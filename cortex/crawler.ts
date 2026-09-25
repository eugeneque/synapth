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
import { createGithubFetcher, importAllFromGithub, toRepoMeta, githubApiFetch, githubErrorMessage, rateLimitReset, GithubParseError, type GithubAuth, type GithubRepoJson, type RepoFetcher, type RepoMeta } from "@/lib/github-parser";
import { scanManifest, type ScanReport } from "@/lib/sandbox-scanner";
import { skillRepository } from "@/cortex/repository";
import { resolveGithubToken } from "@/cortex/github-token";
import { isServerless } from "@/cortex/db";
import { EXTERNAL_SOURCES, externalCandidates, type ExternalSource } from "@/cortex/crawl-sources";
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
  /** Epoch ms after which no new search page or repo is started (serverless time budget). */
  deadline?: number;
  /** Lower-cased `owner/repo` names to treat as already seen (the catalogue, when the state file is ephemeral). */
  knownRepos?: ReadonlySet<string>;
  /** Search order; the scheduled pass alternates so fresh repos surface, not only the top-starred ones. */
  sort?: "stars" | "updated";
  /**
   * Where candidates come from: GitHub search (`queries` + code search) and
   * public registries that link GitHub repos. Default: all of them.
   */
  sources?: CrawlSource[];
  /** Set by `crawl()`: whether a repo is already in the state file / catalogue. */
  isKnown?: (key: string) => boolean;
}

export const CRAWL_SOURCES = ["github", ...EXTERNAL_SOURCES] as const;
export type CrawlSource = "github" | ExternalSource;

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

/** Serverless bundles are read-only; only `/tmp` is writable there (and it does not outlive the instance). */
export const CRAWL_STATE_PATH =
  process.env.SYNAPTH_CRAWL_STATE_PATH ?? (isServerless ? join("/tmp", "synapth", "crawl-state.json") : join(process.cwd(), "data", "crawl-state.json"));

const pastDeadline = (opts: CrawlOptions) => opts.deadline !== undefined && Date.now() >= opts.deadline;

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

  /**
   * Waits until the resource has budget again (with 1 request of headroom).
   * Returns false instead of sleeping past `deadline`: a serverless pass must
   * end in time rather than be killed mid-wait with its run left "running".
   */
  async wait(resource: string, signal?: AbortSignal, deadline?: number): Promise<boolean> {
    const l = this.limits[resource];
    if (!l || l.remaining > 1) return true;
    return this.until(l.resetAt, signal, deadline, () => (l.remaining = 999));
  }

  /** Sleeps until `at` (+1 s), or returns false when that is past the deadline. */
  async until(at: number, signal?: AbortSignal, deadline?: number, then?: () => void): Promise<boolean> {
    const wakeAt = Math.max(Date.now(), at) + 1_000;
    if (deadline !== undefined && wakeAt >= deadline) return false;
    await sleep(wakeAt - Date.now(), signal);
    then?.();
    return true;
  }
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    };
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
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

type SearchOutcome<T> = { ok: true; data: T } | { ok: false; stop: "query" | "all"; reason: string };

/**
 * One Search API page. Never throws on an HTTP error: a failed query is
 * logged and skipped so the other queries (and the import phase) still run.
 * `stop: "all"` means no further search of this kind can succeed in this run.
 */
