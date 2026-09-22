/**
 * POST /api/v1/crawl   start a crawl in the background (one at a time)
 * GET  /api/v1/crawl   progress of the running / last crawl + state summary
 *
 * Admin only: a crawl spends the server's GitHub quota, writes the shared
 * catalogue and runs for minutes, so any signed-in user must not be able to
 * start one.
 */

import { z } from "zod";
import { crawl, loadState, type CrawlProgress } from "@/cortex/crawler";
import { requireCallerRole } from "@/cortex/api-keys";
import { enforceRequestLimit } from "@/cortex/rate-limit";
import { json, withErrors } from "@/lib/api";

export const runtime = "nodejs";

interface Job {
  progress: CrawlProgress | null;
  running: boolean;
  controller: AbortController | null;
  error: string | null;
}

const g = globalThis as unknown as { __synapthCrawl?: Job };
const job: Job = g.__synapthCrawl ?? (g.__synapthCrawl = { progress: null, running: false, controller: null, error: null });

const startSchema = z.object({
  maxRepos: z.number().int().min(1).max(2000).default(100),
  minStars: z.number().int().min(0).default(0),
  queries: z.array(z.string().max(120)).max(20).optional(),
  repos: z.array(z.string().regex(/^[\w.-]+\/[\w.-]+$/)).max(200).optional(),
  codeSearch: z.boolean().optional(),
  refresh: z.boolean().default(false),
  requireManifest: z.boolean().default(false),
});

function summary() {
  const state = loadState();
  const repos = Object.values(state.repos);
  return {
    running: job.running,
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

/** Progress is operational detail: admins only, same as starting a crawl. */
export const GET = withErrors(async (request: Request) => {
  await requireCallerRole(request, "admin");
  return json(summary());
});

export const POST = withErrors(async (request: Request) => {
  const admin = await requireCallerRole(request, "admin");
  enforceRequestLimit("crawl", request, admin.userId);
  if (job.running) return json({ ...summary(), error: "A crawl is already running" }, { status: 409 });

  const body = startSchema.parse(await request.json().catch(() => ({})));
  job.running = true;
  job.error = null;
  job.controller = new AbortController();

  crawl({
    maxRepos: body.maxRepos,
    minStars: body.minStars,
    queries: body.repos?.length ? [] : body.queries,
    candidates: body.repos?.map((fullName) => ({ fullName, foundBy: "api" })),
    codeSearch: body.repos?.length ? false : body.codeSearch,
    refresh: body.refresh || Boolean(body.repos?.length),
    requireManifest: body.requireManifest,
    signal: job.controller.signal,
    onProgress: (p) => {
      job.progress = p;
    },
  })
    .then((p) => {
      job.progress = p;
    })
    .catch((err: Error) => {
      job.error = err.message;
    })
    .finally(() => {
      job.running = false;
    });

  return json({ started: true, ...summary() }, { status: 202 });
});

export const DELETE = withErrors(async (request: Request) => {
  await requireCallerRole(request, "admin");
  job.controller?.abort();
  return json({ aborted: job.running, ...summary() });
});
