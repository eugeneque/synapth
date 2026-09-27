/**
 * Permissions with provenance. A catalogue entry lists what it can do on the
 * user's machine, and every item carries the reason it is there:
 *
 *   declared   the author wrote it — synapth.json `permissions`, SKILL.md `allowed-tools`
 *   detected   the crawler found it — source lines, dependencies, declared MCP tools
 *   assumed    nothing could be read (no code, no manifest field): a conservative
 *              guess, labelled as such, so trust policies stay on the safe side
 *
 * Pure and isomorphic: the parser and the crawler compute it, the skill page
 * renders it. Detection is static and deliberately literal — it reports what
 * the code visibly does, it does not prove what the code cannot do.
 */

import { SKILL_PERMISSIONS, type PermissionEvidence, type PermissionSource, type SkillManifest, type SkillPermission } from "@/types/skill";

/** Evidence items kept per permission — enough to check, short enough to show. */
export const EVIDENCE_PER_PERMISSION = 3;
const DETAIL_MAX = 140;

export const SOURCE_EXTENSIONS = /\.(m?[jt]s|cjs|cts|py)$/i;

// ---------------------------------------------------------------------------
// SKILL.md `allowed-tools` (Claude Code tool names)
// ---------------------------------------------------------------------------

const ALLOWED_TOOL_PERMISSIONS: Array<[RegExp, SkillPermission]> = [
  [/^(Read|Grep|Glob|LS|NotebookRead)\b/, "filesystem:read"],
  [/^(Write|Edit|MultiEdit|NotebookEdit)\b/, "filesystem:write"],
  [/^(Bash|Shell|Exec)\b/i, "shell"],
  [/^(WebFetch|WebSearch)\b/, "network"],
];