async function githubSearch<T>(path: string, auth: GithubAuth, gate: RateGate, resource: "search" | "code_search", opts: CrawlOptions, log: (m: string) => void): Promise<SearchOutcome<T>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!(await gate.wait(resource, opts.signal, opts.deadline))) return { ok: false, stop: "all", reason: `${resource} budget spent until after the deadline` };
    const res = await githubApiFetch(path, auth, { signal: opts.signal, onRateLimit: (i) => gate.update(i), onWarning: log });
    if (res.ok) return { ok: true, data: (await res.json()) as T };
    const body = await res.text();
    const resetAt = rateLimitReset(res, body);
    if (resetAt !== null) {
      // Secondary limit or an exhausted window: wait once (if the budget allows) and retry the same page.
      log(`${resource} rate limited; retry at ${new Date(resetAt).toISOString().slice(11, 19)}`);
      if (!(await gate.until(resetAt, opts.signal, opts.deadline))) return { ok: false, stop: "all", reason: "rate limited until after the deadline" };
      continue;
    }
    // 422: beyond the 1000-result window or a query GitHub cannot parse.
    if (res.status === 422) return { ok: false, stop: "query", reason: githubErrorMessage(body) };
    // Code search needs a valid token; without one no code query can succeed.
    if (res.status === 401 && resource === "code_search") return { ok: false, stop: "all", reason: "code search requires a GitHub token" };
    return { ok: false, stop: res.status === 401 || res.status === 403 ? "all" : "query", reason: `${res.status} ${githubErrorMessage(body)}` };
  }
  return { ok: false, stop: "query", reason: "still rate limited after a retry" };
}

export async function discover(opts: CrawlOptions, gate: RateGate, log: (m: string) => void, auth: GithubAuth = { token: opts.token ?? resolveGithubToken() }): Promise<RepoCandidate[]> {
  const want = opts.maxRepos ?? 200;
  const minStars = opts.minStars ?? 0;
  const seen = new Map<string, RepoCandidate>();
  // Only repos this run would actually process count towards the target, so a
  // catalogue that already holds the top results pages deeper instead of stalling.
  let fresh = 0;
  const isKnown = (key: string) => !opts.refresh && Boolean(opts.isKnown?.(key));
  const add = (c: RepoCandidate) => {
    const key = c.fullName.toLowerCase();
    const cur = seen.get(key);
    if (cur) {
      if (c.paths?.length) cur.paths = [...new Set([...(cur.paths ?? []), ...c.paths])];
      return;
    }
    seen.set(key, c);
    if (!isKnown(key)) fresh += 1;
  };
  const enough = () => fresh >= want || pastDeadline(opts) || Boolean(opts.signal?.aborted);

  const sources = new Set(opts.sources ?? CRAWL_SOURCES);
  const queries = sources.has("github") ? (opts.queries ?? DEFAULT_QUERIES) : [];
  searches: for (const q of queries) {
    if (enough()) break;
    for (let page = 1; page <= 10; page++) {
      if (enough()) break;
      const qs = new URLSearchParams({ q: minStars ? `${q} stars:>=${minStars}` : q, sort: opts.sort ?? "stars", order: "desc", per_page: "100", page: String(page) });
      const res = await githubSearch<SearchRepoResponse>(`/search/repositories?${qs}`, auth, gate, "search", opts, log);
      if (!res.ok) {
        log(`search "${q}" p${page} skipped: ${res.reason}`);
        if (res.stop === "all") break searches;
        break;
      }
      const before = fresh;
      for (const item of res.data.items) if (!item.fork && !item.archived) add({ fullName: item.full_name, json: item, foundBy: q });
      log(`search "${q}" p${page}: ${res.data.items.length} repos, ${fresh - before} new (${fresh} to process)`);
      if (res.data.items.length < 100) break;
    }
  }

  if (sources.has("github") && (opts.codeSearch ?? true) && !enough()) {
    if (!auth.token) log("code search skipped: it requires a GitHub token");
    else {
      const variants = ["filename:SKILL.md description", "filename:SKILL.md claude", "filename:SKILL.md agent", "filename:SKILL.md tools"];
      codeSearches: for (const q of variants) {
        if (enough()) break;
        for (let page = 1; page <= 10; page++) {
          if (enough()) break;
          const qs = new URLSearchParams({ q, per_page: "100", page: String(page) });
          const res = await githubSearch<SearchCodeResponse>(`/search/code?${qs}`, auth, gate, "code_search", opts, log);
          if (!res.ok) {
            log(`code "${q}" p${page} skipped: ${res.reason}`);
            if (res.stop === "all") break codeSearches;
            break;
          }
          for (const item of res.data.items) {
            if (item.repository.fork) continue;
            if (!/(^|\/)SKILL\.md$/i.test(item.path)) continue;
            add({ fullName: item.repository.full_name, paths: [item.path], foundBy: q });
          }
          log(`code "${q}" p${page}: +${res.data.items.length} (${fresh} to process)`);
          if (res.data.items.length < 100) break;
        }
      }
    }
  }

  for (const source of CRAWL_SOURCES) {
    if (source === "github" || !sources.has(source) || enough()) continue;
    const found = await externalCandidates(source, { want: want - fresh, isKnown: (key) => seen.has(key) || isKnown(key), signal: opts.signal, deadline: opts.deadline, log, auth });
    for (const c of found) add(c);
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
    // Registry candidates arrive without search JSON: the star floor is checked on the fetched metadata.
    if (opts.minStars && !candidate.json) {
      const [owner, repo] = candidate.fullName.split("/");
      const meta = await fetcher.meta({ owner, repo, ref: "HEAD", path: "" });
      if (meta.stars < opts.minStars) return { fullName: candidate.fullName, status: "rejected", skills: 0, reason: `below ${opts.minStars} stars`, items: [] };
    }
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
      // A refusal (blocked repo, SSO, proxy policy) may lift; only content problems are final rejections.
      if (err.code === "forbidden") return { fullName: candidate.fullName, status: "error", skills: 0, reason: err.message.slice(0, 200), items: [] };
      return { fullName: candidate.fullName, status: "rejected", skills: 0, reason: `${err.code}: ${err.message.slice(0, 160)}`, items: [] };
    }
    return { fullName: candidate.fullName, status: "error", skills: 0, reason: (err as Error).message.slice(0, 200), items: [] };
  }
}

