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
 *   docker-mcp    Docker's MCP catalog (github.com/docker/mcp-registry):
 *                 `servers/<name>/server.yaml` → `source.project`
 *   marketplaces  Claude Code plugin marketplaces (`.claude-plugin/marketplace.json`):
 *                 the marketplace repo itself + every plugin `source` on GitHub;
 *                 known marketplaces are seeded, more come from code search
 *                 (token only)
 *   awesome       curated "awesome" lists: every github.com repo link in the README
 *
 * Hosts are fixed (no user input in the URL): registry APIs, api.github.com and
 * raw.githubusercontent.com with `owner/repo` validated by `githubFullName()`.
 */

import type { RepoCandidate } from "@/cortex/crawler";
import { githubApiFetch, githubErrorMessage, type GithubAuth } from "@/lib/github-parser";

export const EXTERNAL_SOURCES = ["mcp-registry", "npm", "docker-mcp", "marketplaces", "awesome"] as const;
export type ExternalSource = (typeof EXTERNAL_SOURCES)[number];

export interface SourceOptions {
  /** Stop once this many candidates the run would process were found. */
  want: number;
  /** Whether a lower-cased `owner/repo` is already known (not counted towards `want`). */
  isKnown: (key: string) => boolean;
  signal?: AbortSignal;
  deadline?: number;
  log: (m: string) => void;
  /** GitHub token holder shared with the crawl (Docker catalog listing, marketplace code search). */
  auth?: GithubAuth;
}

const MCP_REGISTRY = "https://registry.modelcontextprotocol.io/v0/servers";
const NPM_SEARCH = "https://registry.npmjs.org/-/v1/search";
export const NPM_KEYWORDS = ["mcp-server", "modelcontextprotocol", "claude-skill", "agent-skill", "claude-code-plugin"];
const MAX_PAGES = 30;
/** Parallel raw.githubusercontent.com reads (Docker `server.yaml`s, marketplace manifests). */
const RAW_CONCURRENCY = 12;

/** Docker's MCP catalog: one directory per server with a `server.yaml`. */
const DOCKER_REGISTRY = "docker/mcp-registry";

/** Marketplaces read on every pass, even without a token for code search. */
export const KNOWN_MARKETPLACES = ["anthropics/claude-plugins-official", "anthropics/claude-code", "anthropics/skills"];

/** Curated lists whose README links the repos (MCP servers first: they are the longest). */
export const AWESOME_LISTS = [
  "punkpeye/awesome-mcp-servers",
  "wong2/awesome-mcp-servers",
  "appcypher/awesome-mcp-servers",
  "hesreallyhim/awesome-claude-code",
  "VoltAgent/awesome-agent-skills",
  "ComposioHQ/awesome-claude-skills",
  "travisvn/awesome-claude-skills",
];

/** github.com paths that are not repositories. */
const NOT_REPO_OWNERS = new Set(["topics", "sponsors", "orgs", "features", "marketplace", "apps", "settings", "login", "about", "pricing", "collections", "trending", "site", "security", "enterprise", "readme", "customer-stories", "users", "user-attachments", "notifications", "explore", "search", "github-copilot", "codespaces", "issues", "pulls"]);
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

/** A file from a repository's default branch, or null (missing, blocked, network error — logged). */
async function rawFile(fullName: string, path: string, o: SourceOptions): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${fullName.split("/").map(encodeURIComponent).join("/")}/HEAD/${path.split("/").map(encodeURIComponent).join("/")}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: o.signal, cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) {
      o.log(`raw ${fullName}/${path}: ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    if (o.signal?.aborted) throw err;
    o.log(`raw ${fullName}/${path} unreachable: ${(err as Error).message.slice(0, 120)}`);
    return null;
  }
}

/** Runs `fn` over `items` with bounded parallelism, stopping early once `done()` holds. */
async function eachLimited<T>(items: T[], done: () => boolean, fn: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length && !done()) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(RAW_CONCURRENCY, items.length) }, worker));
}

/** GitHub REST call through the crawl's token holder; null (logged) on any failure. */
async function githubJson<T>(path: string, o: SourceOptions): Promise<T | null> {
  try {
    const res = await githubApiFetch(path, o.auth ?? { token: null }, { signal: o.signal, onWarning: o.log });
    if (!res.ok) {
      o.log(`GitHub ${path.split("?")[0]}: ${res.status} ${githubErrorMessage(await res.text())}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    if (o.signal?.aborted) throw err;
    o.log(`GitHub ${path.split("?")[0]} unreachable: ${(err as Error).message.slice(0, 120)}`);
    return null;
  }
}