export function permissionsFromAllowedTools(allowed: string[]): PermissionEvidence[] {
  const out: PermissionEvidence[] = [];
  for (const raw of allowed) {
    const tool = raw.trim();
    for (const [re, permission] of ALLOWED_TOOL_PERMISSIONS) if (re.test(tool)) out.push({ permission, via: "allowed-tools", detail: tool.slice(0, DETAIL_MAX) });
    // MCP tools granted to the skill (`mcp__server__tool`) talk to a server — local or remote.
    if (/^mcp__/.test(tool)) out.push({ permission: "network", via: "allowed-tools", detail: tool.slice(0, DETAIL_MAX) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Declared MCP tools: names and the spec's tool annotations
// ---------------------------------------------------------------------------

export interface ToolLike {
  name: string;
  description?: string;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean };
}

const TOOL_NAME_PERMISSIONS: Array<[RegExp, SkillPermission]> = [
  [/(^|_)(read|get|list|search|find|stat|tree)_?(file|files|dir|dirs|directory|directories|path)s?($|_)/i, "filesystem:read"],
  [/(^|_)(write|edit|create|delete|remove|move|rename|append|patch)_?(file|files|dir|dirs|directory|path)s?($|_)/i, "filesystem:write"],
  [/(^|_)(run|exec|execute|spawn)_?(command|shell|script|process|terminal|bash)($|_)|^(bash|shell|terminal|exec)$/i, "shell"],
  [/(^|_)(fetch|http|request|browse|navigate|scrape|crawl|download|web_?search)($|_)/i, "network"],
  [/(^|_)(clipboard|copy_to_clipboard|paste)($|_)/i, "clipboard"],
];

export function permissionsFromTools(tools: ToolLike[]): PermissionEvidence[] {
  const out: PermissionEvidence[] = [];
  for (const t of tools) {
    const name = t.name.replace(/[-.]/g, "_").replace(/([a-z])([A-Z])/g, "$1_$2");
    for (const [re, permission] of TOOL_NAME_PERMISSIONS) if (re.test(name)) out.push({ permission, via: "tool", detail: t.name });
    if (t.annotations?.openWorldHint === true) out.push({ permission: "network", via: "tool", detail: `${t.name} · openWorldHint` });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

const NPM_PERMISSIONS: Record<string, SkillPermission> = {
  axios: "network", "node-fetch": "network", undici: "network", got: "network", ky: "network", ws: "network", superagent: "network", "cross-fetch": "network",
  puppeteer: "network", playwright: "network", "playwright-core": "network", pg: "network", mysql2: "network", mongodb: "network", redis: "network", ioredis: "network",
  execa: "shell", shelljs: "shell", "cross-spawn": "shell", zx: "shell", "node-pty": "shell",
  "fs-extra": "filesystem:write", chokidar: "filesystem:read", "fast-glob": "filesystem:read", globby: "filesystem:read",
  clipboardy: "clipboard", "@napi-rs/clipboard": "clipboard",
};
const PY_PERMISSIONS: Record<string, SkillPermission> = {
  requests: "network", httpx: "network", aiohttp: "network", urllib3: "network", websockets: "network", selenium: "network", playwright: "network",
  psycopg: "network", psycopg2: "network", "psycopg2-binary": "network", asyncpg: "network", pymongo: "network", redis: "network", "mysql-connector-python": "network",
  pexpect: "shell", sh: "shell", plumbum: "shell",
  watchdog: "filesystem:read", pyperclip: "clipboard",
};

/** `files`: path → text of package.json / requirements.txt / pyproject.toml. */
export function permissionsFromDependencies(files: Record<string, string>): PermissionEvidence[] {
  const out: PermissionEvidence[] = [];
  const add = (name: string, table: Record<string, SkillPermission>, file: string) => {
    const permission = table[name.toLowerCase()];
    if (permission) out.push({ permission, via: "dependency", detail: `${name} · ${file}` });
  };
  for (const [path, text] of Object.entries(files)) {
    const base = path.split("/").pop() ?? path;
    if (base === "package.json") {
      try {
        const pkg = JSON.parse(text) as { dependencies?: Record<string, string> };
        for (const name of Object.keys(pkg.dependencies ?? {})) add(name, NPM_PERMISSIONS, path);
      } catch {
        // A broken package.json is the dependency scanner's finding, not ours.
      }
    } else if (base === "requirements.txt") {
      for (const line of text.split("\n")) {
        const name = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(line.replace(/#.*/, ""))?.[1];
        if (name) add(name, PY_PERMISSIONS, path);
      }
    } else if (base === "pyproject.toml") {
      for (const m of text.matchAll(/["']([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:[<>=!~;[\]]|["'])/g)) add(m[1], PY_PERMISSIONS, path);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Source code
// ---------------------------------------------------------------------------

interface CodeRule {
  permission: SkillPermission;
  /** The file must match this first (e.g. imports `fs`); null — any file. */
  requires: RegExp | null;
  /** The line that is shown as evidence. */
  line: RegExp;
}

const JS_FS = /(?:from\s+|require\(\s*|import\(\s*)["'](?:node:)?fs(?:\/promises)?["']|["']fs-extra["']/;
const JS_RULES: CodeRule[] = [
  { permission: "filesystem:read", requires: JS_FS, line: /\b(readFile|readFileSync|createReadStream|readdir|readdirSync|opendir|readlink|realpath|lstat|stat|statSync|existsSync)\s*\(/ },
  { permission: "filesystem:write", requires: JS_FS, line: /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|mkdir|mkdirSync|rm|rmSync|rmdir|unlink|unlinkSync|rename|renameSync|copyFile|copyFileSync|cp|cpSync|truncate|chmod|symlink|outputFile|remove|emptyDir)\s*\(/ },
  { permission: "shell", requires: null, line: /(?:from\s+|require\(\s*|import\(\s*)["'](?:node:child_process|child_process|execa|shelljs|cross-spawn|zx|node-pty)["']/ },
  { permission: "network", requires: null, line: /\bfetch\s*\(|new\s+WebSocket\s*\(|(?:from\s+|require\(\s*|import\(\s*)["'](?:node:)?(?:https?|http2|net|tls|dgram)["']|(?:from\s+|require\(\s*|import\(\s*)["'](?:axios|node-fetch|undici|got|ky|ws|superagent|cross-fetch|pg|mysql2|mongodb|redis|ioredis|puppeteer|playwright|playwright-core)["']/ },
  { permission: "env", requires: null, line: /\bprocess\.env\b|\bDeno\.env\b|\bBun\.env\b/ },
  { permission: "clipboard", requires: null, line: /["'](?:clipboardy|@napi-rs\/clipboard)["']|navigator\.clipboard/ },
];

const PY_RULES: CodeRule[] = [
  { permission: "filesystem:read", requires: null, line: /\bopen\((?![^)]*["'][wax]b?\+?["'])|\.read_text\(|\.read_bytes\(|\bos\.(listdir|walk|scandir)\(|\bglob\.glob\(|\.iterdir\(|\.rglob\(/ },
  { permission: "filesystem:write", requires: null, line: /\bopen\([^)]*["'](?:[wax]b?\+?|r\+b?|rb\+)["']|\.write_text\(|\.write_bytes\(|\bos\.(remove|unlink|rmdir|makedirs|mkdir|rename|replace)\(|\bshutil\.(rmtree|move|copy\w*)\(|\.unlink\(|\.mkdir\(|\.rename\(/ },
  { permission: "shell", requires: null, line: /^\s*(?:import\s+subprocess\b|from\s+subprocess\s+import)|\bos\.(system|popen|exec\w*|spawn\w*)\(|\basyncio\.create_subprocess_(exec|shell)\(|^\s*(?:import|from)\s+(?:pexpect|plumbum)\b/ },
  { permission: "network", requires: null, line: /^\s*(?:import|from)\s+(?:requests|httpx|aiohttp|urllib3?|urllib\.request|websockets?|socket|http\.client|psycopg2?|asyncpg|pymongo|redis|selenium|playwright)\b/ },
  { permission: "env", requires: null, line: /\bos\.environ\b|\bos\.getenv\(/ },
  { permission: "clipboard", requires: null, line: /^\s*(?:import|from)\s+pyperclip\b/ },
];

function compact(line: string) {
  const text = line.trim().replace(/\s+/g, " ");
  return text.length > 72 ? `${text.slice(0, 71)}…` : text;
}

/** `files`: path → source text. Comment-only lines are skipped; the first hit per permission and file is kept. */
export function permissionsFromCode(files: Record<string, string>): PermissionEvidence[] {
  const out: PermissionEvidence[] = [];
  for (const [path, text] of Object.entries(files)) {
    if (!SOURCE_EXTENSIONS.test(path)) continue;
    const rules = /\.py$/i.test(path) ? PY_RULES : JS_RULES;
    const lines = text.split("\n");
    for (const rule of rules) {
      if (rule.requires && !rule.requires.test(text)) continue;
      const i = lines.findIndex((l) => {
        const t = l.trim();
        return !t.startsWith("//") && !t.startsWith("#") && !t.startsWith("*") && rule.line.test(l);
      });
      if (i >= 0) out.push({ permission: rule.permission, via: "code", detail: `${path}:${i + 1} · ${compact(lines[i])}`.slice(0, DETAIL_MAX) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Putting it together
// ---------------------------------------------------------------------------

/** Ordered, deduplicated, at most `EVIDENCE_PER_PERMISSION` per permission. */
export function normalizeEvidence(items: PermissionEvidence[]): PermissionEvidence[] {
  const seen = new Set<string>();
  const perPermission = new Map<SkillPermission, number>();
  const out: PermissionEvidence[] = [];
  for (const e of items) {
    const key = `${e.permission}|${e.via}|${e.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const n = perPermission.get(e.permission) ?? 0;
    if (n >= EVIDENCE_PER_PERMISSION) continue;
    perPermission.set(e.permission, n + 1);
    out.push(e);
  }
  return out.sort((a, b) => SKILL_PERMISSIONS.indexOf(a.permission) - SKILL_PERMISSIONS.indexOf(b.permission));
}

export function permissionsOf(evidence: PermissionEvidence[]): SkillPermission[] {
  return SKILL_PERMISSIONS.filter((p) => evidence.some((e) => e.permission === p));
}

/** What a local MCP server is assumed to need when none of its code could be read — the same guess the catalogue always made. */
export const ASSUMED_LOCAL_SERVER: SkillPermission[] = ["shell", "network"];

type PermissionFields = Pick<SkillManifest, "permissions" | "permissionSource" | "permissionEvidence">;

export function withPermissions(source: PermissionSource, evidence: PermissionEvidence[], assumed: SkillPermission[] = []): PermissionFields {
  const normalized = normalizeEvidence(evidence);
  // A guess covers at least the baseline and everything any evidence already showed.
  const listed = source === "assumed" ? SKILL_PERMISSIONS.filter((p) => assumed.includes(p) || normalized.some((e) => e.permission === p)) : permissionsOf(normalized);
  return { permissions: listed, permissionSource: source, permissionEvidence: normalized };
}

export interface CodeAnalysis {
  /** Source files that were read. */
  files: string[];
  evidence: PermissionEvidence[];
}

/**
 * Refines a parsed manifest with what the crawler read next to it. Declared
 * permissions stay as written (the scanner compares them with the code);
 * a guess is replaced once code was actually read; detected lists grow.
 */
export function refinePermissions(manifest: SkillManifest, analysis: CodeAnalysis | null | undefined): SkillManifest {
  if (!analysis || (!analysis.files.length && !analysis.evidence.length)) return manifest;
  const current = manifest.permissionEvidence ?? [];
  if (manifest.permissionSource === "declared") {
    // SKILL.md: allowed-tools is what the agent grants, scripts are what the skill runs — both are real.
    if (manifest.entrypoint.type !== "prompt") return manifest;
    return { ...manifest, ...withPermissions("declared", [...current, ...analysis.evidence]) };
  }
  if (manifest.permissionSource === "assumed" && !analysis.files.length) return manifest;
  return { ...manifest, ...withPermissions("detected", [...current, ...analysis.evidence]) };
}

/** Which files of a repository tree are read to detect permissions for a manifest in `dir`. */
export function codeFilesFor(tree: string[], dir: string, limit: number): string[] {
  const prefix = dir ? `${dir}/` : "";
  const ignored = /(^|\/)(node_modules|vendor|dist|build|out|\.git|\.venv|venv|__pycache__|tests?|__tests__|spec|fixtures?|examples?|docs?|scripts\/dev)\//i;
  const candidates = tree.filter(
    (p) =>
      p.startsWith(prefix) &&
      SOURCE_EXTENSIONS.test(p) &&
      !ignored.test(`/${p.slice(prefix.length)}`) &&
      !/\.(d\.ts|test\.\w+|spec\.\w+)$/i.test(p) &&
      !/(^|\/)(vite|jest|vitest|eslint|webpack|rollup|tsup|babel|next|tailwind|postcss)\.config\./i.test(p),
  );
  const rank = (p: string) => {
    const rel = p.slice(prefix.length);
    const depth = rel.split("/").length;
    const entry = /(^|\/)(index|main|server|app|cli|__main__|mcp)\.\w+$/i.test(rel) ? 0 : 1;
    const src = /^(src|lib|server|scripts)\//i.test(rel) ? 0 : 1;
    return entry * 100 + src * 10 + depth;
  };
  return candidates.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).slice(0, limit);
}
