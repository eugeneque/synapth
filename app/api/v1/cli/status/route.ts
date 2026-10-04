import { cliStatus, requireDevice } from "@/cortex/cli";
import { enforceRateLimit } from "@/cortex/rate-limit";
import { json, withErrors } from "@/lib/api";

export const runtime = "nodejs";

/** GET /api/v1/cli/status — `synapth status`: account, plan, quota and notices for this linked machine. */
export const GET = withErrors(async (request: Request) => {
  const caller = await requireDevice(request);
  enforceRateLimit("cli", `device:${caller.device.id}`);
  return json(await cliStatus(caller), { headers: { "Cache-Control": "no-store" } });
});
