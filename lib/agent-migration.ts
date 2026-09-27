/**
 * Agent migration — moves what a project has taught one coding agent into
 * another: Codex ⇄ Claude Code. Pure planning; the Synapth CLI
 * (`cli/synapth.ts`) reads the files, calls `planMigration()` and applies
 * the plan. What moves:
 *
 *   knowledge     AGENTS.md (every directory)   ⇄ CLAUDE.md
 *   MCP servers   .codex/config.toml            ⇄ .mcp.json          (user scope: ~/.codex/config.toml ⇄ ~/.claude.json)
 *   commands      ~/.codex/prompts/*.md         ⇄ .claude/commands/*.md
 *   skills        .codex/skills, .agents/skills ⇄ .claude/skills
 *
 * Rules: nothing existing is overwritten (instruction files get an appended,
 * marked block; configs get only the servers they lack), and secrets never
 * travel — literal env values become `${VAR}` references the user exports.
 *
 * Path keys: project paths are relative to the project root ("AGENTS.md",
 * "api/AGENTS.md"); user paths start with "~/" ("~/.codex/config.toml" —
 * the CLI resolves `~/.codex` through $CODEX_HOME).
 */

import { parseToml, tomlTableBlock, TomlError, type TomlTable } from "./toml-lite";

export const AGENTS = ["codex", "claude-code"] as const;
export type AgentId = (typeof AGENTS)[number];
export type MigrationScope = "project" | "user";

export interface MigrationOptions {
  from: AgentId;
  to: AgentId;
  scope: MigrationScope;
}

/** What the CLI read: file contents by path key, and directory listings (entry names; subdirectories end with "/"). */
export interface MigrationSnapshot {
  files: Record<string, string>;
  dirs: Record<string, string[]>;
}

export type MigrationOp =
  | { kind: "create"; path: string; content: string; what: string }
  | { kind: "append"; path: string; content: string; what: string }
  | { kind: "update"; path: string; content: string; what: string }
  | { kind: "copy-dir"; from: string; to: string; what: string }
  | { kind: "run"; command: string; what: string };

export interface MigrationNote {
  level: "info" | "warn";
  message: string;
}

export interface MigrationPlan {
  options: MigrationOptions;
  ops: MigrationOp[];
  notes: MigrationNote[];
}

/** Marks every block the migration writes, so a second run recognises its own work. */
export const MIGRATION_MARKER = "synapth:migrated";

/** Instruction file names per agent. */
const INSTRUCTIONS: Record<AgentId, string> = { codex: "AGENTS.md", "claude-code": "CLAUDE.md" };

/** Where each piece lives, per agent and scope. `null` — the agent has no such thing at that scope. */
interface Layout {
  instructions: string; // the root instruction file
  mcp: string;
  commands: string | null;
  skills: string[]; // first entry is where migrated skills are written
}

export function layout(agent: AgentId, scope: MigrationScope): Layout {
  if (agent === "codex") {
    return scope === "project"
      ? { instructions: "AGENTS.md", mcp: ".codex/config.toml", commands: null, skills: [".codex/skills", ".agents/skills"] }
      : { instructions: "~/.codex/AGENTS.md", mcp: "~/.codex/config.toml", commands: "~/.codex/prompts", skills: ["~/.codex/skills"] };
  }
  return scope === "project"
    ? { instructions: "CLAUDE.md", mcp: ".mcp.json", commands: ".claude/commands", skills: [".claude/skills"] }
    : { instructions: "~/.claude/CLAUDE.md", mcp: "~/.claude.json", commands: "~/.claude/commands", skills: ["~/.claude/skills"] };
}

/** What the CLI has to read before planning: single files, directories to list, and instruction file names to look for in project subdirectories. */
export function snapshotSpec(opts: MigrationOptions): { files: string[]; dirs: string[]; nested: string[] } {
  const from = layout(opts.from, opts.scope);
  const to = layout(opts.to, opts.scope);
  const dirs = [from.commands, to.commands, ...from.skills, ...to.skills].filter((d): d is string => Boolean(d));
  return {
    files: [from.instructions, to.instructions, from.mcp, to.mcp],
    dirs,
    nested: opts.scope === "project" ? [INSTRUCTIONS[opts.from], INSTRUCTIONS[opts.to]] : [],
  };
}

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
const dirname = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);

