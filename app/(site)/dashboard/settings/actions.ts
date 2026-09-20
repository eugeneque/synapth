"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireUser, updateSession } from "@/cortex/auth";
import { HandleTakenError, updateProfile, type AccountProfile, type ProfileUpdate } from "@/cortex/account";

export type SaveProfileResult = { ok: true; profile: AccountProfile } | { ok: false; error: string; field?: string };

/** Persists the settings form and refreshes the session JWT so the header picks up the new name/handle. */
export async function saveProfile(input: ProfileUpdate): Promise<SaveProfileResult> {
  const user = await requireUser();
  try {
    const profile = await updateProfile(user.id, input);
    await updateSession({ user: { name: profile.name, handle: profile.handle } });
    revalidatePath("/dashboard");
    revalidatePath(`/u/${profile.handle}`);
    return { ok: true, profile };
  } catch (err) {
    if (err instanceof HandleTakenError) return { ok: false, error: err.message, field: "handle" };
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      return { ok: false, error: `${issue.path.join(".")}: ${issue.message}`, field: String(issue.path[0] ?? "") };
    }
    throw err;
  }
}
