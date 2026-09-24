/**
 * Cortex · Friends
 *
 * Friendship is a mutual follow. Sending a friend request writes one `Follow`
 * row (from → to); answering it writes the reverse row, and from then on the
 * two are friends. A request nobody answered stays a one-way follow: the
 * sender already hears about the receiver's new posts, the receiver does not
 * hear about the sender's. Withdrawing deletes only the viewer's own row, so
 * unfriending leaves the other side's follow in place (it becomes their
 * pending request again).
 *
 * Dual store like the rest of Cortex: Prisma with `DATABASE_URL`, an array on
 * `globalThis` otherwise.
 */

import { prisma, hasDatabase } from "@/cortex/db";
import { getAuthorRefs, searchProfiles } from "@/cortex/account";
import { seedFollows } from "@/cortex/seed";
import { hasRecent, notify } from "@/cortex/notifications";
import type { AuthorRef, Follow, FriendCounts, FriendState, PersonSummary } from "@/types/social";

export class SelfFollowError extends Error {
  status = 400 as const;
  constructor() {
    super("You cannot add yourself as a friend");
    this.name = "SelfFollowError";
  }
}

const g = globalThis as unknown as { __synapthFollows_v1?: Follow[] };
const mem: Follow[] = g.__synapthFollows_v1 ?? (g.__synapthFollows_v1 = [...seedFollows]);

/** Re-sending a request within this window after withdrawing it does not ping the receiver again. */
const FOLLOW_NOTIFY_WINDOW_MS = 24 * 60 * 60 * 1000;

async function hasFollow(fromId: string, toId: string): Promise<boolean> {
  if (!hasDatabase) return mem.some((f) => f.fromId === fromId && f.toId === toId);
  return Boolean(await prisma.follow.findUnique({ where: { fromId_toId: { fromId, toId } }, select: { fromId: true } }));
}

/** How `viewerId` relates to `userId`. */
export async function friendState(userId: string, viewerId: string | null | undefined): Promise<FriendState> {
  if (!viewerId) return "anonymous";
  if (viewerId === userId) return "self";
  const [out, back] = await Promise.all([hasFollow(viewerId, userId), hasFollow(userId, viewerId)]);
  return out && back ? "friends" : out ? "requested" : back ? "incoming" : "none";
}

/**
 * The single friend control: sends / accepts a request when the viewer has no
 * row yet, withdraws / unfriends when they do. The receiver is notified once
 * per day per sender; an accepted request tells the original sender.
 */
export async function toggleFollow(fromId: string, toId: string): Promise<FriendState> {
  if (fromId === toId) throw new SelfFollowError();
  let added = false;
  if (!hasDatabase) {
    const i = mem.findIndex((f) => f.fromId === fromId && f.toId === toId);
    if (i >= 0) mem.splice(i, 1);
    else {
      mem.push({ fromId, toId, createdAt: new Date().toISOString() });
      added = true;
    }
  } else {
    const existing = await prisma.follow.findUnique({ where: { fromId_toId: { fromId, toId } } });
    if (existing) await prisma.follow.delete({ where: { fromId_toId: { fromId, toId } } });
    else {
      await prisma.follow.create({ data: { fromId, toId } });
      added = true;
    }
  }
  const state = await friendState(toId, fromId);
  if (added) {
    const kind = state === "friends" ? "friend.accepted" : "friend.request";
    if (!(await hasRecent(toId, kind, fromId, FOLLOW_NOTIFY_WINDOW_MS))) await notify({ userId: toId, kind, actorId: fromId, subject: { kind } });
  }
  return state;
}

async function outgoingIds(userId: string): Promise<string[]> {
  if (!hasDatabase) return mem.filter((f) => f.fromId === userId).map((f) => f.toId);
  return (await prisma.follow.findMany({ where: { fromId: userId }, select: { toId: true } })).map((r) => r.toId);
}