// ---------------------------------------------------------------------------
// MCP servers — a neutral shape both configs convert through.
// ---------------------------------------------------------------------------

export interface McpServer {
  name: string;
  transport: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  /** Values are either literals or `${VAR}` references. */
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  /** Settings the other side has no place for. */
  dropped?: string[];
}

const ENV_REF = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;
const BEARER_REF = /^Bearer \$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

const asString = (v: unknown) => (typeof v === "string" ? v : undefined);
const asStrings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined);
function asStringMap(v: unknown): Record<string, string> | undefined {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v)) if (typeof x === "string" || typeof x === "number" || typeof x === "boolean") out[k] = String(x);
  return out;
}

const CODEX_KNOWN = new Set(["command", "args", "env", "env_vars", "url", "bearer_token_env_var", "http_headers", "env_http_headers", "enabled"]);

export function readCodexServers(config: TomlTable): McpServer[] {
  const table = config.mcp_servers;
  if (typeof table !== "object" || table === null || Array.isArray(table)) return [];
  return Object.entries(table).flatMap(([name, raw]): McpServer[] => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return [];
    const s = raw as TomlTable;
    const dropped = Object.keys(s).filter((k) => !CODEX_KNOWN.has(k));
    const enabled = s.enabled !== false;
    const url = asString(s.url);
    if (url) {
      const headers: Record<string, string> = { ...asStringMap(s.http_headers) };
      for (const [h, v] of Object.entries(asStringMap(s.env_http_headers) ?? {})) headers[h] = `\${${v}}`;
      const bearer = asString(s.bearer_token_env_var);
      if (bearer) headers.Authorization = `Bearer \${${bearer}}`;
      return [{ name, transport: "http", url, headers: Object.keys(headers).length ? headers : undefined, enabled, dropped }];
    }
    const command = asString(s.command);
    if (!command) return [];
    const env: Record<string, string> = { ...asStringMap(s.env) };
    for (const v of asStrings(s.env_vars) ?? []) env[v] ??= `\${${v}}`;
    return [{ name, transport: "stdio", command, args: asStrings(s.args), env: Object.keys(env).length ? env : undefined, enabled, dropped }];
  });
}

export function readClaudeServers(json: unknown): McpServer[] {
  const table = (json as { mcpServers?: unknown } | null)?.mcpServers;
  if (typeof table !== "object" || table === null || Array.isArray(table)) return [];
  return Object.entries(table).flatMap(([name, raw]): McpServer[] => {
    if (typeof raw !== "object" || raw === null) return [];
    const s = raw as Record<string, unknown>;
    const type = asString(s.type);
    const url = asString(s.url);
    if (url) {
      return [{ name, transport: type === "sse" ? "sse" : "http", url, headers: asStringMap(s.headers) }];
    }
    const command = asString(s.command);
    if (!command) return [];
    return [{ name, transport: "stdio", command, args: asStrings(s.args), env: asStringMap(s.env) }];
  });
}

/** Literal env values stay behind (they are often secrets): the migrated config references `${KEY}` instead. */
function detachSecrets(env: Record<string, string> | undefined): { env?: Record<string, string>; exported: string[] } {
  if (!env) return { exported: [] };
  const out: Record<string, string> = {};
  const exported: string[] = [];
  for (const [k, v] of Object.entries(env)) {
    if (ENV_REF.test(v)) out[k] = v;
    else {
      out[k] = `\${${k}}`;
      exported.push(k);
    }
  }
  return { env: out, exported };
}

/** Literal header values (API keys, tokens) are swapped for `${SERVER_HEADER}` references the same way. */
function detachHeaders(server: string, headers: Record<string, string> | undefined): { headers?: Record<string, string>; exported: string[] } {
  if (!headers) return { exported: [] };
  const out: Record<string, string> = {};
  const exported: string[] = [];
  for (const [h, v] of Object.entries(headers)) {
    if (v.includes("${")) out[h] = v;
    else {
      const name = `${server}_${h}`.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
      out[h] = `\${${name}}`;
      exported.push(name);
    }
  }
  return { headers: out, exported };
}

