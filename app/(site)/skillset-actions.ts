"use server";

/**
 * Server actions for skillsets: create / edit / delete (author), favorites
 * (any signed-in user), verification (staff) and description image uploads.
 * The rules live in `cortex/skillsets.ts`; this file authenticates, meters and
 * revalidates.
 */

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireUser } from "@/cortex/auth";
import { enforceRateLimit, type RateLimitName } from "@/cortex/rate-limit";
import { hasPermission } from "@/cortex/roles";
import { createSkillset, deleteSkillset, setSkillsetVerification, toggleFavorite, updateSkillset, uploadSkillsetImage, type FavoriteSummary } from "@/cortex/skillsets";

export type SkillsetActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(fn: () => Promise<T>): Promise<SkillsetActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      return { ok: false, error: issue ? `${issue.path.join(".") || "input"}: ${issue.message}` : "Invalid input" };
    }
    if (err instanceof Error && "status" in err) return { ok: false, error: err.message };
    throw err;
  }
}

async function requireUserWithin(limit: RateLimitName = "write") {
  const user = await requireUser();
  enforceRateLimit(limit, `user:${user.id}`);
  return user;
}

function revalidateSet(slug: string) {
  revalidatePath(`/skillsets/${slug}`);
  revalidatePath("/explore");
  revalidatePath("/dashboard/skillsets");
}

/** Creates a set (`id` null) or saves the author's edits; returns the slug to navigate to. */
export async function saveSkillset(id: string | null, input: unknown): Promise<SkillsetActionResult<{ slug: string }>> {
  return run(async () => {
    const user = await requireUserWithin(id ? "write" : "publish");
    const set = id ? await updateSkillset(user.id, id, input) : await createSkillset(user.id, input);
    revalidateSet(set.slug);
    return { slug: set.slug };
  });
}

export async function removeSkillset(id: string): Promise<SkillsetActionResult<null>> {
  return run(async () => {
    const user = await requireUserWithin();
    await deleteSkillset(user.id, id, { moderator: await hasPermission(user.id, "content.moderate") });
    revalidatePath("/explore");
    revalidatePath("/dashboard/skillsets");
    return null;
  });
}

export async function favoriteSkillset(id: string, slug: string): Promise<SkillsetActionResult<FavoriteSummary>> {
  return run(async () => {
    const user = await requireUserWithin();
    const summary = await toggleFavorite(user.id, id);
    revalidateSet(slug);
    return summary;
  });
}

export async function verifySkillset(id: string, verified: boolean): Promise<SkillsetActionResult<{ verified: boolean }>> {
  return run(async () => {
    const user = await requireUserWithin();
    const set = await setSkillsetVerification(user.id, id, verified);
    revalidateSet(set.slug);
    revalidatePath("/dashboard/moderation");
    return { verified: set.verified };
  });
}

/** Stores an image for a description; the editor inserts `![alt](url)` with the returned url. */
export async function uploadSkillsetDescriptionImage(dataUrl: string): Promise<SkillsetActionResult<{ url: string }>> {
  return run(async () => {
    const user = await requireUserWithin("skillsetImage");
    const { url } = await uploadSkillsetImage(user.id, dataUrl);
    return { url };
  });
}
