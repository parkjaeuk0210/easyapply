import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { locate } from '../src/lib/textmatch';
import { extractHangul } from '../src/lib/server/hangul';

// Small stored ZIPs keep these parser fixtures in memory, without extra dependencies.
function zip(entries: Record<string, string>) {
  const local: Buffer[] = [], directory: Buffer[] = [];
  let offset = 0;
  for (const [pathname, content] of Object.entries(entries)) {
    const name = Buffer.from(pathname), data = Buffer.from(content), checksum = crc32(data);
    const header = Buffer.alloc(30), central = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4);
    header.writeUInt32LE(checksum, 14); header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16); central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    local.push(header, name, data); directory.push(central, name);
    offset += header.length + name.length + data.length;
  }
  const end = Buffer.alloc(22), central = Buffer.concat(directory);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, central, end]);
}

async function extract(span: string | null, image = false) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
      <hp:p><hp:run><hp:t>2026년 청년 월세 지원 공고. 가구별 소득 기준은 아래 표를 확인해 주세요.</hp:t></hp:run></hp:p>
      <hp:tbl><hp:tr><hp:tc>${span === null ? '' : `<hp:cellSpan ${span}/>`}
        <hp:subList><hp:p><hp:run><hp:t>청년 가구 소득 기준</hp:t></hp:run></hp:p></hp:subList>
      </hp:tc><hp:tc><hp:cellSpan rowSpan="1" colSpan="1"/>
        <hp:subList><hp:p><hp:run><hp:t>기준 중위소득 60% 이하</hp:t></hp:run></hp:p></hp:subList>
      </hp:tc></hp:tr></hp:tbl>
    </hs:sec>`;
  const entries: Record<string, string> = { 'Contents/section0.xml': xml };
  if (image) entries['BinData/image1.png'] = 'fixture';
  return extractHangul({ name: 'layout.hwpx', mediaType: 'application/hwp+zip', data: zip(entries) }, new AbortController().signal);
}

test('HWPX ordinary tables remain usable without a layout uncertainty flag', async () => {
  for (const span of [null, 'rowSpan="1" colSpan="1"']) {
    const result = await extract(span);
    assert.equal(result.uncertainLayout, false);
    assert.match(result.sections[0].text, /청년 가구 소득 기준/);
    assert.match(result.sections[0].text, /기준 중위소득 60% 이하/);
  }
});

test('HWPX row and column merges preserve text but require layout verification', async () => {
  for (const span of ['rowSpan="2" colSpan="1"', 'rowSpan="1" colSpan="2"']) {
    const result = await extract(span);
    assert.equal(result.uncertainLayout, true);
    assert.match(result.warning, /표의 셀 관계와 배치/);
    assert.match(result.sections[0].text, /청년 가구 소득 기준/);
    assert.match(result.sections[0].text, /기준 중위소득 60% 이하/);
  }
});

test('HWPX unknown or incomplete cell spans require layout verification', async () => {
  for (const span of ['rowSpan="unknown" colSpan="1"', 'rowSpan="1"']) {
    assert.equal((await extract(span)).uncertainLayout, true);
  }
});

test('HWPX images require verification even when the text table is ordinary', async () => {
  const result = await extract('rowSpan="1" colSpan="1"', true);
  assert.equal(result.uncertainLayout, true);
  assert.match(result.warning, /이미지·도형의 글자는 추출하지 않았/);
  assert.doesNotMatch(result.warning, /표의 셀 관계/);
});

// Synthetic 3.5 KiB CFBs: one inline 2x2 table, no scripts/images; compressed and raw variants.
type RecordView = { tag: number; header: Buffer; data: Buffer };
async function hwp(patch?: (records: RecordView[]) => void, compressed = false) {
  const data = readFileSync(new URL(`./fixtures/simple-table${compressed ? '-compressed' : ''}.hwp`, import.meta.url));
  if (patch) {
    const { CompoundFile } = await import('@mdgate/containers');
    const body = Buffer.from(CompoundFile.open(data).readStream('BodyText/Section0'));
    const start = data.indexOf(body); // This tiny fixture's mini stream is physically contiguous.
    assert.ok(start >= 0);
    const records: RecordView[] = [];
    for (let at = 0; at < body.length;) {
      const header = data.subarray(start + at, start + at + 4), h = header.readUInt32LE(0), size = h >>> 20;
      records.push({ tag: h & 1023, header, data: data.subarray(start + at + 4, start + at + 4 + size) });
      at += 4 + size;
    }
    patch(records);
  }
  return extractHangul({ name: 'table.hwp', mediaType: 'application/x-hwp', data }, new AbortController().signal);
}

test('HWP5 complete horizontal grids preserve row order and exact cross-cell quotations', async () => {
  for (const compressed of [false, true]) {
    const result = await hwp(undefined, compressed);
    assert.equal(result.uncertainLayout, false);
    assert.equal(result.sections[0].text, '연령 조건\n만 19세 이상 39세 이하인 청년만 신청할 수 있습니다.\n거주 조건\n신청일 기준 이 지역에 1년 이상 거주해야 합니다.');
    for (const quote of ['연령 조건 만 19세 이상 39세 이하인 청년만 신청할 수 있습니다.', '거주 조건 신청일 기준 이 지역에 1년 이상 거주해야 합니다.']) {
      const found = locate(result.index, 1, quote);
      assert.equal(found.status, 'exact'); assert.equal(found.page, 1); assert.equal(found.items.length, 2);
    }
    assert.doesNotMatch(result.warning, /표의 셀 관계/);
  }
});

test('HWP5 ambiguous grids and unsupported content never clear layout uncertainty', async (t) => {
  const cases: [string, (records: RecordView[]) => void][] = [
    ...[['column merge', 12, 2], ['row merge', 14, 2], ['unknown span', 12, 0], ['vertical cell', 4, 1],
      ['out of order', 8, 1], ['out of bounds row', 10, 9], ['missing paragraph', 0, 2]].map(([name, offset, value]) =>
      [String(name), (r: RecordView[]) => r.find(x => x.tag === 72)!.data.writeUInt16LE(Number(value), Number(offset))] as [string, (r: RecordView[]) => void]),
    ['missing text record', r => { const x = r.filter(x => x.tag === 67).at(-1)!; x.header.writeUInt32LE((x.header.readUInt32LE(0) & ~1023) | 68); }],
    ['incorrect text length', r => r.filter(x => x.tag === 66)[1].data.writeUInt32LE(999, 0)],
    ['unknown control bytes', r => { r.find(x => x.tag === 71)!.data[0] |= 0x80; }],
    ['inline surrounding text', r => r.find(x => x.tag === 67)!.data.writeUInt16LE(65, 16)],
    ['inconsistent row size', r => r.find(x => x.tag === 77)!.data.writeUInt16LE(1, 18)],
    ['zero dimensions', r => r.find(x => x.tag === 77)!.data.writeUInt16LE(0, 4)],
    ['duplicate cell', r => r.filter(x => x.tag === 72)[1].data.writeUInt16LE(0, 8)],
    ['missing cell', r => { const x = r.find(x => x.tag === 72)!; x.header.writeUInt32LE((x.header.readUInt32LE(0) & ~1023) | 70); }],
    ['missing table metadata', r => { const x = r.find(x => x.tag === 77)!; x.header.writeUInt32LE((x.header.readUInt32LE(0) & ~1023) | 70); }],
    ['nested table', r => { const x = r.find(x => x.tag === 77)!; x.header.writeUInt32LE(x.header.readUInt32LE(0) + (2 << 10)); }],
    ['floating table', r => r.find(x => x.tag === 71 && x.data.toString('ascii', 0, 4) === ' lbt')!.data.writeUInt32LE(0, 4)],
    ['vertical section', r => r.find(x => x.tag === 71 && x.data.toString('ascii', 0, 4) === 'dces')!.data.writeUInt32LE(0x10000, 4)],
    ...[76, 85, 88].map(tag => [`unsupported shape/equation ${tag}`, (r: RecordView[]) => { const x = r.find(x => x.tag === 71)!; x.header.writeUInt32LE((x.header.readUInt32LE(0) & ~1023) | tag); }] as [string, (r: RecordView[]) => void]),
  ];
  for (const [name, patch] of cases) await t.test(name, async () => {
    const result = await hwp(patch);
    assert.equal(result.uncertainLayout, true);
    assert.match(result.sections[0].text, /만 19세 이상 39세 이하/);
  });
});

test('HWP5 empty cells and line breaks do not lose subsequent cell text', async () => {
  const result = await hwp(r => {
    const texts = r.filter(x => x.tag === 67);
    for (let at = 0; at < texts[1].data.length - 2; at += 2) texts[1].data.writeUInt16LE(32, at);
    texts[3].data.writeUInt16LE(10, 4); // A line break instead of the label's space.
  });
  assert.equal(result.uncertainLayout, false);
  assert.equal(locate(result.index, 1, '거주 조건 신청일 기준 이 지역에 1년 이상 거주해야 합니다.').status, 'exact');
});

test('HWP5 truncated cell records fail closed', async () => {
  await assert.rejects(hwp(r => {
    const cell = r.find(x => x.tag === 72)!;
    cell.header.writeUInt32LE((16 << 20) | (2 << 10) | 72);
  }), /손상되었거나 지원하지 않는 구조/);
});
