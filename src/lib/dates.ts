import type { Analysis, Match } from "./schema";
import { contentKey } from "./client-api";

export function todayLocalISO() {
  return kstISO(new Date());
}

/** 주어진 시각의 한국 날짜(YYYY-MM-DD). */
export function kstISO(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function parseISO(iso: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? date : null;
}

export function daysUntil(iso: string | null | undefined, today = todayLocalISO()): number | null {
  if (!iso) return null;
  const a = parseISO(today);
  const b = parseISO(iso);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function ddayLabel(days: number | null) {
  if (days === null) return null;
  if (days === 0) return "D-DAY";
  return days > 0 ? `D-${days}` : "마감";
}

const WD = ["일", "월", "화", "수", "목", "금", "토"];
export function shortDate(iso: string | null | undefined) {
  const d = iso ? parseISO(iso) : null;
  if (!d) return null;
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WD[d.getUTCDay()]})`;
}

export function applicationDeadlines(a: Analysis) {
  return a.schedule.filter((s) => s.is_deadline && s.is_application_deadline && !OPEN_ENDED.test(`${s.label} ${s.date_text}`));
}

type Dated = { date_iso: string | null; time: string | null };

/** 마감 시각(KST). 시각이 적혀 있으면 그 시각, 날짜만 있으면 그날 23:59:59. 날짜가 없으면 null. */
export function deadlineEnd(s: Dated): Date | null {
  if (!s.date_iso || !parseISO(s.date_iso)) return null;
  const time = s.time && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s.time) ? `${s.time}:00` : "23:59:59";
  return new Date(`${s.date_iso}T${time}+09:00`);
}

/** 서버 판정과 화면이 함께 쓰는 마감 경과 여부. 날짜를 모르면 false. */
export function deadlinePassed(s: Dated, now = new Date()) {
  const end = deadlineEnd(s);
  return !!end && now.getTime() > end.getTime();
}

/** 화면 D-day용 남은 일수. 마감 시각이 지났으면 같은 날이어도 -1(마감). */
export function deadlineDays(s: Dated | null | undefined, now = new Date()) {
  if (!s || !deadlineEnd(s)) return null;
  return deadlinePassed(s, now) ? -1 : daysUntil(s.date_iso, kstISO(now));
}

export function mainDeadline(a: Analysis, today = todayLocalISO(), now = today === todayLocalISO() ? new Date() : new Date(`${today}T00:00:00+09:00`)) {
  const deadlines = applicationDeadlines(a)
    .filter((s) => deadlineEnd(s))
    .sort((x, y) => deadlineEnd(x)!.getTime() - deadlineEnd(y)!.getTime());
  if (!deadlines.length) return null;
  // 아직 지나지 않은 가장 이른 마감, 없으면 마지막 마감
  return deadlines.find((s) => !deadlinePassed(s, now)) ?? deadlines[deadlines.length - 1];
}

// ── 한국어 날짜 표기 해석 ─────────────────────────────────────────

export type DateMention = {
  /** 원문(또는 같은 기간 표기의 앞 날짜)에 적힌 연도. 없으면 null */
  year: number | null;
  month: number;
  day: number;
  /** 0=일 … 6=토. 원문에 요일이 없으면 null */
  weekday: number | null;
  /** HH:MM. 자정·24:00은 23:59 */
  time: string | null;
  /** '09:00~18:00'처럼 하루 안의 시간 범위가 있으면 끝 시각 */
  timeEnd: string | null;
  midnight: boolean;
  /** 기간 표기 'A ~ B'의 끝 날짜(A에만 붙는다). 끝 날짜도 목록에 따로 들어간다. */
  rangeEnd: DateMention | null;
  /** 원문에서 이 날짜 표기(요일·시각 포함)가 끝나는 위치 */
  end: number;
};

const WEEKDAYS = "일월화수목금토";
const FULL_DATES = [
  /(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/y,
  /(\d{4})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{1,2})(?!\d)\.?/y,
  /['’‘`]\s*(\d{2})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{1,2})(?!\d)\.?/y,
];
const MONTH_DAY_KO = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/y;
const MONTH_DAY = /(\d{1,2})\s*\.\s*(\d{1,2})(?!\d)(\.(?!\d))?/y;
const DAY_ONLY = /(\d{1,2})\s*일|(\d{1,2})(?=\s*\(\s*[일월화수목금토])/y;
const WEEKDAY = /\s*(?:\.\s*)?(?:\(\s*([일월화수목금토])(?:요일)?\s*\)|([일월화수목금토])요일)/y;
const CLOCK = /\s*(?:(오전|오후)\s*)?(\d{1,2})\s*(?::\s*(\d{2})|시(?!간)(?:\s*(\d{1,2})\s*분)?)/y;
const NAMED_TIME = /\s*(자정|정오)/y;
const TIME_RANGE_END = /\s*[~∼～〜\-–]\s*(\d{1,2}):(\d{2})/y;
const RANGE = /\s*(?:~|∼|～|〜|–|-|부터)\s*/y;
const SIGNAL = /\s*(?:\(\s*[일월화수목금토]|\d{1,2}\s*:|(?:오전|오후)|자정|정오|까지)/y;

function at(re: RegExp, text: string, pos: number) {
  re.lastIndex = pos;
  return re.exec(text);
}

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

// 날짜 뒤의 요일·시각을 읽는다.
function readTail(text: string, pos: number) {
  let weekday: number | null = null, time: string | null = null, timeEnd: string | null = null, midnight = false;
  const w = at(WEEKDAY, text, pos);
  if (w) { weekday = WEEKDAYS.indexOf(w[1] ?? w[2]); pos += w[0].length; }
  const named = at(NAMED_TIME, text, pos);
  const clock = named ? null : at(CLOCK, text, pos);
  if (named) {
    if (named[1] === "자정") { time = "23:59"; midnight = true; } else time = "12:00";
    pos += named[0].length;
  } else if (clock) {
    let hour = Number(clock[2]);
    const minute = Number(clock[3] ?? clock[4] ?? 0);
    if (clock[1] === "오후" && hour < 12) hour += 12;
    if (clock[1] === "오전" && hour === 12) hour = 0;
    if (hour === 24 && minute === 0) { time = "23:59"; midnight = true; }
    else if (hour < 24 && minute < 60) time = `${pad(hour)}:${pad(minute)}`;
    if (time) {
      pos += clock[0].length;
      const range = at(TIME_RANGE_END, text, pos);
      if (range && Number(range[1]) < 24 && Number(range[2]) < 60) { timeEnd = `${pad(Number(range[1]))}:${range[2]}`; pos += range[0].length; }
    }
  }
  return { weekday, time, timeEnd, midnight, pos };
}

// pos에서 시작하는 날짜 하나. inherit가 있으면 기간의 끝 날짜로 읽어 연·월을 이어받는다.
function readDate(text: string, pos: number, inherit?: { year: number | null; month: number }) {
  let year: number | null = null, month = 0, day = 0, next = -1, inherited = false;
  for (const re of FULL_DATES) {
    const m = at(re, text, pos);
    if (m) { year = Number(m[1]) + (m[1].length === 2 ? 2000 : 0); month = Number(m[2]); day = Number(m[3]); next = pos + m[0].length; break; }
  }
  if (next < 0) {
    const m = at(MONTH_DAY_KO, text, pos) ?? at(MONTH_DAY, text, pos);
    // 연도 없는 'M. D'는 끝의 점·요일·시각이 있거나 기간의 끝일 때만 날짜로 본다(소수 '5.5%' 배제).
    if (m && (inherit || m[0].includes("월") || m[3] || at(SIGNAL, text, pos + m[0].length))) {
      year = inherit?.year ?? null; month = Number(m[1]); day = Number(m[2]); next = pos + m[0].length;
      inherited = !!inherit;
    }
  }
  if (next < 0 && inherit) {
    const m = at(DAY_ONLY, text, pos);
    if (m) { year = inherit.year; month = inherit.month; day = Number(m[1] ?? m[2]); next = pos + m[0].length; inherited = true; }
  }
  if (next < 0 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year !== null && !parseISO(isoOf(year, month, day))) return null;
  const { weekday, time, timeEnd, midnight, pos: end } = readTail(text, next);
  const mention: DateMention = { year, month, day, weekday, time, timeEnd, midnight, rangeEnd: null, end };
  return { mention, inherited };
}

/** 공고문의 날짜 표기를 모두 찾는다(2026. 5. 17. / '26.5.17 / 5월 17일 / 기간 A ~ B / 요일 / 시각). */
export function parseKoreanDates(text: string): DateMention[] {
  const found: DateMention[] = [];
  for (let pos = 0; pos < text.length; pos++) {
    if (!/[\d'’‘`]/.test(text[pos]) || (pos > 0 && /[\d.]/.test(text[pos - 1]) && /\d/.test(text[pos]))) continue;
    const read = readDate(text, pos);
    if (!read) continue;
    const start = read.mention;
    found.push(start);
    pos = start.end - 1;
    const sep = at(RANGE, text, start.end);
    const finish = sep && readDate(text, start.end + sep[0].length, { year: start.year, month: start.month });
    if (!finish) continue;
    const last = finish.mention;
    // '12. 28 ~ 1. 5'처럼 연도를 이어받은 끝 날짜가 앞 날짜보다 이르면 다음 해다.
    if (finish.inherited && last.year !== null && (last.month < start.month || (last.month === start.month && last.day < start.day))) last.year += 1;
    if (last.year !== null && !parseISO(isoOf(last.year, last.month, last.day))) continue;
    start.rangeEnd = last;
    found.push(last);
    pos = last.end - 1;
  }
  return found;
}

// ── 일정 날짜 대조와 접수 마감 추정 ──────────────────────────────────

type Entry = Analysis["schedule"][number];
const APPLY_WORDS = /접수|신청|모집|지원/;
const END_WORDS = /마감|종료|까지/;
const OPEN_ENDED = /상시|수시|예산\s*소진/;
const LATER_STAGE = /발표|지급|결과|선정|합격|면접|교육|이의|보완|정산|활동|협약|사업\s*기간|지원\s*기간/;

/** 이름·표기로 보아 처음 신청하는 사람의 접수 기간·마감으로 보이는 일정인지. */
export function looksLikeApplication(s: Entry) {
  const text = `${s.label} ${s.date_text}`;
  return APPLY_WORDS.test(text) && !LATER_STAGE.test(text);
}

const weekdayOf = (iso: string) => parseISO(iso)!.getUTCDay();

function reconcileEntry(s: Entry, years: Set<number>, thisYear: number) {
  if (!s.is_application_deadline) s.deadline_inferred = false;
  if (s.date_uncertain) s.date_iso = null;
  if (!s.date_iso) return;
  const uncertain = () => {
    s.date_iso = null;
    s.date_uncertain = true;
  };
  const fromText = parseKoreanDates(s.date_text);
  const mentions = fromText.length ? fromText : s.evidence.flatMap((e) => parseKoreanDates(e.quote));
  const deadlineLike = s.is_deadline || s.is_application_deadline || looksLikeApplication(s);
  // Separate end dates in one entry cannot establish which recruitment round is closed.
  if (deadlineLike && new Set(mentions.filter((x) => !x.rangeEnd).map((x) => `${x.year}-${x.month}-${x.day}`)).size > 1) return uncertain();
  const [y, m, d] = s.date_iso.split("-").map(Number);
  let hit = mentions.find((x) => x.month === m && x.day === d && (x.year === null || x.year === y));
  let year = y;
  if (!hit) {
    // '5. 17. 자정'을 다음 날 00:00으로 적은 경우
    const prev = new Date(Date.UTC(y, m - 1, d - 1));
    hit = s.time === "00:00" ? mentions.find((x) => x.midnight && x.month === prev.getUTCMonth() + 1 && x.day === prev.getUTCDate() &&
      (x.year === null || x.year === prev.getUTCFullYear())) : undefined;
    if (!hit) return uncertain();
    year = prev.getUTCFullYear();
  }
  // 연도가 원문에 없으면 같은 공고의 다른 날짜·제목에 나온 연도이거나, 적힌 요일이 맞는 올해 앞뒤 해일 때만 믿는다(요일은 아래에서 대조).
  if (hit.year === null && !years.has(year) && !(hit.weekday !== null && Math.abs(year - thisYear) <= 1)) return uncertain();
  let target = hit;
  if (deadlineLike && hit.rangeEnd) target = hit.rangeEnd;
  const targetYear = target === hit ? year : target.year ?? year + (target.month < hit.month ? 1 : 0);
  const iso = isoOf(targetYear, target.month, target.day);
  if (!parseISO(iso)) return uncertain();
  const hitIso = isoOf(year, hit.month, hit.day);
  if ((hit.weekday !== null && hit.weekday !== weekdayOf(hitIso)) || (target.weekday !== null && target.weekday !== weekdayOf(iso))) return uncertain();
  s.date_iso = iso;
  if (target.midnight) s.time = "23:59";
  else if (target !== hit) s.time = target.timeEnd ?? target.time;
  else if (deadlineLike && (target.timeEnd ?? target.time)) s.time = target.timeEnd ?? target.time;
  // 원문에 시각이 없는 마감의 00:00은 '자정'을 잘못 읽은 값이라 하루 일찍 닫히지 않게 지운다.
  else if (deadlineLike && s.time === "00:00") s.time = null;
}

/**
 * 모델이 채운 date_iso·time을 date_text(없으면 인용)의 날짜와 대조해 고친다. 제자리 수정이며 여러 번 불러도 같다.
 * - 월·일·요일·연도가 맞지 않으면 date_iso를 비우고 date_uncertain=true
 * - 마감의 기간 표기는 끝 날짜로, 자정·24:00은 그날 23:59로
 * - 종료 표기나 날짜 범위가 명확한 접수 일정만 회차별로 추정(deadline_inferred=true)
 */
export function reconcileDates(a: Analysis) {
  const years = new Set<number>();
  for (const text of [a.title, ...a.schedule.flatMap((s) => [s.date_text, ...s.evidence.map((e) => e.quote)])]) {
    for (const x of parseKoreanDates(text)) if (x.year !== null) years.add(x.year);
    for (const x of text.matchAll(/(\d{4})\s*년/g)) years.add(Number(x[1]));
  }
  const thisYear = Number(todayLocalISO().slice(0, 4));
  for (const s of a.schedule) reconcileEntry(s, years, thisYear);
  for (const s of a.schedule) {
    if (s.is_application_deadline || !deadlineEnd(s) || !looksLikeApplication(s)) continue;
    const text = `${s.label} ${s.date_text}`;
    if (OPEN_ENDED.test(text) || (!END_WORDS.test(text) && !parseKoreanDates(s.date_text).some((d) => d.rangeEnd))) continue;
    s.is_deadline = true;
    s.is_application_deadline = true;
    s.deadline_inferred = true;
  }
}

// ── 캘린더(.ics) 내보내기 ────────────────────────────────────────

function icsEscape(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function vevent(uid: string, title: string, iso: string, time: string | null, desc: string, alarmDays: number) {
  const ymd = iso.replace(/-/g, "");
  const lines = ["BEGIN:VEVENT", `UID:${uid}@easyapply`, `DTSTAMP:${stamp()}`];
  const t = time && /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : null;
  if (t) {
    const start = new Date(`${iso}T${t}:00+09:00`);
    const utc = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    lines.push(`DTSTART:${utc(start)}`, `DTEND:${utc(new Date(start.getTime() + 15 * 60_000))}`);
  } else {
    const next = new Date(parseISO(iso)!.getTime() + 86_400_000);
    const n = next.toISOString().slice(0, 10).replace(/-/g, "");
    lines.push(`DTSTART;VALUE=DATE:${ymd}`, `DTEND;VALUE=DATE:${n}`);
  }
  lines.push(`SUMMARY:${icsEscape(title)}`, `DESCRIPTION:${icsEscape(desc)}`);
  if (alarmDays > 0) {
    lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEscape(title)}`, `TRIGGER:-P${alarmDays}D`, "END:VALARM");
  }
  lines.push("END:VEVENT");
  return lines.join("\r\n");
}

export function buildIcs(a: Analysis, match: Match | null) {
  const events: string[] = [];
  const key = contentKey(a);
  a.schedule.forEach((s, i) => {
    if (!s.date_iso || !parseISO(s.date_iso)) return;
    events.push(
      vevent(`${key}-s${i}-${s.date_iso}`, `${s.is_deadline ? "⏰ " : ""}[${a.title}] ${s.label}`, s.date_iso, s.time, s.date_text, s.is_deadline ? 3 : 1),
    );
  });
  match?.checklist.forEach((t) => {
    if (!t.due_date_iso || !parseISO(t.due_date_iso)) return;
    events.push(vevent(`${key}-t-${contentKey(t)}`, `☑ ${t.title}`, t.due_date_iso, null, `${a.title}\n${t.detail ?? ""}`, 1));
  });
  const raw = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//EasyApply//KO", "CALSCALE:GREGORIAN", ...events, "END:VCALENDAR"].join("\r\n");
  // RFC 5545: fold at 75 UTF-8 octets without splitting a Korean character.
  const encoder = new TextEncoder();
  return raw.split("\r\n").map((line) => {
    let result = "", count = 0;
    for (const char of line) {
      const size = encoder.encode(char).length;
      if (count + size > 75) { result += "\r\n "; count = 1; }
      result += char; count += size;
    }
    return result;
  }).join("\r\n") + "\r\n";
}

export function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
