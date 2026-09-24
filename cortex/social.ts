/**
 * Cortex · Social layer
 *
 * Impulses (one developer fires an impulse at another — Synapth's like),
 * posts on the profile page, comments on posts and catalogue entries, and
 * skill watches. Every mutation that concerns someone else drops a row into
 * `cortex/notifications.ts`. Dual store: Prisma with `DATABASE_URL`, four
 * arrays on `globalThis` otherwise.
 *
 * Deliberately independent of `cortex/repository.ts` (which calls
 * `notifySkillUpdated` on version bumps), so callers hand over the skill
 * facts a notification needs instead of this module looking them up.
 */

import { z } from "zod";
import { prisma, hasDatabase } from "@/cortex/db";
import { getAuthorRefs } from "@/cortex/account";
import { seedComments, seedImpulses, seedPosts, seedReactions, seedWatches } from "@/cortex/seed";
import { hasRecent, notify, notifyMany } from "@/cortex/notifications";
import { followerIds } from "@/cortex/friends";
import { COMMENT_MAX_LENGTH, POST_MAX_LENGTH, POST_REACTIONS, type AuthorRef, type Comment, type CommentTargetKind, type Impulse, type Post, type PostReaction, type PostReactionEmoji, type ReactionCount, type SkillWatch } from "@/types/social";

export const postBodySchema = z.string().trim().min(1).max(POST_MAX_LENGTH);
export const commentBodySchema = z.string().trim().min(1).max(COMMENT_MAX_LENGTH);
export const reactionSchema = z.enum(POST_REACTIONS);

export class SelfImpulseError extends Error {
  status = 400 as const;
  constructor() {
    super("You cannot send an impulse to yourself");
    this.name = "SelfImpulseError";
  }
}

