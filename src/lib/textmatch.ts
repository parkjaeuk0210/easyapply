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

// 따옴표는 모양과 관계없이 하나로 본다(「」『』 포함). NFKC가 먼저 바꾸는 글자(～ 등)는 넣지 않는다.
const CHAR_MAP: Record<string, string> = {
  '"': "'",
  "“": "'",
  "”": "'",
  "„": "'",
  "‘": "'",
  "’": "'",
  "「": "'",
  "」": "'",
  "『": "'",
  "』": "'",
  "‧": "·",
  "∙": "·",
  "•": "·",
  "・": "·",
  "⋅": "·",
  "‐": "-",
  "‒": "-",
  "–": "-",
  "—": "-",
  "―": "-",
  "−": "-",
  "〜": "~",
  "∼": "~",
};
// 보이지 않는 글자(소프트 하이픈·폭 없는 공백), 글꼴 전용 사용자 정의 영역 글자, 목록 불릿은 지운다.
const DROP = /[\u00AD\u200B-\u200D\uE000-\uF8FF■□▪▫○●◦]/;
const CHOSEONG = /[\u1100-\u115F\uA960-\uA97F]/;
// 앞 글자와 합쳐질 수 있는 글자(결합 부호, 한글 중성·종성 자모)는 같은 조각으로 묶어 정규화한다.
const JOINS_PREVIOUS = /[\p{M}\u1160-\u11FF\uD7B0-\uD7FF]/u;

// 원문자 숫자는 NFKC가 그냥 숫자로 바꿔 '① 2회'가 '12회'가 되므로 괄호 숫자로 먼저 바꾼다.
function circled(ch: string) {
  const c = ch.codePointAt(0)!;
  if (c >= 0x2460 && c <= 0x2473) return `(${c - 0x245f})`;
  if (c >= 0x3251 && c <= 0x325f) return `(${c - 0x323c})`;
  if (c >= 0x32b1 && c <= 0x32bf) return `(${c - 0x328d})`;
  return ch === "⓪" ? "(0)" : ch;
}

function normalizeSegment(segment: string) {
  let out = "", prev = "";
  for (const ch of [...segment].map(circled).join("").replace(/ㆍ/g, "·").normalize("NFKC")) {
    // 아래아(U+119E)는 초성 뒤의 옛한글 모음일 때만 남기고, 홀로 쓰인 것은 가운뎃점으로 본다.
    if (ch === "\u119E" && !CHOSEONG.test(prev)) out += "·";
    else if (!/\s/.test(ch) && !DROP.test(ch)) out += CHAR_MAP[ch] ?? ch.toLowerCase();
    prev = ch;
  }
  return out;
}

// 정규화 결과와, 정규화된 글자(UTF-16 단위)마다 원문의 [시작, 끝) 위치.
// 색인과 하이라이트가 같은 함수를 써서 분해된 한글(NFD)에서도 위치가 어긋나지 않는다.
function normalizeParts(s: string, track: boolean) {
  let norm = "", segment = "", start = 0, offset = 0;
  const from: number[] = [], to: number[] = [];
  const flush = () => {
    const out = segment ? normalizeSegment(segment) : "";
    norm += out;
    for (let k = 0; track && k < out.length; k++) {
      from.push(start);
      to.push(offset);
    }
    segment = "";
    start = offset;
  };
  for (const ch of s) {
    if (segment && !JOINS_PREVIOUS.test(ch)) flush();
    segment += ch;
    offset += ch.length;
  }
  flush();
  return { norm, from, to };
}

export function normalize(s: string): string {
  return normalizeParts(s, false).norm;
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
  const { from, to } = normalizeParts(raw, true);
  if (!from.length) return [0, raw.length];
  return [from[Math.min(nFrom, from.length - 1)], to[Math.min(Math.max(nTo, nFrom + 1), to.length) - 1]];
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
