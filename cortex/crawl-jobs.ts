/**
 * Cortex · Crawler jobs & run log
 *
 * Every crawl goes through here, whoever starts it:
 *   - `startManualCrawl()` — the admin panel / `POST /api/v1/crawl`; runs in
 *     the background of a long-lived process and is polled for progress;
 *   - `runScheduledCrawl()` — the automatic pass every `CRAWL_INTERVAL_HOURS`
 *     hours: the Netlify scheduled function (`netlify/functions/crawl-cron.mjs`)
 *     calls `POST /api/cron/crawl`, a long-lived `next start` uses the
 *     in-process timer from `instrumentation.ts`.
 *
 * Each run is logged as a `CrawlRun` row (counters + the tail of its log), so
 * the history survives serverless instances whose state file lives in /tmp.
 * One crawl at a time per process; the scheduled pass skips while one runs.
 */

import { timingSafeEqual } from "node:crypto";
import { prisma, hasDatabase, isServerless } from "@/cortex/db";
import { crawl, DEFAULT_QUERIES, loadState, type CrawlOptions, type CrawlProgress, type CrawlSource } from "@/cortex/crawler";
import { skillRepository } from "@/cortex/repository";
import { EXTERNAL_SOURCES } from "@/cortex/crawl-sources";

export const CRAWL_INTERVAL_HOURS = 2;
/** Cron expression for the same cadence (Netlify scheduled function, UTC). */
export const CRAWL_CRON = `0 */${CRAWL_INTERVAL_HOURS} * * *`;
/** Serverless functions are cut off at ~26 s; the scheduled pass stops starting new work before that. */
export const SCHEDULED_BUDGET_MS = 20_000;
const LOG_LINES_KEPT = 200;
/** A "running" row older than this belongs to an instance that was killed mid-run (serverless timeout, redeploy). */
const STALE_RUN_MS = 30 * 60_000;
const RUNS_KEPT_IN_MEMORY = 50;

export type CrawlTrigger = "schedule" | "manual";
export type CrawlRunStatus = "running" | "done" | "aborted" | "failed";

export interface CrawlRunRecord {
  id: string;
  trigger: CrawlTrigger;
  status: CrawlRunStatus;
  actorId: string | null;
  startedAt: string;
  finishedAt: string | null;
  discovered: number;
  processed: number;
  imported: number;
  rejected: number;
  errors: number;
  created: number;
  updated: number;
  error: string | null;
  log: string[];
}

interface Job {
  progress: CrawlProgress | null;
  running: boolean;
  trigger: CrawlTrigger | null;
  controller: AbortController | null;
  error: string | null;
}

const g = globalThis as unknown as { __synapthCrawl_v2?: Job; __synapthCrawlRuns_v1?: CrawlRunRecord[] };
const job: Job = g.__synapthCrawl_v2 ?? (g.__synapthCrawl_v2 = { progress: null, running: false, trigger: null, controller: null, error: null });
const memoryRuns: CrawlRunRecord[] = g.__synapthCrawlRuns_v1 ?? (g.__synapthCrawlRuns_v1 = []);

export class CrawlBusyError extends Error {
  status = 409 as const;
  constructor() {
    super("A crawl is already running");
    this.name = "CrawlBusyError";
  }
}

// ---------------------------------------------------------------------------
// Run log
// ---------------------------------------------------------------------------

