/**
 * Cortex · Caller resolution for the v1 API.
 * Browsers arrive with a session cookie, agents with `X-Synapth-Key`.
 */

import { createHash, randomBytes } from "node:crypto";
import { auth } from "@/cortex/auth";
import { prisma, hasDatabase } from "@/cortex/db";

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

function bearer(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}
