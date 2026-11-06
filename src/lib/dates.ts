import type { Analysis, Match } from "./schema";
import { contentKey } from "./client-api";

export function todayLocalISO() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
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

export function mainDeadline(a: Analysis) {
  const deadlines = a.schedule.filter((s) => s.is_deadline && s.date_iso && parseISO(s.date_iso)).sort((x, y) => x.date_iso!.localeCompare(y.date_iso!));
  if (!deadlines.length) return null;
  // 아직 지나지 않은 가장 이른 마감, 없으면 마지막 마감
  const upcoming = deadlines
    .filter((s) => (daysUntil(s.date_iso) ?? -1) >= 0)
    .sort((x, y) => x.date_iso!.localeCompare(y.date_iso!));
  return upcoming[0] ?? deadlines[deadlines.length - 1];
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
