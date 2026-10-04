import { requireDevice, revokeDevice } from "@/cortex/cli";
import { enforceRateLimit } from "@/cortex/rate-limit";
import { json, withErrors } from "@/lib/api";

export const runtime = "nodejs";

/** POST /api/v1/cli/unlink — `synapth unlink`: the machine revokes its own device token. */
export const POST = withErrors(async (request: Request) => {
  const caller = await requireDevice(request);
  enforceRateLimit("cli", `device:${caller.device.id}`);
  await revokeDevice(caller.device.userId, caller.device.id);
  return json({ ok: true });
});
