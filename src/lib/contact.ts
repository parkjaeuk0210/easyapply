export type ContactPart = { text: string; href?: string };

// Link recognizable contact details only; keep the rest of the source text intact.
const CONTACT_DETAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?<![A-Z0-9])(?:(?:\+82[ .-]?(?:\(0\)[ .-]?)?[1-9]\d{0,2}|0[1-9]\d{0,2})[ .)-]?\d{3,4}[ .-]?\d{4}|1[568]\d{2}[ .-]?\d{4})(?![A-Z0-9])/gi;

export function contactParts(text: string): ContactPart[] {
  const parts: ContactPart[] = [];
  let offset = 0;
  for (const match of text.matchAll(CONTACT_DETAIL)) {
    const start = match.index;
    if (start > offset) parts.push({ text: text.slice(offset, start) });
    const value = match[0];
    const href = value.includes("@")
      ? `mailto:${value.split("@").map(encodeURIComponent).join("@")}`
      : `tel:${value.replace(/[^+\d]/g, "").replace(/^\+820/, "+82")}`;
    parts.push({ text: value, href });
    offset = start + value.length;
  }
  if (offset < text.length) parts.push({ text: text.slice(offset) });
  return parts;
}
