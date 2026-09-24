/**
 * Cortex · crawler discovery beyond GitHub search
 *
 * Public registries that point at GitHub repositories. They only feed
 * candidates: every repo is still imported by `lib/github-parser.ts`, so the
 * catalogue keeps one source of truth (the repo) and one scanner path.
 *
 *   mcp-registry  registry.modelcontextprotocol.io — the official MCP server
 *                 registry (`server.json` entries with `repository.url`)
 *   npm           registry.npmjs.org search by keyword (MCP servers, skills,
 *                 Claude Code plugins) with a GitHub `links.repository`
 *
 * Both are fixed hosts (no user input in the URL), key-less and paginated.
 */

import type { RepoCandidate } from "@/cortex/crawler";

export const EXTERNAL_SOURCES = ["mcp-registry", "npm"] as const;
export type ExternalSource = (typeof EXTERNAL_SOURCES)[number];

export interface SourceOptions {
  /** Stop once this many candidates the run would process were found. */
  want: number;
  /** Whether a lower-cased `owner/repo` is already known (not counted towards `want`). */
  isKnown: (key: string) => boolean;
  signal?: AbortSignal;
  deadline?: number;
  log: (m: string) => void;
}

const MCP_REGISTRY = "https://registry.modelcontextprotocol.io/v0/servers";
const NPM_SEARCH = "https://registry.npmjs.org/-/v1/search";
export const NPM_KEYWORDS = ["mcp-server", "modelcontextprotocol", "claude-skill", "agent-skill", "claude-code-plugin"];
const MAX_PAGES = 30;
const USER_AGENT = "synapth-crawler/0.3";

/** `owner/repo` from any github.com URL form npm and the registry use (git+https, .git, /tree/…, ssh). */
export function githubFullName(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.trim().match(/(?:^|[/@.])github\.com[/:]([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?(?:[/#?].*)?$/i);
  if (!m || m[2] === "." || m[2] === "..") return null;
  return `${m[1]}/${m[2]}`;
}

const pastDeadline = (o: SourceOptions) => (o.deadline !== undefined && Date.now() >= o.deadline) || Boolean(o.signal?.aborted);

async function getJson<T>(url: string, o: SourceOptions): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: o.signal, cache: "no-store" });
    if (!res.ok) {
      o.log(`${new URL(url).host} ${res.status}: ${(await res.text()).replace(/\s+/g, " ").slice(0, 160)}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    if (o.signal?.aborted) throw err;
    o.log(`${new URL(url).host} unreachable: ${(err as Error).message.slice(0, 160)}`);
    return null;
  }
}

/** Collects candidates, counting only unknown repos towards `want`. */
function collector(source: ExternalSource, o: SourceOptions) {
  const seen = new Map<string, RepoCandidate>();
  let fresh = 0;
  return {
    add(fullName: string | null) {
      if (!fullName) return;
      const key = fullName.toLowerCase();
      if (seen.has(key)) return;
      seen.set(key, { fullName, foundBy: source });
      if (!o.isKnown(key)) fresh += 1;
    },
    get fresh() {
      return fresh;
    },
    done: () => fresh >= o.want || pastDeadline(o),
    result: () => [...seen.values()],
  };
}

interface McpRegistryPage {
  servers?: Array<{ server?: { name?: string; repository?: { url?: string; source?: string } } }>;
  metadata?: { nextCursor?: string | null };
}

export async function mcpRegistryCandidates(o: SourceOptions): Promise<RepoCandidate[]> {
  const c = collector("mcp-registry", o);
  let cursor: string | null = null;
  for (let page = 1; page <= MAX_PAGES && !c.done(); page++) {
    const qs = new URLSearchParams({ limit: "100", version: "latest" });
    if (cursor) qs.set("cursor", cursor);
    const data: McpRegistryPage | null = await getJson<McpRegistryPage>(`${MCP_REGISTRY}?${qs}`, o);
    if (!data?.servers) break;
    const before = c.fresh;
    for (const entry of data.servers) c.add(githubFullName(entry.server?.repository?.url));
    o.log(`mcp-registry p${page}: ${data.servers.length} servers, ${c.fresh - before} new repos`);
    cursor = data.metadata?.nextCursor ?? null;
    if (!cursor) break;
  }
  return c.result();
}

interface NpmSearchPage {
  total?: number;
  objects?: Array<{ package?: { name?: string; links?: { repository?: string; homepage?: string } } }>;
}

export async function npmCandidates(o: SourceOptions, keywords = NPM_KEYWORDS): Promise<RepoCandidate[]> {
  const c = collector("npm", o);
  for (const keyword of keywords) {
    for (let from = 0, page = 1; page <= MAX_PAGES && !c.done(); page++, from += 250) {
      const qs = new URLSearchParams({ text: `keywords:${keyword}`, size: "250", from: String(from) });
      const data = await getJson<NpmSearchPage>(`${NPM_SEARCH}?${qs}`, o);
      if (!data?.objects?.length) break;
      const before = c.fresh;
      for (const { package: pkg } of data.objects) c.add(githubFullName(pkg?.links?.repository) ?? githubFullName(pkg?.links?.homepage));
      o.log(`npm keywords:${keyword} p${page}: ${data.objects.length} packages, ${c.fresh - before} new repos`);
      if (data.objects.length < 250) break;
    }
    if (c.done()) break;
  }
  return c.result();
}

export function externalCandidates(source: ExternalSource, o: SourceOptions): Promise<RepoCandidate[]> {
  return source === "mcp-registry" ? mcpRegistryCandidates(o) : npmCandidates(o);
}
