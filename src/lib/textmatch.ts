/**
 * AI가 인용한 근거 문장(quote)을 실제 공고문 텍스트에서 찾아내는 모듈.
 * - PDF: pdf.js 텍스트 레이어의 item 단위로 색인 → 찾은 item에 하이라이트
 * - 이미지: AI가 옮겨 적은 transcript의 줄 단위로 색인
 * 띄어쓰기·전각문자·따옴표 모양 차이는 무시하고 비교한다.
 */

export type PageItems = { page: number; items: string[] };

export type IndexedPage = {
  page: number;
  raw: string[];
  norm: string; // item별 정규화 문자열을 이어 붙인 것
  starts: number[]; // item i 의 norm 시작 위치
  ends: number[];
};

export type TextIndex = {
  source: "pdf" | "transcript" | "extracted";
  pages: IndexedPage[];
  hasText: boolean;
};

export type Located = {
  status: "exact" | "fuzzy" | "none" | "unknown";
  page: number;
  items: number[]; // 하이라이트할 item(줄) 번호
  /** item 번호 → 그 item 문자열 안에서 하이라이트할 [시작, 끝) 글자 위치 */
  ranges: Record<number, [number, number]>;
};

const CHAR_MAP: Record<string, string> = {
  "“": '"',
  "”": '"',
  "„": '"',
  "‘": "'",
  "’": "'",
  "‧": "·",
  "∙": "·",
  "•": "·",
  "ㆍ": "·",
  "・": "·",
  "–": "-",
  "—": "-",
  "―": "-",
  "−": "-",
  "～": "~",
  "〜": "~",
};

export function normalize(s: string): string {
  let out = "";
  for (const ch of s.normalize("NFKC")) {
    if (/\s/.test(ch)) continue;
    out += CHAR_MAP[ch] ?? ch.toLowerCase();
  }
  return out;
}

export function buildIndex(pages: PageItems[], source: TextIndex["source"]): TextIndex {
  const indexed = pages.map(({ page, items }) => {
    let norm = "";
    const starts: number[] = [];
    const ends: number[] = [];
    for (const it of items) {
      starts.push(norm.length);
      norm += normalize(it);
      ends.push(norm.length);
    }
    return { page, raw: items, norm, starts, ends };
  });
  return { source, pages: indexed, hasText: indexed.some((p) => p.norm.length > 20) };
}

function itemsIn(p: IndexedPage, from: number, to: number) {
  const items: number[] = [];
  const ranges: Record<number, [number, number]> = {};
  for (let i = 0; i < p.starts.length; i++) {
    if (p.ends[i] > from && p.starts[i] < to && p.ends[i] > p.starts[i]) {
      items.push(i);
      ranges[i] = rawRange(p.raw[i], Math.max(0, from - p.starts[i]), Math.min(p.ends[i], to) - p.starts[i]);
    }
  }
  return { items, ranges };
}

// 정규화된 위치 [nFrom, nTo)를 원래 문자열의 글자 위치로 되돌린다.
function rawRange(raw: string, nFrom: number, nTo: number): [number, number] {
  let n = 0;
  let start = -1;
  let end = raw.length;
  let i = 0;
  for (const ch of raw) {
    const w = normalize(ch).length;
    if (start < 0 && w > 0 && n >= nFrom) start = i;
    n += w;
    i += ch.length;
    if (n >= nTo) {
      end = i;
      break;
    }
  }
  return [start < 0 ? 0 : start, end];
}

function fuzzyIn(p: IndexedPage, q: string): { from: number; to: number; score: number } | null {
  // 따옴표 안 문장을 8글자 조각으로 나눠 몇 개나 그 쪽에 있는지 본다.
  const size = q.length >= 24 ? 8 : 5;
  const chunks: string[] = [];
  for (let i = 0; i + size <= q.length; i += size) chunks.push(q.slice(i, i + size));
  if (chunks.length < 2) return null;
  const found: number[] = [];
  let cursor = 0;
  let hits = 0;
  for (const c of chunks) {
    const at = p.norm.indexOf(c, cursor);
    const any = at >= 0 ? at : p.norm.indexOf(c);
    if (any >= 0) {
      hits++;
      found.push(any);
      if (at >= 0) cursor = at + c.length;
    }
  }
  const score = hits / chunks.length;
  if (score < 0.6) return null;
  found.sort((a, b) => a - b);
  // 가장 촘촘하게 모인 구간만 하이라이트
  const from = found[Math.floor(found.length * 0.1)];
  const to = Math.min(found[Math.ceil(found.length * 0.9) - 1] + size, from + q.length * 2);
  return { from, to, score };
}

export function locate(index: TextIndex | null, page: number, quote: string): Located {
  if (!index || !index.hasText) return { status: "unknown", page, items: [], ranges: {} };
  const q = normalize(quote);
  if (q.length < 2) return { status: "none", page, items: [], ranges: {} };

  const ordered = [...index.pages].sort(
    (a, b) => Number(b.page === page) - Number(a.page === page) || a.page - b.page,
  );
  for (const p of ordered) {
    const at = p.norm.indexOf(q);
    if (at >= 0) return { status: "exact", page: p.page, ...itemsIn(p, at, at + q.length) };
  }
  let best: { p: IndexedPage; from: number; to: number; score: number } | null = null;
  for (const p of ordered) {
    const f = fuzzyIn(p, q);
    if (f && (!best || f.score > best.score)) best = { p, ...f };
  }
  if (best) return { status: "fuzzy", page: best.p.page, ...itemsIn(best.p, best.from, best.to) };
  return { status: "none", page, items: [], ranges: {} };
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
