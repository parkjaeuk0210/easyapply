import type { Analysis, Match } from "./schema";

export function todayLocalISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseISO(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
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
  return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;
}

export function mainDeadline(a: Analysis) {
  const deadlines = a.schedule.filter((s) => s.is_deadline && s.date_iso);
  if (!deadlines.length) return null;
  // 아직 지나지 않은 가장 이른 마감, 없으면 마지막 마감
  const upcoming = deadlines
    .filter((s) => (daysUntil(s.date_iso) ?? -1) >= 0)
    .sort((x, y) => x.date_iso!.localeCompare(y.date_iso!));
  return upcoming[0] ?? deadlines[deadlines.length - 1];
}

// ── 캘린더(.ics) 내보내기 ────────────────────────────────────────

function icsEscape(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function vevent(uid: string, title: string, iso: string, time: string | null, desc: string, alarmDays: number) {
  const ymd = iso.replace(/-/g, "");
  const lines = ["BEGIN:VEVENT", `UID:${uid}@easyapply`, `DTSTAMP:${stamp()}`];
  const t = time && /^\d{1,2}:\d{2}$/.test(time) ? time.padStart(5, "0").replace(":", "") : null;
  if (t) {
    lines.push(`DTSTART;TZID=Asia/Seoul:${ymd}T${t}00`, `DTEND;TZID=Asia/Seoul:${ymd}T${t}00`);
  } else {
    const next = new Date(parseISO(iso)!.getTime() + 86_400_000);
    const n = `${next.getFullYear()}${String(next.getMonth() + 1).padStart(2, "0")}${String(next.getDate()).padStart(2, "0")}`;
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
  a.schedule.forEach((s, i) => {
    if (!s.date_iso) return;
    events.push(
      vevent(`s${i}-${s.date_iso}`, `${s.is_deadline ? "⏰ " : ""}[${a.title}] ${s.label}`, s.date_iso, s.time, s.date_text, s.is_deadline ? 3 : 1),
    );
  });
  match?.checklist.forEach((t) => {
    if (!t.due_date_iso) return;
    events.push(vevent(`t-${t.id}-${t.due_date_iso}`, `☑ ${t.title}`, t.due_date_iso, null, `${a.title}\n${t.detail ?? ""}`, 1));
  });
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//EasyApply//KO", "CALSCALE:GREGORIAN", ...events, "END:VCALENDAR"].join("\r\n");
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
