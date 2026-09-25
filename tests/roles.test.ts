import { test } from "node:test";
import { scanSkill } from "@/lib/sandbox-scanner";
import assert from "node:assert/strict";
import { can, permissionsOf, PERMISSIONS, publicRole, toUserRole } from "@/types/auth";
import { PermissionDeniedError, RoleChangeError, getRole, listUsers, requirePermission, setUserRole } from "@/cortex/roles";
import { setDeveloper } from "@/cortex/developers";
import { moderationQueue, setVerification, VerificationRefusedError } from "@/cortex/moderation";
import { grantBadge, listBadges, BadgeGrantError } from "@/cortex/badges";
import { getUserCard } from "@/cortex/user-card";
import { getProfile } from "@/cortex/account";
import { createPost, addComment, deletePost, deleteComment, ForbiddenError, resetSocialForTests } from "@/cortex/social";
import { skillRepository } from "@/cortex/repository";
import { registerWithPassword } from "@/cortex/registration";

test("permission table: users hold nothing extra, moderators verify, admins hold everything", () => {
  assert.deepEqual(permissionsOf("user"), []);
  assert.deepEqual(permissionsOf("moderator").sort(), ["catalog.moderate", "catalog.verify"]);
  assert.deepEqual(permissionsOf("admin"), [...PERMISSIONS]);
  assert.ok(!can("moderator", "users.manageRoles"));
  assert.ok(!can("moderator", "crawler.run"));
  assert.ok(!can(null, "catalog.verify"));
  // The retired `creator` role and garbage degrade to a plain user.
  assert.equal(toUserRole("creator"), "user");
  assert.equal(toUserRole(undefined), "user");
});

async function account(handle: string) {
  return (await registerWithPassword({ name: handle, handle, email: `${handle}@example.com`, password: "long enough password" })).id;
}

test("only admins change roles; no self-edits, no demoting the last admin", async () => {
  const mod = await account("mira");
  const pleb = await account("otto");
  assert.equal(await getRole(pleb), "user");

  await assert.rejects(setUserRole(pleb, mod, "moderator"), PermissionDeniedError);
  const updated = await setUserRole("usr_demo", mod, "moderator");
  assert.equal(updated.role, "moderator");
  assert.equal(await getRole(mod), "moderator");
  await assert.rejects(setUserRole(mod, pleb, "admin"), PermissionDeniedError);

  await assert.rejects(setUserRole("usr_demo", "usr_demo", "user"), RoleChangeError);
  await assert.rejects(setUserRole("usr_demo", pleb, "root"), /Unknown role/);
  await assert.rejects(setUserRole("usr_demo", "nobody", "user"), (e: unknown) => e instanceof RoleChangeError && e.status === 404);

  // A second admin can demote the first one, but not the other way round once only one is left.
  await setUserRole("usr_demo", pleb, "admin");
  await setUserRole(pleb, "usr_demo", "user");
  await assert.rejects(setUserRole(pleb, pleb, "user"), RoleChangeError);
  await setUserRole(pleb, "usr_demo", "admin");
  await setUserRole("usr_demo", pleb, "user");

  const staff = await listUsers({ role: "moderator" });
  assert.deepEqual(staff.map((u) => u.handle), ["mira"]);
  assert.ok((await listUsers({ q: "OTTO" })).some((u) => u.id === pleb));
});

test("moderators verify clean entries; the scanner still blocks sandboxed ones; users cannot", async () => {
  const mod = await account("vera");
  const user = await account("ugo");
  await setUserRole("usr_demo", mod, "moderator");

  const queue = await moderationQueue();
  const pending = queue.pending.find((s) => scanSkill(s).verifiable);
  assert.ok(pending, "seed catalogue has Community entries clean enough for Verified");
  // Medium findings pushing the risk score under 85 keep an entry out of Verified (ТЗ §2, stage 7).
  const lowScore = queue.pending.find((s) => !scanSkill(s).verifiable);
  if (lowScore) await assert.rejects(setVerification(mod, lowScore.id, true), VerificationRefusedError);
  await assert.rejects(setVerification(user, pending.id, true), PermissionDeniedError);

  const verified = await setVerification(mod, pending.id, true);
  assert.equal(verified.securityLevel, "Verified");
  assert.equal((await skillRepository.byId(pending.id))?.securityLevel, "Verified");
  assert.ok(!(await moderationQueue()).pending.some((s) => s.id === pending.id));

  const revoked = await setVerification(mod, pending.id, false);
  assert.equal(revoked.securityLevel, "Community");

  const sandboxed = (await skillRepository.all()).find((s) => s.securityLevel === "Sandbox");
  assert.ok(sandboxed);
  await assert.rejects(setVerification(mod, sandboxed.id, true), VerificationRefusedError);
  // Admins inherit the permission.
  assert.equal(await requirePermission("usr_demo", "catalog.verify"), "admin");
});

test("content moderation and badge grants are admin-only", async () => {
  resetSocialForTests();
  const author = await account("pia");
  const mod = await account("moss");
  await setUserRole("usr_demo", mod, "moderator");
  const post = await createPost(author, "hello");
  const comment = await addComment(author, { kind: "post", id: post.id }, "self reply");

  // The social layer takes the permission as a flag; the server actions derive it from the stored role.
  await assert.rejects(deleteComment(mod, comment.id), ForbiddenError);
  await deleteComment("usr_demo", comment.id, { moderator: can(await getRole("usr_demo"), "content.moderate") });
  await assert.rejects(deletePost(mod, post.id, { moderator: can(await getRole(mod), "content.moderate") }), ForbiddenError);
  await deletePost("usr_demo", post.id, { moderator: true });

  await assert.rejects(grantBadge(mod, author, "veteran"), BadgeGrantError);
  // Unique badges follow the developer flag and cannot be handed out, not even by an admin.
  await assert.rejects(grantBadge("usr_demo", author, "platform-developer"), BadgeGrantError);
});

test("admins never show up as admins in public", async () => {
  assert.equal(publicRole("admin"), "user");
  assert.equal(publicRole("moderator"), "moderator");
  assert.equal((await getProfile("usr_demo"))?.role, "admin");
  assert.equal((await getUserCard("demo", null))?.role, "user");
});

test("developer flag: admin-only, allowed on oneself, the unique badge follows it", async () => {
  const dev = await account("vega");
  await assert.rejects(setDeveloper(dev, dev, true), PermissionDeniedError);

  const on = await setDeveloper("usr_demo", dev, true);
  assert.equal(on.developer, true);
  assert.equal((await getProfile(dev))?.developer, true);
  assert.ok((await listBadges(dev)).some((b) => b.badgeId === "platform-developer"));
  assert.ok((await listUsers({ developer: true })).some((u) => u.id === dev));
  assert.equal((await getUserCard("vega", null))?.developer, true);

  const off = await setDeveloper("usr_demo", dev, false);
  assert.equal(off.developer, false);
  assert.ok(!(await listBadges(dev)).some((b) => b.badgeId === "platform-developer"));

  // Grants nothing, so an admin may mark themselves; system accounts are refused.
  assert.equal((await setDeveloper("usr_demo", "usr_demo", true)).developer, true);
  await assert.rejects(setDeveloper("usr_demo", "usr_platform", true), RoleChangeError);
  await assert.rejects(setDeveloper("usr_demo", "nobody", true), (e: unknown) => e instanceof RoleChangeError && e.status === 404);
});
