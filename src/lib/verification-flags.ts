// 원문 대조 결과를 판정에 어떻게 쓰는지 한 곳에서 정한다. 기존 판정(/api/match)과 맞춤 공고 찾기가 같이 쓴다.
//
// 원칙: 사용자가 답한 내용으로 분명히 맞거나 분명히 안 맞는 조건은 다시 확인하라고 하지 않는다.
// 원문 인용이 표 배치·띄어쓰기 때문에 글자 그대로 안 맞는 일은 흔하다. 위험한 것은 숫자를 잘못 읽은 경우뿐이다.
// - 숫자가 없는 조건(수급자 여부, 재학·휴학, 거주 지역 등): 인용이 안 맞아도 충족·미충족 모두 답한 대로 쓴다.
// - 글자가 있는 문서인데 숫자가 든 인용이 원문과 안 맞음(만 34세를 35세로 읽었을 수 있음): 충족·미충족 모두 단정하지 않는다.
// - 스캔본(대조할 글자가 없어 AI가 읽은 내용)의 숫자 조건: 충족은 쓰고, 미충족은 단정하지 않는다(잘못 읽은 숫자로 포기하지 않게).
// - 한글 파일의 그림 속 글자는 읽지 못하므로, 조건이 모두 맞아도 공고 전체를 '가능'으로 확정하지 않는다.
//
// 서명 토큰과 응답의 verification.flags에는 문자열 목록 하나로 담는다:
//   "c3"      원문 인용이 정확히 맞지 않은 조건(기록용)
//   "c3#n"    글자가 있는 원문에서 숫자가 든 인용을 확인하지 못한 조건
//   "c3#s"    스캔본에서 숫자가 든 조건
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

export function buildFlags(a: Analysis, v: { unverified_criteria: string[]; method: string }, unreadImages: boolean, index: TextIndex | null = null): string[] {
  const scanned = v.method === "unverified_scan_or_image";
  const flags = [...v.unverified_criteria];
  for (const id of v.unverified_criteria) {
    const c = a.eligibility.find((e) => e.id === id);
    const quotes = c?.evidence.map((e) => e.quote).join(" ").trim();
    if (!c || !/\d/.test(quotes || c.requirement)) continue;
    if (scanned) flags.push(`${id}#s`);
    else if (!numbersFound(c.evidence, index)) flags.push(`${id}#n`);
  }
  if (unreadImages) flags.push(UNREAD_IMAGES);
  return flags;
}

export function readFlags(flags: string[] = []) {
  return {
    /** '충족'으로 단정하지 않을 조건 */
    doubtMet: new Set(flags.filter((f) => f.endsWith("#n")).map((f) => f.slice(0, -2))),
    /** '맞지 않음'으로 단정하지 않을 조건 */
    doubtNotMet: new Set(flags.filter((f) => f.endsWith("#n") || f.endsWith("#s")).map((f) => f.slice(0, -2))),
    unreadImages: flags.includes(UNREAD_IMAGES),
  };
}
