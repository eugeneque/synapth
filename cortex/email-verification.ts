/**
 * Cortex · Email confirmation for password accounts.
 *
 * A password signup proves nothing about the address, so the account starts
 * with `emailVerified = null` and the credentials provider refuses it
 * (`email_unverified`) until the owner types the 6-digit code mailed to them.
 * OAuth accounts are not gated: the provider already owns the address.
 *
 *   - one live code per account, only its hash is stored (`EmailCode`);
 *   - 15 minutes, 5 wrong guesses burn it, a new one no sooner than a minute later;
 *   - every answer about an unknown address looks like a wrong code / a sent
 *     email, so the endpoints do not enumerate accounts.
 *
 * Required when mail can actually go out (or in development, where the code is
 * printed to the console); `SYNAPTH_EMAIL_VERIFICATION=0|1` overrides. In
 * production without a mail provider it is off: nobody could receive a code.
 */

import { prisma, hasDatabase } from "@/cortex/db";
import { memoryUsers } from "@/cortex/seed";
import { mailerConfigured, sendMail } from "@/cortex/mailer";
import { uiTranslator, DEFAULT_LOCALE, type Locale } from "@/lib/i18n";

export const EMAIL_CODE_LENGTH = 6;
export const EMAIL_CODE_TTL_MS = 15 * 60_000;
export const EMAIL_CODE_MAX_ATTEMPTS = 5;
export const EMAIL_CODE_RESEND_MS = 60_000;

export function emailVerificationRequired(): boolean {
  const flag = process.env.SYNAPTH_EMAIL_VERIFICATION;
  if (flag === "0") return false;
  if (flag === "1") return true;
  return mailerConfigured() || process.env.NODE_ENV !== "production";
}

/**
 * `emailVerified` as both stores carry it: a `Date` (Prisma), an ISO string
 * (memory) or null. Absent (legacy in-memory seed rows) counts as confirmed.
 */
export function isEmailConfirmed(user: { emailVerified?: Date | string | null }): boolean {
  return user.emailVerified !== null;
}

/** Credentials sign-in gate: a password account with an unconfirmed address stays out. */
export function mustConfirmEmail(user: { emailVerified?: Date | string | null }): boolean {
  return emailVerificationRequired() && !isEmailConfirmed(user);
}

export type EmailVerificationErrorCode = "invalid_code" | "expired_code";

export class EmailVerificationError extends Error {
  readonly status = 400 as const;
  constructor(readonly code: EmailVerificationErrorCode) {
    super(code === "invalid_code" ? "Invalid confirmation code" : "The confirmation code has expired; request a new one");
    this.name = "EmailVerificationError";
  }
}

interface StoredCode {
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  sentAt: Date;
}

const g = globalThis as unknown as { __synapthEmailCodes_v1?: Map<string, StoredCode> };
const memoryCodes: Map<string, StoredCode> = g.__synapthEmailCodes_v1 ?? (g.__synapthEmailCodes_v1 = new Map());

// Web Crypto, not `node:crypto`: `cortex/auth.ts` imports this module and middleware runs on the edge.