function toClaudeEntry(s: McpServer): Record<string, unknown> {
  if (s.transport !== "stdio") return { type: s.transport, url: s.url, ...(s.headers ? { headers: s.headers } : {}) };
  return { command: s.command, ...(s.args?.length ? { args: s.args } : {}), ...(s.env ? { env: s.env } : {}) };
}

/** Codex keeps env literals in its own config and passes through named variables with `env_vars`. */
function toCodexTable(s: McpServer, notes: MigrationNote[]): TomlTable | null {
  if (s.transport === "sse") {
    notes.push({ level: "warn", message: `MCP "${s.name}": Codex has no SSE transport — skipped; switch the server to streamable HTTP first.` });
    return null;
  }
  if (s.transport === "http") {
    const t: TomlTable = { url: s.url! };
    const literal: Record<string, string> = {};
    const fromEnv: Record<string, string> = {};
    for (const [h, v] of Object.entries(s.headers ?? {})) {
      const bearer = h.toLowerCase() === "authorization" ? BEARER_REF.exec(v) : null;
      const ref = ENV_REF.exec(v);
      if (bearer) t.bearer_token_env_var = bearer[1];
      else if (ref) fromEnv[h] = ref[1];
      else if (v.includes("${")) notes.push({ level: "warn", message: `MCP "${s.name}": header ${h} mixes text and variables — Codex can't express it, set it by hand.` });
      else literal[h] = v;
    }
    if (Object.keys(literal).length) t.http_headers = literal;
    if (Object.keys(fromEnv).length) t.env_http_headers = fromEnv;
    return t;
  }
  const t: TomlTable = { command: s.command! };
  if (s.args?.length) t.args = s.args;
  const env: Record<string, string> = {};
  const passThrough: string[] = [];
  for (const [k, v] of Object.entries(s.env ?? {})) {
    const ref = ENV_REF.exec(v);
    if (ref && ref[1] === k) passThrough.push(k);
    else if (ref || v.includes("${")) notes.push({ level: "warn", message: `MCP "${s.name}": ${k}=${v} renames a variable — Codex passes variables through only under their own name; set ${k} by hand.` });
    else env[k] = v;
  }
  if (Object.keys(env).length) t.env = env;
  if (passThrough.length) t.env_vars = passThrough;
  return t;
}

function shellQuote(s: string) {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

// ---------------------------------------------------------------------------
// Markdown with frontmatter — commands/prompts keep only the keys the target reads.
// ---------------------------------------------------------------------------

/** Frontmatter keys each agent understands in a command/prompt file. */
const COMMAND_KEYS: Record<AgentId, Set<string>> = {
  codex: new Set(["description", "argument-hint"]),
  "claude-code": new Set(["description", "argument-hint", "allowed-tools", "model", "disable-model-invocation"]),
};

/** Keeps the listed top-level frontmatter keys (with their continuation lines) and reports the rest. */
export function filterFrontmatter(text: string, keep: Set<string>): { text: string; dropped: string[] } {
  const m = /^(﻿?---\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))([\s\S]*)$/.exec(text);
  if (!m) return { text, dropped: [] };
  const entries: { key: string | null; lines: string[] }[] = [];
  for (const line of m[2].split(/\r?\n/)) {
    const key = /^([A-Za-z0-9_-]+)\s*:/.exec(line)?.[1] ?? null;
    if (key || entries.length === 0) entries.push({ key, lines: [line] });
    else entries[entries.length - 1].lines.push(line);
  }
  const dropped = entries.filter((e) => e.key && !keep.has(e.key)).map((e) => e.key!);
  if (!dropped.length) return { text, dropped };
  const kept = entries.filter((e) => !e.key || keep.has(e.key)).flatMap((e) => e.lines);
  const head = kept.join("\n").trim();
  return { text: head ? `${m[1]}${head}${m[3]}${m[4]}` : m[4].replace(/^\r?\n/, ""), dropped };
}

