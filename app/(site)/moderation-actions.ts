"use server";

/**
 * Server actions for staff: catalogue verification (moderators and admins)
 * and role management (admins). Permission checks live in `cortex/roles.ts`
 * and read the stored role, so a stale JWT never grants anything.
 */

import { revalidatePath } from "next/cache";
import { requireUser } from "@/cortex/auth";
import { enforceRateLimit } from "@/cortex/rate-limit";
import { setVerification } from "@/cortex/moderation";
import { setUserRole, type DirectoryUser } from "@/cortex/roles";
import type { SecurityLevel } from "@/types/skill";

export type StaffActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(fn: () => Promise<T>): Promise<StaffActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof Error && "status" in err) return { ok: false, error: err.message };
    throw err;
  }
}

/** Sets or revokes `Verified`; the scanner still decides whether the entry qualifies. */
export async function verifySkill(skillId: string, verified: boolean): Promise<StaffActionResult<{ securityLevel: SecurityLevel }>> {
  return run(async () => {
    const user = await requireUser();
    enforceRateLimit("write", `user:${user.id}`);
    const skill = await setVerification(user.id, skillId, verified);
    revalidatePath(`/skills/${skill.slug}`);
    revalidatePath("/dashboard/moderation");
    return { securityLevel: skill.securityLevel };
  });
}

export async function changeUserRole(userId: string, role: string): Promise<StaffActionResult<DirectoryUser>> {
  return run(async () => {
    const user = await requireUser();
    enforceRateLimit("write", `user:${user.id}`);
    const updated = await setUserRole(user.id, userId, role);
    revalidatePath("/dashboard/users");
    if (updated.handle) revalidatePath(`/u/${updated.handle}`);
    return updated;
  });
}
