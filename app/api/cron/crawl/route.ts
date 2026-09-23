/**
 * POST /api/cron/crawl — the automatic crawler pass (every 2 hours).
 *
 * Called by the Netlify scheduled function `netlify/functions/crawl-cron.mjs`
 * with `Authorization: Bearer $SYNAPTH_CRON_SECRET`; closed when the secret is
 * not configured. The request stays open for the whole (time-boxed) run.
 */

import { isCronAuthorized, runScheduledCrawl } from "@/cortex/crawl-jobs";
import { json, withErrors } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 26;

export const POST = withErrors(async (request: Request) => {
  if (!isCronAuthorized(request)) return json({ error: "Unauthorized" }, { status: 401 });
  const run = await runScheduledCrawl();
  if (!run) return json({ skipped: true, reason: "A crawl is already running" }, { status: 409 });
  const { log, ...summary } = run;
  return json({ ...summary, logLines: log.length });
});
