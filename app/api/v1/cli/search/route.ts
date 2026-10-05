import { z } from "zod";
import { cliSearch, requireDevice } from "@/cortex/cli";
import { enforceRateLimit } from "@/cortex/rate-limit";
import { json, withErrors } from "@/lib/api";

export const runtime = "nodejs";

const schema = z.object({ q: z.string().max(200).default(""), limit: z.coerce.number().int().min(1).max(30).default(10) });

/** GET /api/v1/cli/search?q= — `synapth search`: compact catalogue rows plus matching skillsets. Does not count against the install quota. */
export const GET = withErrors(async (request: Request) => {
  const caller = await requireDevice(request);
  enforceRateLimit("cli", `device:${caller.device.id}`);
  const { q, limit } = schema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return json(await cliSearch(q, limit), { headers: { "Cache-Control": "no-store" } });
});
