import { test } from "node:test";
import assert from "node:assert/strict";
import { can, permissionsOf, PERMISSIONS, toUserRole } from "@/types/auth";
import { PermissionDeniedError, RoleChangeError, getRole, listUsers, requirePermission, setUserRole } from "@/cortex/roles";
import { moderationQueue, setVerification, VerificationRefusedError } from "@/cortex/moderation";
import { grantBadge, BadgeGrantError } from "@/cortex/badges";
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
  const pending = queue.pending[0];
  assert.ok(pending, "seed catalogue has Community entries");
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

  await assert.rejects(grantBadge(mod, author, "platform-admin"), BadgeGrantError);
});
