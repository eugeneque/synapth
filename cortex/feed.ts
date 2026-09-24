/**
 * Cortex · Feed
 *
 * Everyone's posts in one stream, two ways:
 *  - `following` — posts of people the viewer follows (friends and pending
 *    requests) plus their own, newest first;
 *  - `for-you` — every recent post, ranked by a deliberately simple,
 *    explainable model:
 *
 *      score = (1 + affinity) × quality × freshness × seen
 *
 *    affinity  — how close the viewer is to the post: a sum of weighted
 *                signals (friendship, follows, mentions, impulses, past
 *                engagement with the author, friends-of-friends, friends who
 *                engaged with this post, and "people who react like you
 *                reacted here" — cosine similarity over co-reactions);
 *    quality   — 1 + log2(1 + reactions + 2·comments), so a pile-on does not
 *                bury everything else;
 *    freshness — exponential decay with a `HALF_LIFE_HOURS` half-life;
 *    seen      — posts the viewer already reacted to or commented on sink.
 *
 *    The ranked list is then re-ordered greedily so one author cannot fill a
 *    screen (every further post by the same author is damped by
 *    `AUTHOR_REPEAT_DAMPING`). An anonymous reader has no affinity at all and
 *    gets popularity × freshness.
 *
 * Candidates are posts from the last `WINDOW_DAYS` (at most `MAX_CANDIDATES`),
 * scored in memory. Pages are offsets into that ranking, pinned to an `asOf`
 * timestamp so paging does not reshuffle under the reader.
 */

import { getAuthorRef, getAuthorRefs } from "@/cortex/account";
import { followGraph, type FollowGraph } from "@/cortex/friends";
import { engagementByAuthor, feedCandidates, impulseTargets, listComments, postsByIds, type FeedCandidate } from "@/cortex/social";
import { extractMentions } from "@/lib/post-body";
import { FEED_PAGE_SIZE, type FeedItem, type FeedPage, type FeedReason, type FeedSuggestion, type FeedTab } from "@/types/feed";
import type { Comment } from "@/types/social";

export const WINDOW_DAYS = 30;
export const MAX_CANDIDATES = 400;
export const HALF_LIFE_HOURS = 36;
export const AUTHOR_REPEAT_DAMPING = 0.6;
/** Multiplier for posts the viewer already engaged with. */
export const SEEN_PENALTY = 0.5;

/** Affinity weights; each signal's contribution is also what picks the card's "why" chip. */
export const FEED_WEIGHTS = {
  self: 0.6,
  mention: 4,
  friend: 3,
  following: 2,
  follower: 0.4,
  impulse: 1.2,
  /** × log2(1 + past reactions/comments on this author's posts). */
  engaged: 0.8,
  /** × friends following the author (capped at 3). */
  network: 0.5,
  /** × friends/followed people who reacted to or commented on this post (capped at 4). */
  friendsEngaged: 0.7,
  /** × summed cosine similarity of the post's reactors to the viewer (capped at 1.5). */
  similar: 2,
} as const satisfies Partial<Record<FeedReason, number>>;

/** Everything personal the ranker knows about the viewer. Empty for an anonymous reader. */
export interface FeedContext {
  viewerId: string | null;
  viewerHandle: string | null;
  graph: Pick<FollowGraph, "friends" | "following" | "followers" | "secondDegree">;
  impulses: string[];
  /** Past engagement per author (`engagementByAuthor`). */
  engagement: Map<string, number>;
}

export const anonymousContext = (): FeedContext => ({ viewerId: null, viewerHandle: null, graph: { friends: [], following: [], followers: [], secondDegree: new Map() }, impulses: [], engagement: new Map() });

async function viewerContext(viewerId: string | null): Promise<FeedContext> {
  if (!viewerId) return anonymousContext();
  const [me, graph, impulses, engagement] = await Promise.all([getAuthorRef(viewerId), followGraph(viewerId), impulseTargets(viewerId), engagementByAuthor(viewerId)]);
  return { viewerId, viewerHandle: me?.handle ?? null, graph, impulses, engagement };
}

export interface ScoredCandidate {
  id: string;
  authorId: string;
  score: number;
  reason: FeedReason;
}

/**
 * Cosine similarity between the viewer and every other reactor, over the
 * candidate window: |shared posts| / √(|viewer's| · |theirs|).
 */
