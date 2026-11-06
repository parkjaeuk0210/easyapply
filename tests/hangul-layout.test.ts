import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
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

test('HWPX images still require verification when the table is ordinary', async () => {
  const result = await extract('rowSpan="1" colSpan="1"', true);
  assert.equal(result.uncertainLayout, true);
  assert.match(result.warning, /이미지·도형의 글자는 추출하지 않았/);
});
