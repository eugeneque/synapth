import { z } from "zod";
import { installForDevice, requireDevice } from "@/cortex/cli";
import { enforceRateLimit } from "@/cortex/rate-limit";
import { json, withErrors } from "@/lib/api";
import { CLI_TARGETS } from "@/types/cli";

export const runtime = "nodejs";

const schema = z.object({
  slug: z.string().min(1).max(120),
  set: z.boolean().optional(),
  target: z.enum(CLI_TARGETS).default("claude-code"),
  allowSandbox: z.boolean().optional(),
  via: z.enum(["cli", "mcp"]).optional(),
});

/**
 * POST /api/v1/cli/install — `synapth install <slug>`: plan, device and quota
 * checks, then the bundle(s) the CLI writes to disk. Counts against the daily quota.
 */
export const POST = withErrors(async (request: Request) => {
  const caller = await requireDevice(request);
  enforceRateLimit("cli", `device:${caller.device.id}`);
  const input = schema.parse(await request.json());
  return json(await installForDevice(caller, input), { headers: { "Cache-Control": "no-store" } });
});
