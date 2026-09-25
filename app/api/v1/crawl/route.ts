/**
 * POST   /api/v1/crawl   start a manual crawl in the background (one at a time)
 * GET    /api/v1/crawl   progress of the running / last crawl + state summary
 * DELETE /api/v1/crawl   abort the running crawl
 *
 * Admin only: a crawl spends the server's GitHub quota, writes the shared
 * catalogue and runs for minutes. The automatic pass is `/api/cron/crawl`;
 * both are logged by `cortex/crawl-jobs.ts`.
 */

import { z } from "zod";
import { abortCrawl, crawlStatus, startManualCrawl } from "@/cortex/crawl-jobs";
import { CRAWL_SOURCES } from "@/cortex/crawler";
import { requireCallerPermission } from "@/cortex/api-keys";
import { enforceRequestLimit } from "@/cortex/rate-limit";
import { json, withErrors } from "@/lib/api";

export const runtime = "nodejs";
/** On serverless the POST awaits a time-boxed pass (see `startManualCrawl`). */
export const maxDuration = 26;

const startSchema = z.object({
  maxRepos: z.number().int().min(1).max(2000).default(100),
  minStars: z.number().int().min(0).default(0),
  queries: z.array(z.string().max(120)).max(20).optional(),
  repos: z.array(z.string().regex(/^[\w.-]+\/[\w.-]+$/)).max(200).optional(),
  sources: z.array(z.enum(CRAWL_SOURCES)).min(1).optional(),
  codeSearch: z.boolean().optional(),
  refresh: z.boolean().default(false),
  requireManifest: z.boolean().default(false),
});

/** Progress is operational detail: admins only, same as starting a crawl. */
export const GET = withErrors(async (request: Request) => {
  await requireCallerPermission(request, "crawler.run");
  return json(crawlStatus());
});

export const POST = withErrors(async (request: Request) => {
  const admin = await requireCallerPermission(request, "crawler.run");
  enforceRequestLimit("crawl", request, admin.userId);
  const body = startSchema.parse(await request.json().catch(() => ({})));
  await startManualCrawl(admin.userId, body);
  return json({ started: true, ...crawlStatus() }, { status: 202 });
});

export const DELETE = withErrors(async (request: Request) => {
  await requireCallerPermission(request, "crawler.run");
  return json({ aborted: abortCrawl(), ...crawlStatus() });
});
