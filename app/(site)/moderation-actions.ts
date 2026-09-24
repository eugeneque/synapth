"use server";

/**
 * Server actions for the review flow: any user files a moderation request;
 * staff re-run the scanner, close requests with a verdict and toggle
 * `Verified` (moderators and admins); admins manage roles and the
 * platform-developer flag. Permission checks
 * live in `cortex/roles.ts` and read the stored role, so a stale JWT never
 * grants anything.
 */

import { revalidatePath } from "next/cache";
import { requireUser } from "@/cortex/auth";
import { enforceRateLimit } from "@/cortex/rate-limit";
import { decideModeration, requestModeration, rescanForReview, setVerification } from "@/cortex/moderation";
import { setUserRole, type DirectoryUser } from "@/cortex/roles";
import { setDeveloper } from "@/cortex/developers";
import type { ScanReport } from "@/lib/sandbox-scanner";
import type { ModerationStatus, ModerationVerdict } from "@/types/moderation";
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

/** "Send for moderation" on an entry page. */
export async function submitForModeration(skillId: string, note: string): Promise<StaffActionResult<{ requestId: string }>> {
  return run(async () => {
    const user = await requireUser();
    enforceRateLimit("moderationRequest", `user:${user.id}`);
    const request = await requestModeration(user.id, skillId, note);
    if (request.skill) revalidatePath(`/skills/${request.skill.slug}`);
    revalidatePath("/dashboard/moderation");
    return { requestId: request.id };
  });
}

/** The reviewer's "Run scanner": a fresh scan of the stored manifest. */
export async function rescanEntry(skillId: string): Promise<StaffActionResult<{ report: ScanReport; verifiable: boolean; scannedAt: string }>> {
  return run(async () => {
    const user = await requireUser();
    enforceRateLimit("write", `user:${user.id}`);
    return rescanForReview(user.id, skillId);
  });
}

export async function decideRequest(requestId: string, verdict: ModerationVerdict, note: string): Promise<StaffActionResult<{ status: ModerationStatus; securityLevel: SecurityLevel | null }>> {
  return run(async () => {
    const user = await requireUser();
    enforceRateLimit("write", `user:${user.id}`);
    if (verdict !== "approve" && verdict !== "reject") throw Object.assign(new Error("Unknown verdict"), { status: 400 });
    const request = await decideModeration(user.id, requestId, verdict, note);
    if (request.skill) revalidatePath(`/skills/${request.skill.slug}`);
    revalidatePath("/dashboard/moderation");
    revalidatePath(`/dashboard/moderation/${requestId}`);
    return { status: request.status, securityLevel: request.resultLevel };
  });
}

export async function changeUserRole(userId: string, role: string): Promise<StaffActionResult<DirectoryUser>> {
  return run(async () => {
    const user = await requireUser();
    enforceRateLimit("write", `user:${user.id}`);
    const updated = await setUserRole(user.id, userId, role);
    revalidatePath("/dashboard/admin/users");
    if (updated.handle) revalidatePath(`/u/${updated.handle}`);
    return updated;
  });
}

export async function changeDeveloper(userId: string, developer: boolean): Promise<StaffActionResult<DirectoryUser>> {
  return run(async () => {
    const user = await requireUser();
    enforceRateLimit("write", `user:${user.id}`);
    const updated = await setDeveloper(user.id, userId, Boolean(developer));
    revalidatePath("/dashboard/admin/users");
    if (updated.handle) revalidatePath(`/u/${updated.handle}`);
    return updated;
  });
}
