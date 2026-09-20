import { resolveCaller } from "@/cortex/api-keys";
import { getProfile } from "@/cortex/account";
import { UnauthorizedError } from "@/cortex/auth";
import { json, withErrors } from "@/lib/api";

/** GET /api/v1/account/me — who the caller is (session cookie or `X-Synapth-Key`). The auth gate uses it to check machine tokens. */
export const GET = withErrors(async (request: Request) => {
  const caller = await resolveCaller(request);
  if (!caller) throw new UnauthorizedError();
  const profile = await getProfile(caller.userId);
  return json({ userId: caller.userId, via: caller.via, handle: profile?.handle ?? null, name: profile?.name ?? null, role: profile?.role ?? "user" });
});
