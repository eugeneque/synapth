import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { checkEligibility, claimVerification, decideVerification, grantUserVerification, listVerificationRequests, resetVerificationForTests, revokeUserVerification, submitVerification, verificationState, withdrawVerification, VerificationError } from "@/cortex/verification";
import { getAuthorRef, getProfile, resetAccountVerificationForTests } from "@/cortex/account";
import { listNotifications, resetNotificationsForTests } from "@/cortex/notifications";
import { PermissionDeniedError } from "@/cortex/roles";
import { maskPhone, normalizePhone, stageStates } from "@/types/verification";

const DEMO = "usr_demo"; // admin in the in-memory seed
const CANDIDATES = ["usr_acme", "usr_nimbus", "usr_kite"];
const PHONE = "+7 (999) 123-45-67";
/** In-memory accounts are as old as the process, so the tests relax the thresholds. */
const OPEN = { rules: { minAccountAgeDays: 0, minImpulses: 0 } };

async function userWithSkills(clean: boolean): Promise<string | null> {
  for (const id of CANDIDATES) if ((await checkEligibility(id, null)).flaggedSkills.length === 0 === clean) return id;
  return null;
}

beforeEach(() => {
  resetVerificationForTests();
  resetAccountVerificationForTests();
  resetNotificationsForTests();
});

test("phone helpers: E.164 only, masked for the owner", () => {
  assert.equal(normalizePhone(PHONE), "+79991234567");
  assert.equal(normalizePhone("89991234567"), null, "the country code is required");
  assert.equal(normalizePhone("+7 999"), null);
  assert.equal(maskPhone("+79991234567"), "+7 ••• ••• 45 67");
});

test("submit: refuses a bad phone and accounts below the thresholds, storing nothing", async () => {
  const user = CANDIDATES[0];
  await assert.rejects(submitVerification(user, "12345", OPEN), (e: unknown) => e instanceof VerificationError && e.code === "phone_invalid");
  // Default rules: a fresh in-memory account is 0 days old with far fewer than 500 impulses.
  await assert.rejects(submitVerification(user, PHONE), (e: unknown) => e instanceof VerificationError && e.code === "not_eligible");
  const eligibility = await checkEligibility(user, PHONE);
  assert.equal(eligibility.checks.find((c) => c.id === "age")?.ok, false);
  assert.equal(eligibility.checks.find((c) => c.id === "impulses")?.required, 500);
  assert.equal((await verificationState(user)).request, null);
});

test("full flow: scan → queue → claim → reject needs a note → approve sets the mark", async () => {
  const user = await userWithSkills(true);
  assert.ok(user, "the seed has a developer with clean skills");
  const filed = await submitVerification(user!, PHONE, OPEN);
  assert.equal(filed.status, "pending");
  assert.equal(filed.stage, "review");
  assert.equal(filed.phone, maskPhone("+79991234567"), "the applicant sees a masked number");
  assert.deepEqual(stageStates(filed.events), { submitted: "done", scan: "done", review: "waiting", decision: null });
  assert.equal((await listNotifications(DEMO)).items[0].kind, "verification.requested", "admins are told");
  await assert.rejects(submitVerification(user!, PHONE, OPEN), (e: unknown) => e instanceof VerificationError && e.code === "already_pending");

  const [queued] = await listVerificationRequests(DEMO, "open");
  assert.equal(queued.phone, "+79991234567", "admins see the full number");
  await assert.rejects(listVerificationRequests(user!, "open"), PermissionDeniedError);

  const claimed = await claimVerification(DEMO, filed.id);
  assert.equal(stageStates(claimed.events).review, "active");
  assert.equal(claimed.reviewer?.id, DEMO);
  const note = (await listNotifications(user!)).items[0];
  assert.equal(note.subject.kind === "verification.updated" && note.subject.code, "claimed");

  await assert.rejects(decideVerification(DEMO, filed.id, "reject", "  "), (e: unknown) => e instanceof VerificationError && e.code === "note_required");
  const approved = await decideVerification(DEMO, filed.id, "approve");
  assert.equal(approved.status, "approved");
  assert.deepEqual(stageStates(approved.events), { submitted: "done", scan: "done", review: "done", decision: "done" });
  assert.equal((await getProfile(user!))?.verified?.via, "request");
  assert.equal((await getAuthorRef(user!))?.verified, true);
  await assert.rejects(decideVerification(DEMO, filed.id, "approve"), (e: unknown) => e instanceof VerificationError && e.code === "closed");
  await assert.rejects(submitVerification(user!, PHONE, OPEN), (e: unknown) => e instanceof VerificationError && e.code === "already_verified");
});

test("scan stage: any finding in the applicant's skills rejects the request at once", async (t) => {
  const user = await userWithSkills(false);
  if (!user) return t.skip("no seeded developer has flagged skills");
  const filed = await submitVerification(user, PHONE, OPEN);
  assert.equal(filed.status, "rejected");
  assert.equal(stageStates(filed.events).scan, "failed");
  assert.equal((await listVerificationRequests(DEMO, "open")).length, 0, "nothing reaches the admins");
});

test("withdraw and reject: the applicant can apply again afterwards", async () => {
  const user = (await userWithSkills(true))!;
  await submitVerification(user, PHONE, OPEN);
  const withdrawn = await withdrawVerification(user);
  assert.equal(withdrawn.status, "withdrawn");
  await assert.rejects(withdrawVerification(user), (e: unknown) => e instanceof VerificationError && e.code === "no_open_request");

  const again = await submitVerification(user, PHONE, OPEN);
  const rejected = await decideVerification(DEMO, again.id, "reject", "Profile is empty");
  assert.equal(rejected.decisionNote, "Profile is empty");
  assert.equal((await getProfile(user))?.verified, null);
  assert.equal((await verificationState(user)).request?.status, "rejected");
});

test("manual check mark: admins only, never on themselves; a grant closes the open request", async () => {
  const user = (await userWithSkills(true))!;
  const filed = await submitVerification(user, PHONE, OPEN);
  await assert.rejects(grantUserVerification(user, CANDIDATES.find((c) => c !== user)!), PermissionDeniedError);
  await assert.rejects(grantUserVerification(DEMO, DEMO), (e: unknown) => e instanceof VerificationError && e.code === "self");

  await grantUserVerification(DEMO, user, "Known maintainer");
  assert.equal((await getProfile(user))?.verified?.via, "manual");
  const [closed] = await listVerificationRequests(DEMO, "closed");
  assert.equal(closed.id, filed.id);
  assert.equal(closed.status, "approved");

  await revokeUserVerification(DEMO, user, "Account sold");
  assert.equal((await getProfile(user))?.verified, null);
  const codes = (await listNotifications(user)).items.map((n) => (n.subject.kind === "verification.updated" ? n.subject.code : null));
  assert.ok(codes.includes("granted") && codes.includes("revoked"));
});
