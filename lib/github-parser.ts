/**
 * Cortex · GitHub Aggregator
 *
 * Turns a repository into zero or more Synapth skills. Handles the shapes
 * that actually exist in the wild:
 *
 *   SKILL.md                         one skill at the root
 *   skills/<name>/SKILL.md           a collection (anthropics/skills, …)
 *   .claude/skills/<name>/SKILL.md   project-local skills
 *   synapth.json                     native manifest
 *   mcp-server.json / server.json    MCP servers (incl. the MCP registry format)
 *   .mcp.json                        Claude Code project MCP config ({ mcpServers })
 *   tool.json                        single HTTP tool
 *   README.md                        fallback when the repo is clearly a skill/MCP server
 *
 * The HTTP layer is injectable: `createGithubFetcher()` for production,
 * `createMockFetcher()` for tests and the no-database demo.
 */

import type { GithubSource, JsonSchema, SkillCategory, SkillCreateInput, SkillEntrypoint, SkillManifest, ToolDefinition } from "@/types/skill";
import { parseFrontmatter, str, strList } from "@/lib/frontmatter";
import { slugify } from "@/lib/utils";

export interface RepoRef {
  owner: string;
  repo: string;
  ref: string; // branch, tag, commit or "HEAD"
  path: string; // sub-directory ("" = root)
}

export const MANIFEST_FILES = ["synapth.json", "mcp-server.json", "server.json", ".mcp.json", "tool.json", "SKILL.md", "README.md"] as const;
export type ManifestFile = (typeof MANIFEST_FILES)[number];

/** Directories where collections keep their skills. Depth-limited to avoid vendored trees. */
const SKILL_FILE = /(^|\/)SKILL\.md$/i;
const MAX_SKILL_DEPTH = 4;
/** Stored README/SKILL.md body cap; the search index reads the first 20k anyway. */
const README_STORE_CAP = 40_000;
const IGNORED_DIRS = /(^|\/)(node_modules|vendor|dist|build|\.git|test|tests|__tests__|fixtures?|examples?|templates?)\//i;

export interface RepoMeta {
  fullName: string;
  stars: number;
  forks: number;
  openIssues: number;
  description: string | null;
  defaultBranch: string;
  license: string | null;
  topics: string[];
  language: string | null;
  homepage: string | null;
  avatarUrl: string | null;
  pushedAt: string;
  archived: boolean;
}

export interface RepoFetcher {
  /** File text or null when it does not exist. */
  readFile(ref: RepoRef, path: string): Promise<string | null>;
  meta(ref: RepoRef): Promise<RepoMeta>;
  /** All file paths in the repo (recursive). Null when unavailable (no token / too large). */
  tree(ref: RepoRef): Promise<string[] | null>;
}

export interface ImportResult {
  ref: RepoRef;
  manifestFile: ManifestFile;
  manifestPath: string;
  input: SkillCreateInput;
  meta: RepoMeta;
  warnings: string[];
}

export type GithubErrorCode = "bad_url" | "not_found" | "invalid_manifest" | "rate_limited" | "forbidden";

export class GithubParseError extends Error {
  constructor(
    message: string,
    public readonly code: GithubErrorCode,
    /** For `rate_limited`: epoch ms when the budget comes back (best effort). */
    public readonly resetAt?: number,
  ) {
    super(message);
    this.name = "GithubParseError";
  }
}

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

/** GitHub's own limits; also stops `..`, `%2e%2e` and other path tricks reaching the API URL. */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,199}$/;

function assertSegment(value: string, what: string): string {
  if (!SEGMENT.test(value) || value.includes("..")) throw new GithubParseError(`Invalid ${what}: ${value}`, "bad_url");
  return value;
}