/** `$1`–`$9` and `$ARGUMENTS` mean the same in both agents; Codex's named `$FOO` placeholders have no Claude Code counterpart. */
export function namedPlaceholders(body: string): string[] {
  return [...new Set([...body.matchAll(/\$([A-Z][A-Z0-9_]*)\b/g)].map((m) => m[1]).filter((n) => n !== "ARGUMENTS"))];
}

// ---------------------------------------------------------------------------
// The planner.
// ---------------------------------------------------------------------------

function importsIn(text: string): string[] {
  return [...text.matchAll(/^\s*@(\S+)\s*$/gm)].map((m) => m[1]);
}

function planInstructions(opts: MigrationOptions, snap: MigrationSnapshot, ops: MigrationOp[], notes: MigrationNote[]) {
  const fromName = INSTRUCTIONS[opts.from];
  const toName = INSTRUCTIONS[opts.to];
  const root = layout(opts.from, opts.scope).instructions;
  const sources = Object.keys(snap.files)
    .filter((p) => (opts.scope === "project" ? !p.startsWith("~/") && basename(p) === fromName : p === root))
    .sort();
  if (!sources.length) {
    notes.push({ level: "info", message: `No ${opts.scope === "project" ? fromName : root} found — no instructions to move.` });
    return;
  }
  for (const src of sources) {
    const content = snap.files[src];
    const target = opts.scope === "project" ? join(dirname(src), toName) : layout(opts.to, "user").instructions;
    const existing = snap.files[target];
    if (!content.trim()) continue;

    if (opts.to === "claude-code") {
      // Claude Code imports other files: one source of truth that both agents keep reading.
      const ref = opts.scope === "project" ? `@${fromName}` : `@${src}`;
      if (existing?.split(/\r?\n/).some((l) => l.trim() === ref)) {
        notes.push({ level: "info", message: `${target} already imports ${src}.` });
        continue;
      }
      const block = `<!-- ${MIGRATION_MARKER} from Codex: ${src} stays the shared source of instructions for both agents. -->\n${ref}\n`;
      ops.push(
        existing === undefined
          ? { kind: "create", path: target, content: block, what: `import ${src} into Claude Code` }
          : { kind: "append", path: target, content: `\n${block}`, what: `import ${src} into Claude Code` },
      );
      continue;
    }

    // Codex has no imports: the text itself moves, once.
    if (existing?.includes(`${MIGRATION_MARKER} from Claude Code: ${src}`)) {
      notes.push({ level: "info", message: `${target} already holds ${src}.` });
      continue;
    }
    const onlyImports = content.split(/\r?\n/).every((l) => !l.trim() || /^\s*@\S+\s*$/.test(l) || /^\s*<!--.*-->\s*$/.test(l));
    if (onlyImports) {
      // e.g. a CLAUDE.md that just imports AGENTS.md: nothing of its own to move.
      notes.push({ level: "info", message: `${src} only imports other files (${importsIn(content).map((i) => `@${i}`).join(", ")}) — nothing to copy.` });
      continue;
    }
    const imports = importsIn(content);
    if (imports.length) notes.push({ level: "warn", message: `${src} imports ${imports.map((i) => `@${i}`).join(", ")} — Codex doesn't follow imports; merge those files into ${target} by hand if they matter.` });
    const block = `<!-- ${MIGRATION_MARKER} from Claude Code: ${src} -->\n${content.trim()}\n`;
    ops.push(
      existing === undefined
        ? { kind: "create", path: target, content: block, what: `copy ${src} for Codex` }
        : { kind: "append", path: target, content: `\n${block}`, what: `copy ${src} for Codex` },
    );
  }
}

function parseSource(path: string, text: string, notes: MigrationNote[]): TomlTable | Record<string, unknown> | null {
  try {
    return path.endsWith(".toml") ? parseToml(text) : (JSON.parse(text) as Record<string, unknown>);
  } catch (e) {
    notes.push({ level: "warn", message: `${path} can't be parsed (${e instanceof TomlError || e instanceof SyntaxError ? e.message : "invalid"}) — MCP servers skipped.` });
    return null;
  }
}