function reactorSimilarity(candidates: FeedCandidate[], viewerId: string): Map<string, number> {
  const byUser = new Map<string, Set<string>>();
  for (const c of candidates) for (const u of new Set([...c.reactors, ...c.commenters])) (byUser.get(u) ?? byUser.set(u, new Set()).get(u)!).add(c.id);
  const mine = byUser.get(viewerId);
  const out = new Map<string, number>();
  if (!mine?.size) return out;
  for (const [user, posts] of byUser) {
    if (user === viewerId) continue;
    let shared = 0;
    for (const id of posts) if (mine.has(id)) shared++;
    if (shared) out.set(user, shared / Math.sqrt(mine.size * posts.size));
  }
  return out;
}

/** Pure scoring step: exported for tests. Returns candidates best first, author runs already broken up. */
export function rankCandidates(candidates: FeedCandidate[], ctx: FeedContext, now: Date = new Date()): ScoredCandidate[] {
  const w = FEED_WEIGHTS;
  const friends = new Set(ctx.graph.friends);
  const following = new Set(ctx.graph.following);
  const followers = new Set(ctx.graph.followers);
  const circle = new Set([...friends, ...following]);
  const impulses = new Set(ctx.impulses);
  const similarity = ctx.viewerId ? reactorSimilarity(candidates, ctx.viewerId) : new Map<string, number>();
  const handle = ctx.viewerHandle?.toLowerCase() ?? null;

  const scored = candidates.map((c) => {
    const signals: Partial<Record<FeedReason, number>> = {};
    const a = c.authorId;
    if (ctx.viewerId) {
      if (a === ctx.viewerId) signals.self = w.self;
      else {
        if (friends.has(a)) signals.friend = w.friend;
        else if (following.has(a)) signals.following = w.following;
        else if (followers.has(a)) signals.follower = w.follower;
        if (impulses.has(a)) signals.impulse = w.impulse;
        const past = ctx.engagement.get(a) ?? 0;
        if (past) signals.engaged = w.engaged * Math.log2(1 + past);
        const mutual = ctx.graph.secondDegree.get(a) ?? 0;
        if (mutual) signals.network = w.network * Math.min(3, mutual);
        if (handle && extractMentions(c.body).includes(handle)) signals.mention = w.mention;
      }
      const engagedFriends = new Set([...c.reactors, ...c.commenters].filter((u) => circle.has(u) && u !== a)).size;
      if (engagedFriends) signals.friendsEngaged = w.friendsEngaged * Math.min(4, engagedFriends);
      const sim = c.reactors.reduce((sum, u) => sum + (similarity.get(u) ?? 0), 0);
      if (sim) signals.similar = w.similar * Math.min(1.5, sim);
    }

    const affinity = Object.values(signals).reduce((s, v) => s + v, 0);
    const engagement = c.reactors.length + 2 * c.commenters.length;
    const quality = 1 + Math.log2(1 + engagement);
    const ageHours = Math.max(0, (now.getTime() - new Date(c.createdAt).getTime()) / 3_600_000);
    const freshness = 0.5 ** (ageHours / HALF_LIFE_HOURS);
    const seen = ctx.viewerId && a !== ctx.viewerId && (c.reactors.includes(ctx.viewerId) || c.commenters.includes(ctx.viewerId)) ? SEEN_PENALTY : 1;

    const top = (Object.entries(signals) as [FeedReason, number][]).sort((x, y) => y[1] - x[1])[0];
    const reason: FeedReason = top?.[0] ?? (engagement >= 3 ? "popular" : "fresh");
    return { id: c.id, authorId: a, createdAt: c.createdAt, score: (1 + affinity) * quality * freshness * seen, reason };
  });

  // Greedy diversity pass: pick the best remaining post, damping authors already on the list.
  const shown = new Map<string, number>();
  const out: ScoredCandidate[] = [];
  const pool = [...scored];
  while (pool.length) {
    let best = 0;
    let bestScore = -1;
    for (let i = 0; i < pool.length; i++) {
      const s = pool[i].score * AUTHOR_REPEAT_DAMPING ** (shown.get(pool[i].authorId) ?? 0);
      if (s > bestScore || (s === bestScore && pool[i].createdAt > pool[best].createdAt)) {
        best = i;
        bestScore = s;
      }
    }
    const [pick] = pool.splice(best, 1);
    shown.set(pick.authorId, (shown.get(pick.authorId) ?? 0) + 1);
    out.push({ id: pick.id, authorId: pick.authorId, score: bestScore, reason: pick.reason });
  }
  return out;
}

