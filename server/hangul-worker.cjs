// Runs in a bounded worker. Never evaluates document scripts or opens external URLs.
/* eslint-disable @typescript-eslint/no-require-imports -- Node worker entry is deliberately CommonJS for deployment tracing. */
const { parentPort, workerData } = require('node:worker_threads');
const zlib = require('node:zlib');
const { inflateRawSync } = zlib;
// zlib.crc32 exists from Node 22.2; the bitwise fallback keeps older 22.x runtimes from rejecting every HWPX.
const crc32 = zlib.crc32 ?? ((data) => {
  let c = ~0;
  for (const byte of data) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
});
const MAX = 8 * 1024 * 1024;
function fail(message) { throw new Error(message); }
(async () => {
  const { CompoundFile, parseXml } = await import('@mdgate/containers');
  const bytes = Buffer.from(workerData.bytes);
  const maxExtractedChars = workerData.maxExtractedChars;
  if (!Number.isSafeInteger(maxExtractedChars) || maxExtractedChars <= 0) fail('invalid');
  let sections = [], images = 0, uncertainLayout = false;
  if (workerData.format === 'hwp') {
    const cfb = CompoundFile.open(bytes);
    if (!cfb.exists('FileHeader')) fail('invalid');
    const header = Buffer.from(cfb.readStream('FileHeader'));
    if (header.length < 40 || header.toString('ascii', 0, 17) !== 'HWP Document File' || header[35] !== 5) fail('version');
    const flags = header.readUInt32LE(36);
    if (flags & (2 | 4 | 256 | 512 | 1024)) fail('encrypted');
    const compressed = !!(flags & 1);
    if (!cfb.exists('DocInfo')) fail('invalid');
    const docRaw = Buffer.from(cfb.readStream('DocInfo'));
    const docInfo = compressed ? inflateRawSync(docRaw, { maxOutputLength: MAX }) : docRaw;
    // HWPTAG_DOCUMENT_PROPERTIES is the first DocInfo record; its first uint16 is section count.
    if (docInfo.length < 6 || (docInfo.readUInt32LE(0) & 1023) !== 16) fail('invalid');
    const docLength = docInfo.readUInt32LE(0) >>> 20;
    const docOffset = docLength === 4095 ? 8 : 4;
    if (docInfo.length < docOffset + 2) fail('invalid');
    const sectionCount = docInfo.readUInt16LE(docOffset);
    if (!sectionCount || sectionCount > 100) fail('too_long');
    let total = docInfo.length;
    for (let n = 0; n < sectionCount; n++) {
      if (!cfb.exists(`BodyText/Section${n}`)) fail('invalid');
      const raw = Buffer.from(cfb.readStream(`BodyText/Section${n}`));
      const data = compressed ? inflateRawSync(raw, { maxOutputLength: MAX }) : raw;
      total += data.length; if (total > 32 * 1024 * 1024) fail('too_long');
      const lines = [];
      let at = 0;
      while (at < data.length) {
        if (at + 4 > data.length) fail('invalid');
        const h = data.readUInt32LE(at); at += 4;
        const tag = h & 1023;
        let length = h >>> 20;
        if (length === 4095) { if (at + 4 > data.length) fail('invalid'); length = data.readUInt32LE(at); at += 4; }
        if (at + length > data.length) fail('invalid');
        // HWPTAG_TABLE: table cells are flattened into separate lines, so their relations are lost.
        if (tag === 77) uncertainLayout = true;
        if (tag === 67) {
          const para = data.subarray(at, at + length);
          if (para.length % 2) fail('invalid');
          let s = '';
          for (let i = 0; i < para.length;) {
            const ch = para.readUInt16LE(i); i += 2;
            if (ch >= 32) { if (ch !== 65535 && ch !== 65534) s += String.fromCharCode(ch); }
            else if (ch === 10 || ch === 13) s += '\n';
            else if ([0, 24, 25, 30, 31].includes(ch)) { if (ch) s += ' '; }
            else { if (i + 14 > para.length) fail('invalid'); if (ch === 9) s += '\t'; i += 14; }
          }
          if (s.trim()) lines.push(s.trim());
        }
        at += length;
      }
      sections.push(lines.join('\n'));
    }
    if (cfb.exists(`BodyText/Section${sectionCount}`)) fail('invalid');
    if (!sections.length) fail('no_text'); // Never fall back to the truncated PrvText stream.
    images = cfb.exists('BinData') ? 1 : 0;
  } else {
    // Read the central directory first, reject zip bombs before decompression.
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (bytes.readUInt32LE(i) === 0x06054b50) { end = i; break; }
    }
    if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) fail('invalid');
    const count = bytes.readUInt16LE(end + 10), offset = bytes.readUInt32LE(end + 16);
    if (count > 1000 || count === 65535) fail('too_long');
    let at = offset, total = 0;
    const entries = new Map();
    for (let n = 0; n < count; n++) {
      if (at + 46 > end || bytes.readUInt32LE(at) !== 0x02014b50) fail('invalid');
      const flags = bytes.readUInt16LE(at + 8), method = bytes.readUInt16LE(at + 10);
      const crc = bytes.readUInt32LE(at + 16), compressed = bytes.readUInt32LE(at + 20), size = bytes.readUInt32LE(at + 24);
      const namesize = bytes.readUInt16LE(at + 28), extrasize = bytes.readUInt16LE(at + 30), comment = bytes.readUInt16LE(at + 32);
      const local = bytes.readUInt32LE(at + 42);
      if (at + 46 + namesize + extrasize + comment > end) fail('invalid');
      const name = bytes.toString('utf8', at + 46, at + 46 + namesize);
      if (flags & 1) fail('encrypted');
      total += size;
      if (size > MAX || total > 32 * 1024 * 1024) fail('too_long');
      if (entries.has(name)) fail('invalid');
      entries.set(name, { method, size, compressed, local, crc });
      at += 46 + namesize + extrasize + comment;
    }
    // Reads one entry and rejects size or CRC32 mismatches (a silently altered number must not be analysed).
    const read = (name) => {
      const e = entries.get(name), p = e.local;
      if (p + 30 > bytes.length || bytes.readUInt32LE(p) !== 0x04034b50) fail('invalid');
      const start = p + 30 + bytes.readUInt16LE(p + 26) + bytes.readUInt16LE(p + 28);
      if (start + e.compressed > offset) fail('invalid');
      const input = bytes.subarray(start, start + e.compressed);
      const data = e.method === 0 ? input : e.method === 8 ? inflateRawSync(input, { maxOutputLength: MAX }) : fail('invalid');
      if (data.length !== e.size || crc32(data) !== e.crc) fail('invalid');
      if (/<!DOCTYPE|<!ENTITY/i.test(data.toString('utf8'))) fail('invalid');
      return data;
    };
    const names = [...entries.keys()].filter(n => /^Contents\/section\d+\.xml$/i.test(n)).sort((a,b) => Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0]));
    if (!names.length || names.length > 100) fail('invalid');
    // Every body section the package manifest lists in its spine must be present.
    if (entries.has('Contents/content.hpf')) {
      const pkg = parseXml(read('Contents/content.hpf'));
      const items = new Map(), spine = [];
      const scan = (node, depth = 0) => {
        if (depth > 100) fail('too_long');
        if (node.local === 'item') items.set(node.attrAny('id'), node.attrAny('href'));
        if (node.local === 'itemref') spine.push(node.attrAny('idref'));
        node.childElems().forEach(child => scan(child, depth + 1));
      };
      scan(pkg);
      for (const href of spine.map(id => items.get(id) ?? '')) {
        if (/section\d+\.xml$/i.test(href) && !entries.has(href) && !entries.has(`Contents/${href}`)) fail('invalid');
      }
    }
    for (const name of names) {
      const root = parseXml(read(name));
      const walk = (node, depth = 0) => {
        if (depth > 100) fail('too_long');
        // Flattening cannot preserve merged-cell relationships or unknown spans.
        if (node.local === 'cellSpan' && ['rowSpan', 'colSpan'].some(name => Number(node.attrAny(name)) !== 1)) uncertainLayout = true;
        if (node.local === 't') return node.text();
        if (node.local === 'tab') return '\t';
        if (/lineBreak/i.test(node.local)) return '\n';
        let text = node.childElems().map(n => walk(n, depth + 1)).join('');
        if (node.local === 'tc') text = text.trim() + '\t';
        if (['p', 'tr', 'tbl'].includes(node.local)) text += '\n';
        return text;
      };
      sections.push(walk(root).trim());
    }
    images = [...entries.keys()].filter(n => /^BinData\//i.test(n)).length;
  }
  const text = sections.join('\n\n');
  if (text.trim().length < 40) fail('no_text');
  if (text.length > maxExtractedChars) fail('too_long');
  parentPort.postMessage({ sections, images, uncertainLayout });
})().catch(e => parentPort.postMessage({ error: ['encrypted','version','too_long','no_text'].includes(e.message) ? e.message : 'invalid' }));
