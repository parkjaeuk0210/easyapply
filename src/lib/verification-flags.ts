// 원문 대조 결과를 판정에 어떻게 쓰는지 한 곳에서 정한다. 기존 판정(/api/match)과 맞춤 공고 찾기가 같이 쓴다.
//
// 원칙 한 문장: 원문에서 확인된 숫자만 판정에 쓴다.
// - 숫자가 없는 조건(수급자 여부, 재학·휴학, 거주 지역 등)은 답한 대로 충족·미충족을 판정한다.
// - 숫자가 든 조건은 그 숫자가 인용한 쪽의 원문에 실제로 있을 때만 판정한다. 없거나(잘못 읽었을 수 있음)
//   대조할 글자가 없는 스캔본이면 충족·미충족 모두 '확인 필요'로 둔다.
// 덧붙여, 한글 파일의 그림 속 글자는 읽지 못하므로 조건이 모두 맞아도 공고 전체를 '가능'으로 확정하지 않는다.
//
// 서명 토큰과 응답의 verification.flags에는 문자열 목록 하나로 담는다:
//   "c3"      원문 인용이 글자 그대로 맞지 않은 조건(기록용)
//   "c3#n"    숫자를 원문에서 확인하지 못한 조건
//   "#images" 그림 속 글자를 읽지 못한 문서
import type { Analysis, Evidence } from "./schema";
import type { TextIndex } from "./textmatch";

export const UNREAD_IMAGES = "#images";

/**
 * 인용 속 숫자가 인용한 쪽(앞뒤 한 쪽 포함)의 원문에 모두 실제로 있는지. 인용 문장 전체가 표 배치 때문에
 * 글자 그대로 안 맞아도, 숫자가 원문에 있으면 AI가 숫자를 잘못 읽은 것은 아니다. 숫자가 하나도 없으면 false.
 */
export function numbersFound(evidence: Evidence[], index: TextIndex | null): boolean {
  if (!index?.hasText) return false;
  let any = false;
  for (const e of evidence) {
    const numbers = e.quote.match(/\d+/g) ?? [];
    const pages = index.pages.filter((p) => Math.abs(p.page - e.page) <= 1).map((p) => p.norm);
    for (const n of numbers) {
      any = true;
      if (!pages.some((text) => new RegExp(`(^|\\D)${n}(?!\\d)`).test(text))) return false;
    }
  }
  return any;
}

export function buildFlags(a: Analysis, v: { unverified_criteria: string[] }, unreadImages: boolean, index: TextIndex | null = null): string[] {
  const flags = [...v.unverified_criteria];
  for (const id of v.unverified_criteria) {
    const c = a.eligibility.find((e) => e.id === id);
    const quotes = c?.evidence.map((e) => e.quote).join(" ").trim();
    if (c && /\d/.test(quotes || c.requirement) && !numbersFound(c.evidence, index)) flags.push(`${id}#n`);
  }
  if (unreadImages) flags.push(UNREAD_IMAGES);
  return flags;
}

export function readFlags(flags: string[] = []) {
  return {
    /** 숫자를 원문에서 확인하지 못해 충족·미충족 모두 단정하지 않을 조건 */
    doubt: new Set(flags.filter((f) => f.endsWith("#n")).map((f) => f.slice(0, -2))),
    unreadImages: flags.includes(UNREAD_IMAGES),
  };
}
