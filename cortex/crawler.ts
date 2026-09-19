/**
 * Cortex · GitHub crawler
 *
 * Discovers skill repositories through the GitHub Search API (repository
 * search by topic/keywords + code search for `filename:SKILL.md`), imports
 * each one with `lib/github-parser.ts`, scans every manifest and upserts the
 * result into the catalogue.
 *
 * Designed to be resumable: `data/crawl-state.json` remembers every repo it
 * has seen (imported / rejected / errored) so re-runs only touch new repos
 * unless `refresh` is set. Pacing follows GitHub's rate-limit headers.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createGithubFetcher, importAllFromGithub, toRepoMeta, GithubParseError, type GithubRepoJson, type RepoFetcher, type RepoMeta } from "@/lib/github-parser";
import { scanManifest, type ScanReport } from "@/lib/sandbox-scanner";
import { skillRepository } from "@/cortex/repository";
import { resolveGithubToken } from "@/cortex/github-token";
import type { SkillCreateInput } from "@/types/skill";

export const DEFAULT_QUERIES = [
  "topic:claude-skills",
  "topic:agent-skills",
  "topic:claude-code-skills",
  "topic:skills claude",
  "topic:mcp-server",
  "topic:mcp claude",
  "skill claude in:name,description",
  "skills claude code in:name,description",
  "agent skills SKILL.md in:readme",
  "mcp server in:name,description",
];

export interface CrawlOptions {
  queries?: string[];
  /** Also run `filename:SKILL.md` code search (10 req/min, very precise). */
  codeSearch?: boolean;
  /** Repositories to process in this run. */
  maxRepos?: number;
  minStars?: number;
  concurrency?: number;
  /** Re-process repos already in the state file. */
  refresh?: boolean;
  requireManifest?: boolean;
  maxPerRepo?: number;
  token?: string | null;
  statePath?: string;
  onProgress?: (p: CrawlProgress) => void;
  signal?: AbortSignal;
  /** Injected fetcher (tests). */
  fetcher?: RepoFetcher;
  /** Injected discovery (tests): candidate repos instead of the Search API. */
  candidates?: RepoCandidate[];
}

export interface RepoCandidate {
  fullName: string;
  json?: GithubRepoJson;
  /** Known manifest paths (from code search). */
  paths?: string[];
  foundBy: string;
}

export type RepoStatus = "imported" | "rejected" | "error";

export interface CrawlState {
  repos: Record<string, { status: RepoStatus; skills: number; at: string; reason?: string; stars?: number }>;
  runs: Array<{ startedAt: string; finishedAt: string; discovered: number; processed: number; created: number; updated: number }>;
}

export interface CrawlProgress {
  phase: "discover" | "import" | "done" | "aborted";
  discovered: number;
  processed: number;
  imported: number;
  rejected: number;
  errors: number;
  skillsCreated: number;
  skillsUpdated: number;
  current: string | null;
  rateLimit: Record<string, { remaining: number; resetAt: number }>;
  startedAt: string;
  log: string[];
}

export const CRAWL_STATE_PATH = process.env.SYNAPTH_CRAWL_STATE_PATH ?? join(process.cwd(), "data", "crawl-state.json");

// ---------------------------------------------------------------------------
// State persistence
// ---------------------------------------------------------------------------

export function loadState(path = CRAWL_STATE_PATH): CrawlState {
  if (!existsSync(path)) return { repos: {}, runs: [] };
  try {
    return JSON.parse(readFileSync(path, "utf8")) as CrawlState;
  } catch {
    return { repos: {}, runs: [] };
  }
}

export function saveState(state: CrawlState, path = CRAWL_STATE_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, JSON.stringify(state));
  renameSync(`${path}.tmp`, path);
}

// ---------------------------------------------------------------------------
// Rate-limit gate
// ---------------------------------------------------------------------------

class RateGate {
  readonly limits: Record<string, { remaining: number; resetAt: number }> = {};

  update(info: { resource: string; remaining: number; resetAt: number }) {
    this.limits[info.resource] = { remaining: info.remaining, resetAt: info.resetAt };
  }

  /** Waits until the resource has budget again (with 1 request of headroom). */
  async wait(resource: string, signal?: AbortSignal) {
    const l = this.limits[resource];
    if (!l || l.remaining > 1) return;
    const ms = Math.max(0, l.resetAt - Date.now()) + 1_000;
    await sleep(ms, signal);
    l.remaining = 999;
  }
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    });
  });
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

interface SearchRepoResponse {
  total_count: number;
  incomplete_results: boolean;
  items: Array<GithubRepoJson & { fork: boolean }>;
}

interface SearchCodeResponse {
  items: Array<{ path: string; repository: GithubRepoJson & { fork: boolean } }>;
}