export function parseRepoUrl(input: string): RepoRef {
  const trimmed = input.trim();
  const shorthand = trimmed.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (shorthand) return { owner: assertSegment(shorthand[1], "owner"), repo: assertSegment(stripGit(shorthand[2]), "repository"), ref: "HEAD", path: "" };

  let url: URL;
  try {
    url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
  } catch {
    throw new GithubParseError(`Not a URL: ${input}`, "bad_url");
  }
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
    throw new GithubParseError(`Only github.com repositories are supported (got ${url.hostname})`, "bad_url");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) throw new GithubParseError("URL must contain owner and repository", "bad_url");
  const [rawOwner, rawRepo, kind, rawRef, ...rest] = parts;
  const owner = assertSegment(decodeURIComponent(rawOwner), "owner");
  const repo = assertSegment(stripGit(decodeURIComponent(rawRepo)), "repository");
  if ((kind === "tree" || kind === "blob") && rawRef) {
    const ref = decodeURIComponent(rawRef);
    if (!REF.test(ref) || ref.includes("..")) throw new GithubParseError(`Invalid ref: ${ref}`, "bad_url");
    const path = rest.map((p) => decodeURIComponent(p)).join("/");
    if (path.split("/").some((seg) => seg === "." || seg === "..")) throw new GithubParseError("Invalid path", "bad_url");
    return { owner, repo, ref, path };
  }
  return { owner, repo, ref: "HEAD", path: "" };
}

const stripGit = (name: string) => name.replace(/\.git$/, "");
export const repoUrl = (ref: RepoRef) => `https://github.com/${ref.owner}/${ref.repo}`;

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

/** Mutable token holder shared by every GitHub call of one crawl: a rejected token is dropped once for all of them. */
export interface GithubAuth {
  token: string | null;
}

export interface GithubCallOptions {
  signal?: AbortSignal;
  /** Called with rate-limit headers after every API response (crawler uses it to pace itself). */
  onRateLimit?: (info: { remaining: number; resetAt: number; resource: string }) => void;
  /** Non-fatal problems worth a log line (e.g. the token was rejected). */
  onWarning?: (message: string) => void;
}

const USER_AGENT = "synapth-cortex/0.3";

/**
 * GET against api.github.com. A token GitHub rejects (401: expired, revoked,
 * wrong scope) is dropped and the call retried anonymously: one stale
 * GITHUB_TOKEN must not turn every crawl into a hard failure.
 */
export async function githubApiFetch(path: string, auth: GithubAuth, opts: GithubCallOptions = {}): Promise<Response> {
  for (;;) {
    const headers: Record<string, string> = { "User-Agent": USER_AGENT, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    const token = auth.token;
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`https://api.github.com${path}`, { headers, signal: opts.signal, cache: "no-store" });
    const remaining = Number(res.headers.get("x-ratelimit-remaining") ?? NaN);
    if (!Number.isNaN(remaining)) {
      opts.onRateLimit?.({ remaining, resetAt: Number(res.headers.get("x-ratelimit-reset")) * 1000, resource: res.headers.get("x-ratelimit-resource") ?? "core" });
    }
    if (res.status === 401 && token) {
      await res.body?.cancel();
      if (auth.token === token) {
        auth.token = null;
        opts.onWarning?.("GitHub rejected the token (401 Bad credentials): continuing unauthenticated — renew GITHUB_TOKEN");
      }
      continue;
    }
    return res;
  }
}

/**
 * Primary (`x-ratelimit-remaining: 0`) and secondary (`retry-after`, "rate
 * limit" in the message) limits. Any other 403 is a real refusal (blocked
 * repo, SSO, proxy policy) and must not be retried forever.
 */
export function rateLimitReset(res: Response, body: string): number | null {
  if (res.status !== 403 && res.status !== 429) return null;
  const retryAfter = Number(res.headers.get("retry-after"));
  if (retryAfter > 0) return Date.now() + retryAfter * 1000;
  const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000;
  if (res.headers.get("x-ratelimit-remaining") === "0") return reset > 0 ? reset : Date.now() + 60_000;
  if (res.status === 429 || /rate limit/i.test(body)) return Date.now() + 60_000;
  return null;
}

