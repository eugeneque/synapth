import { test } from "node:test";
import assert from "node:assert/strict";
import { PermissionDeniedError, setUserRole } from "@/cortex/roles";
import { decideModeration, listModerationRequests, ModerationRequestError, pendingRequestFor, requestModeration, rescanForReview, resetModerationForTests, setVerification, VerificationRefusedError } from "@/cortex/moderation";
import { listNotifications } from "@/cortex/notifications";
import { skillRepository } from "@/cortex/repository";
import { registerWithPassword } from "@/cortex/registration";
import { can, permissionsOf } from "@/types/auth";
import { isCronAuthorized, nextScheduledRun } from "@/cortex/crawl-jobs";

async function account(handle: string) {
  return (await registerWithPassword({ name: handle, handle, email: `${handle}@example.com`, password: "long enough password" })).id;
}

async function communityEntry() {
  const entry = (await skillRepository.all()).find((s) => s.securityLevel === "Community");
  assert.ok(entry, "seed catalogue has Community entries");
  return entry;
}

test("the admin panel is admin-only", () => {
  assert.ok(can("admin", "admin.access"));
  assert.ok(!can("moderator", "admin.access"));
  assert.ok(!permissionsOf("user").includes("admin.access"));
});

test("a user request notifies staff; a moderator approves it and the requester hears back", async () => {
  resetModerationForTests();
  const requester = await account("rhea");
  const mod = await account("mort");
  await setUserRole("usr_demo", mod, "moderator");
  const entry = await communityEntry();

  const request = await requestModeration(requester, entry.id, "  please review  ");
  assert.equal(request.status, "pending");
  assert.equal(request.note, "please review");
  assert.equal((await pendingRequestFor(entry.id))?.id, request.id);
  // One open request per entry.
  await assert.rejects(requestModeration(requester, entry.id), (e: unknown) => e instanceof ModerationRequestError && e.status === 409);

  const staffInbox = await listNotifications(mod);
  assert.ok(staffInbox.items.some((n) => n.subject.kind === "moderation.requested" && n.subject.requestId === request.id));
  assert.ok((await listNotifications("usr_demo")).items.some((n) => n.kind === "moderation.requested"), "admins are staff too");

  // Only staff run the reviewer's scanner and decide.
  await assert.rejects(rescanForReview(requester, entry.id), PermissionDeniedError);
  assert.equal((await rescanForReview(mod, entry.id)).verifiable, true);
  await assert.rejects(decideModeration(requester, request.id, "approve"), PermissionDeniedError);

  const closed = await decideModeration(mod, request.id, "approve", "looks good");
  assert.equal(closed.status, "approved");
  assert.equal(closed.resultLevel, "Verified");
  assert.equal(closed.reviewer?.id, mod);
  assert.equal((await skillRepository.byId(entry.id))?.securityLevel, "Verified");
  assert.equal(await pendingRequestFor(entry.id), null);
  await assert.rejects(decideModeration(mod, request.id, "reject", "late"), (e: unknown) => e instanceof ModerationRequestError && e.status === 409);

  const reply = (await listNotifications(requester)).items.find((n) => n.subject.kind === "moderation.decided");
  assert.ok(reply && reply.subject.kind === "moderation.decided" && reply.subject.verdict === "approved");
  assert.deepEqual((await listModerationRequests("decided")).map((r) => r.id), [request.id]);

  // Verified entries cannot be requested again; restore the seed level for other tests.
  await assert.rejects(requestModeration(requester, entry.id), (e: unknown) => e instanceof ModerationRequestError && e.status === 409);
  await setVerification(mod, entry.id, false);
});

test("rejections need a reason and leave the level alone; the scanner still blocks sandboxed entries", async () => {
  resetModerationForTests();
  const requester = await account("sian");
  const entry = await communityEntry();

  const request = await requestModeration(requester, entry.id);
  await assert.rejects(decideModeration("usr_demo", request.id, "reject", "  "), ModerationRequestError);
  const rejected = await decideModeration("usr_demo", request.id, "reject", "add a license");
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.verdictNote, "add a license");
  assert.equal((await skillRepository.byId(entry.id))?.securityLevel, "Community");

  const sandboxed = (await skillRepository.all()).find((s) => s.securityLevel === "Sandbox");
  assert.ok(sandboxed);
  const blocked = await requestModeration(requester, sandboxed.id);
  await assert.rejects(decideModeration("usr_demo", blocked.id, "approve"), VerificationRefusedError);
  // A refused approval keeps the request open.
  assert.equal((await pendingRequestFor(sandboxed.id))?.id, blocked.id);
});

test("the cron hook needs the shared secret; runs land on the 2-hour UTC grid", () => {
  const req = (auth?: string) => new Request("https://synapth.test/api/cron/crawl", { method: "POST", headers: auth ? { authorization: auth } : {} });
  assert.equal(isCronAuthorized(req("Bearer s3cret"), undefined), false, "closed without a configured secret");
  assert.equal(isCronAuthorized(req(), "s3cret"), false);
  assert.equal(isCronAuthorized(req("Bearer nope"), "s3cret"), false);
  assert.equal(isCronAuthorized(req("Bearer s3cret"), "s3cret"), true);

  assert.equal(nextScheduledRun(new Date("2026-09-23T13:05:00Z")).toISOString(), "2026-09-23T14:00:00.000Z");
  assert.equal(nextScheduledRun(new Date("2026-09-23T14:00:00Z")).toISOString(), "2026-09-23T16:00:00.000Z");
  assert.equal(nextScheduledRun(new Date("2026-09-23T23:30:00Z")).toISOString(), "2026-09-24T00:00:00.000Z");
});