/** Bound to the account: a code leaked for one user is worthless for another. */
async function hashCode(userId: string, code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${userId}:${code}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time comparison of two hex digests. */
function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Uniform `0 … 10^length - 1`, zero-padded: rejection sampling avoids modulo bias. */
function randomCode(): string {
  const range = 10 ** EMAIL_CODE_LENGTH;
  const limit = Math.floor(0x1_0000_0000 / range) * range;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return String(buf[0] % range).padStart(EMAIL_CODE_LENGTH, "0");
}

/** The password account behind `email` that still waits for confirmation, if any. */
async function pendingAccount(email: string): Promise<{ id: string; email: string } | null> {
  const normalized = email.trim().toLowerCase();
  if (!hasDatabase) {
    const u = memoryUsers.find((m) => m.email.toLowerCase() === normalized);
    return u && u.passwordHash && !isEmailConfirmed(u) ? { id: u.id, email: u.email } : null;
  }
  const u = await prisma.user.findFirst({
    where: { email: { equals: normalized, mode: "insensitive" }, emailVerified: null, passwordHash: { not: null } },
    select: { id: true, email: true },
  });
  return u?.email ? { id: u.id, email: u.email } : null;
}

async function readCode(userId: string): Promise<StoredCode | null> {
  if (!hasDatabase) return memoryCodes.get(userId) ?? null;
  return prisma.emailCode.findUnique({ where: { userId } });
}

/**
 * Mails a fresh code to an unconfirmed account and replaces the previous one.
 * Silent no-op for unknown / already confirmed addresses and inside the resend
 * cooldown, so the caller's answer is the same either way. Throws
 * `MailDeliveryError` when the provider refuses the message.
 */
export async function issueEmailCode(email: string, locale: Locale = DEFAULT_LOCALE): Promise<void> {
  const account = await pendingAccount(email);
  if (!account) return;

  const previous = await readCode(account.id);
  const now = Date.now();
  if (previous && now - previous.sentAt.getTime() < EMAIL_CODE_RESEND_MS) return;

  const code = randomCode();
  const row: StoredCode = { codeHash: await hashCode(account.id, code), attempts: 0, expiresAt: new Date(now + EMAIL_CODE_TTL_MS), sentAt: new Date(now) };
  if (!hasDatabase) memoryCodes.set(account.id, row);
  else await prisma.emailCode.upsert({ where: { userId: account.id }, create: { userId: account.id, ...row }, update: row });

  const { t } = uiTranslator(locale);
  const minutes = EMAIL_CODE_TTL_MS / 60_000;
  const text = t("email.verify.body", { code, minutes });
  await sendMail({
    to: account.email,
    subject: t("email.verify.subject", { code }),
    text,
    html: `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111">
<p>${escapeHtml(t("email.verify.lead"))}</p>
<p style="font-family:ui-monospace,monospace;font-size:28px;font-weight:700;letter-spacing:6px;margin:16px 0">${code}</p>
<p style="color:#555">${escapeHtml(t("email.verify.note", { minutes }))}</p>
</div>`,
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * Checks `code` against the live code of `email` and confirms the address.
 * Every guess spends an attempt first (atomically in the database), so parallel
 * requests cannot stretch the budget.
 */
export async function confirmEmailCode(email: string, code: string): Promise<{ userId: string }> {
  const account = await pendingAccount(email);
  const clean = code.replace(/\s+/g, "");
  if (!account || !new RegExp(`^\\d{${EMAIL_CODE_LENGTH}}$`).test(clean)) throw new EmailVerificationError("invalid_code");

  const now = new Date();
  let stored: StoredCode | null;
  if (!hasDatabase) {
    stored = memoryCodes.get(account.id) ?? null;
    if (!stored || stored.expiresAt <= now || stored.attempts >= EMAIL_CODE_MAX_ATTEMPTS) throw new EmailVerificationError("expired_code");
    stored.attempts += 1;
  } else {
    const spent = await prisma.emailCode.updateMany({
      where: { userId: account.id, expiresAt: { gt: now }, attempts: { lt: EMAIL_CODE_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (spent.count === 0) throw new EmailVerificationError("expired_code");
    stored = await readCode(account.id);
    if (!stored) throw new EmailVerificationError("expired_code");
  }

  if (!sameHash(stored.codeHash, await hashCode(account.id, clean))) throw new EmailVerificationError("invalid_code");

  if (!hasDatabase) {
    const user = memoryUsers.find((u) => u.id === account.id);
    if (user) user.emailVerified = now.toISOString();
    memoryCodes.delete(account.id);
  } else {
    await prisma.$transaction([
      prisma.user.update({ where: { id: account.id }, data: { emailVerified: now } }),
      prisma.emailCode.delete({ where: { userId: account.id } }),
    ]);
  }
  return { userId: account.id };
}
