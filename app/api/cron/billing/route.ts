/**
 * POST /api/cron/billing — daily subscription renewals (ТЗ §4.6).
 * Same bearer secret as the crawl cron; closed without `SYNAPTH_CRON_SECRET`.
 */

import { isCronAuthorized } from "@/cortex/crawl-jobs";
import { renewDueSubscriptions } from "@/cortex/payments";
import { sweepAgentAudit } from "@/cortex/agent-audit";
import { json, withErrors } from "@/lib/api";
import { PLANS } from "@/types/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 26;

export const POST = withErrors(async (request: Request) => {
  if (!isCronAuthorized(request)) return json({ error: "Unauthorized" }, { status: 401 });
  const renewals = await renewDueSubscriptions();
  // The longest retention of any plan bounds the journal; per-plan trimming happens on read.
  const maxDays = Math.max(...Object.values(PLANS).map((p) => p.limits.auditDays));
  const swept = await sweepAgentAudit(new Date(Date.now() - maxDays * 86_400_000));
  return json({ ...renewals, auditSwept: swept });
});
