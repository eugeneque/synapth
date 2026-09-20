import { requireUser } from "@/cortex/auth";
import { dismiss } from "@/cortex/notifications";
import { json, withErrors } from "@/lib/api";

/** DELETE /api/v1/notifications/:id — dismiss one card. */
export const DELETE = withErrors(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await params;
  const ok = await dismiss(user.id, id);
  return json({ ok }, { status: ok ? 200 : 404 });
});
