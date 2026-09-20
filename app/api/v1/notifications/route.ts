import { requireUser } from "@/cortex/auth";
import { listNotifications, pollNotifications } from "@/cortex/notifications";
import { json, withErrors } from "@/lib/api";
import type { NotificationChannel } from "@/types/social";

const CHANNELS = new Set(["all", "unread", "social", "skills", "system"]);

/**
 * GET /api/v1/notifications — the signed-in user's inbox.
 *   ?after=<iso>            poll mode: unread count + rows newer than the cursor (what the drawer uses)
 *   ?channel=&limit=        feed mode: newest first, optionally narrowed to a tab
 */
export const GET = withErrors(async (request: Request) => {
  const user = await requireUser();
  const url = new URL(request.url);
  const after = url.searchParams.get("after");
  if (after !== null) return json(await pollNotifications(user.id, after || null), { headers: { "Cache-Control": "no-store" } });
  const channel = url.searchParams.get("channel") ?? "all";
  const limit = Number(url.searchParams.get("limit") ?? 50);
  return json(await listNotifications(user.id, { channel: (CHANNELS.has(channel) ? channel : "all") as NotificationChannel | "all" | "unread", limit }), { headers: { "Cache-Control": "no-store" } });
});