/** GitHub error bodies are JSON `{ message }`; keep log lines short. */
export function githubErrorMessage(body: string): string {
  try {
    const message = (JSON.parse(body) as { message?: unknown }).message;
    if (typeof message === "string") return message.slice(0, 200);
  } catch {
    /* not JSON */
  }
  return body.replace(/\s+/g, " ").slice(0, 200);
}

/** Postgres rejects U+0000 in text and jsonb; some READMEs and manifests carry it. */
const stripNul = (text: string) => (text.includes("\u0000") ? text.replace(/\u0000/g, "") : text);

/** Same for parsed JSON manifests, where the NUL arrives as a `\u0000` escape (an escaped backslash before it is kept). */
function withoutNul<T>(value: T): T {
  const json = JSON.stringify(value);
  return json.includes("\\u0000") ? (JSON.parse(json.replace(/(?<!\\)((?:\\\\)*)\\u0000/g, "$1")) as T) : value;
}

export interface GithubFetcherOptions extends Omit<GithubCallOptions, "signal"> {
  token?: string;
  /** Shared token holder (the crawler passes one so search and fetches drop a bad token together). */
  auth?: GithubAuth;
}

export function createGithubFetcher(opts: GithubFetcherOptions = {}): RepoFetcher {
  const auth: GithubAuth = opts.auth ?? { token: opts.token ?? process.env.GITHUB_TOKEN ?? null };
  const metaCache = new Map<string, Promise<RepoMeta>>();

  async function api<T>(path: string): Promise<T | null> {
    const res = await githubApiFetch(path, auth, opts);
    // 404 missing, 409 empty repository, 451 blocked for legal reasons: nothing to import.
    if (res.status === 404 || res.status === 409 || res.status === 451) {
      await res.body?.cancel();
      return null;
    }
    if (!res.ok) {
      const body = await res.text();
      const resetAt = rateLimitReset(res, body);
      if (resetAt !== null) throw new GithubParseError(`GitHub rate limit hit on ${path}`, "rate_limited", resetAt);
      if (res.status === 403) throw new GithubParseError(`GitHub refused ${path}: ${githubErrorMessage(body)}`, "forbidden");
      throw new Error(`GitHub API ${res.status} for ${path}: ${githubErrorMessage(body)}`);
    }
    return (await res.json()) as T;
  }

  return {
    async meta(ref) {
      const key = `${ref.owner}/${ref.repo}`.toLowerCase();
      let p = metaCache.get(key);
      if (!p) {
        p = api<GithubRepoJson>(`/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`).then((json) => {
          if (!json) throw new GithubParseError(`Repository ${ref.owner}/${ref.repo} not found`, "not_found");
          return toRepoMeta(json);
        });
        metaCache.set(key, p);
      }
      return p;
    },
    async readFile(ref, path) {
      const branch = ref.ref === "HEAD" ? (await this.meta(ref)).defaultBranch : ref.ref;
      const full = [ref.path, path].filter(Boolean).join("/");
      const target = `https://raw.githubusercontent.com/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/${branch.split("/").map(encodeURIComponent).join("/")}/${full.split("/").map(encodeURIComponent).join("/")}`;
      const res = await fetch(target, { headers: { "User-Agent": USER_AGENT }, cache: "no-store" });
      if (res.status === 404) return null;
      if (res.status === 429) throw new GithubParseError(`raw.githubusercontent.com rate limit on ${full}`, "rate_limited", Date.now() + 60_000);
      if (!res.ok) throw new Error(`raw fetch ${res.status}: ${full}`);
      return stripNul(await res.text());
    },
    async tree(ref) {
      const branch = ref.ref === "HEAD" ? (await this.meta(ref)).defaultBranch : ref.ref;
      const json = await api<{ tree: Array<{ path: string; type: string }>; truncated: boolean }>(`/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
      if (!json) return null;
      const paths = json.tree.filter((t) => t.type === "blob").map((t) => t.path);
      return ref.path ? paths.filter((p) => p.startsWith(`${ref.path}/`)).map((p) => p.slice(ref.path.length + 1)) : paths;
    },
  };
}

export interface GithubRepoJson {
  full_name: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  description: string | null;
  default_branch: string;
  license: { spdx_id: string } | null;
  topics?: string[];
  language: string | null;
  homepage: string | null;
  owner: { login: string; avatar_url: string };
  pushed_at: string;
  archived: boolean;
}

export function toRepoMeta(json: GithubRepoJson): RepoMeta {
  return {
    fullName: json.full_name,
    stars: json.stargazers_count,
    forks: json.forks_count,
    openIssues: json.open_issues_count,
    description: json.description,
    defaultBranch: json.default_branch,
    license: json.license?.spdx_id && json.license.spdx_id !== "NOASSERTION" ? json.license.spdx_id : null,
    topics: json.topics ?? [],
    language: json.language,
    homepage: json.homepage || null,
    avatarUrl: json.owner?.avatar_url ?? null,
    pushedAt: json.pushed_at,
    archived: json.archived,
  };
}

/** Canned repositories for tests and the no-database demo. */
export function createMockFetcher(): RepoFetcher {
  const files: Record<string, Record<string, string>> = {
    "acme/postgres-mcp": {
      "mcp-server.json": JSON.stringify({
        name: "postgres-mcp",
        description: "Read-only SQL access to a PostgreSQL database for agents.",
        command: "npx",
        args: ["-y", "@acme/postgres-mcp"],
        env: { DATABASE_URL: "${DATABASE_URL}" },
        tools: [
          { name: "query", description: "Run a read-only SQL query.", inputSchema: { type: "object", properties: { sql: { type: "string", description: "SELECT statement" } }, required: ["sql"] } },
          { name: "list_tables", description: "List tables in the public schema.", inputSchema: { type: "object", properties: {} } },
        ],
      }),
      "README.md": "# postgres-mcp\n\nAn MCP server for Postgres.",
    },
    "acme/weather-tool": {
      "tool.json": JSON.stringify({
        name: "weather_now",
        description: "Current weather by city using Open-Meteo.",
        url: "https://tools.acme.dev/weather",
        method: "POST",
        parameters: { type: "object", properties: { city: { type: "string" }, units: { type: "string", enum: ["metric", "imperial"] } }, required: ["city"] },
      }),
    },
    "acme/code-review-skill": {
      "SKILL.md": [
        "---",
        "name: Strict Code Reviewer",
        "description: Turns the agent into a meticulous reviewer that always checks tests and edge cases.",
        "category: Prompt",
        "tags: [review, quality, testing]",
        "---",
        "",
        "You are a strict senior reviewer. For every change:",
        "1. Identify the intent from the diff, not the description.",
        "2. Check that tests cover the new branch.",
        "3. Flag any silent behaviour change as a blocker.",
        "Reply in the form: Verdict / Blockers / Nits.",
      ].join("\n"),
    },
    "acme/skills-collection": {
      "README.md": "# Skills\n\nA collection of agent skills.",
      "skills/pdf/SKILL.md": "---\nname: pdf\ndescription: Read, merge and fill PDF files.\nlicense: MIT\n---\n\n# PDF\n\nUse pypdf for merging.",
      "skills/xlsx/SKILL.md": "---\nname: xlsx\ndescription: >\n  Create and edit spreadsheets\n  with formulas.\n---\n\n# XLSX\n\nUse openpyxl.",
      "skills/pdf/scripts/merge.py": "print('hi')",
    },
  };
  const meta: Record<string, RepoMeta> = {
    "acme/postgres-mcp": mockMeta("acme/postgres-mcp", 1840, "TypeScript", ["mcp", "postgres"], "Postgres MCP server"),
    "acme/weather-tool": mockMeta("acme/weather-tool", 212, "Go", ["tool"], "Weather tool"),
    "acme/code-review-skill": mockMeta("acme/code-review-skill", 97, null, ["prompt"], "Reviewer prompt"),
    "acme/skills-collection": mockMeta("acme/skills-collection", 4200, "Python", ["claude-skills", "skills"], "Agent skills collection"),
  };
  return {
    async readFile(ref, path) {
      return files[`${ref.owner}/${ref.repo}`]?.[path] ?? null;
    },
    async meta(ref) {
      const m = meta[`${ref.owner}/${ref.repo}`];
      if (!m) throw new GithubParseError(`Repository ${ref.owner}/${ref.repo} not found (mock)`, "not_found");
      return m;
    },
    async tree(ref) {
      const f = files[`${ref.owner}/${ref.repo}`];
      return f ? Object.keys(f) : null;
    },
  };
}

function mockMeta(fullName: string, stars: number, language: string | null, topics: string[], description: string): RepoMeta {
  return { fullName, stars, forks: Math.round(stars / 10), openIssues: 3, description, defaultBranch: "main", license: "MIT", topics, language, homepage: null, avatarUrl: null, pushedAt: new Date().toISOString(), archived: false };
}

// ---------------------------------------------------------------------------
// Mapping: external formats → SkillManifest
// ---------------------------------------------------------------------------

interface McpServerJson {
  name?: string;
  description?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  tools?: Array<{ name: string; description?: string; inputSchema?: JsonSchema; parameters?: JsonSchema }>;
  version?: string;
  // MCP registry `server.json`
  packages?: Array<{ registry_type?: string; registryType?: string; identifier?: string; name?: string; runtime_hint?: string; environment_variables?: Array<{ name: string }>; environmentVariables?: Array<{ name: string }> }>;
  remotes?: Array<{ type?: string; url: string }>;
  // Claude Code `.mcp.json`
  mcpServers?: Record<string, { command?: string; args?: string[]; env?: Record<string, string>; url?: string; type?: string }>;
}

interface ToolJson {
  name: string;
  description?: string;
  url: string;
  method?: "GET" | "POST";
  parameters?: JsonSchema;
  version?: string;
}

function toolsFrom(raw: McpServerJson["tools"]): ToolDefinition[] {
  return (raw ?? [])
    .filter((t) => t && typeof t.name === "string")
    .map((t) => ({ name: t.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64), description: t.description ?? "", parameters: t.inputSchema ?? t.parameters ?? { type: "object", properties: {} } }));
}

function mapMcpServer(raw: McpServerJson, fallbackName: string, warnings: string[]): SkillManifest {
  let entrypoint: SkillEntrypoint | null = null;
  let requiredEnv: string[] = [];
  let name = raw.name ?? fallbackName;

  if (raw.mcpServers && Object.keys(raw.mcpServers).length) {
    // .mcp.json: take the first server; others are listed as a warning.
    const [key, server] = Object.entries(raw.mcpServers)[0];
    name = raw.name ?? key;
    if (Object.keys(raw.mcpServers).length > 1) warnings.push(`.mcp.json declares ${Object.keys(raw.mcpServers).length} servers; imported "${key}".`);
    entrypoint = server.url ? { type: "mcp-sse", url: server.url } : { type: "mcp-stdio", command: server.command ?? "npx", args: server.args ?? [], env: server.env };
    requiredEnv = Object.keys(server.env ?? {});
  } else if (raw.remotes?.length) {
    entrypoint = { type: "mcp-sse", url: raw.remotes[0].url };
  } else if (raw.packages?.length) {
    const pkg = raw.packages[0];
    const registry = (pkg.registry_type ?? pkg.registryType ?? "npm").toLowerCase();
    const id = pkg.identifier ?? pkg.name ?? fallbackName;
    const cmd = registry === "pypi" ? { command: "uvx", args: [id] } : registry === "oci" ? { command: "docker", args: ["run", "-i", "--rm", id] } : { command: "npx", args: ["-y", id] };
    entrypoint = { type: "mcp-stdio", ...cmd };
    requiredEnv = (pkg.environment_variables ?? pkg.environmentVariables ?? []).map((e) => e.name);
  } else if (raw.url) {
    entrypoint = { type: "mcp-sse", url: raw.url };
  } else {
    entrypoint = { type: "mcp-stdio", command: raw.command ?? "npx", args: raw.args ?? [], env: raw.env };
    requiredEnv = Object.keys(raw.env ?? {});
  }

  const tools = toolsFrom(raw.tools);
  if (!tools.length) warnings.push("No tools declared in the manifest; the agent discovers them at runtime via MCP `tools/list`.");

  return {
    schemaVersion: 1,
    name: String(name),
    description: raw.description ?? "",
    category: "MCP",
    tools,
    entrypoint,
    permissions: entrypoint.type === "mcp-sse" ? ["network"] : ["shell", "network"],
    requiredEnv,
  };
}

function mapTool(raw: ToolJson): SkillManifest {
  return {
    schemaVersion: 1,
    name: raw.name,
    description: raw.description ?? "",
    category: "Tool",
    tools: [{ name: raw.name.replace(/[^a-zA-Z0-9_-]/g, "_"), description: raw.description ?? "", parameters: raw.parameters ?? { type: "object", properties: {} } }],
    entrypoint: { type: "http", url: raw.url, method: raw.method ?? "POST" },
    permissions: ["network"],
  };
}

/** Back-compat shim used by tests and older callers. */
export function parseSkillMarkdown(text: string): { frontmatter: Record<string, string | string[]>; body: string } {
  const { data, body } = parseFrontmatter(text);
  const fm: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(data)) fm[k] = Array.isArray(v) ? v.map(String) : String(v);
  return { frontmatter: fm, body };
}

function mapSkillMarkdown(text: string, fallbackName: string): { manifest: SkillManifest; tags: string[]; license: string | null; body: string } {
  const { data, body } = parseFrontmatter(text);
  const declared = str(data, "category");
  const category: SkillCategory = declared === "MCP" || declared === "Tool" ? declared : "Prompt";
  const firstParagraph = body.replace(/^#.*$/m, "").trim().split(/\n\s*\n/)[0]?.replace(/\s+/g, " ").slice(0, 300) ?? "";
  const allowedTools = strList(data, "allowed-tools");
  return {
    manifest: {
      schemaVersion: 1,
      name: str(data, "name") ?? fallbackName,
      description: str(data, "description")?.replace(/\s+/g, " ") ?? firstParagraph,
      category,
      systemPrompt: body,
      tools: [],
      entrypoint: { type: "prompt" },
      permissions: allowedTools.some((t) => /bash|shell|exec/i.test(t)) ? ["shell"] : [],
    },
    tags: [...strList(data, "tags"), ...strList(data, "keywords")],
    license: str(data, "license") ?? null,
    body,
  };
}

/**
 * README fallback: only for repos that are clearly about agent skills / MCP.
 * Produces a Prompt-less MCP or Prompt entry whose page is the README itself.
 */
const SKILL_SIGNALS = /\b(claude|mcp|model context protocol|agent skill|skills? for (ai|agents?|claude|cursor|codex)|cursor rule|system prompt|prompt pack)\b/i;

function mapReadme(readme: string, meta: RepoMeta, ref: RepoRef): SkillManifest | null {
  const haystack = `${meta.description ?? ""}\n${meta.topics.join(" ")}\n${readme.slice(0, 4000)}`;
  if (!SKILL_SIGNALS.test(haystack) && !meta.topics.some((t) => /skill|mcp|claude|agent/i.test(t))) return null;

  const isMcp = /\b(mcp|model context protocol)\b/i.test(haystack);
  const npx = readme.match(/npx\s+(-y\s+)?(@?[\w./-]+(?:@[\w.^~-]+)?)/);
  const uvx = readme.match(/uvx\s+([\w.-]+)/);
  const entrypoint: SkillEntrypoint = isMcp
    ? npx
      ? { type: "mcp-stdio", command: "npx", args: ["-y", npx[2]] }
      : uvx
        ? { type: "mcp-stdio", command: "uvx", args: [uvx[1]] }
        : { type: "mcp-stdio", command: "npx", args: ["-y", `github:${ref.owner}/${ref.repo}`] }
    : { type: "prompt" };

  const title = readme.match(/^#\s+(.+)$/m)?.[1]?.replace(/[*_`]/g, "").trim();
  return {
    schemaVersion: 1,
    name: title && title.length <= 80 ? title : ref.repo,
    description: meta.description ?? readme.replace(/^#.*$/m, "").trim().split(/\n\s*\n/)[0]?.replace(/\s+/g, " ").slice(0, 300) ?? "",
    category: isMcp ? "MCP" : "Prompt",
    tools: [],
    entrypoint,
    permissions: isMcp ? ["shell", "network"] : [],
  };
}

// ---------------------------------------------------------------------------
// Discovery inside a repository
// ---------------------------------------------------------------------------

export interface DiscoveredManifest {
  file: ManifestFile;
  path: string;
}

/** Root manifests first, then every SKILL.md in a collection, README last. */
export async function discoverManifests(ref: RepoRef, fetcher: RepoFetcher): Promise<DiscoveredManifest[]> {
  const tree = await fetcher.tree(ref);
  const found: DiscoveredManifest[] = [];

  if (tree) {
    const set = new Set(tree);
    for (const f of MANIFEST_FILES) if (f !== "README.md" && f !== "SKILL.md" && set.has(f)) found.push({ file: f, path: f });
    const skillFiles = tree
      .filter((p) => SKILL_FILE.test(p) && !IGNORED_DIRS.test(p) && p.split("/").length <= MAX_SKILL_DEPTH + 1)
      .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
    for (const p of skillFiles) found.push({ file: "SKILL.md", path: p });
    if (!found.length) {
      const readme = tree.find((p) => /^readme\.md$/i.test(p));
      if (readme) found.push({ file: "README.md", path: readme });
    }
    return found;
  }

  // No tree (no token or huge repo): probe well-known paths with raw fetches.
  for (const f of MANIFEST_FILES) {
    if (f === "README.md") continue;
    if ((await fetcher.readFile(ref, f)) !== null) found.push({ file: f, path: f });
  }
  if (!found.length && (await fetcher.readFile(ref, "README.md")) !== null) found.push({ file: "README.md", path: "README.md" });
  return found;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ImportOptions {
  /** Cap on skills per repository (collections can be huge). */
  maxPerRepo?: number;
  /** Skip README-only imports. */
  requireManifest?: boolean;
}

export async function importAllFromGithub(url: string, fetcher: RepoFetcher = createGithubFetcher(), options: ImportOptions = {}): Promise<ImportResult[]> {
  const ref = parseRepoUrl(url);
  const meta = await fetcher.meta(ref);
  const manifests = await discoverManifests(ref, fetcher);
  const results: ImportResult[] = [];
  const skipped: string[] = [];
  const usedSlugs = new Set<string>();
  const crawledAt = new Date().toISOString();
  const rootReadme = manifests.some((m) => m.file !== "README.md") ? await fetcher.readFile(ref, "README.md") : null;

  for (const found of manifests.slice(0, options.maxPerRepo ?? 50)) {
    if (found.file === "README.md" && options.requireManifest) continue;
    const text = await fetcher.readFile(ref, found.path);
    if (text === null) continue;

    const warnings: string[] = [];
    let manifest: SkillManifest | null;
    let version = "0.1.0";
    let tags: string[] = [];
    let license: string | null = null;
    let skillBody: string | null = null;
    const dirName = found.path.split("/").slice(-2, -1)[0];
    const fallbackName = dirName ?? ref.repo;

    try {
      switch (found.file) {
        case "SKILL.md": {
          const mapped = mapSkillMarkdown(text, fallbackName);
          manifest = mapped.manifest;
          tags = mapped.tags;
          license = mapped.license;
          skillBody = mapped.body;
          break;
        }
        case "README.md":
          manifest = mapReadme(text, meta, ref);
          if (!manifest) continue;
          break;
        case "tool.json": {
          const json = JSON.parse(text) as ToolJson;
          version = json.version ?? version;
          manifest = mapTool(json);
          break;
        }
        case "synapth.json": {
          const json = JSON.parse(text) as SkillManifest & { version?: string };
          version = json.version ?? version;
          manifest = json.schemaVersion === 1 ? json : mapMcpServer(json as unknown as McpServerJson, ref.repo, warnings);
          break;
        }
        default: {
          const json = JSON.parse(text) as McpServerJson;
          // `server.json` is a common name outside MCP: require an MCP-shaped document.
          const mcpShaped = Boolean(json.mcpServers || json.packages || json.remotes || json.tools || json.command || json.url);
          if (!mcpShaped) {
            manifest = null;
            break;
          }
          version = json.version ?? version;
          manifest = mapMcpServer(json, ref.repo, warnings);
        }
      }
    } catch (err) {
      // One broken file must not sink the rest of a collection.
      warnings.push(`${found.path}: ${(err as Error).message.slice(0, 120)}`);
      skipped.push(`${found.path} in ${ref.owner}/${ref.repo} is not valid: ${(err as Error).message}`);
      continue;
    }
    if (!manifest?.name) continue;

    // Collection items are keyed by their directory (unique inside a repo); a frontmatter
    // `name` can repeat across folders (e.g. one skill packaged for several agents).
    const isCollectionItem = found.file === "SKILL.md" && found.path.includes("/");
    const rawSlug = isCollectionItem ? `${ref.owner}-${ref.repo}-${dirName ?? manifest.name}` : `${ref.owner}-${manifest.name === ref.repo ? ref.repo : `${ref.repo}-${manifest.name}`}`;
    let slug = slugify(rawSlug);
    for (let i = 2; usedSlugs.has(slug); i++) slug = `${slugify(rawSlug)}-${i}`;
    usedSlugs.add(slug);
    // SKILL.md pages show the body (frontmatter is already mapped); README-only imports show the README.
    const readme = found.file === "SKILL.md" ? skillBody : found.file === "README.md" ? text : rootReadme;

    const source: GithubSource = {
      owner: ref.owner,
      repo: ref.repo,
      fullName: meta.fullName,
      defaultBranch: meta.defaultBranch,
      manifestPath: found.path,
      manifestFile: found.file,
      language: meta.language,
      license: license ?? meta.license,
      topics: meta.topics,
      stars: meta.stars,
      forks: meta.forks,
      openIssues: meta.openIssues,
      homepage: meta.homepage,
      avatarUrl: meta.avatarUrl,
      pushedAt: meta.pushedAt,
      crawledAt,
    };

    results.push({
      ref,
      manifestFile: found.file,
      manifestPath: found.path,
      meta,
      warnings,
      input: withoutNul({
        name: manifest.name.slice(0, 80),
        slug,
        description: (manifest.description || meta.description || "").slice(0, 2000),
        version,
        category: manifest.category,
        pricePerCall: 0,
        manifest,
        repoUrl: found.path.includes("/") ? `${repoUrl(ref)}/tree/${meta.defaultBranch}/${found.path.split("/").slice(0, -1).join("/")}` : repoUrl(ref),
        githubStars: meta.stars,
        tags: Array.from(new Set([...meta.topics, ...tags, manifest.category.toLowerCase()].map((t) => t.toLowerCase()))).slice(0, 12),
        origin: "github",
        source,
        readme: readme ? readme.slice(0, README_STORE_CAP) : null,
      }),
    });
  }

  if (!results.length) {
    if (skipped.length) throw new GithubParseError(skipped[0], "invalid_manifest");
    throw new GithubParseError(`No manifest found in ${ref.owner}/${ref.repo} (looked for ${MANIFEST_FILES.join(", ")})`, "not_found");
  }
  return results;
}

/** First skill of a repository — what the dashboard import form uses. */
export async function importFromGithub(url: string, fetcher: RepoFetcher = createGithubFetcher(), options: ImportOptions = {}): Promise<ImportResult> {
  return (await importAllFromGithub(url, fetcher, options))[0];
}