async function githubSearch<T>(path: string, token: string | null, gate: RateGate, resource: "search" | "code_search", signal?: AbortSignal): Promise<T | null> {
  await gate.wait(resource, signal);
  const headers: Record<string, string> = { "User-Agent": "synapth-crawler/0.2", Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com${path}`, { headers, signal, cache: "no-store" });
  const remaining = Number(res.headers.get("x-ratelimit-remaining"));
  if (!Number.isNaN(remaining)) gate.update({ resource: res.headers.get("x-ratelimit-resource") ?? resource, remaining, resetAt: Number(res.headers.get("x-ratelimit-reset")) * 1000 });
  if (res.status === 403 || res.status === 429) {
    // Secondary rate limit: back off and let the caller retry the next page.
    const retry = Number(res.headers.get("retry-after") ?? 30);
    await sleep(retry * 1000, signal);
    return null;
  }
  if (res.status === 422) return null; // beyond the 1000-result window
  if (!res.ok) throw new Error(`GitHub search ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

export async function discover(opts: CrawlOptions, gate: RateGate, log: (m: string) => void): Promise<RepoCandidate[]> {
  const token = opts.token ?? resolveGithubToken();
  const want = opts.maxRepos ?? 200;
  const minStars = opts.minStars ?? 0;
  const seen = new Map<string, RepoCandidate>();
  const add = (c: RepoCandidate) => {
    const key = c.fullName.toLowerCase();
    const cur = seen.get(key);
    if (cur) {
      if (c.paths?.length) cur.paths = [...new Set([...(cur.paths ?? []), ...c.paths])];
      return;
    }
    seen.set(key, c);
  };

  const queries = opts.queries ?? DEFAULT_QUERIES;
  for (const q of queries) {
    if (seen.size >= want * 2) break;
    for (let page = 1; page <= 10; page++) {
      if (seen.size >= want * 2) break;
      const qs = new URLSearchParams({ q: minStars ? `${q} stars:>=${minStars}` : q, sort: "stars", order: "desc", per_page: "100", page: String(page) });
      const res = await githubSearch<SearchRepoResponse>(`/search/repositories?${qs}`, token, gate, "search", opts.signal);
      if (!res) break;
      for (const item of res.items) if (!item.fork && !item.archived) add({ fullName: item.full_name, json: item, foundBy: q });
      log(`search "${q}" p${page}: +${res.items.length} (total ${seen.size})`);
      if (res.items.length < 100) break;
    }
  }

  if (opts.codeSearch ?? true) {
    const variants = ["filename:SKILL.md description", "filename:SKILL.md claude", "filename:SKILL.md agent", "filename:SKILL.md tools"];
    for (const q of variants) {
      if (seen.size >= want * 2) break;
      for (let page = 1; page <= 10; page++) {
        if (seen.size >= want * 2) break;
        const qs = new URLSearchParams({ q, per_page: "100", page: String(page) });
        const res = await githubSearch<SearchCodeResponse>(`/search/code?${qs}`, token, gate, "code_search", opts.signal);
        if (!res) break;
        for (const item of res.items) {
          if (item.repository.fork) continue;
          if (!/(^|\/)SKILL\.md$/.test(item.path)) continue;
          add({ fullName: item.repository.full_name, paths: [item.path], foundBy: q });
        }
        log(`code "${q}" p${page}: +${res.items.length} (total ${seen.size})`);
        if (res.items.length < 100) break;
      }
    }
  }

  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ProcessedRepo {
  fullName: string;
  status: RepoStatus;
  skills: number;
  reason?: string;
  items: Array<{ input: SkillCreateInput; scan: ScanReport }>;
}

/** Full-name → authorId used for crawled content. */
export const githubAuthorId = (owner: string) => `gh:${owner.toLowerCase()}`;

export async function processRepo(candidate: RepoCandidate, fetcher: RepoFetcher, opts: CrawlOptions): Promise<ProcessedRepo> {
  try {
    const results = await importAllFromGithub(candidate.fullName, fetcher, { maxPerRepo: opts.maxPerRepo ?? 40, requireManifest: opts.requireManifest ?? false });
    const items: ProcessedRepo["items"] = [];
    for (const r of results) {
      const scan = scanManifest(r.input.manifest);
      // Never republish leaked credentials; everything else lands with the badge the scanner assigned.
      if (scan.findings.some((f) => f.kind === "secret_leak" && f.severity === "critical")) continue;
      items.push({ input: r.input, scan });
    }
    if (!items.length) return { fullName: candidate.fullName, status: "rejected", skills: 0, reason: "all manifests rejected by scanner", items };
    return { fullName: candidate.fullName, status: "imported", skills: items.length, items };
  } catch (err) {
    if (err instanceof GithubParseError) {
      if (err.code === "rate_limited") throw err;
      return { fullName: candidate.fullName, status: "rejected", skills: 0, reason: `${err.code}: ${err.message.slice(0, 160)}`, items: [] };
    }
    return { fullName: candidate.fullName, status: "error", skills: 0, reason: (err as Error).message.slice(0, 200), items: [] };
  }
}

export async function crawl(opts: CrawlOptions = {}): Promise<CrawlProgress> {
  const token = opts.token === undefined ? resolveGithubToken() : opts.token;
  const gate = new RateGate();
  const state = loadState(opts.statePath);
  const progress: CrawlProgress = {
    phase: "discover",
    discovered: 0,
    processed: 0,
    imported: 0,
    rejected: 0,
    errors: 0,
    skillsCreated: 0,
    skillsUpdated: 0,
    current: null,
    rateLimit: gate.limits,
    startedAt: new Date().toISOString(),
    log: [],
  };
  const log = (m: string) => {
    progress.log.push(`${new Date().toISOString().slice(11, 19)} ${m}`);
    if (progress.log.length > 200) progress.log.shift();
    opts.onProgress?.(progress);
  };
  if (!token) log("no GitHub token: unauthenticated limits (10 searches/min, 60 API calls/h)");

  const fetcher = opts.fetcher ?? createGithubFetcher({ token: token ?? undefined, onRateLimit: (i) => gate.update(i) });
  const primed = new Map<string, RepoMeta>();
  const primingFetcher: RepoFetcher = {
    meta: async (ref) => primed.get(`${ref.owner}/${ref.repo}`.toLowerCase()) ?? fetcher.meta(ref),
    readFile: (ref, path) => fetcher.readFile(ref, path),
    tree: (ref) => fetcher.tree(ref),
  };

  const candidates = (opts.candidates ?? (await discover({ ...opts, token }, gate, log))).filter((c) => {
    const prev = state.repos[c.fullName.toLowerCase()];
    if (prev && !opts.refresh) return false;
    if (opts.minStars && c.json && c.json.stargazers_count < opts.minStars) return false;
    return true;
  });
  for (const c of candidates) if (c.json) primed.set(c.fullName.toLowerCase(), toRepoMeta(c.json));
  const queue = candidates.slice(0, opts.maxRepos ?? 200);
  progress.discovered = queue.length;
  progress.phase = "import";
  log(`discovered ${candidates.length} new repos, processing ${queue.length}`);

  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 4, 8));
  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length && !opts.signal?.aborted) {
      const candidate = queue[cursor++];
      progress.current = candidate.fullName;
      await gate.wait("core", opts.signal);
      let result: ProcessedRepo;
      try {
        result = await processRepo(candidate, primingFetcher, opts);
      } catch (err) {
        if (err instanceof GithubParseError && err.code === "rate_limited") {
          log(`rate limited on ${candidate.fullName}; waiting`);
          await sleep(60_000, opts.signal);
          cursor -= 1; // retry later
          continue;
        }
        result = { fullName: candidate.fullName, status: "error", skills: 0, reason: (err as Error).message, items: [] };
      }

      if (result.items.length) {
        const owner = candidate.fullName.split("/")[0];
        const counts = await skillRepository.upsertMany(result.items.map((i) => ({ input: i.input, authorId: githubAuthorId(owner), authorName: owner, securityLevel: i.scan.level })));
        progress.skillsCreated += counts.created;
        progress.skillsUpdated += counts.updated;
      }
      progress.processed += 1;
      progress[result.status === "imported" ? "imported" : result.status === "rejected" ? "rejected" : "errors"] += 1;
      state.repos[candidate.fullName.toLowerCase()] = { status: result.status, skills: result.skills, at: new Date().toISOString(), reason: result.reason, stars: candidate.json?.stargazers_count };
      if (progress.processed % 5 === 0) saveState(state, opts.statePath);
      log(`${result.status.padEnd(8)} ${candidate.fullName} → ${result.skills} skill(s)${result.reason ? ` (${result.reason})` : ""}`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  progress.phase = opts.signal?.aborted ? "aborted" : "done";
  progress.current = null;
  state.runs.push({ startedAt: progress.startedAt, finishedAt: new Date().toISOString(), discovered: progress.discovered, processed: progress.processed, created: progress.skillsCreated, updated: progress.skillsUpdated });
  saveState(state, opts.statePath);
  log(`done: ${progress.imported} imported, ${progress.rejected} rejected, ${progress.errors} errors, +${progress.skillsCreated} / ~${progress.skillsUpdated} skills`);
  return progress;
}
