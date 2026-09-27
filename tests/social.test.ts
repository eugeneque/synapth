import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { addComment, createPost, deleteComment, deletePost, impulseSummary, listComments, listPosts, notifySkillUpdated, resetSocialForTests, socialSignals, toggleImpulse, toggleReaction, reactionCounts, NotFoundError, toggleWatch, watchSummary, SelfImpulseError, ForbiddenError } from "@/cortex/social";
import { countByChannel, dismiss, listNotifications, markRead, pollNotifications, resetNotificationsForTests } from "@/cortex/notifications";
import { evaluateBadges, grantBadge, listBadges, resetBadgesForTests, BadgeGrantError } from "@/cortex/badges";
import { NOTIFICATION_CHANNEL } from "@/types/social";
import { BADGES, BADGE_CRITERIA } from "@/types/badges";

const DEMO = "usr_demo";
const ACME = "usr_acme";
const KITE = "usr_kite";

beforeEach(() => {
  resetSocialForTests();
  resetNotificationsForTests();
  resetBadgesForTests();
});

test("impulses: one per pair, toggled, never to yourself, and the receiver is notified once", async () => {
  await assert.rejects(toggleImpulse(DEMO, DEMO), SelfImpulseError);

  const on = await toggleImpulse(ACME, DEMO);
  assert.deepEqual(on, { total: 1, active: true });
  assert.deepEqual(await impulseSummary(DEMO, KITE), { total: 1, active: false });

  const feed = await listNotifications(DEMO);
  assert.equal(feed.unread, 1);
  assert.equal(feed.items[0].kind, "impulse");
  assert.equal(feed.items[0].actor?.handle, "acme");

  const off = await toggleImpulse(ACME, DEMO);
  assert.deepEqual(off, { total: 0, active: false });
  // Withdrawing is silent, and re-firing the same day does not ping again.
  await toggleImpulse(ACME, DEMO);
  assert.equal((await listNotifications(DEMO)).total, 1);
});

test("reactions: one per (user, post) — another emoji replaces it, the same one withdraws it; only the allowed set, gone with the post", async () => {
  const post = await createPost(DEMO, "Reactions please");
  await assert.rejects(toggleReaction(KITE, post.id, "💩"));
  await assert.rejects(toggleReaction(KITE, "post_missing", "👍"), NotFoundError);

  await toggleReaction(KITE, post.id, "🔥");
  await toggleReaction(ACME, post.id, "🔥");
  // Picking a different emoji moves KITE's single reaction instead of adding a second one.
  const mine = await toggleReaction(KITE, post.id, "👍");
  assert.deepEqual(mine, [
    { emoji: "👍", count: 1, mine: true },
    { emoji: "🔥", count: 1, mine: false },
  ]);
  assert.deepEqual((await listPosts(DEMO, { viewerId: ACME }))[0].reactions, [
    { emoji: "👍", count: 1, mine: false },
    { emoji: "🔥", count: 1, mine: true },
  ]);

  // The same emoji again withdraws; a zero tally disappears from the list.
  assert.deepEqual(await toggleReaction(KITE, post.id, "👍"), [{ emoji: "🔥", count: 1, mine: false }]);
  // Reactions are not worth a notification.
  assert.equal((await listNotifications(DEMO)).total, 0);

  await deletePost(DEMO, post.id);
  assert.equal((await reactionCounts([post.id])).size, 0);
});

test("posts and comments: threads attach to posts, the post author is notified, only authors delete", async () => {
  const post = await createPost(DEMO, "  Hello Synapth  ");
  assert.equal(post.body, "Hello Synapth");
  assert.equal(post.author.handle, "demo");
  await assert.rejects(createPost(DEMO, "   "));

  const c = await addComment(KITE, { kind: "post", id: post.id }, "Nice one");
  assert.equal(c.targetKind, "post");
  assert.equal((await listPosts(DEMO))[0].commentCount, 1);
  assert.equal((await listComments("post", post.id)).length, 1);

  const feed = await listNotifications(DEMO);
  assert.equal(feed.items[0].kind, "comment.post");
  assert.equal(feed.items[0].subject.kind === "comment.post" && feed.items[0].subject.excerpt, "Nice one");

  // Commenting on your own post does not notify you.
  await addComment(DEMO, { kind: "post", id: post.id }, "Thanks!");
  assert.equal((await listNotifications(DEMO)).total, 1);

  await assert.rejects(deleteComment(DEMO, c.id), ForbiddenError);
  await deleteComment(KITE, c.id);
  await assert.rejects(deletePost(KITE, post.id), ForbiddenError);
  await deletePost(DEMO, post.id);
  assert.equal((await listPosts(DEMO)).length, 0);
  assert.equal((await listComments("post", post.id)).length, 0);
});

