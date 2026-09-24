import { test } from "node:test";
import assert from "node:assert/strict";
import { registerWithPassword, RegistrationError } from "@/cortex/registration";
import { EMAIL_CODE_MAX_ATTEMPTS, EmailVerificationError, confirmEmailCode, issueEmailCode, isEmailConfirmed, mustConfirmEmail } from "@/cortex/email-verification";
import { consoleOutbox } from "@/cortex/mailer";
import { memoryUsers } from "@/cortex/seed";

const codeFor = (email: string) => {
  const message = [...consoleOutbox].reverse().find((m) => m.to === email);
  assert.ok(message, `no email to ${email}`);
  return message.text.match(/\b(\d{6})\b/)![1];
};
const rejectsWith = (code: string) => (e: unknown) => e instanceof EmailVerificationError && e.code === code;

test("a password signup starts unconfirmed, gets a code by mail and is confirmed by it", async () => {
  const user = await registerWithPassword({ name: "Mail Tester", handle: "mail-tester", email: "Mail@Example.com", password: "correct horse battery" });
  assert.equal(user.emailVerification, "pending");
  const row = memoryUsers.find((u) => u.id === user.id)!;
  assert.equal(row.emailVerified, null);
  assert.ok(mustConfirmEmail(row));

  const code = codeFor("mail@example.com");
  const wrong = code === "000000" ? "111111" : "000000";
  await assert.rejects(confirmEmailCode("mail@example.com", wrong), rejectsWith("invalid_code"));
  await confirmEmailCode("MAIL@example.com", code);
  assert.ok(isEmailConfirmed(row));
  assert.ok(!mustConfirmEmail(row));

  // Confirmed: the code is gone and the address can no longer be reclaimed.
  await assert.rejects(confirmEmailCode("mail@example.com", code), rejectsWith("invalid_code"));
  await assert.rejects(registerWithPassword({ name: "Other", handle: "other-mail", email: "mail@example.com", password: "another password" }), (e: unknown) => e instanceof RegistrationError && e.code === "email_taken");
});

test("wrong guesses burn the code; a new one is not sent inside the cooldown", async () => {
  await registerWithPassword({ name: "Guesser", handle: "guesser", email: "guess@example.com", password: "correct horse battery" });
  const code = codeFor("guess@example.com");
  const wrong = code === "123456" ? "654321" : "123456";
  for (let i = 0; i < EMAIL_CODE_MAX_ATTEMPTS; i++) await assert.rejects(confirmEmailCode("guess@example.com", wrong), rejectsWith("invalid_code"));
  await assert.rejects(confirmEmailCode("guess@example.com", code), rejectsWith("expired_code"));

  const before = consoleOutbox.length;
  await issueEmailCode("guess@example.com");
  assert.equal(consoleOutbox.length, before, "resend inside the cooldown is a silent no-op");
});

test("unknown and seed addresses get the same answers as anyone else", async () => {
  const before = consoleOutbox.length;
  await issueEmailCode("nobody@example.com");
  await issueEmailCode("demo@synapth.dev");
  assert.equal(consoleOutbox.length, before);
  await assert.rejects(confirmEmailCode("nobody@example.com", "123456"), rejectsWith("invalid_code"));
  assert.ok(isEmailConfirmed(memoryUsers.find((u) => u.id === "usr_demo")!), "seed rows count as confirmed");
});

test("an unconfirmed address is reclaimed by a new signup instead of being squatted", async () => {
  const first = await registerWithPassword({ name: "Squatter", handle: "squatter", email: "victim@example.com", password: "squatter password" });
  const second = await registerWithPassword({ name: "Owner", handle: "real-owner", email: "victim@example.com", password: "owner password!" });
  assert.equal(second.id, first.id);
  const row = memoryUsers.find((u) => u.id === first.id)!;
  assert.equal(row.handle, "real-owner");
  assert.equal(memoryUsers.filter((u) => u.email === "victim@example.com").length, 1);
  // The old handle is free again.
  const third = await registerWithPassword({ name: "Squatter", handle: "squatter", email: "squatter@example.com", password: "squatter password" });
  assert.equal(third.handle, "squatter");
});
