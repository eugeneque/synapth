"use server";

/**
 * Server actions for the social layer: impulses, posts, comments, watches.
 * Thin orchestration only — the stores live in `cortex/social.ts`; after any
 * event that could unlock an achievement the badge engine re-evaluates the
 * user(s) involved.
 */

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireUser } from "@/cortex/auth";
import { enforceRateLimit, type RateLimitName } from "@/cortex/rate-limit";
import { evaluateBadges } from "@/cortex/badges";
import { hasPermission } from "@/cortex/roles";
import { skillRepository } from "@/cortex/repository";
import { addComment, createPost, deleteComment, deletePost, toggleImpulse, toggleWatch, type ImpulseSummary, type WatchSummary } from "@/cortex/social";
import type { Comment, Post } from "@/types/social";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof ZodError) return { ok: false, error: err.issues[0]?.message ?? "Invalid input" };
    if (err instanceof Error && "status" in err) return { ok: false, error: err.message };
    throw err;
  }
}

/**
 * Server actions are a public POST endpoint like any other, so the write
 * budget applies here too — otherwise posts, comments and impulse toggles are
 * an unmetered spam and notification-flood channel.
 */
async function requireUserWithin(limit: RateLimitName = "write") {
  const user = await requireUser();
  enforceRateLimit(limit, `user:${user.id}`);
  return user;
}

/** Fire / withdraw an impulse at the developer behind `handle`. */
export async function sendImpulse(toId: string, handle: string): Promise<ActionResult<ImpulseSummary>> {
  return run(async () => {
    const user = await requireUserWithin();
    const summary = await toggleImpulse(user.id, toId);
    if (summary.active) await evaluateBadges(toId);
    revalidatePath(`/u/${handle}`);
    return summary;
  });
}

export async function publishPost(body: string, handle: string): Promise<ActionResult<Post>> {
  return run(async () => {
    const user = await requireUserWithin();
    const post = await createPost(user.id, body);
    await evaluateBadges(user.id);
    revalidatePath(`/u/${handle}`);
    return post;
  });
}

export async function removePost(postId: string, handle: string): Promise<ActionResult<null>> {
  return run(async () => {
    const user = await requireUserWithin();
    await deletePost(user.id, postId, { moderator: await hasPermission(user.id, "content.moderate") });
    revalidatePath(`/u/${handle}`);
    return null;
  });
}

export async function commentOnPost(postId: string, body: string): Promise<ActionResult<Comment>> {
  return run(async () => {
    const user = await requireUserWithin();
    const comment = await addComment(user.id, { kind: "post", id: postId }, body);
    await evaluateBadges(user.id);
    return comment;
  });
}

export async function commentOnSkill(skillId: string, body: string): Promise<ActionResult<Comment>> {
  return run(async () => {
    const user = await requireUserWithin();
    const skill = await skillRepository.byId(skillId);
    if (!skill) throw Object.assign(new Error("Skill not found"), { status: 404 });
    const comment = await addComment(user.id, { kind: "skill", id: skill.id, ownerId: skill.authorId, slug: skill.slug, name: skill.name }, body);
    await evaluateBadges(user.id);
    revalidatePath(`/skills/${skill.slug}`);
    return comment;
  });
}

export async function removeComment(commentId: string): Promise<ActionResult<null>> {
  return run(async () => {
    const user = await requireUserWithin();
    await deleteComment(user.id, commentId, { moderator: await hasPermission(user.id, "content.moderate") });
    return null;
  });
}

/** Add / remove a skill from the user's "watched" list. */
export async function watchSkill(skillId: string, slug: string): Promise<ActionResult<WatchSummary>> {
  return run(async () => {
    const user = await requireUserWithin();
    const summary = await toggleWatch(user.id, skillId);
    if (summary.watching) await evaluateBadges(user.id);
    revalidatePath(`/skills/${slug}`);
    revalidatePath("/dashboard/notifications");
    return summary;
  });
}
