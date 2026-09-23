import { requireUser } from "@/cortex/auth";
import { verificationState } from "@/cortex/verification";
import { enforceRequestLimit } from "@/cortex/rate-limit";
import { json, withErrors } from "@/lib/api";

export const runtime = "nodejs";

/** GET /api/v1/account/verification — the signed-in user's check mark, latest request and eligibility (settings polls it). */
export const GET = withErrors(async (request: Request) => {
  const user = await requireUser();
  enforceRequestLimit("read", request, user.id);
  return json(await verificationState(user.id), { headers: { "Cache-Control": "no-store" } });
});
