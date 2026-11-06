import { z } from "zod";

type Node = {
  type?: string; anyOf?: Node[]; properties?: Record<string, Node>; items?: Node;
  minItems?: number; maxItems?: number; minLength?: number; maxLength?: number;
  pattern?: string; minimum?: number; maximum?: number;
};
type Context = { pages?: number; kinds: Record<string, number> };
type Walked = { value: unknown; drop?: boolean };

export type Repair = { value: unknown; repairs: number; kinds: Record<string, number> };

const schemas = new WeakMap<z.ZodType, Node | null>();

/**
 * Deterministic fixes applied before Zod validation. The Anthropic tool schema
 * cannot carry pattern/minItems/maxItems, so near misses would otherwise turn a
 * paid analysis into a 502. Anything not handled here is left for Zod to reject.
 */
export function repairOutput(raw: unknown, schema: z.ZodType, options: { pages?: number } = {}): Repair {
  const node = jsonSchema(schema);
  const ctx: Context = { pages: options.pages, kinds: {} };
  if (!node) return { value: raw, repairs: 0, kinds: {} };
  const value = walk(raw, node, "", "", ctx).value;
  pruneDroppedCriteria(raw, value, ctx);
  const repairs = Object.values(ctx.kinds).reduce((sum, n) => sum + n, 0);
  return { value, repairs, kinds: ctx.kinds };
}

function jsonSchema(schema: z.ZodType) {
  if (!schemas.has(schema)) {
    try { schemas.set(schema, z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Node); }
    catch { schemas.set(schema, null); }
  }
  return schemas.get(schema)!;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const note = (ctx: Context, kind: string, n = 1) => { if (n > 0) ctx.kinds[kind] = (ctx.kinds[kind] ?? 0) + n; };

/** `container` is the nearest enclosing array property, e.g. "transcript". */
function walk(value: unknown, node: Node, key: string, container: string, ctx: Context): Walked {
  const inner = node.anyOf?.find((n) => n.type !== "null") ?? node;
  const nullable = !!node.anyOf?.some((n) => n.type === "null");
  if (inner.type === "object" && isRecord(value)) return walkObject(value, inner, container, ctx);
  if (inner.type === "array" && Array.isArray(value)) return walkArray(value, inner, key, ctx);
  if (inner.type === "string" && typeof value === "string") return walkString(value, inner, key, nullable, ctx);
  if (inner.type === "integer" && typeof value === "number" && key === "page") return walkPage(value, inner, container, ctx);
  return { value };
}

function walkObject(value: Record<string, unknown>, node: Node, container: string, ctx: Context): Walked {
  const out: Record<string, unknown> = { ...value };
  let drop = false;
  for (const [name, child] of Object.entries(node.properties ?? {})) {
    if (!(name in value)) continue;
    const result = walk(value[name], child, name, container, ctx);
    out[name] = result.value;
    drop ||= !!result.drop;
  }
  return { value: out, drop };
}

function walkArray(value: unknown[], node: Node, key: string, ctx: Context): Walked {
  const walked: Walked[] = node.items ? value.map((item) => walk(item, node.items!, "", key, ctx)) : value.map((item) => ({ value: item }));
  let out = walked.filter((item) => !item.drop).map((item) => item.value);
  note(ctx, "dropped", value.length - out.length);
  if (node.items?.type === "string") {
    const unique = [...new Set(out)];
    note(ctx, "deduplicated", out.length - unique.length);
    out = unique;
  }
  if (node.maxItems !== undefined && out.length > node.maxItems) {
    note(ctx, "sliced");
    out = out.slice(0, node.maxItems);
  }
  // An item that loses every citation breaks the evidence rule; its parent array drops it.
  return { value: out, drop: node.minItems !== undefined && out.length < node.minItems };
}

function walkString(value: string, node: Node, key: string, nullable: boolean, ctx: Context): Walked {
  if (key === "quote" && value.trim().length < (node.minLength ?? 1)) return { value, drop: true };
  let out: string | null = value;
  if (node.pattern && !new RegExp(node.pattern).test(value)) out = fixPattern(value, new RegExp(node.pattern), key, nullable, ctx);
  if (out !== null && node.maxLength !== undefined && out.length > node.maxLength) {
    note(ctx, "truncated");
    out = truncate(out, node.maxLength);
  }
  return { value: out };
}

function fixPattern(value: string, pattern: RegExp, key: string, nullable: boolean, ctx: Context): string | null {
  if (key === "time") {
    // "24:00" means the end of that day.
    const fixed = value === "24:00" ? "23:59" : /^\d:[0-5]\d$/.test(value) ? `0${value}` : null;
    if (fixed === null && !nullable) return value;
    note(ctx, "time");
    return fixed;
  }
  const id = normalizeId(value);
  if (id === value || !pattern.test(id)) return value;
  note(ctx, "id");
  return id;
}

function walkPage(value: number, node: Node, container: string, ctx: Context): Walked {
  const min = node.minimum ?? 1;
  const max = Math.min(ctx.pages ?? Infinity, node.maximum ?? Infinity);
  if (!Number.isInteger(value) || (value >= min && value <= max)) return { value };
  // Clamping a transcript page would duplicate a real page; drop it instead.
  if (container === "transcript") return { value, drop: true };
  note(ctx, "page");
  return { value: Math.min(Math.max(value, min), max) };
}

function truncate(value: string, max: number) {
  const cut = value.slice(0, max);
  // Do not leave half of a surrogate pair at the end.
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

const normalizeId = (value: string) => value.toLowerCase().replace(/\s+/g, "");

// Dropping an uncited criterion must not leave questions pointing at it.
function pruneDroppedCriteria(raw: unknown, value: unknown, ctx: Context) {
  if (!isRecord(raw) || !isRecord(value) || !Array.isArray(value.profile_questions)) return;
  const ids = (items: unknown) => Array.isArray(items)
    ? items.flatMap((item) => isRecord(item) && typeof item.id === "string" ? [normalizeId(item.id)] : [])
    : [];
  const kept = new Set(ids(value.eligibility));
  const dropped = new Set(ids(raw.eligibility).filter((id) => !kept.has(id)));
  if (!dropped.size) return;
  value.profile_questions = value.profile_questions.flatMap((question) => {
    if (!isRecord(question) || !Array.isArray(question.criteria_ids)) return [question];
    const criteria = question.criteria_ids.filter((id) => typeof id !== "string" || !dropped.has(id));
    if (criteria.length === question.criteria_ids.length) return [question];
    note(ctx, "references");
    return criteria.length ? [{ ...question, criteria_ids: criteria }] : [];
  });
}
