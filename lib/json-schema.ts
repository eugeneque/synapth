/**
 * Minimal JSON Schema check for tool arguments (ТЗ §5.2, step 2): the subset
 * LLM tool schemas use — type, required, properties, additionalProperties,
 * items, enum, min/max length and value. Unknown keywords pass: the upstream
 * stays the final judge, this only stops charging for calls that are wrong
 * on their face.
 */

import type { JsonSchema } from "@/types/skill";

const typeOf = (v: unknown): string => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);

export function validateJson(schema: JsonSchema | undefined, value: unknown, path = "input", depth = 0): string[] {
  if (!schema || depth > 12) return [];
  const errors: string[] = [];
  const t = typeOf(value);
  if (schema.type) {
    const ok = schema.type === t || (schema.type === "number" && t === "integer");
    if (!ok) return [`${path}: expected ${schema.type}, got ${t}`];
  }
  if (schema.enum && !schema.enum.some((e) => e === value)) errors.push(`${path}: must be one of ${schema.enum.map(String).join(", ")}`);
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) errors.push(`${path}: shorter than ${schema.minLength}`);
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) errors.push(`${path}: longer than ${schema.maxLength}`);
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) errors.push(`${path}: below ${schema.minimum}`);
    if (typeof schema.maximum === "number" && value > schema.maximum) errors.push(`${path}: above ${schema.maximum}`);
  }
  if (t === "object" && value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const req of schema.required ?? []) if (!(req in obj)) errors.push(`${path}.${req}: required`);
    for (const [key, v] of Object.entries(obj)) {
      const sub = schema.properties?.[key];
      if (sub) errors.push(...validateJson(sub, v, `${path}.${key}`, depth + 1));
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: not allowed`);
      else if (typeof schema.additionalProperties === "object") errors.push(...validateJson(schema.additionalProperties, v, `${path}.${key}`, depth + 1));
    }
  }
  if (t === "array" && schema.items) (value as unknown[]).slice(0, 1000).forEach((item, i) => errors.push(...validateJson(schema.items, item, `${path}[${i}]`, depth + 1)));
  return errors.slice(0, 20);
}