/** Chronological "Following" reasons: the relation to the author. */
function relationReason(authorId: string, ctx: FeedContext): FeedReason {
  if (authorId === ctx.viewerId) return "self";
  return ctx.graph.friends.includes(authorId) ? "friend" : "following";
}

/**
 * One page of the viewer's feed. The `following` tab needs a signed-in
 * viewer; an anonymous one gets an empty page. `asOf` pins the candidate set
 * and the clock across pages.
 */
export async function getFeed(viewerId: string | null, { tab = "for-you", offset = 0, limit = FEED_PAGE_SIZE, asOf }: { tab?: FeedTab; offset?: number; limit?: number; asOf?: string | Date } = {}): Promise<FeedPage> {
  const parsed = asOf ? new Date(asOf) : new Date();
  const now = Number.isNaN(parsed.getTime()) || parsed.getTime() > Date.now() ? new Date() : parsed;
  const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 3_600_000);
  const empty: FeedPage = { items: [], comments: {}, nextOffset: null, asOf: now.toISOString() };
  const ctx = await viewerContext(viewerId);

  let ranked: ScoredCandidate[];
  if (tab === "following") {
    if (!viewerId) return empty;
    const authorIds = [viewerId, ...ctx.graph.friends, ...ctx.graph.following];
    const rows = await feedCandidates({ since: new Date(0), until: now, limit: offset + limit + 1, authorIds });
    ranked = rows.map((c) => ({ id: c.id, authorId: c.authorId, score: 0, reason: relationReason(c.authorId, ctx) }));
  } else {
    ranked = rankCandidates(await feedCandidates({ since, until: now, limit: MAX_CANDIDATES }), ctx, now);
  }

  const slice = ranked.slice(offset, offset + limit);
  const posts = await postsByIds(
    slice.map((r) => r.id),
    viewerId,
  );
  const byId = new Map(posts.map((p) => [p.id, p]));
  const items: FeedItem[] = slice.flatMap((r) => {
    const post = byId.get(r.id);
    return post ? [{ post, reason: r.reason, score: Math.round(r.score * 1000) / 1000 }] : [];
  });
  const comments: Record<string, Comment[]> = Object.fromEntries(await Promise.all(items.map(async ({ post }) => [post.id, post.commentCount ? await listComments("post", post.id) : []] as const)));
  return { items, comments, nextOffset: offset + limit < ranked.length ? offset + limit : null, asOf: now.toISOString() };
}

/**
 * "People to follow": friends-of-friends first (by how many friends follow
 * them), then the authors whose recent posts drew the most engagement.
 * Anyone the viewer already relates to is left out.
 */
export async function feedSuggestions(viewerId: string, limit = 5): Promise<FeedSuggestion[]> {
  const now = new Date();
  const [graph, recent] = await Promise.all([followGraph(viewerId), feedCandidates({ since: new Date(now.getTime() - WINDOW_DAYS * 24 * 3_600_000), until: now, limit: MAX_CANDIDATES })]);
  const known = new Set([viewerId, ...graph.friends, ...graph.following, ...graph.followers]);
  const popularity = new Map<string, number>();
  for (const c of recent) if (!known.has(c.authorId)) popularity.set(c.authorId, (popularity.get(c.authorId) ?? 0) + 1 + c.reactors.length + 2 * c.commenters.length);

  const ranked = [...graph.secondDegree.entries()].sort((a, b) => b[1] - a[1] || (popularity.get(b[0]) ?? 0) - (popularity.get(a[0]) ?? 0)).map(([id, mutual]) => ({ id, mutual }));
  for (const [id] of [...popularity.entries()].sort((a, b) => b[1] - a[1])) if (!graph.secondDegree.has(id)) ranked.push({ id, mutual: 0 });

  const top = ranked.slice(0, limit * 2);
  const refs = await getAuthorRefs(top.map((r) => r.id));
  return top.flatMap((r) => {
    const ref = refs.get(r.id);
    return ref ? [{ ...ref, mutual: r.mutual }] : [];
  }).slice(0, limit);
}
