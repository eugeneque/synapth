import { parse as parseYaml } from "yaml";

export interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
}

/** Splits `---\nyaml\n---\nbody`. Tolerates CRLF, BOM and a missing block. */
export function parseFrontmatter(text: string): Frontmatter {
  const clean = text.replace(/^﻿/, "");
  const m = clean.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: clean.trim() };
  let data: unknown = {};
  try {
    data = parseYaml(m[1]) ?? {};
  } catch {
    // Broken YAML: fall back to `key: value` lines so we still get a name.
    data = Object.fromEntries(
      m[1]
        .split(/\r?\n/)
        .map((l) => l.match(/^([\w-]+)\s*:\s*(.*)$/))
        .filter((x): x is RegExpMatchArray => Boolean(x))
        .map((x) => [x[1], x[2].trim().replace(/^["']|["']$/g, "")]),
    );
  }
  return { data: typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {}, body: m[2].trim() };
}

export function str(data: Record<string, unknown>, key: string): string | undefined {
  const v = data[key];
  return typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : undefined;
}

export function strList(data: Record<string, unknown>, key: string): string[] {
  const v = data[key];
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}
