import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { anonymousContext, feedSuggestions, getFeed, rankCandidates, type FeedContext } from "@/cortex/feed";
import { createPost, resetSocialForTests, toggleReaction } from "@/cortex/social";
import { resetFriendsForTests, toggleFollow } from "@/cortex/friends";
import { resetNotificationsForTests } from "@/cortex/notifications";
import type { FeedCandidate } from "@/cortex/social";

const DEMO = "usr_demo";
const ACME = "usr_acme";
const KITE = "usr_kite";
const NIMBUS = "usr_nimbus";

const NOW = new Date("2026-09-24T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const post = (id: string, authorId: string, h: number, extra: Partial<FeedCandidate> = {}): FeedCandidate => ({ id, authorId, body: "hello", createdAt: hoursAgo(h), reactors: [], commenters: [], ...extra });
const ctx = (over: Partial<FeedContext> & Partial<FeedContext["graph"]> = {}): FeedContext => ({
  ...anonymousContext(),
  viewerId: DEMO,
  viewerHandle: "demo",
  ...over,
  graph: { friends: over.friends ?? [], following: over.following ?? [], followers: over.followers ?? [], secondDegree: over.secondDegree ?? new Map() },
});

beforeEach(() => {
  resetSocialForTests();
  resetFriendsForTests();
  resetNotificationsForTests();
});

test("anonymous ranking: engagement × freshness", () => {
  const ranked = rankCandidates([post("old", ACME, 72, { reactors: ["a", "b", "c"] }), post("new", KITE, 1), post("hot", NIMBUS, 2, { reactors: ["a", "b", "c", "d"], commenters: ["e"] })], anonymousContext(), NOW);
  assert.deepEqual(
    ranked.map((r) => r.id),
    ["hot", "new", "old"],
  );
  assert.equal(ranked[0].reason, "popular");
  assert.equal(ranked[1].reason, "fresh");
});

test("affinity: a friend's post outranks an equally fresh stranger's, a mention beats both", () => {
  const ranked = rankCandidates([post("stranger", NIMBUS, 2), post("friend", ACME, 2), post("mention", KITE, 2, { body: "thanks @demo!" })], ctx({ friends: [ACME] }), NOW);
  assert.deepEqual(
    ranked.map((r) => [r.id, r.reason]),
    [
      ["mention", "mention"],
      ["friend", "friend"],
      ["stranger", "fresh"],
    ],
  );
});

test("signals: friends who engaged, similar taste, past engagement and friends-of-friends", () => {
  // DEMO and KITE both reacted to p1 → KITE is similar; KITE's reaction lifts p2.
  const candidates = [post("p1", ACME, 30, { reactors: [DEMO, KITE] }), post("p2", NIMBUS, 3, { reactors: [KITE] }), post("p3", "usr_x", 3)];
  const ranked = rankCandidates(candidates, ctx(), NOW);
  assert.equal(ranked.find((r) => r.id === "p2")?.reason, "similar");
  assert.equal(ranked[0].id, "p2");

  assert.equal(rankCandidates([post("a", NIMBUS, 3, { reactors: [ACME] })], ctx({ friends: [ACME] }), NOW)[0].reason, "friendsEngaged");
  assert.equal(rankCandidates([post("a", NIMBUS, 3)], ctx({ engagement: new Map([[NIMBUS, 5]]) }), NOW)[0].reason, "engaged");
  assert.equal(rankCandidates([post("a", NIMBUS, 3)], ctx({ secondDegree: new Map([[NIMBUS, 2]]) }), NOW)[0].reason, "network");
});

test("seen posts sink and one author cannot fill the top", () => {
  const seen = rankCandidates([post("seen", ACME, 1, { reactors: [DEMO] }), post("unseen", NIMBUS, 1, { reactors: [KITE] })], ctx({ friends: [ACME, NIMBUS] }), NOW);
  assert.deepEqual(
    seen.map((r) => r.id),
    ["unseen", "seen"],
  );

  const burst = rankCandidates([post("a1", ACME, 1), post("a2", ACME, 1.1), post("a3", ACME, 1.2), post("k1", KITE, 1.5)], anonymousContext(), NOW);
  assert.equal(burst[1].id, "k1", "another author breaks the run");
});

test("getFeed: for-you ranks everyone, following keeps to the viewer's circle, paging is stable", async () => {
  await toggleFollow(DEMO, ACME);
  await toggleFollow(ACME, DEMO);
  const stranger = await createPost(NIMBUS, "benchmarks are up");
  const friend = await createPost(ACME, "release notes");
  const mine = await createPost(DEMO, "hello feed");
  await toggleReaction(KITE, stranger.id, "🔥");

  const forYou = await getFeed(DEMO);
  assert.equal(forYou.items.length, 3);
  assert.equal(forYou.items[0].post.id, friend.id);
  assert.equal(forYou.nextOffset, null);

  const following = await getFeed(DEMO, { tab: "following" });
  assert.deepEqual(
    following.items.map((i) => [i.post.id, i.reason]),
    [
      [mine.id, "self"],
      [friend.id, "friend"],
    ],
  );
  assert.deepEqual((await getFeed(null, { tab: "following" })).items, []);

  const first = await getFeed(null, { limit: 2 });
  assert.equal(first.nextOffset, 2);
  const second = await getFeed(null, { limit: 2, offset: 2, asOf: first.asOf });
  assert.equal(second.nextOffset, null);
  assert.deepEqual(new Set([...first.items, ...second.items].map((i) => i.post.id)).size, 3);
});

test("suggestions: friends-of-friends first, never someone the viewer already knows", async () => {
  await toggleFollow(DEMO, ACME);
  await toggleFollow(ACME, DEMO);
  await toggleFollow(ACME, KITE);
  await createPost(NIMBUS, "popular post");
  const list = await feedSuggestions(DEMO);
  assert.equal(list[0].id, KITE);
  assert.equal(list[0].mutual, 1);
  assert.ok(list.some((s) => s.id === NIMBUS && s.mutual === 0));
  assert.ok(!list.some((s) => s.id === ACME || s.id === DEMO));
});
