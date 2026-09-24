import { test } from "node:test";
import assert from "node:assert/strict";
import { ZodError } from "zod";
import { RegistrationError, WELCOME_CREDIT_USD, availableHandle, handleCandidate, isReservedHandle, registerWithPassword } from "@/cortex/registration";
import { getProfile, updateProfile, HandleTakenError } from "@/cortex/account";
import { billing } from "@/cortex/billing";
import { memoryUsers } from "@/cortex/seed";
import { usdToMicros } from "@/types/economy";
import { confirmEmailCode } from "@/cortex/email-verification";
import { consoleOutbox } from "@/cortex/mailer";

const input = { name: "Ada Lovelace", handle: "ada", email: "Ada@Example.com", password: "correct horse battery" };

test("password signup stores a normalized user with a hashed password and the welcome credit", async () => {
  const user = await registerWithPassword(input);
  assert.equal(user.email, "ada@example.com");
  assert.equal(user.handle, "ada");

  const row = memoryUsers.find((u) => u.id === user.id);
  assert.ok(row);
  assert.notEqual(row.passwordHash, input.password);
  assert.match(row.passwordHash, /^\$2[aby]\$12\$/);
  assert.equal(row.role, "user");

  const wallet = await billing.getWallet(user.id);
  assert.equal(wallet.balanceMicros, usdToMicros(WELCOME_CREDIT_USD));
  const ledger = await billing.ledger(user.id);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].type, "topup");

  const profile = await getProfile(user.id);
  assert.equal(profile?.handle, "ada");
});

test("duplicate email and handle are reported with distinct codes, case-insensitively", async () => {
  // An unconfirmed address can be reclaimed (tests/email-verification.test.ts); a confirmed one is taken.
  const mail = consoleOutbox.findLast((m) => m.to === "ada@example.com");
  assert.ok(mail);
  await confirmEmailCode("ada@example.com", mail.text.match(/\b(\d{6})\b/)![1]);
  await assert.rejects(registerWithPassword({ ...input, handle: "ada-two", email: "ADA@example.com" }), (e: unknown) => e instanceof RegistrationError && e.code === "email_taken" && e.status === 409);
  await assert.rejects(registerWithPassword({ ...input, handle: "ADA", email: "other@example.com" }), (e: unknown) => e instanceof RegistrationError && e.code === "handle_taken");
});

test("reserved and malformed handles are refused", async () => {
  for (const handle of ["admin", "moderator", "synapth", "gh-anthropics", "dashboard"]) {
    assert.ok(isReservedHandle(handle), handle);
    await assert.rejects(registerWithPassword({ ...input, handle, email: `${handle}@example.com` }), (e: unknown) => e instanceof RegistrationError && e.code === "handle_reserved");
  }
  for (const handle of ["-ada", "ada-", "a", "ada lovelace", "ада"]) {
    await assert.rejects(registerWithPassword({ ...input, handle, email: "x@example.com" }), ZodError, handle);
  }
  await assert.rejects(registerWithPassword({ ...input, handle: "fresh", email: "fresh@example.com", password: "short" }), ZodError);
});

test("profile edits cannot move onto a reserved or taken handle", async () => {
  const user = await registerWithPassword({ ...input, handle: "grace", email: "grace@example.com" });
  const base = { name: "Grace", bio: "", organization: "", location: "", website: "", defaultTarget: null };
  await assert.rejects(updateProfile(user.id, { ...base, handle: "admin" }), HandleTakenError);
  await assert.rejects(updateProfile(user.id, { ...base, handle: "ada" }), HandleTakenError);
  const ok = await updateProfile(user.id, { ...base, handle: "grace-h" });
  assert.equal(ok.handle, "grace-h");
});

test("OAuth handles are derived from the profile and made unique", async () => {
  assert.equal(handleCandidate("Octo_Cat"), "octo-cat");
  assert.equal(handleCandidate(null, "zoë.müller", "ignored"), "zoe-muller");
  assert.equal(handleCandidate("admin", "x", "Jane Doe"), "jane-doe");
  assert.equal(handleCandidate("", null), "dev");
  assert.equal(await availableHandle("ada"), "ada-2");
  assert.equal(await availableHandle("brand-new"), "brand-new");
});
