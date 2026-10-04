import { z } from "zod";
import { cliRecommend, requireDevice } from "@/cortex/cli";
import { enforceRateLimit } from "@/cortex/rate-limit";
import { json, withErrors } from "@/lib/api";
import { CLI_TARGETS } from "@/types/cli";

export const runtime = "nodejs";

const schema = z.object({ task: z.string().min(3).max(2000), target: z.enum(CLI_TARGETS).default("claude-code") });

/**
 * POST /api/v1/cli/recommend — `synapth recommend` and the `recommend_skills`
 * MCP tool: entries for a task (resolve_task), counted against the daily resolve quota.
 */
export const POST = withErrors(async (request: Request) => {
  const caller = await requireDevice(request);
  enforceRateLimit("cli", `device:${caller.device.id}`);
  const { task, target } = schema.parse(await request.json());
  return json({ recommendations: await cliRecommend(caller, task, target) }, { headers: { "Cache-Control": "no-store" } });
});