const newRunId = () => `crun_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Closes rows no live process will ever finish, so the run log does not show them "running" forever. */
async function closeStaleRuns() {
  const before = new Date(Date.now() - STALE_RUN_MS);
  const error = "interrupted: the process ended before the run finished";
  if (!hasDatabase) {
    for (const r of memoryRuns) if (r.status === "running" && new Date(r.startedAt) < before) Object.assign(r, { status: "failed", error, finishedAt: new Date().toISOString() });
    return;
  }
  await prisma.crawlRun.updateMany({ where: { status: "running", startedAt: { lt: before } }, data: { status: "failed", error, finishedAt: new Date() } });
}

async function openRun(trigger: CrawlTrigger, actorId: string | null): Promise<string> {
  await closeStaleRuns().catch((err) => console.error("[crawl] could not close stale runs", err));
  if (!hasDatabase) {
    const run: CrawlRunRecord = { id: newRunId(), trigger, status: "running", actorId, startedAt: new Date().toISOString(), finishedAt: null, discovered: 0, processed: 0, imported: 0, rejected: 0, errors: 0, created: 0, updated: 0, error: null, log: [] };
    memoryRuns.unshift(run);
    memoryRuns.splice(RUNS_KEPT_IN_MEMORY);
    return run.id;
  }
  const row = await prisma.crawlRun.create({ data: { trigger, actorId }, select: { id: true } });
  return row.id;
}

async function closeRun(id: string, status: CrawlRunStatus, progress: CrawlProgress | null, error: string | null) {
  const counters = {
    discovered: progress?.discovered ?? 0,
    processed: progress?.processed ?? 0,
    imported: progress?.imported ?? 0,
    rejected: progress?.rejected ?? 0,
    errors: progress?.errors ?? 0,
    created: progress?.skillsCreated ?? 0,
    updated: progress?.skillsUpdated ?? 0,
  };
  const log = (progress?.log ?? []).slice(-LOG_LINES_KEPT);
  if (error) log.push(`failed: ${error}`);
  console.log(`[crawl] ${id} ${status}: ${counters.processed} processed, +${counters.created} / ~${counters.updated} skills${error ? ` (${error})` : ""}`);
  if (!hasDatabase) {
    const run = memoryRuns.find((r) => r.id === id);
    if (run) Object.assign(run, counters, { status, error, log, finishedAt: new Date().toISOString() });
    return;
  }
  await prisma.crawlRun.update({ where: { id }, data: { ...counters, status, error, log, finishedAt: new Date() } });
}

function toRecord(r: { id: string; trigger: string; status: string; actorId: string | null; startedAt: Date; finishedAt: Date | null; discovered: number; processed: number; imported: number; rejected: number; errors: number; created: number; updated: number; error: string | null; log: unknown }): CrawlRunRecord {
  return {
    ...r,
    trigger: r.trigger === "manual" ? "manual" : "schedule",
    status: (["running", "done", "aborted", "failed"] as const).find((s) => s === r.status) ?? "failed",
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    log: Array.isArray(r.log) ? r.log.filter((l): l is string => typeof l === "string") : [],
  };
}

/** Newest first. */
export async function listCrawlRuns(limit = 20): Promise<CrawlRunRecord[]> {
  const take = Math.min(Math.max(limit, 1), 100);
  if (!hasDatabase) return memoryRuns.slice(0, take).map((r) => ({ ...r, log: [...r.log] }));
  const rows = await prisma.crawlRun.findMany({ orderBy: { startedAt: "desc" }, take });
  return rows.map(toRecord);
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

/** Next slot of the fixed UTC grid (00:00, 02:00, …) — the same instants the cron expression fires at. */
export function nextScheduledRun(now = new Date()): Date {
  const period = CRAWL_INTERVAL_HOURS * 3_600_000;
  return new Date(Math.floor(now.getTime() / period) * period + period);
}

/** Whether this deployment runs the automatic pass, and by what means. */
export function scheduleMode(): "netlify" | "in-process" | "off" {
  if (process.env.SYNAPTH_AUTO_CRAWL === "0") return "off";
  // Serverless: the scheduled function needs the shared secret to reach the endpoint.
  if (isServerless) return process.env.SYNAPTH_CRON_SECRET ? "netlify" : "off";
  return process.env.NODE_ENV === "production" || process.env.SYNAPTH_AUTO_CRAWL === "1" ? "in-process" : "off";
}

/**
 * Bearer check for `POST /api/cron/crawl`. Without `SYNAPTH_CRON_SECRET` the
 * endpoint is closed: a public URL that makes the server spend its GitHub
 * quota must not be callable by anyone.
 */
export function isCronAuthorized(request: Request, secret = process.env.SYNAPTH_CRON_SECRET): boolean {
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}

const slotOf = (now: Date) => Math.floor(now.getTime() / (CRAWL_INTERVAL_HOURS * 3_600_000));

/** Two queries per pass, rotating with the slot, so every query comes round within a day. */
function scheduledQueries(now = new Date()): string[] {
  const i = (slotOf(now) * 2) % DEFAULT_QUERIES.length;
  return [DEFAULT_QUERIES[i], DEFAULT_QUERIES[(i + 1) % DEFAULT_QUERIES.length]];
}

/**
 * GitHub search every pass, plus one external source in turn (all five come round within 10 hours); the search order
 * alternates so recently pushed repos surface, not only the top-starred ones
 * the catalogue already holds.
 */
export function scheduledPlan(now = new Date()): { queries: string[]; sources: CrawlSource[]; sort: "stars" | "updated" } {
  const slot = slotOf(now);
  return { queries: scheduledQueries(now), sources: ["github", EXTERNAL_SOURCES[slot % EXTERNAL_SOURCES.length]], sort: slot % 2 ? "updated" : "stars" };
}

/** Repos the catalogue already holds: the crawl-state file does not survive a serverless instance. */
async function catalogueRepos(): Promise<Set<string>> {
  const all = await skillRepository.all();
  return new Set(all.flatMap((s) => (s.source?.fullName ? [s.source.fullName.toLowerCase()] : [])));
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function execute(trigger: CrawlTrigger, actorId: string | null, options: CrawlOptions): Promise<CrawlRunRecord | null> {
  if (job.running) throw new CrawlBusyError();
  job.running = true;
  job.trigger = trigger;
  job.error = null;
  job.progress = null;
  job.controller = new AbortController();
  let runId: string | null = null;
  try {
    runId = await openRun(trigger, actorId);
    const progress = await crawl({
      ...options,
      signal: job.controller.signal,
      onProgress: (p) => {
        job.progress = p;
      },
    });
    job.progress = progress;
    await closeRun(runId, progress.phase === "aborted" ? "aborted" : "done", progress, null);
  } catch (err) {
    job.error = (err as Error).message;
    if (runId) await closeRun(runId, job.controller.signal.aborted ? "aborted" : "failed", job.progress, job.error).catch(() => undefined);
  } finally {
    job.running = false;
    job.trigger = null;
  }
  return runId ? ((await listCrawlRuns(RUNS_KEPT_IN_MEMORY)).find((r) => r.id === runId) ?? null) : null;
}

export interface ManualCrawlInput {
  maxRepos: number;
  minStars: number;
  queries?: string[];
  repos?: string[];
  sources?: CrawlSource[];
  codeSearch?: boolean;
  refresh?: boolean;
  requireManifest?: boolean;
}

/**
 * Starts a manual crawl. In a long-lived process it runs in the background and
 * returns immediately (progress via `crawlStatus()`). On serverless a promise
 * left running after the response is frozen with the instance, so there the
 * call awaits a time-boxed pass instead, like the scheduled one; repos it did
 * not reach are picked up by the next run.
 */
export async function startManualCrawl(actorId: string, input: ManualCrawlInput): Promise<void> {
  if (job.running) throw new CrawlBusyError();
  const direct = Boolean(input.repos?.length);
  const options: CrawlOptions = {
    maxRepos: isServerless ? Math.min(input.maxRepos, 25) : input.maxRepos,
    minStars: input.minStars,
    queries: direct ? [] : input.queries,
    sources: direct ? [] : input.sources,
    candidates: input.repos?.map((fullName) => ({ fullName, foundBy: "api" })),
    codeSearch: direct ? false : input.codeSearch,
    refresh: input.refresh || direct,
    requireManifest: input.requireManifest,
  };
  if (!isServerless) {
    void execute("manual", actorId, options);
    return;
  }
  await execute("manual", actorId, { ...options, deadline: Date.now() + SCHEDULED_BUDGET_MS, knownRepos: direct ? undefined : await catalogueRepos() });
}

/**
 * The automatic pass. Awaited, so a serverless request stays alive for the
 * whole run; on serverless it gets a time budget and skips repos the
 * catalogue already holds. Returns null when another crawl is running.
 */
export async function runScheduledCrawl(options: { budgetMs?: number; now?: Date } = {}): Promise<CrawlRunRecord | null> {
  if (job.running) {
    console.log("[crawl] scheduled pass skipped: a crawl is already running");
    return null;
  }
  const budgetMs = options.budgetMs ?? (isServerless ? SCHEDULED_BUDGET_MS : undefined);
  return execute("schedule", null, {
    ...scheduledPlan(options.now),
    maxRepos: budgetMs ? 25 : 100,
    minStars: 3,
    codeSearch: false,
    deadline: budgetMs ? Date.now() + budgetMs : undefined,
    knownRepos: await catalogueRepos(),
  });
}

export function abortCrawl(): boolean {
  const was = job.running;
  job.controller?.abort();
  return was;
}

/** Snapshot for the admin panel and `GET /api/v1/crawl`. */
export function crawlStatus() {
  const state = loadState();
  const repos = Object.values(state.repos);
  return {
    running: job.running,
    trigger: job.trigger,
    error: job.error,
    progress: job.progress ? { ...job.progress, log: job.progress.log.slice(-40) } : null,
    state: {
      repos: repos.length,
      imported: repos.filter((r) => r.status === "imported").length,
      rejected: repos.filter((r) => r.status === "rejected").length,
      errors: repos.filter((r) => r.status === "error").length,
      skills: repos.reduce((s, r) => s + r.skills, 0),
      lastRun: state.runs.at(-1) ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// In-process timer (long-lived `next start`; see instrumentation.ts)
// ---------------------------------------------------------------------------

const timer = globalThis as unknown as { __synapthCrawlTimer_v1?: ReturnType<typeof setTimeout> };

export function startCrawlScheduler(): boolean {
  if (scheduleMode() !== "in-process" || timer.__synapthCrawlTimer_v1) return false;
  const arm = () => {
    const delay = Math.max(1_000, nextScheduledRun().getTime() - Date.now());
    timer.__synapthCrawlTimer_v1 = setTimeout(async () => {
      try {
        await runScheduledCrawl();
      } catch (err) {
        console.error("[crawl] scheduled pass failed", err);
      }
      arm();
    }, delay);
    timer.__synapthCrawlTimer_v1.unref?.();
  };
  arm();
  console.log(`[crawl] automatic crawl every ${CRAWL_INTERVAL_HOURS}h; next at ${nextScheduledRun().toISOString()}`);
  return true;
}
