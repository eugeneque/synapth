/**
 * GET /api/v1/users/:handle/card — the avatar hover card: public profile summary
 * plus whether the signed-in viewer has an impulse on this user.
 */

import { auth } from "@/cortex/auth";
import { getUserCard } from "@/cortex/user-card";
import { enforceRequestLimit } from "@/cortex/rate-limit";
import { json, withErrors } from "@/lib/api";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ handle: string }> };

export const GET = withErrors(async (request: Request, { params }: Ctx) => {
  const session = await auth();
  const viewerId = session?.user?.id ?? null;
  enforceRequestLimit("read", request, viewerId);
  const card = await getUserCard(decodeURIComponent((await params).handle), viewerId);
  if (!card) return json({ error: "User not found" }, { status: 404 });
  return json(card, { headers: { "Cache-Control": "private, no-store" } });
});
