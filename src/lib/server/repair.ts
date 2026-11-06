import { z } from "zod";

type Node = { type?: string; anyOf?: Node[]; properties?: Record<string, Node>; items?: Node; pattern?: string };
export type Repair = { value: unknown; repairs: number; kinds: Record<string, number> };
const schemas = new WeakMap<z.ZodType, Node | null>();

/** Only normalize recognizable time/ID notation; never delete or shorten source content. */
export function repairOutput(raw: unknown, schema: z.ZodType): Repair {
  if (!schemas.has(schema)) {
    try { schemas.set(schema, z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Node); }
    catch { schemas.set(schema, null); }
  }
  const node = schemas.get(schema), kinds: Record<string, number> = {};
  const value = node ? walk(raw, node, "", kinds) : raw;
  return { value, repairs: Object.values(kinds).reduce((sum, n) => sum + n, 0), kinds };
}

function walk(value: unknown, node: Node, key: string, kinds: Record<string, number>): unknown {
  const inner = node.anyOf?.find((n) => n.type !== "null") ?? node;
  if (inner.type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value).map(([name, child]) => [name,
      inner.properties?.[name] ? walk(child, inner.properties[name], name, kinds) : child]));
  }
  if (inner.type === "array" && Array.isArray(value) && inner.items) return value.map((item) => walk(item, inner.items!, key, kinds));
  if (typeof value !== "string" || !inner.pattern || new RegExp(inner.pattern).test(value)) return value;
  let fixed = value;
  const kind = key === "time" ? "time" : "id";
  if (key === "time") fixed = value === "24:00" ? "23:59" : /^\d:[0-5]\d$/.test(value) ? `0${value}` : value;
  else if (/^(?:id|criterion_id|document_id|criteria_ids|failed_answer_ids)$/.test(key)) fixed = value.trim().toLowerCase();
  if (fixed !== value && new RegExp(inner.pattern).test(fixed)) {
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    return fixed;
  }
  return value;
}
