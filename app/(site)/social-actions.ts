"use server";

/**
 * Server actions for the social layer: impulses, friends, posts, comments, watches.
 * Thin orchestration only — the stores live in `cortex/social.ts`; after any
 * event that could unlock an achievement the badge engine re-evaluates the
 * user(s) involved.
 */

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { ZodError } from "zod";
import { auth, requireUser } from "@/cortex/auth";
import { clientIp, enforceRateLimit, type RateLimitName } from "@/cortex/rate-limit";
import { evaluateBadges } from "@/cortex/badges";
import { hasPermission } from "@/cortex/roles";
import { skillRepository } from "@/cortex/repository";
import { addComment, createPost, deleteComment, deletePost, discardPostImage, toggleImpulse, uploadPostImage, toggleReaction, toggleWatch, type ImpulseSummary, type WatchSummary } from "@/cortex/social";
import { toggleFollow } from "@/cortex/friends";
import { getFeed } from "@/cortex/feed";
import { FEED_TABS, type FeedPage, type FeedTab } from "@/types/feed";
import type { Comment, FriendState, Post, ReactionCount } from "@/types/social";

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

/** Send / accept / withdraw a friend request, or unfriend — whichever the current state implies. */
export async function toggleFriend(toId: string, handle: string): Promise<ActionResult<FriendState>> {
  return run(async () => {
    const user = await requireUserWithin();
    const state = await toggleFollow(user.id, toId);
    revalidatePath(`/u/${handle}`);
    revalidatePath("/search");
    return state;
  });
}

/** `imageIds` — photos uploaded with `uploadPostPhoto`, in carousel order. */
export async function publishPost(body: string, handle: string, imageIds: string[] = []): Promise<ActionResult<Post>> {
  return run(async () => {
    const user = await requireUserWithin();
    const post = await createPost(user.id, body, { imageIds });
    await evaluateBadges(user.id);
    revalidatePath(`/u/${handle}`);
    revalidatePath("/feed");
    return post;
  });
}

/** One photo per call (a full carousel would not fit the action body limit); returns the draft id to publish with. */
export async function uploadPostPhoto(dataUrl: string): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const user = await requireUserWithin("postImage");
    return uploadPostImage(user.id, dataUrl);
  });
}

/** Drops a draft photo removed from the composer before publishing. */
export async function discardPostPhoto(id: string): Promise<ActionResult<null>> {
  return run(async () => {
    const user = await requireUserWithin();
    await discardPostImage(user.id, String(id));
    return null;
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

/** Toggle the viewer's emoji on a post; returns the post's fresh tallies. */
export async function reactToPost(postId: string, emoji: string): Promise<ActionResult<ReactionCount[]>> {
  return run(async () => {
    const user = await requireUserWithin();
    return toggleReaction(user.id, postId, emoji);
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

/** Next page of `/feed`. Ranking is a full pass over recent posts, so it is metered like any read endpoint (by IP when signed out). */
export async function loadFeed(tab: FeedTab, offset: number, asOf: string): Promise<ActionResult<FeedPage>> {
  return run(async () => {
    const session = await auth();
    const viewerId = session?.user?.id ?? null;
    enforceRateLimit("read", viewerId ? `user:${viewerId}` : `ip:${clientIp(new Request("http://x", { headers: await headers() }))}`);
    const safeTab: FeedTab = FEED_TABS.includes(tab) ? tab : "for-you";
    const safeOffset = Number.isInteger(offset) && offset >= 0 && offset <= 10_000 ? offset : 0;
    return getFeed(viewerId, { tab: safeTab, offset: safeOffset, asOf: typeof asOf === "string" ? asOf : undefined });
  });
}