/** `source.project` of a Docker catalog `server.yaml` (flat YAML; no parser needed). */
export function dockerProject(yaml: string): string | null {
  const block = yaml.match(/^source:\s*\n((?:[ \t]+.*\n?)*)/m)?.[1] ?? "";
  const project = block.match(/^[ \t]+project:\s*["']?([^"'\s#]+)/m)?.[1];
  return githubFullName(project);
}

export async function dockerMcpCandidates(o: SourceOptions): Promise<RepoCandidate[]> {
  const c = collector("docker-mcp", o);
  const listing = await githubJson<Array<{ name: string; type: string }>>(`/repos/${DOCKER_REGISTRY}/contents/servers`, o);
  if (!listing) return [];
  const dirs = listing.filter((e) => e.type === "dir" && /^[\w.-]+$/.test(e.name)).map((e) => e.name);
  let read = 0;
  await eachLimited(dirs, c.done, async (dir) => {
    const yaml = await rawFile(DOCKER_REGISTRY, `servers/${dir}/server.yaml`, o);
    read += 1;
    if (yaml) c.add(dockerProject(yaml));
  });
  o.log(`docker-mcp: ${read}/${dirs.length} servers read, ${c.fresh} new repos`);
  return c.result();
}

type PluginSource = string | { source?: string; repo?: string; url?: string };

/** GitHub repos a `marketplace.json` points at; relative sources live in the marketplace repo itself. */
export function marketplaceRepos(json: string, marketplace: string): string[] {
  let plugins: Array<{ source?: PluginSource }> = [];
  try {
    const parsed = JSON.parse(json) as { plugins?: unknown };
    if (Array.isArray(parsed.plugins)) plugins = parsed.plugins as typeof plugins;
  } catch {
    return [];
  }
  const repos = [marketplace];
  for (const { source } of plugins) {
    if (!source) continue;
    if (typeof source === "string") continue; // "./plugins/x": part of the marketplace repo
    const repo = source.repo && /^[\w.-]+\/[\w.-]+$/.test(source.repo) ? source.repo : githubFullName(source.url);
    if (repo) repos.push(repo);
  }
  return repos;
}

export async function marketplaceCandidates(o: SourceOptions): Promise<RepoCandidate[]> {
  const c = collector("marketplaces", o);
  const markets = new Set(KNOWN_MARKETPLACES);
  if (o.auth?.token) {
    const qs = new URLSearchParams({ q: "filename:marketplace.json path:.claude-plugin", per_page: "100" });
    const found = await githubJson<{ items?: Array<{ path: string; repository: { full_name: string; fork?: boolean } }> }>(`/search/code?${qs}`, o);
    for (const item of found?.items ?? []) if (!item.repository.fork && item.path === ".claude-plugin/marketplace.json") markets.add(item.repository.full_name);
  } else o.log("marketplaces: code search skipped (no GitHub token); reading the known marketplaces only");
  await eachLimited([...markets], c.done, async (market) => {
    const json = await rawFile(market, ".claude-plugin/marketplace.json", o);
    if (!json) return;
    const repos = marketplaceRepos(json, market);
    const before = c.fresh;
    for (const repo of repos) c.add(repo);
    o.log(`marketplace ${market}: ${repos.length - 1} plugin repo(s) outside it, ${c.fresh - before} new repos`);
  });
  return c.result();
}

/** Every repository linked from a Markdown document, in order, minus the list itself. */
export function linkedRepos(markdown: string, self?: string): string[] {
  const out: string[] = [];
  for (const m of markdown.matchAll(/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})/g)) {
    const owner = m[1];
    const repo = m[2].replace(/\.git$/i, "").replace(/\.+$/, "");
    if (!repo || NOT_REPO_OWNERS.has(owner.toLowerCase())) continue;
    const fullName = `${owner}/${repo}`;
    if (self && fullName.toLowerCase() === self.toLowerCase()) continue;
    out.push(fullName);
  }
  return out;
}

export async function awesomeCandidates(o: SourceOptions, lists = AWESOME_LISTS): Promise<RepoCandidate[]> {
  const c = collector("awesome", o);
  for (const list of lists) {
    if (c.done()) break;
    const readme = await rawFile(list, "README.md", o);
    if (!readme) continue;
    const before = c.fresh;
    const repos = linkedRepos(readme, list);
    for (const repo of repos) {
      if (c.done()) break;
      c.add(repo);
    }
    o.log(`awesome ${list}: ${repos.length} links, ${c.fresh - before} new repos`);
  }
  return c.result();
}

export function externalCandidates(source: ExternalSource, o: SourceOptions): Promise<RepoCandidate[]> {
  switch (source) {
    case "mcp-registry":
      return mcpRegistryCandidates(o);
    case "npm":
      return npmCandidates(o);
    case "docker-mcp":
      return dockerMcpCandidates(o);
    case "marketplaces":
      return marketplaceCandidates(o);
    case "awesome":
      return awesomeCandidates(o);
  }
}
