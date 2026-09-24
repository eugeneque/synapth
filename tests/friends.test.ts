import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { followerIds, friendCounts, friendState, listFriends, listRequests, resetFriendsForTests, searchPeople, toggleFollow, SelfFollowError } from "@/cortex/friends";
import { createPost, resetSocialForTests } from "@/cortex/social";
import { listNotifications, resetNotificationsForTests } from "@/cortex/notifications";
import { searchProfiles } from "@/cortex/account";

const DEMO = "usr_demo";
const ACME = "usr_acme";
const KITE = "usr_kite";
const NIMBUS = "usr_nimbus";

beforeEach(() => {
  resetFriendsForTests();
  resetSocialForTests();
  resetNotificationsForTests();
});

const kinds = async (userId: string) => (await listNotifications(userId)).items.map((n) => n.kind);

test("friend requests: one-way until returned, the receiver hears about the request and the sender about the answer", async () => {
  await assert.rejects(toggleFollow(DEMO, DEMO), SelfFollowError);
  assert.equal(await friendState(ACME, null), "anonymous");
  assert.equal(await friendState(ACME, ACME), "self");

  assert.equal(await toggleFollow(DEMO, ACME), "requested");
  assert.equal(await friendState(DEMO, ACME), "incoming");
  assert.deepEqual(await kinds(ACME), ["friend.request"]);
  assert.deepEqual(await friendCounts(ACME), { friends: 0, incoming: 1, outgoing: 0 });

  assert.equal(await toggleFollow(ACME, DEMO), "friends");
  assert.deepEqual(await kinds(DEMO), ["friend.accepted"]);
  assert.deepEqual((await listFriends(ACME)).map((f) => f.handle), ["demo"]);
  assert.deepEqual((await listFriends(DEMO)).map((f) => f.handle), ["acme"]);

  // Unfriending drops only your own row: the other side's follow becomes a pending request again.
  assert.equal(await toggleFollow(DEMO, ACME), "incoming");
  assert.equal(await friendState(DEMO, ACME), "requested");
  const requests = await listRequests(DEMO);
  assert.deepEqual(requests.incoming.map((f) => f.id), [ACME]);
  assert.deepEqual(requests.outgoing, []);
});

test("re-sending a withdrawn request the same day does not ping again", async () => {
  await toggleFollow(KITE, DEMO);
  await toggleFollow(KITE, DEMO);
  await toggleFollow(KITE, DEMO);
  assert.equal((await listNotifications(DEMO)).total, 1);
});

test("new posts reach followers: both friends, but only the sender of an unanswered request", async () => {
  await toggleFollow(DEMO, ACME);
  await toggleFollow(ACME, DEMO); // friends
  await toggleFollow(KITE, DEMO); // kite → demo, unanswered
  resetNotificationsForTests();

  assert.deepEqual((await followerIds(DEMO)).sort(), [ACME, KITE].sort());

  const post = await createPost(DEMO, "Shipping skillsets today");
  for (const id of [ACME, KITE]) {
    const feed = await listNotifications(id);
    assert.equal(feed.items[0].kind, "post.new");
    assert.equal(feed.items[0].actor?.id, DEMO);
    assert.deepEqual(feed.items[0].subject, { kind: "post.new", postId: post.id, excerpt: "Shipping skillsets today" });
  }
  assert.equal((await listNotifications(NIMBUS)).total, 0);
  assert.equal((await listNotifications(DEMO)).total, 0, "authors are not notified about their own posts");

  // Kite asked, demo did not answer: kite's posts do not reach demo.
  await createPost(KITE, "Hello");
  assert.equal((await listNotifications(DEMO)).total, 0);
  // Acme is a friend: acme's posts do.
  await createPost(ACME, "Hi friends");
  assert.deepEqual(await kinds(DEMO), ["post.new"]);
});

test("people search matches name and handle, hides crawler placeholders and reports the viewer relation", async () => {
  assert.deepEqual((await searchProfiles("@nim")).map((p) => p.handle), ["nimbus"]);
  assert.deepEqual((await searchProfiles("LABS")).map((p) => p.handle), ["acme"]);
  assert.ok((await searchProfiles("")).length >= 4);

  await toggleFollow(DEMO, ACME);
  await toggleFollow(ACME, DEMO);
  await toggleFollow(KITE, DEMO);
  const rows = await searchPeople("", DEMO);
  const by = Object.fromEntries(rows.map((r) => [r.handle, r]));
  assert.equal(by.demo.state, "self");
  assert.equal(by.acme.state, "friends");
  assert.equal(by.acme.friends, 1);
  assert.equal(by.kite.state, "incoming");
  assert.equal(by.nimbus.state, "none");
  assert.ok((await searchPeople("", null)).every((r) => r.state === "anonymous"));
});