/** A repo hit by a rate limit is retried this many times before it is left for the next run. */
const MAX_RATE_LIMIT_RETRIES = 2;

export async function crawl(opts: CrawlOptions = {}): Promise<CrawlProgress> {
  const auth: GithubAuth = { token: opts.token === undefined ? resolveGithubToken() : opts.token };
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
  if (!auth.token) log("no GitHub token: unauthenticated limits (10 searches/min, 60 API calls/h, no code search)");

  const isKnown = (key: string) => Boolean(state.repos[key] || opts.knownRepos?.has(key));
  const fetcher = opts.fetcher ?? createGithubFetcher({ auth, onRateLimit: (i) => gate.update(i), onWarning: log });
  const primed = new Map<string, RepoMeta>();
  const primingFetcher: RepoFetcher = {
    meta: async (ref) => primed.get(`${ref.owner}/${ref.repo}`.toLowerCase()) ?? fetcher.meta(ref),
    readFile: (ref, path) => fetcher.readFile(ref, path),
    tree: (ref) => fetcher.tree(ref),
  };

  let discovered: RepoCandidate[];
  try {
    discovered = opts.candidates ?? (await discover({ ...opts, isKnown }, gate, log, auth));
  } catch (err) {
    // Only an abort gets here (search errors are logged per query); keep what the import phase needs to finish cleanly.
    if (!opts.signal?.aborted) throw err;
    discovered = [];
  }
  const candidates = discovered.filter((c) => {
    if (isKnown(c.fullName.toLowerCase()) && !opts.refresh) return false;
    if (opts.minStars && c.json && c.json.stargazers_count < opts.minStars) return false;
    return true;
  });
  for (const c of candidates) if (c.json) primed.set(c.fullName.toLowerCase(), toRepoMeta(c.json));
  const queue = candidates.slice(0, opts.maxRepos ?? 200);
  progress.discovered = queue.length;
  progress.phase = "import";
  log(`discovered ${candidates.length} new repos, processing ${queue.length}`);

  const retries = new Map<string, number>();
  const record = (candidate: RepoCandidate, result: Omit<ProcessedRepo, "items">) => {
    progress.processed += 1;
    progress[result.status === "imported" ? "imported" : result.status === "rejected" ? "rejected" : "errors"] += 1;
    state.repos[candidate.fullName.toLowerCase()] = { status: result.status, skills: result.skills, at: new Date().toISOString(), reason: result.reason, stars: candidate.json?.stargazers_count };
    if (progress.processed % 5 === 0) saveState(state, opts.statePath);
    log(`${result.status.padEnd(8)} ${candidate.fullName} → ${result.skills} skill(s)${result.reason ? ` (${result.reason})` : ""}`);
  };

  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 4, 8));
  let stopped = false;
  const worker = async () => {
    while (!stopped && !opts.signal?.aborted && !pastDeadline(opts)) {
      const candidate = queue.shift();
      if (!candidate) return;
      progress.current = candidate.fullName;
      const core = gate.limits.core;
      if (core && core.remaining <= 1) log(`GitHub API budget spent; waiting until ${new Date(core.resetAt).toISOString().slice(11, 19)} UTC`);
      if (!(await gate.wait("core", opts.signal, opts.deadline).catch(() => false))) {
        queue.unshift(candidate);
        stopped = true;
        return;
      }
      let result: ProcessedRepo;
      try {
        result = await processRepo(candidate, primingFetcher, opts);
      } catch (err) {
        if (opts.signal?.aborted) return;
        if (err instanceof GithubParseError && err.code === "rate_limited") {
          const tries = (retries.get(candidate.fullName) ?? 0) + 1;
          retries.set(candidate.fullName, tries);
          const resetAt = err.resetAt ?? Date.now() + 60_000;
          // Not recorded in the state file: the repo stays "new" and is picked up by a later run.
          if (tries > MAX_RATE_LIMIT_RETRIES) {
            log(`rate limited on ${candidate.fullName} ${tries} times; left for the next run`);
            continue;
          }
          log(`rate limited on ${candidate.fullName}; retrying after ${new Date(resetAt).toISOString().slice(11, 19)} UTC`);
          queue.push(candidate);
          if (!(await gate.until(resetAt, opts.signal, opts.deadline).catch(() => false))) {
            stopped = true;
            return;
          }
          continue;
        }
        result = { fullName: candidate.fullName, status: "error", skills: 0, reason: (err as Error).message.slice(0, 200), items: [] };
      }

      if (result.items.length) {
        const owner = candidate.fullName.split("/")[0];
        try {
          const counts = await skillRepository.upsertMany(result.items.map((i) => ({ input: i.input, authorId: githubAuthorId(owner), authorName: owner, securityLevel: i.scan.level })));
          progress.skillsCreated += counts.created;
          progress.skillsUpdated += counts.updated;
          if (counts.skipped) result = { ...result, reason: `${counts.skipped} slug(s) owned by another author skipped` };
        } catch (err) {
          // A write failure (constraint, oversized row, DB hiccup) costs this repo, not the whole run.
          result = { ...result, status: "error", skills: 0, reason: `save failed: ${(err as Error).message.replace(/\s+/g, " ").slice(0, 180)}` };
        }
      }
      record(candidate, result);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  const left = queue.length;
  if (left && !opts.signal?.aborted) log(`${stopped ? "rate limit outlasts the time budget" : "time budget spent"}: ${left} repo(s) left for the next run`);
  progress.phase = opts.signal?.aborted ? "aborted" : "done";
  progress.current = null;
  state.runs.push({ startedAt: progress.startedAt, finishedAt: new Date().toISOString(), discovered: progress.discovered, processed: progress.processed, created: progress.skillsCreated, updated: progress.skillsUpdated });
  saveState(state, opts.statePath);
  log(`done: ${progress.imported} imported, ${progress.rejected} rejected, ${progress.errors} errors, +${progress.skillsCreated} / ~${progress.skillsUpdated} skills`);
  return progress;
}