function planMcp(opts: MigrationOptions, snap: MigrationSnapshot, ops: MigrationOp[], notes: MigrationNote[]) {
  const fromPath = layout(opts.from, opts.scope).mcp;
  const toPath = layout(opts.to, opts.scope).mcp;
  const srcText = snap.files[fromPath];
  if (srcText === undefined) {
    notes.push({ level: "info", message: `No ${fromPath} — no MCP servers to move.` });
    return;
  }
  const parsed = parseSource(fromPath, srcText, notes);
  if (!parsed) return;
  const servers = opts.from === "codex" ? readCodexServers(parsed as TomlTable) : readClaudeServers(parsed);
  if (!servers.length) return;

  const existingText = snap.files[toPath];
  const existing = existingText === undefined ? {} : parseSource(toPath, existingText, notes);
  if (!existing) return;
  const taken = new Set(Object.keys(((opts.to === "codex" ? (existing as TomlTable).mcp_servers : (existing as { mcpServers?: unknown }).mcpServers) as object | undefined) ?? {}));

  const fresh = servers.filter((s) => {
    if (taken.has(s.name)) {
      notes.push({ level: "info", message: `MCP "${s.name}" is already configured in ${toPath}.` });
      return false;
    }
    if (s.enabled === false) {
      notes.push({ level: "info", message: `MCP "${s.name}" is disabled in ${fromPath} — skipped.` });
      return false;
    }
    if (s.dropped?.length) notes.push({ level: "warn", message: `MCP "${s.name}": ${s.dropped.join(", ")} not carried over (no counterpart in ${opts.to === "codex" ? "Codex" : "Claude Code"}).` });
    return true;
  });
  if (!fresh.length) return;

  const exported = new Set<string>();

  if (opts.to === "claude-code") {
    const entries = fresh.map((s) => {
      const { env, exported: names } = detachSecrets(s.env);
      const { headers, exported: headerVars } = detachHeaders(s.name, s.headers);
      [...names, ...headerVars].forEach((n) => exported.add(n));
      return { name: s.name, entry: toClaudeEntry({ ...s, env, headers }) };
    });
    if (opts.scope === "project") {
      const doc = { ...(existing as Record<string, unknown>) };
      doc.mcpServers = { ...((doc.mcpServers as object) ?? {}), ...Object.fromEntries(entries.map((e) => [e.name, e.entry])) };
      const content = `${JSON.stringify(doc, null, 2)}\n`;
      const what = `add MCP ${entries.map((e) => e.name).join(", ")}`;
      ops.push(existingText === undefined ? { kind: "create", path: toPath, content, what } : { kind: "update", path: toPath, content, what });
    } else {
      // ~/.claude.json is Claude Code's own state file: never edited, the CLI registers servers through `claude mcp`.
      for (const e of entries) ops.push({ kind: "run", command: `claude mcp add-json --scope user ${shellQuote(e.name)} ${shellQuote(JSON.stringify(e.entry))}`, what: `add MCP ${e.name}` });
    }
  } else {
    const blocks = fresh.flatMap((s) => {
      const table = toCodexTable(s, notes);
      if (!table) return [];
      for (const [k, v] of Object.entries(s.env ?? {})) if (ENV_REF.exec(v)?.[1] === k) exported.add(k);
      for (const v of Object.values(s.headers ?? {})) {
        const ref = BEARER_REF.exec(v) ?? ENV_REF.exec(v);
        if (ref) exported.add(ref[1]);
      }
      return [{ name: s.name, block: tomlTableBlock(["mcp_servers", s.name], table) }];
    });
    if (!blocks.length) return;
    const body = `# ${MIGRATION_MARKER} from Claude Code (${fromPath})\n${blocks.map((b) => b.block).join("\n\n")}\n`;
    const what = `add MCP ${blocks.map((b) => b.name).join(", ")}`;
    ops.push(existingText === undefined ? { kind: "create", path: toPath, content: body, what } : { kind: "append", path: toPath, content: `${existingText.endsWith("\n") ? "" : "\n"}\n${body}`, what });
  }

  if (exported.size) {
    const vars = [...exported].sort().join(", ");
    notes.push({
      level: "warn",
      message: opts.to === "codex" ? `Export before starting Codex: ${vars}.` : `Export before starting Claude Code: ${vars} (values stay in ${fromPath}, they are not copied).`,
    });
  }
}

