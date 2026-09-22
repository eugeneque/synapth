"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireUser, updateSession } from "@/cortex/auth";
import { enforceRateLimit, RateLimitError } from "@/cortex/rate-limit";
import { HandleTakenError, updateProfile, type AccountProfile, type ProfileUpdate } from "@/cortex/account";

export type SaveProfileResult = { ok: true; profile: AccountProfile } | { ok: false; error: string; field?: string };

/** Persists the settings form and refreshes the session JWT so the header picks up the new name/handle. */
export async function saveProfile(input: ProfileUpdate): Promise<SaveProfileResult> {
  const user = await requireUser();
  try {
    // Profile writes carry up to ~760 KB of image data; budget them per user.
    enforceRateLimit("write", `user:${user.id}`);
    const profile = await updateProfile(user.id, input);
    await updateSession({ user: { name: profile.name, handle: profile.handle } });
    revalidatePath("/dashboard");
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