export class ForbiddenError extends Error {
  status = 403 as const;
  constructor(message = "Not allowed") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends Error {
  status = 404 as const;
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

// ---------------------------------------------------------------------------
// In-memory rows (author ids only; `AuthorRef`s are attached on read)
// ---------------------------------------------------------------------------

interface PostRow {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
}
interface CommentRow {
  id: string;
  authorId: string;
  targetKind: CommentTargetKind;
  targetId: string;
  body: string;
  createdAt: string;
}
interface MemoryStore {
  impulses: Impulse[];
  posts: PostRow[];
  comments: CommentRow[];
  watches: SkillWatch[];
  reactions: PostReaction[];
}

const g = globalThis as unknown as { __synapthSocial_v2?: MemoryStore };
const mem: MemoryStore = g.__synapthSocial_v2 ?? (g.__synapthSocial_v2 = { impulses: [...seedImpulses], posts: [...seedPosts], comments: [...seedComments], watches: [...seedWatches], reactions: [...seedReactions] });

const newId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
const now = () => new Date().toISOString();

const excerpt = (body: string) => (body.length > 140 ? `${body.slice(0, 137).trimEnd()}…` : body);

const unknownAuthor = (id: string): AuthorRef => ({ id, name: "Unknown", handle: id, image: null, occupation: null });

async function attachAuthors<T extends { authorId: string }>(list: T[]): Promise<Map<string, AuthorRef>> {
  return getAuthorRefs(list.map((r) => r.authorId));
}

// ---------------------------------------------------------------------------
// Impulses
// ---------------------------------------------------------------------------

export interface ImpulseSummary {
  total: number;
  /** Whether `viewerId` has an active impulse on this user. */
  active: boolean;
}

export async function impulseSummary(userId: string, viewerId?: string | null): Promise<ImpulseSummary> {
  if (!hasDatabase) {
    const mine = mem.impulses.filter((i) => i.toId === userId);
    return { total: mine.length, active: Boolean(viewerId) && mine.some((i) => i.fromId === viewerId) };
  }
  const [total, active] = await Promise.all([
    prisma.impulse.count({ where: { toId: userId } }),
    viewerId ? prisma.impulse.findUnique({ where: { fromId_toId: { fromId: viewerId, toId: userId } }, select: { fromId: true } }) : Promise.resolve(null),
  ]);
  return { total, active: Boolean(active) };
}

/** Re-firing within this window after a withdrawal does not ping the receiver again. */
const IMPULSE_NOTIFY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Fires or withdraws an impulse. Firing notifies the receiver with the running total (once per day per sender). */
export async function toggleImpulse(fromId: string, toId: string): Promise<ImpulseSummary> {
  if (fromId === toId) throw new SelfImpulseError();
  let activated = false;
  if (!hasDatabase) {
    const i = mem.impulses.findIndex((x) => x.fromId === fromId && x.toId === toId);
    if (i >= 0) mem.impulses.splice(i, 1);
    else {
      mem.impulses.push({ fromId, toId, createdAt: now() });
      activated = true;
    }
  } else {
    const existing = await prisma.impulse.findUnique({ where: { fromId_toId: { fromId, toId } } });
    if (existing) await prisma.impulse.delete({ where: { fromId_toId: { fromId, toId } } });
    else {
      await prisma.impulse.create({ data: { fromId, toId } });
      activated = true;
    }
  }
  const summary = await impulseSummary(toId, fromId);
  if (activated && !(await hasRecent(toId, "impulse", fromId, IMPULSE_NOTIFY_WINDOW_MS))) await notify({ userId: toId, kind: "impulse", actorId: fromId, subject: { kind: "impulse", total: summary.total } });
  return summary;
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

async function hydratePosts(list: PostRow[], viewerId?: string | null): Promise<Post[]> {
  const ids = list.map((p) => p.id);
  const [authors, counts, reactions] = await Promise.all([attachAuthors(list), commentCounts("post", ids), reactionCounts(ids, viewerId)]);
  return list.map((p) => ({ id: p.id, author: authors.get(p.authorId) ?? unknownAuthor(p.authorId), body: p.body, commentCount: counts.get(p.id) ?? 0, reactions: reactions.get(p.id) ?? [], createdAt: p.createdAt }));
}

/**
 * Publishes a post and tells everyone following the author: friends both ways,
 * plus people whose friend request the author has not answered yet. The
 * author's own unanswered requests do not subscribe the receiver.
 */
export async function createPost(authorId: string, rawBody: string): Promise<Post> {
  const body = postBodySchema.parse(rawBody);
  let row: PostRow;
  if (!hasDatabase) {
    row = { id: newId("post"), authorId, body, createdAt: now() };
    mem.posts.unshift(row);
  } else {
    const r = await prisma.post.create({ data: { authorId, body } });
    row = { id: r.id, authorId: r.authorId, body: r.body, createdAt: r.createdAt.toISOString() };
  }
  const followers = await followerIds(authorId);
  if (followers.length) await notifyMany(followers, { kind: "post.new", actorId: authorId, subject: { kind: "post.new", postId: row.id, excerpt: excerpt(body) } });
  return (await hydratePosts([row]))[0];
}

export async function getPost(id: string, viewerId?: string | null): Promise<Post | null> {
  if (!hasDatabase) {
    const row = mem.posts.find((p) => p.id === id);
    return row ? (await hydratePosts([row], viewerId))[0] : null;
  }
  const row = await prisma.post.findUnique({ where: { id } });
  return row ? (await hydratePosts([{ id: row.id, authorId: row.authorId, body: row.body, createdAt: row.createdAt.toISOString() }], viewerId))[0] : null;
}

/** Newest first. `viewerId` marks the reactions the viewer left. */
export async function listPosts(authorId: string, { limit = 20, viewerId = null }: { limit?: number; viewerId?: string | null } = {}): Promise<Post[]> {
  if (!hasDatabase) {
    return hydratePosts(mem.posts.filter((p) => p.authorId === authorId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit), viewerId);
  }
  const rows = await prisma.post.findMany({ where: { authorId }, orderBy: { createdAt: "desc" }, take: limit });
  return hydratePosts(rows.map((r) => ({ id: r.id, authorId: r.authorId, body: r.body, createdAt: r.createdAt.toISOString() })), viewerId);
}

/** Authors delete their own posts (`moderator` = holder of `content.moderate`: anyone's); the post's comments go with it. */
export async function deletePost(userId: string, postId: string, { moderator = false }: { moderator?: boolean } = {}): Promise<void> {
  if (!hasDatabase) {
    const i = mem.posts.findIndex((p) => p.id === postId);
    if (i < 0) throw new NotFoundError("Post not found");
    if (mem.posts[i].authorId !== userId && !moderator) throw new ForbiddenError();
    mem.posts.splice(i, 1);
    mem.comments = mem.comments.filter((c) => !(c.targetKind === "post" && c.targetId === postId));
    mem.reactions = mem.reactions.filter((r) => r.postId !== postId);
    return;
  }
  const row = await prisma.post.findUnique({ where: { id: postId }, select: { authorId: true } });
  if (!row) throw new NotFoundError("Post not found");
  if (row.authorId !== userId && !moderator) throw new ForbiddenError();
  await prisma.$transaction([prisma.comment.deleteMany({ where: { targetKind: "post", targetId: postId } }), prisma.post.delete({ where: { id: postId } })]);
}

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------

/** Per post: emojis with at least one reaction, in `POST_REACTIONS` order. */
export async function reactionCounts(postIds: string[], viewerId?: string | null): Promise<Map<string, ReactionCount[]>> {
  const out = new Map<string, ReactionCount[]>();
  if (!postIds.length) return out;
  let rows: { postId: string; userId: string; emoji: string }[];
  if (!hasDatabase) rows = mem.reactions.filter((r) => postIds.includes(r.postId));
  else rows = await prisma.postReaction.findMany({ where: { postId: { in: postIds } }, select: { postId: true, userId: true, emoji: true } });
  for (const id of postIds) {
    const mine = rows.filter((r) => r.postId === id);
    const list = POST_REACTIONS.map((emoji) => {
      const hits = mine.filter((r) => r.emoji === emoji);
      return { emoji, count: hits.length, mine: Boolean(viewerId) && hits.some((r) => r.userId === viewerId) };
    }).filter((r) => r.count > 0);
    if (list.length) out.set(id, list);
  }
  return out;
}

/** Adds or removes the user's `emoji` on a post and returns the post's fresh tallies. No notification: reactions are too cheap to ping for. */
export async function toggleReaction(userId: string, postId: string, rawEmoji: string): Promise<ReactionCount[]> {
  const emoji: PostReactionEmoji = reactionSchema.parse(rawEmoji);
  if (!hasDatabase) {
    if (!mem.posts.some((p) => p.id === postId)) throw new NotFoundError("Post not found");
    const i = mem.reactions.findIndex((r) => r.postId === postId && r.userId === userId && r.emoji === emoji);
    if (i >= 0) mem.reactions.splice(i, 1);
    else mem.reactions.push({ postId, userId, emoji, createdAt: now() });
  } else {
    if (!(await prisma.post.findUnique({ where: { id: postId }, select: { id: true } }))) throw new NotFoundError("Post not found");
    const key = { postId_userId_emoji: { postId, userId, emoji } };
    if (await prisma.postReaction.findUnique({ where: key, select: { postId: true } })) await prisma.postReaction.delete({ where: key });
    else await prisma.postReaction.create({ data: { postId, userId, emoji } });
  }
  return (await reactionCounts([postId], userId)).get(postId) ?? [];
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

/** Where a comment lands. Skill targets carry what the owner's notification needs. */
export type CommentTargetRef = { kind: "post"; id: string } | { kind: "skill"; id: string; ownerId: string; slug: string; name: string };

async function hydrateComments(list: CommentRow[]): Promise<Comment[]> {
  const authors = await attachAuthors(list);
  return list.map((c) => ({ id: c.id, author: authors.get(c.authorId) ?? unknownAuthor(c.authorId), targetKind: c.targetKind, targetId: c.targetId, body: c.body, createdAt: c.createdAt }));
}

export async function addComment(authorId: string, target: CommentTargetRef, rawBody: string): Promise<Comment> {
  const body = commentBodySchema.parse(rawBody);
  let ownerId: string;
  if (target.kind === "post") {
    const post = await getPost(target.id);
    if (!post) throw new NotFoundError("Post not found");
    ownerId = post.author.id;
  } else ownerId = target.ownerId;

  let row: CommentRow;
  if (!hasDatabase) {
    row = { id: newId("cmt"), authorId, targetKind: target.kind, targetId: target.id, body, createdAt: now() };
    mem.comments.push(row);
  } else {
    const r = await prisma.comment.create({ data: { authorId, targetKind: target.kind, targetId: target.id, body } });
    row = { id: r.id, authorId: r.authorId, targetKind: r.targetKind, targetId: r.targetId, body: r.body, createdAt: r.createdAt.toISOString() };
  }

  if (target.kind === "post") await notify({ userId: ownerId, kind: "comment.post", actorId: authorId, subject: { kind: "comment.post", postId: target.id, commentId: row.id, excerpt: excerpt(body) } });
  else await notify({ userId: ownerId, kind: "comment.skill", actorId: authorId, subject: { kind: "comment.skill", skillId: target.id, slug: target.slug, skillName: target.name, commentId: row.id, excerpt: excerpt(body) } });
  return (await hydrateComments([row]))[0];
}

/** Oldest first, like a thread. */
export async function listComments(kind: CommentTargetKind, targetId: string, limit = 100): Promise<Comment[]> {
  if (!hasDatabase) return hydrateComments(mem.comments.filter((c) => c.targetKind === kind && c.targetId === targetId).slice(-limit));
  const rows = await prisma.comment.findMany({ where: { targetKind: kind, targetId }, orderBy: { createdAt: "asc" }, take: limit });
  return hydrateComments(rows.map((r) => ({ id: r.id, authorId: r.authorId, targetKind: r.targetKind, targetId: r.targetId, body: r.body, createdAt: r.createdAt.toISOString() })));
}

export async function commentCounts(kind: CommentTargetKind, targetIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!targetIds.length) return out;
  if (!hasDatabase) {
    for (const c of mem.comments) if (c.targetKind === kind && targetIds.includes(c.targetId)) out.set(c.targetId, (out.get(c.targetId) ?? 0) + 1);
    return out;
  }
  const grouped = await prisma.comment.groupBy({ by: ["targetId"], where: { targetKind: kind, targetId: { in: targetIds } }, _count: { _all: true } });
  for (const row of grouped) out.set(row.targetId, row._count._all);
  return out;
}

/** Comment authors may delete their own comments; `moderator` (holder of `content.moderate`) deletes any. */
export async function deleteComment(userId: string, commentId: string, { moderator = false }: { moderator?: boolean } = {}): Promise<void> {
  if (!hasDatabase) {
    const i = mem.comments.findIndex((c) => c.id === commentId);
    if (i < 0) throw new NotFoundError("Comment not found");
    if (mem.comments[i].authorId !== userId && !moderator) throw new ForbiddenError();
    mem.comments.splice(i, 1);
    return;
  }
  const row = await prisma.comment.findUnique({ where: { id: commentId }, select: { authorId: true } });
  if (!row) throw new NotFoundError("Comment not found");
  if (row.authorId !== userId && !moderator) throw new ForbiddenError();
  await prisma.comment.delete({ where: { id: commentId } });
}

// ---------------------------------------------------------------------------
// Watches ("Отслеживаемое")
// ---------------------------------------------------------------------------

export interface WatchSummary {
  watchers: number;
  watching: boolean;
}

export async function watchSummary(skillId: string, viewerId?: string | null): Promise<WatchSummary> {
  if (!hasDatabase) {
    const list = mem.watches.filter((w) => w.skillId === skillId);
    return { watchers: list.length, watching: Boolean(viewerId) && list.some((w) => w.userId === viewerId) };
  }
  const [watchers, mine] = await Promise.all([
    prisma.skillWatch.count({ where: { skillId } }),
    viewerId ? prisma.skillWatch.findUnique({ where: { userId_skillId: { userId: viewerId, skillId } }, select: { userId: true } }) : Promise.resolve(null),
  ]);
  return { watchers, watching: Boolean(mine) };
}

export async function toggleWatch(userId: string, skillId: string): Promise<WatchSummary> {
  if (!hasDatabase) {
    const i = mem.watches.findIndex((w) => w.userId === userId && w.skillId === skillId);
    if (i >= 0) mem.watches.splice(i, 1);
    else mem.watches.push({ userId, skillId, createdAt: now() });
  } else {
    const existing = await prisma.skillWatch.findUnique({ where: { userId_skillId: { userId, skillId } } });
    if (existing) await prisma.skillWatch.delete({ where: { userId_skillId: { userId, skillId } } });
    else await prisma.skillWatch.create({ data: { userId, skillId } });
  }
  return watchSummary(skillId, userId);
}

/** Skill ids the user watches, most recently watched first. */
export async function listWatched(userId: string): Promise<SkillWatch[]> {
  if (!hasDatabase) return mem.watches.filter((w) => w.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const rows = await prisma.skillWatch.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  return rows.map((r) => ({ userId: r.userId, skillId: r.skillId, createdAt: r.createdAt.toISOString() }));
}

export async function watchersOf(skillId: string): Promise<string[]> {
  if (!hasDatabase) return mem.watches.filter((w) => w.skillId === skillId).map((w) => w.userId);
  return (await prisma.skillWatch.findMany({ where: { skillId }, select: { userId: true } })).map((r) => r.userId);
}

export interface SkillRelease {
  id: string;
  slug: string;
  name: string;
  version: string;
  previousVersion: string | null;
  verified: boolean;
  authorId: string;
}

/** Called by the repository when a stored skill's version changes: every watcher except the author hears about it. */
export async function notifySkillUpdated(release: SkillRelease): Promise<number> {
  const watchers = (await watchersOf(release.id)).filter((id) => id !== release.authorId);
  if (!watchers.length) return 0;
  return notifyMany(watchers, {
    kind: "skill.updated",
    actorId: null,
    subject: { kind: "skill.updated", skillId: release.id, slug: release.slug, skillName: release.name, version: release.version, previousVersion: release.previousVersion, verified: release.verified },
  });
}

// ---------------------------------------------------------------------------
// Signals for the badge engine
// ---------------------------------------------------------------------------

export async function socialSignals(userId: string): Promise<{ posts: number; comments: number; impulsesReceived: number; watching: number }> {
  if (!hasDatabase) {
    return {
      posts: mem.posts.filter((p) => p.authorId === userId).length,
      comments: mem.comments.filter((c) => c.authorId === userId).length,
      impulsesReceived: mem.impulses.filter((i) => i.toId === userId).length,
      watching: mem.watches.filter((w) => w.userId === userId).length,
    };
  }
  const [posts, comments, impulsesReceived, watching] = await Promise.all([
    prisma.post.count({ where: { authorId: userId } }),
    prisma.comment.count({ where: { authorId: userId } }),
    prisma.impulse.count({ where: { toId: userId } }),
    prisma.skillWatch.count({ where: { userId } }),
  ]);
  return { posts, comments, impulsesReceived, watching };
}

/** Test helper for the in-memory store. */
export function resetSocialForTests() {
  mem.impulses.length = 0;
  mem.posts.length = 0;
  mem.comments.length = 0;
  mem.watches.length = 0;
  mem.reactions.length = 0;
}
