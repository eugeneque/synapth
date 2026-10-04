"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireUser, updateSession } from "@/cortex/auth";
import { enforceRateLimit, RateLimitError } from "@/cortex/rate-limit";
import { HandleTakenError, updateProfile, type AccountProfile, type ProfileUpdate } from "@/cortex/account";
import { issueLinkKey, revokeDevice, revokeLinkKey } from "@/cortex/cli";
import type { CliLinkKeyInfo } from "@/types/cli";

export type SaveProfileResult = { ok: true; profile: AccountProfile } | { ok: false; error: string; field?: string };

/** Persists the settings form and refreshes the session JWT so the header picks up the new name/handle. */
export async function saveProfile(input: ProfileUpdate): Promise<SaveProfileResult> {
  const user = await requireUser();
  try {
    // Profile writes carry up to ~760 KB of image data; budget them per user.
    enforceRateLimit("write", `user:${user.id}`);
    const profile = await updateProfile(user.id, input);
    await updateSession({ user: { name: profile.name, handle: profile.handle } });
    revalidatePath("/dashboard/settings");
    revalidatePath(`/u/${profile.handle}`);
    return { ok: true, profile };
  } catch (err) {
    if (err instanceof RateLimitError) return { ok: false, error: `Too many changes, retry in ${err.result.retryAfter}s` };
    if (err instanceof HandleTakenError) return { ok: false, error: err.message, field: "handle" };
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      return { ok: false, error: `${issue.path.join(".")}: ${issue.message}`, field: String(issue.path[0] ?? "") };
    }
    throw err;
  }
}

export type CliKeyResult = { ok: true; key: string; info: CliLinkKeyInfo } | { ok: false; error: string };

/** Issues the CLI link key (retiring the previous one); the plain key comes back once. */
export async function issueCliKey(): Promise<CliKeyResult> {
  const user = await requireUser();
  try {
    enforceRateLimit("write", `user:${user.id}`);
  } catch (err) {
    if (err instanceof RateLimitError) return { ok: false, error: `Too many changes, retry in ${err.result.retryAfter}s` };
    throw err;
  }
  const { key, info } = await issueLinkKey(user.id);
  revalidatePath("/dashboard/settings");
  return { ok: true, key, info };
}

/** Retires the link key: no new machine can be linked until a new one is issued. Linked machines keep working. */
export async function revokeCliKey(): Promise<{ ok: boolean }> {
  const user = await requireUser();
  enforceRateLimit("write", `user:${user.id}`);
  await revokeLinkKey(user.id);
  revalidatePath("/dashboard/settings");
  return { ok: true };
}

/** Unlinks a machine: its device token stops working on the next request. */
export async function unlinkCliDevice(deviceId: string): Promise<{ ok: boolean }> {
  const user = await requireUser();
  enforceRateLimit("write", `user:${user.id}`);
  const ok = await revokeDevice(user.id, String(deviceId));
  revalidatePath("/dashboard/settings");
  return { ok };
}
