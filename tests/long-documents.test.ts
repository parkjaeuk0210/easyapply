import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32 } from "node:zlib";
import { MAX_DOCUMENT_PAGES, MAX_EXTRACTED_CHARS } from "../src/lib/document-limits";
import { extractHangul } from "../src/lib/server/hangul";
import { inspectPdf } from "../src/lib/server/uploads";
import { locate } from "../src/lib/textmatch";

// Generate small, real PDFs in memory; no PDF-writing dependency or fixture cache is needed.
function pdf(pages: string[][]) {
  const objects: string[] = ["", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const kids: string[] = [];
  for (const lines of pages) {
    const pageId = objects.length + 1, contentId = pageId + 1;
    kids.push(`${pageId} 0 R`);
    const escaped = lines.map(line => line.replace(/[\\()]/g, "\\$&"));
    const stream = `BT /F1 8 Tf 10 TL 36 806 Td\n${escaped.map(line => `(${line}) Tj T*`).join("\n")}\nET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;
  const chunks: Buffer[] = [Buffer.from("%PDF-1.7\n")], offsets = [0];
  let size = chunks[0].length;
  objects.forEach((object, i) => {
    offsets.push(size);
    const chunk = Buffer.from(`${i + 1} 0 obj\n${object}\nendobj\n`);
    chunks.push(chunk); size += chunk.length;
  });
  const xref = `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF\n`;
  return Buffer.concat([...chunks, Buffer.from(xref)]);
}

function hwpx(sections: string[]) {
  const local: Buffer[] = [], directory: Buffer[] = [];
  let offset = 0;
  sections.forEach((text, i) => {
    const name = Buffer.from(`Contents/section${i}.xml`);
    const data = Buffer.from(`<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"><hp:p><hp:run><hp:t>${text}</hp:t></hp:run></hp:p></hs:sec>`);
    const checksum = crc32(data), header = Buffer.alloc(30), central = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4);
    header.writeUInt32LE(checksum, 14); header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16); central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    local.push(header, name, data); directory.push(central, name);
    offset += header.length + name.length + data.length;
  });
  const end = Buffer.alloc(22), central = Buffer.concat(directory);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(sections.length, 8);
  end.writeUInt16LE(sections.length, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return { name: "long.hwpx", mediaType: "application/hwp+zip", data: Buffer.concat([...local, central, end]) };
}

test("200-page PDFs keep every page and exact evidence after the old 200k-character limit", async () => {
  const pages = Array.from({ length: MAX_DOCUMENT_PAGES }, (_, i) => [
    `Page ${i + 1}: eligibility evidence remains readable.`,
    ...Array.from({ length: 24 }, (_, line) => `P${i + 1} line ${line + 1}: ${"support criteria ".repeat(4)}`),
    `Final evidence on page ${i + 1}: apply at the local office.`,
  ]);
  const result = await inspectPdf({ name: "200-pages.pdf", mediaType: "application/pdf", data: pdf(pages) }, new AbortController().signal);
  assert.equal(result.pages, 200);
  assert.equal(result.index.pages.length, 200);
  assert.ok(result.index.pages.reduce((sum, page) => sum + page.raw.join("").length, 0) > 200_000);
  for (const page of [1, 101, 200]) {
    const quote = `Final evidence on page ${page}: apply at the local office.`;
    const match = locate(result.index, page, quote);
    assert.equal(match.status, "exact");
    assert.equal(match.page, page);
  }
});

test("201-page PDFs fail explicitly instead of accepting a truncated first 200 pages", async () => {
  const data = pdf(Array.from({ length: MAX_DOCUMENT_PAGES + 1 }, () => []));
  await assert.rejects(inspectPdf({ name: "201-pages.pdf", mediaType: "application/pdf", data }, new AbortController().signal), {
    code: "too_many_pages", status: 413,
  });
});

test("PDF extraction still rejects text beyond the one-million-character budget", async () => {
  const line = "A documented eligibility condition. ".repeat(2);
  const data = pdf(Array.from({ length: MAX_DOCUMENT_PAGES }, () => Array.from({ length: 75 }, () => line)));
  assert.ok(line.length * 75 * MAX_DOCUMENT_PAGES > MAX_EXTRACTED_CHARS);
  await assert.rejects(inspectPdf({ name: "too-much-text.pdf", mediaType: "application/pdf", data }, new AbortController().signal), {
    code: "too_long", status: 413,
  });
});

test("HWPX preserves one million characters including the final evidence", async () => {
  const quote = "마지막 근거도 빠짐없이 신청 안내에 포함됩니다.";
  const text = "가".repeat(MAX_EXTRACTED_CHARS - quote.length) + quote;
  const result = await extractHangul(hwpx([text]), new AbortController().signal);
  assert.equal(result.sections.map(section => section.text).join(""), text);
  const page = result.sections.at(-1)!.page;
  assert.equal(locate(result.index, page, quote).status, "exact");
});

test("HWPX over the character budget fails instead of returning an incomplete body", async () => {
  await assert.rejects(extractHangul(hwpx(["가".repeat(MAX_EXTRACTED_CHARS + 1)]), new AbortController().signal), {
    code: "invalid_hangul", status: 422,
  });
});

test("100 native Hangul sections fit the 200-section evidence range at the text budget", async () => {
  // Each native section may add a final partial 12k display section. This is the worst case.
  const nativeSections = ["가".repeat(MAX_EXTRACTED_CHARS - 99 * 3), ...Array.from({ length: 99 }, () => "나")];
  assert.equal(nativeSections.join("\n\n").length, MAX_EXTRACTED_CHARS);
  const result = await extractHangul(hwpx(nativeSections), new AbortController().signal);
  assert.equal(result.sections.length, 183);
  assert.ok(result.sections.length <= MAX_DOCUMENT_PAGES);
  assert.equal(result.sections.map(section => section.text).join(""), nativeSections.join(""));
  assert.equal(result.sections.at(-1)!.page, 183);
});