/** Everyone who follows `userId` — friends and pending requesters. They hear about new posts. */
export async function followerIds(userId: string): Promise<string[]> {
  if (!hasDatabase) return mem.filter((f) => f.toId === userId).map((f) => f.fromId);
  return (await prisma.follow.findMany({ where: { toId: userId }, select: { fromId: true } })).map((r) => r.fromId);
}

interface Split {
  friends: string[];
  incoming: string[];
  outgoing: string[];
}

/** Newest relation first in every bucket. */
async function split(userId: string): Promise<Split> {
  let rows: Follow[];
  if (!hasDatabase) rows = mem.filter((f) => f.fromId === userId || f.toId === userId);
  else rows = (await prisma.follow.findMany({ where: { OR: [{ fromId: userId }, { toId: userId }] }, orderBy: { createdAt: "desc" } })).map((r) => ({ fromId: r.fromId, toId: r.toId, createdAt: r.createdAt.toISOString() }));
  rows = [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const out = new Set(rows.filter((f) => f.fromId === userId).map((f) => f.toId));
  const inc = new Set(rows.filter((f) => f.toId === userId).map((f) => f.fromId));
  const seen = new Set<string>();
  const res: Split = { friends: [], incoming: [], outgoing: [] };
  for (const f of rows) {
    const other = f.fromId === userId ? f.toId : f.fromId;
    if (seen.has(other)) continue;
    seen.add(other);
    if (out.has(other) && inc.has(other)) res.friends.push(other);
    else if (inc.has(other)) res.incoming.push(other);
    else res.outgoing.push(other);
  }
  return res;
}

export async function friendCounts(userId: string): Promise<FriendCounts> {
  const s = await split(userId);
  return { friends: s.friends.length, incoming: s.incoming.length, outgoing: s.outgoing.length };
}

function ordered(ids: string[], refs: Map<string, AuthorRef>): AuthorRef[] {
  return ids.map((id) => refs.get(id)).filter((r): r is AuthorRef => Boolean(r));
}

/** Public: anyone can see a user's friends. */
export async function listFriends(userId: string): Promise<AuthorRef[]> {
  const { friends } = await split(userId);
  return ordered(friends, await getAuthorRefs(friends));
}

/** Owner-only views: requests waiting for an answer and requests the user sent. */
export async function listRequests(userId: string): Promise<{ incoming: AuthorRef[]; outgoing: AuthorRef[] }> {
  const { incoming, outgoing } = await split(userId);
  const refs = await getAuthorRefs([...incoming, ...outgoing]);
  return { incoming: ordered(incoming, refs), outgoing: ordered(outgoing, refs) };
}

/** The viewer's relation to each of `ids` (friend lists on someone else's profile), from two queries. */
export async function friendStates(ids: string[], viewerId: string | null | undefined): Promise<Record<string, FriendState>> {
  if (!viewerId) return Object.fromEntries(ids.map((id) => [id, "anonymous" as const]));
  const [mine, theirs] = await Promise.all([outgoingIds(viewerId), followerIds(viewerId)]);
  return Object.fromEntries(
    ids.map((id) => {
      const out = mine.includes(id);
      const back = theirs.includes(id);
      const state: FriendState = id === viewerId ? "self" : out && back ? "friends" : out ? "requested" : back ? "incoming" : "none";
      return [id, state];
    }),
  );
}

/** People search with the viewer's relation and friend count on every row. */
export async function searchPeople(query: string, viewerId: string | null, limit = 40): Promise<PersonSummary[]> {
  const hits = await searchProfiles(query, limit);
  const states = await friendStates(hits.map((h) => h.id), viewerId);
  return Promise.all(hits.map(async (h) => ({ ...h, friends: (await friendCounts(h.id)).friends, state: states[h.id] })));
}

/** Test helper for the in-memory store. */
export function resetFriendsForTests() {
  mem.length = 0;
}
