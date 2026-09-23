/**
 * Cortex · Roles & permissions
 *
 * The permission table lives in `types/auth.ts` (shared with the UI); this
 * module enforces it. Decisions always read the stored role, never the one
 * cached in the session JWT, so a demotion takes effect on the next request.
 *
 * Role changes are admin-only and guarded against lock-out: nobody edits
 * their own role, and the last admin cannot be demoted.
 */

import { prisma, hasDatabase } from "@/cortex/db";
import { memoryUsers } from "@/cortex/seed";
import { can, toUserRole, USER_ROLES, type Permission, type UserRole } from "@/types/auth";

/** 403; rendered by `lib/api` and the server-action wrappers through its `status`. */
export class PermissionDeniedError extends Error {
  status = 403 as const;
  constructor(readonly permission: Permission) {
    super(`Missing permission: ${permission}`);
    this.name = "PermissionDeniedError";
  }
}

export class RoleChangeError extends Error {
  status: 400 | 404 | 409;
  constructor(message: string, status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = "RoleChangeError";
    this.status = status;
  }
}

/** Stored role; unknown users are plain users (and hold no permissions beyond that). */
export async function getRole(userId: string): Promise<UserRole> {
  if (!hasDatabase) return toUserRole(memoryUsers.find((u) => u.id === userId)?.role);
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  return toUserRole(row?.role);
}

export async function hasPermission(userId: string | null | undefined, permission: Permission): Promise<boolean> {
  return Boolean(userId) && can(await getRole(userId!), permission);
}

/** Throws 403 unless `userId` holds `permission`; returns the role for callers that branch on it. */
export async function requirePermission(userId: string, permission: Permission): Promise<UserRole> {
  const role = await getRole(userId);
  if (!can(role, permission)) throw new PermissionDeniedError(permission);
  return role;
}

// ---------------------------------------------------------------------------
// User directory (admin console)
// ---------------------------------------------------------------------------

export interface DirectoryUser {
  id: string;
  name: string;
  handle: string;
  email: string | null;
  role: UserRole;
  createdAt: string | null;
}

/** Crawler pseudo-users (`gh:<owner>`) and the platform ledger account are not people; the directory hides them. */
const isSystemAccount = (id: string) => id.startsWith("gh:") || id === "usr_platform";

export async function listUsers(options: { q?: string; role?: UserRole; limit?: number } = {}): Promise<DirectoryUser[]> {
  const q = options.q?.trim().toLowerCase() ?? "";
  const limit = Math.min(options.limit ?? 50, 200);
  if (!hasDatabase) {
    return memoryUsers
      .filter((u) => !isSystemAccount(u.id))
      .filter((u) => !options.role || u.role === options.role)
      .filter((u) => !q || [u.name, u.handle, u.email].some((f) => f.toLowerCase().includes(q)))
      .slice(0, limit)
      .map((u) => ({ id: u.id, name: u.name, handle: u.handle, email: u.email, role: toUserRole(u.role), createdAt: null }));
  }
  const rows = await prisma.user.findMany({
    where: {
      NOT: [{ id: { startsWith: "gh:" } }, { id: "usr_platform" }],
      ...(options.role ? { role: options.role } : {}),
      ...(q
        ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { handle: { contains: q, mode: "insensitive" as const } }, { email: { contains: q, mode: "insensitive" as const } }] }
        : {}),
    },
    // Staff first, then newest accounts.
    orderBy: [{ role: "desc" }, { createdAt: "desc" }],
    take: limit,
    select: { id: true, name: true, handle: true, email: true, role: true, createdAt: true },
  });
  return rows.map((r) => ({ id: r.id, name: r.name ?? "", handle: r.handle ?? "", email: r.email, role: toUserRole(r.role), createdAt: r.createdAt.toISOString() }));
}

/** Admins who are people: the platform ledger account may carry the role too, it cannot sign in. */
async function adminCount(): Promise<number> {
  if (!hasDatabase) return memoryUsers.filter((u) => u.role === "admin" && !isSystemAccount(u.id)).length;
  return prisma.user.count({ where: { role: "admin", NOT: [{ id: { startsWith: "gh:" } }, { id: "usr_platform" }] } });
}

/** Admin-only. Returns the updated directory row. */
export async function setUserRole(actorId: string, targetId: string, rawRole: string): Promise<DirectoryUser> {
  await requirePermission(actorId, "users.manageRoles");
  if (!(USER_ROLES as readonly string[]).includes(rawRole)) throw new RoleChangeError(`Unknown role: ${rawRole}`);
  const role = rawRole as UserRole;
  if (actorId === targetId) throw new RoleChangeError("You cannot change your own role");
  if (isSystemAccount(targetId)) throw new RoleChangeError("System accounts have no role to change");

  const current = hasDatabase ? (await prisma.user.findUnique({ where: { id: targetId }, select: { role: true } }))?.role : memoryUsers.find((u) => u.id === targetId)?.role;
  if (!current) throw new RoleChangeError("User not found", 404);
  if (current === "admin" && role !== "admin" && (await adminCount()) <= 1) throw new RoleChangeError("The last admin cannot be demoted", 409);

  if (!hasDatabase) {
    const u = memoryUsers.find((m) => m.id === targetId)!;
    u.role = role;
    return { id: u.id, name: u.name, handle: u.handle, email: u.email, role, createdAt: null };
  }
  const r = await prisma.user.update({ where: { id: targetId }, data: { role }, select: { id: true, name: true, handle: true, email: true, role: true, createdAt: true } });
  return { id: r.id, name: r.name ?? "", handle: r.handle ?? "", email: r.email, role: toUserRole(r.role), createdAt: r.createdAt.toISOString() };
}