test("skill comments notify the skill owner with a deep link", async () => {
  const target = { kind: "skill" as const, id: "skl_postgres", ownerId: ACME, slug: "acme-postgres-mcp", name: "Postgres MCP" };
  await addComment(KITE, target, "Does it support EXPLAIN?");
  const feed = await listNotifications(ACME);
  assert.equal(feed.items[0].kind, "comment.skill");
  const s = feed.items[0].subject;
  assert.ok(s.kind === "comment.skill" && s.slug === "acme-postgres-mcp" && s.skillName === "Postgres MCP");
});

test("watches: toggled per user, watchers hear about version bumps, the author does not", async () => {
  assert.deepEqual(await toggleWatch(DEMO, "skl_postgres"), { watchers: 1, watching: true });
  await toggleWatch(KITE, "skl_postgres");
  await toggleWatch(ACME, "skl_postgres");
  assert.equal((await watchSummary("skl_postgres")).watchers, 3);

  const sent = await notifySkillUpdated({ id: "skl_postgres", slug: "acme-postgres-mcp", name: "Postgres MCP", version: "1.5.0", previousVersion: "1.4.2", verified: true, authorId: ACME });
  assert.equal(sent, 2);
  assert.equal((await listNotifications(ACME)).total, 0);
  const demo = await listNotifications(DEMO, { channel: "skills" });
  assert.equal(demo.items.length, 1);
  assert.ok(demo.items[0].subject.kind === "skill.updated" && demo.items[0].subject.version === "1.5.0");

  assert.deepEqual(await toggleWatch(DEMO, "skl_postgres"), { watchers: 2, watching: false });
});

test("inbox: channels, polling cursor, read marks and dismissal", async () => {
  await toggleImpulse(ACME, DEMO);
  const t0 = new Date().toISOString();
  await new Promise((r) => setTimeout(r, 5));
  await addComment(KITE, { kind: "skill", id: "skl_browser", ownerId: DEMO, slug: "nimbus-headless-browser", name: "Headless Browser" }, "hi");

  const counts = await countByChannel(DEMO);
  assert.equal(counts.all, 2);
  assert.equal(counts.social, 1);
  assert.equal(counts.skills, 1);
  assert.equal(counts.unread, 2);

  const poll = await pollNotifications(DEMO, t0);
  assert.equal(poll.fresh.length, 1);
  assert.equal(poll.fresh[0].kind, "comment.skill");
  assert.equal(poll.unread, 2);
  assert.equal((await pollNotifications(DEMO, null)).fresh.length, 0);

  const first = (await listNotifications(DEMO)).items[0];
  assert.equal(await markRead(DEMO, [first.id]), 1);
  assert.equal((await listNotifications(DEMO, { channel: "unread" })).items.length, 1);
  assert.equal(await markRead(DEMO), 0);

  assert.equal(await dismiss(KITE, first.id), false);
  assert.equal(await dismiss(DEMO, first.id), true);
  assert.equal((await listNotifications(DEMO)).total, 1);
});

test("every notification kind maps to a drawer channel", () => {
  for (const kind of Object.keys(NOTIFICATION_CHANNEL)) assert.ok(["social", "skills", "system"].includes(NOTIFICATION_CHANNEL[kind as keyof typeof NOTIFICATION_CHANNEL]));
});

test("badges: auto criteria award once, notify, and manual grants need an admin", async () => {
  for (const b of BADGES) if (b.award === "auto") assert.ok(b.id in BADGE_CRITERIA, `${b.id} has no criteria`);

  assert.equal((await listBadges(KITE)).length, 0);
  await createPost(KITE, "first!");
  const fresh = (await evaluateBadges(KITE)).map((b) => b.badgeId);
  assert.ok(fresh.includes("first-post"));
  assert.ok(fresh.includes("first-skill"), "kite owns seeded skills");
  assert.ok(!fresh.includes("skillmaster"));
  assert.deepEqual(await evaluateBadges(KITE), []);
  const system = await listNotifications(KITE, { channel: "system" });
  assert.equal(system.items.length, fresh.length);
  assert.ok(system.items.every((n) => n.kind === "badge"));

  // Acme's seeded Postgres MCP has 48k installs → both install badges; nobody has 25 skills or a verified "five" set.
  const acme = (await evaluateBadges(ACME)).map((b) => b.badgeId);
  assert.ok(acme.includes("first-skill") && acme.includes("goat") && acme.includes("community-pride"));
  assert.ok(!acme.includes("skillmaster") && !acme.includes("five") && !acme.includes("veteran"));

  for (let i = 0; i < 5; i++) await toggleImpulse(`usr_fan_${i}`, DEMO);
  assert.equal((await socialSignals(DEMO)).impulsesReceived, 5);
  assert.ok((await evaluateBadges(DEMO)).some((b) => b.badgeId === "resonance"));

  // KITE has role "user"; the seeded demo operator is the only admin.
  await assert.rejects(grantBadge(KITE, DEMO, "veteran"), BadgeGrantError);
});
