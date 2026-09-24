/**
 * Cortex · Platform developers
 *
 * `User.developer` marks the people who build Synapth itself (types/auth.ts).
 * It is not a role and grants no permission, so an admin may set it on
 * anyone, themselves included. The unique `platform-developer` achievement
 * follows the flag both ways through `evaluateBadges()`.
 */

import { prisma, hasDatabase } from "@/cortex/db";
import { memoryUsers } from "@/cortex/seed";
import { evaluateBadges } from "@/cortex/badges";
import { DIRECTORY_SELECT, RoleChangeError, directoryRow, isSystemAccount, memoryDirectoryRow, requirePermission, type DirectoryUser } from "@/cortex/roles";

/** Admin-only: marks (or unmarks) someone who builds the platform; the unique badge follows. */
export async function setDeveloper(actorId: string, targetId: string, developer: boolean): Promise<DirectoryUser> {
  await requirePermission(actorId, "users.manageRoles");
  if (isSystemAccount(targetId)) throw new RoleChangeError("System accounts cannot be developers");

  let row: DirectoryUser;
  if (!hasDatabase) {
    const u = memoryUsers.find((m) => m.id === targetId);
    if (!u) throw new RoleChangeError("User not found", 404);
    u.developer = developer;
    row = await memoryDirectoryRow(u);
  } else {
    if (!(await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } }))) throw new RoleChangeError("User not found", 404);
    row = directoryRow(await prisma.user.update({ where: { id: targetId }, data: { developer }, select: DIRECTORY_SELECT }));
  }
  await evaluateBadges(targetId);
  return row;
}
