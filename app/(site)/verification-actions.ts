"use server";

/**
 * Server actions for account verification: the applicant files / withdraws a
 * request from settings; admins claim, decide, and grant or revoke the check
 * mark by hand. Rules and permission checks live in `cortex/verification.ts`.
 */

import { revalidatePath } from "next/cache";
import { requireUser } from "@/cortex/auth";
import { enforceRateLimit } from "@/cortex/rate-limit";
import { claimVerification, decideVerification, grantUserVerification, revokeUserVerification, submitVerification, withdrawVerification } from "@/cortex/verification";
import type { VerificationRequest } from "@/types/verification";

export type VerificationActionResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

async function run<T>(fn: () => Promise<T>): Promise<VerificationActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof Error && "status" in err) return { ok: false, error: err.message, code: "code" in err && typeof err.code === "string" ? err.code : undefined };
    throw err;
  }
}

function refresh(requestId?: string) {
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/admin/verification");
  if (requestId) revalidatePath(`/dashboard/admin/verification/${requestId}`);
}

export async function applyForVerification(phone: string): Promise<VerificationActionResult<VerificationRequest>> {
  return run(async () => {
    const user = await requireUser();
    enforceRateLimit("verificationRequest", `user:${user.id}`);
    const request = await submitVerification(user.id, phone);
    refresh();
    return request;
  });
}

export async function withdrawVerificationRequest(): Promise<VerificationActionResult<VerificationRequest>> {
  return run(async () => {
    const user = await requireUser();
    enforceRateLimit("write", `user:${user.id}`);
    const request = await withdrawVerification(user.id);
    refresh(request.id);
    return request;
  });
}

export async function claimVerificationRequest(id: string): Promise<VerificationActionResult<VerificationRequest>> {
  return run(async () => {
    const user = await requireUser();
    enforceRateLimit("write", `user:${user.id}`);
    const request = await claimVerification(user.id, id);
    refresh(id);
    return request;
  });
}

export async function decideVerificationRequest(id: string, verdict: "approve" | "reject", note: string): Promise<VerificationActionResult<VerificationRequest>> {
  return run(async () => {
    const user = await requireUser();
    enforceRateLimit("write", `user:${user.id}`);
    if (verdict !== "approve" && verdict !== "reject") throw Object.assign(new Error("Unknown verdict"), { status: 400 });
    const request = await decideVerification(user.id, id, verdict, note);
    refresh(id);
    revalidatePath(`/u/${request.user.handle}`);
    return request;
  });
}

export async function setUserCheckMark(userId: string, handle: string, verified: boolean, note: string): Promise<VerificationActionResult<{ verified: boolean }>> {
  return run(async () => {
    const user = await requireUser();
    enforceRateLimit("write", `user:${user.id}`);
    if (verified) await grantUserVerification(user.id, userId, note);
    else await revokeUserVerification(user.id, userId, note);
    refresh();
    revalidatePath("/dashboard/admin/users");
    revalidatePath(`/u/${handle}`);
    return { verified };
  });
}
