/**
 * A small TOML reader/writer — enough for agent config files such as Codex's
 * `config.toml`: tables and dotted/quoted table names, `key = value` with
 * basic and literal strings (single and multi-line), integers, floats,
 * booleans, arrays (multi-line too) and inline tables. Dates and arrays of
 * tables are not needed there and are rejected. Pure and dependency-free:
 * the Synapth CLI bundles it.
 */

export type TomlValue = string | number | boolean | TomlValue[] | TomlTable;
export interface TomlTable {
  [key: string]: TomlValue;
}

export class TomlError extends Error {
  constructor(message: string, readonly line: number) {
    super(`${message} (line ${line})`);
  }
}

const BARE_KEY = /^[A-Za-z0-9_-]+$/;
const ESCAPES: Record<string, string> = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "\\": "\\" };

function isTable(v: TomlValue | undefined): v is TomlTable {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

class Reader {
  pos = 0;
  constructor(readonly src: string) {}

  get line() {
    return this.src.slice(0, this.pos).split("\n").length;
  }
  fail(message: string): never {
    throw new TomlError(message, this.line);
  }
  peek(n = 0) {
    return this.src[this.pos + n];
  }
  startsWith(s: string) {
    return this.src.startsWith(s, this.pos);
  }
  /** Spaces and tabs only. */
  skipInline() {
    while (this.peek() === " " || this.peek() === "\t") this.pos++;
  }
  skipComment() {
    if (this.peek() === "#") while (this.pos < this.src.length && this.peek() !== "\n") this.pos++;
  }
  /** Whitespace, newlines and comments — used inside arrays. */
  skipAll() {
    for (;;) {
      const c = this.peek();
      if (c === " " || c === "\t" || c === "\r" || c === "\n") this.pos++;
      else if (c === "#") this.skipComment();
      else return;
    }
  }
  endOfLine() {
    this.skipInline();
    this.skipComment();
    if (this.peek() === "\r") this.pos++;
    if (this.pos < this.src.length && this.peek() !== "\n") this.fail("Expected end of line");
    this.pos++;
  }

  key(): string[] {
    const parts: string[] = [];
    for (;;) {
      this.skipInline();
      const c = this.peek();
      if (c === '"') parts.push(this.basicString());
      else if (c === "'") parts.push(this.literalString());
      else {
        const start = this.pos;
        while (this.pos < this.src.length && /[A-Za-z0-9_-]/.test(this.peek())) this.pos++;
        if (start === this.pos) this.fail("Expected a key");
        parts.push(this.src.slice(start, this.pos));
      }
      this.skipInline();
      if (this.peek() !== ".") return parts;
      this.pos++;
    }
  }

  basicString(): string {
    if (this.startsWith('"""')) {
      this.pos += 3;
      if (this.peek() === "\n") this.pos++;
      else if (this.startsWith("\r\n")) this.pos += 2;
      return this.stringBody('"""', true);
    }
    this.pos++;
    return this.stringBody('"', true);
  }

  literalString(): string {
    const multi = this.startsWith("'''");
    this.pos += multi ? 3 : 1;
    if (multi && this.peek() === "\n") this.pos++;
    const end = this.src.indexOf(multi ? "'''" : "'", this.pos);
    if (end < 0) this.fail("Unterminated string");
    const text = this.src.slice(this.pos, end);
    if (!multi && text.includes("\n")) this.fail("Newline in string");
    this.pos = end + (multi ? 3 : 1);
    return text;
  }

  stringBody(close: string, escapes: boolean): string {
    let out = "";
    for (;;) {
      if (this.pos >= this.src.length) this.fail("Unterminated string");
      if (this.startsWith(close)) {
        this.pos += close.length;
        return out;
      }
      const c = this.src[this.pos++];
      if (c === "\n" && close === '"') this.fail("Newline in string");
      if (c !== "\\" || !escapes) {
        out += c;
        continue;
      }
      const e = this.src[this.pos++];
      if (e in ESCAPES) out += ESCAPES[e];
      else if (e === "u" || e === "U") {
        const len = e === "u" ? 4 : 8;
        const hex = this.src.slice(this.pos, this.pos + len);
        if (!/^[0-9A-Fa-f]+$/.test(hex) || hex.length !== len) this.fail("Bad unicode escape");
        out += String.fromCodePoint(parseInt(hex, 16));
        this.pos += len;
      } else if (close === '"""' && (e === "\n" || e === " " || e === "\t" || e === "\r")) {
        // Line-ending backslash: trims the newline and the indentation that follows.
        while (/[ \t\r\n]/.test(this.peek() ?? "")) this.pos++;
      } else this.fail(`Bad escape \\${e}`);
    }
  }

  value(): TomlValue {
    this.skipInline();
    const c = this.peek();
    if (c === '"') return this.basicString();
    if (c === "'") return this.literalString();
    if (c === "[") return this.array();
    if (c === "{") return this.inlineTable();
    if (this.startsWith("true")) return (this.pos += 4), true;
    if (this.startsWith("false")) return (this.pos += 5), false;
    const m = /^[+-]?(?:inf|nan|0x[0-9A-Fa-f_]+|0o[0-7_]+|0b[01_]+|[0-9_]+(?:\.[0-9_]+)?(?:[eE][+-]?[0-9_]+)?)/.exec(this.src.slice(this.pos));
    if (!m || /^\d{4}-/.test(this.src.slice(this.pos))) this.fail("Unsupported value");
    this.pos += m[0].length;
    const raw = m[0].replace(/_/g, "");
    if (/inf$/.test(raw)) return raw.startsWith("-") ? -Infinity : Infinity;
    if (/nan$/.test(raw)) return NaN;
    if (/^[+-]?0[xob]/.test(raw)) return Number(raw.replace(/^\+/, ""));
    return Number(raw);
  }

  array(): TomlValue[] {
    this.pos++;
    const out: TomlValue[] = [];
    for (;;) {
      this.skipAll();
      if (this.peek() === "]") return this.pos++, out;
      out.push(this.value());
      this.skipAll();
      if (this.peek() === ",") this.pos++;
      else if (this.peek() !== "]") this.fail("Expected , or ] in array");
    }
  }

  inlineTable(): TomlTable {
    this.pos++;
    const out: TomlTable = {};
    this.skipInline();
    if (this.peek() === "}") return this.pos++, out;
    for (;;) {
      const key = this.key();
      if (this.peek() !== "=") this.fail("Expected =");
      this.pos++;
      assign(out, key, this.value(), this);
      this.skipInline();
      if (this.peek() === "}") return this.pos++, out;
      if (this.peek() !== ",") this.fail("Expected , or } in inline table");
      this.pos++;
    }
  }
}

function descend(root: TomlTable, path: string[], r: Reader): TomlTable {
  let t = root;
  for (const k of path) {
    const next = t[k];
    if (next === undefined) t = t[k] = {};
    else if (isTable(next)) t = next;
    else r.fail(`Key "${k}" is not a table`);
  }
  return t;
}

function assign(table: TomlTable, key: string[], value: TomlValue, r: Reader) {
  const parent = descend(table, key.slice(0, -1), r);
  const last = key[key.length - 1];
  if (last in parent) r.fail(`Duplicate key "${key.join(".")}"`);
  parent[last] = value;
}

export function parseToml(src: string): TomlTable {
  const r = new Reader(src.replace(/^﻿/, ""));
  const root: TomlTable = {};
  let current = root;
  while (r.pos < r.src.length) {
    r.skipInline();
    const c = r.peek();
    if (c === "\n" || c === "\r" || c === "#" || c === undefined) {
      r.endOfLine();
      continue;
    }
    if (c === "[") {
      if (r.peek(1) === "[") r.fail("Arrays of tables are not supported");
      r.pos++;
      const name = r.key();
      if (r.peek() !== "]") r.fail("Expected ]");
      r.pos++;
      current = descend(root, name, r);
      r.endOfLine();
      continue;
    }
    const key = r.key();
    if (r.peek() !== "=") r.fail("Expected =");
    r.pos++;
    assign(current, key, r.value(), r);
    r.endOfLine();
  }
  return root;
}

export function tomlKey(key: string): string {
  return BARE_KEY.test(key) ? key : tomlString(key);
}

export function tomlString(s: string): string {
  return `"${s.replace(/[\\"\u0000-\u001f\u007f]/g, (c) => {
    const named = Object.entries(ESCAPES).find(([, v]) => v === c)?.[0];
    return named ? `\\${named}` : `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`;
  })}"`;
}

export function tomlInline(v: TomlValue): string {
  if (typeof v === "string") return tomlString(v);
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : Number.isNaN(v) ? "nan" : v > 0 ? "inf" : "-inf";
  if (typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.map(tomlInline).join(", ")}]`;
  const entries = Object.entries(v);
  return entries.length ? `{ ${entries.map(([k, x]) => `${tomlKey(k)} = ${tomlInline(x)}`).join(", ")} }` : "{}";
}

/** One `[a.b]` table with scalar/array/inline values — the shape agent configs append. */
export function tomlTableBlock(path: string[], table: TomlTable): string {
  const lines = [`[${path.map(tomlKey).join(".")}]`];
  for (const [k, v] of Object.entries(table)) lines.push(`${tomlKey(k)} = ${tomlInline(v)}`);
  return lines.join("\n");
}