function planCommands(opts: MigrationOptions, snap: MigrationSnapshot, ops: MigrationOp[], notes: MigrationNote[]) {
  const from = layout(opts.from, opts.scope).commands;
  const to = layout(opts.to, opts.scope).commands;
  const listing = from ? (snap.dirs[from] ?? []).filter((n) => n.endsWith(".md")) : [];
  if (!listing.length) return;
  if (!to) {
    notes.push({ level: "warn", message: `${listing.length} command(s) in ${from} not moved: Codex keeps custom prompts per user only — copy the ones you need to ~/.codex/prompts.` });
    return;
  }
  const taken = new Set(snap.dirs[to] ?? []);
  for (const name of listing) {
    const src = join(from!, name);
    const text = snap.files[src];
    if (text === undefined) continue;
    const target = join(to, name);
    if (taken.has(name)) {
      notes.push({ level: "info", message: `${target} already exists — kept.` });
      continue;
    }
    const { text: content, dropped } = filterFrontmatter(text, COMMAND_KEYS[opts.to]);
    if (dropped.length) notes.push({ level: "warn", message: `${src}: ${dropped.join(", ")} dropped (not supported by ${opts.to === "codex" ? "Codex prompts" : "Claude Code commands"}).` });
    if (opts.to === "claude-code") {
      const named = namedPlaceholders(content);
      if (named.length) notes.push({ level: "warn", message: `${src} uses named placeholders ${named.map((n) => `$${n}`).join(", ")} — Claude Code passes arguments as $ARGUMENTS/$1…$9; rewrite them.` });
    } else if (/^!`|@\S+\.\w+/m.test(content)) {
      notes.push({ level: "warn", message: `${src} uses !\`bash\` or @file references — Codex prompts insert them as plain text.` });
    }
    const invoke = opts.to === "codex" ? `/prompts:${name.slice(0, -3)}` : `/${name.slice(0, -3)}`;
    ops.push({ kind: "create", path: target, content, what: `command → ${invoke}` });
  }
}

function planSkills(opts: MigrationOptions, snap: MigrationSnapshot, ops: MigrationOp[], notes: MigrationNote[]) {
  const toDirs = layout(opts.to, opts.scope).skills;
  const toDir = toDirs[0];
  const taken = new Set(toDirs.flatMap((d) => snap.dirs[d] ?? []));
  const seen = new Set<string>();
  for (const from of layout(opts.from, opts.scope).skills) {
    for (const entry of snap.dirs[from] ?? []) {
      if (!entry.endsWith("/")) continue;
      const name = entry.slice(0, -1);
      if (seen.has(name)) continue;
      seen.add(name);
      if (taken.has(entry)) {
        notes.push({ level: "info", message: `Skill "${name}" already exists in ${toDir} — kept.` });
        continue;
      }
      // SKILL.md is the same open format for both agents: the directory is copied as is.
      ops.push({ kind: "copy-dir", from: join(from, name), to: join(toDir, name), what: `skill ${name}` });
    }
  }
}

export function planMigration(opts: MigrationOptions, snap: MigrationSnapshot): MigrationPlan {
  if (opts.from === opts.to) throw new Error("Source and target agent are the same");
  const ops: MigrationOp[] = [];
  const notes: MigrationNote[] = [];
  planInstructions(opts, snap, ops, notes);
  planMcp(opts, snap, ops, notes);
  planCommands(opts, snap, ops, notes);
  planSkills(opts, snap, ops, notes);
  if (opts.from === "claude-code") {
    notes.push({ level: "info", message: "Not moved: subagents (.claude/agents), hooks and permission rules in settings.json — Codex has no counterparts." });
  } else {
    notes.push({ level: "info", message: "Not moved: model, approval and sandbox settings from config.toml — choose them again in Claude Code (/model, /permissions)." });
  }
  return { options: opts, ops, notes };
}
