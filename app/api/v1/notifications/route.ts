import { requireUser } from "@/cortex/auth";
import { listNotifications, pollNotifications } from "@/cortex/notifications";
import { json, withErrors } from "@/lib/api";
import { enforceRequestLimit } from "@/cortex/rate-limit";
import type { NotificationChannel } from "@/types/social";

const CHANNELS = new Set(["all", "unread", "social", "skills", "system"]);

/**
 * GET /api/v1/notifications — the signed-in user's inbox.
 *   ?after=<iso>            poll mode: unread count + rows newer than the cursor (what the drawer uses)
 *   ?channel=&limit=        feed mode: newest first, optionally narrowed to a tab
 */
export const GET = withErrors(async (request: Request) => {
  const user = await requireUser();
  enforceRequestLimit("read", request, user.id);
  const url = new URL(request.url);
  const after = url.searchParams.get("after");
  if (after !== null) return json(await pollNotifications(user.id, after || null), { headers: { "Cache-Control": "no-store" } });
  const channel = url.searchParams.get("channel") ?? "all";
  // Unvalidated, this reaches the store as NaN or as an unbounded page size.
  const requested = Number(url.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 200) : 50;
  return json(await listNotifications(user.id, { channel: (CHANNELS.has(channel) ? channel : "all") as NotificationChannel | "all" | "unread", limit }), { headers: { "Cache-Control": "no-store" } });
});
