import { z } from "zod";
import { requireUser } from "@/cortex/auth";
import { markRead } from "@/cortex/notifications";
import { json, withErrors } from "@/lib/api";

const bodySchema = z.object({ ids: z.array(z.string().min(1)).max(500).optional() });

/** POST /api/v1/notifications/read — `{ ids }` marks those rows read, `{}` marks the whole inbox. */
export const POST = withErrors(async (request: Request) => {
  const user = await requireUser();
  const { ids } = bodySchema.parse(await request.json().catch(() => ({})));
  return json({ unread: await markRead(user.id, ids) });
});
