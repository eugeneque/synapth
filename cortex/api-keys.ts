/**
 * Cortex · Caller resolution for the v1 API.
 * Browsers arrive with a session cookie, agents with `X-Synapth-Key`.
 */

import { createHash, randomBytes } from "node:crypto";
import { auth, ForbiddenError, UnauthorizedError } from "@/cortex/auth";
import { getProfile } from "@/cortex/account";
import { prisma, hasDatabase } from "@/cortex/db";
import type { UserRole } from "@/types/auth";

export const API_KEY_PREFIX = "syn_";
/** Works only on the in-memory store, for local agents and docs examples. */
export const DEMO_API_KEY = "syn_demo_0000000000000000";

export interface Caller {
  userId: string;
  via: "session" | "api-key";
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const key = `${API_KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
  return { key, prefix: key.slice(0, 12), hash: hashKey(key) };
}

export async function resolveCaller(request: Request): Promise<Caller | null> {
  const key = request.headers.get("x-synapth-key") ?? bearer(request.headers.get("authorization"));
  if (key) {
    if (!hasDatabase) return key === DEMO_API_KEY ? { userId: "usr_demo", via: "api-key" } : null;
    const row = await prisma.apiKey.findUnique({ where: { keyHash: hashKey(key) }, select: { userId: true, revokedAt: true, id: true } });
    if (!row || row.revokedAt) return null;
    await prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
    return { userId: row.userId, via: "api-key" };
  }

  const session = await auth();
  return session?.user?.id ? { userId: session.user.id, via: "session" } : null;
}

/** `resolveCaller` or 401 — for handlers that agents reach with `X-Synapth-Key`. */
export async function requireCaller(request: Request): Promise<Caller> {
  const caller = await resolveCaller(request);
  if (!caller) throw new UnauthorizedError();
  return caller;
}

/**
 * Role check that works for both credentials: the JWT carries the role for a
 * session, but an API key only carries a user id, so the role is read from the
 * stored profile either way.
 */
export async function requireCallerRole(request: Request, ...roles: UserRole[]): Promise<Caller & { role: UserRole }> {
  const caller = await requireCaller(request);
  const role = (await getProfile(caller.userId))?.role ?? "user";
  if (!roles.includes(role)) throw new ForbiddenError(`Requires role: ${roles.join(" or ")}`);
  return { ...caller, role };
}

function bearer(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}
