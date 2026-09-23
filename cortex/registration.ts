/**
 * Cortex · Account registration
 *
 * Two ways in, one outcome: every new account gets a unique handle, a wallet
 * with the welcome credit (and its ledger row), all written in one step so a
 * half-created user never exists.
 *
 *   - `registerWithPassword()` — the email + password form (`/api/auth/register`);
 *   - `createOAuthUser()` — wired into the Auth.js adapter, runs on the first
 *     GitHub / Google sign-in and derives a handle from the provider profile.
 *
 * Same dual store as the rest of Cortex. On a serverless runtime without a
 * database the in-memory user table dies with the function instance, so
 * registration refuses instead of creating an account that vanishes.
 */

import { hash } from "bcryptjs";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma, hasDatabase, isServerless } from "@/cortex/db";
import { memoryUsers } from "@/cortex/seed";
import { billing } from "@/cortex/billing";
import { usdToMicros } from "@/types/economy";
import { toUserRole, type UserRole } from "@/types/auth";

/** Credited to every new account so a first paid call works without a payment provider. */
export const WELCOME_CREDIT_USD = 1;
export const WELCOME_CREDIT_MEMO = "Welcome credit";

/** bcrypt work factor; 12 is the current OWASP floor for new deployments. */
const BCRYPT_ROUNDS = 12;

export const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * Handles that would shadow a route, impersonate the platform, or collide with the
 * crawler's pseudo-users (`gh-<owner>`, see `cortex/repository.ts`).
 */
const RESERVED_HANDLES = new Set([
  "admin", "administrator", "root", "system", "support", "help", "security", "staff", "moderator", "mod",
  "synapth", "official", "team", "platform", "billing", "api", "www", "mail", "noreply", "no-reply",
  "dashboard", "settings", "signin", "signup", "login", "logout", "register", "auth", "publish",
  "skills", "authors", "u", "user", "users", "docs", "faq", "about", "new", "me", "null", "undefined",
]);

export function isReservedHandle(handle: string): boolean {
  const h = handle.toLowerCase();
  return RESERVED_HANDLES.has(h) || h.startsWith("gh-");
}

export const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(32)
  .regex(HANDLE_PATTERN, "lowercase letters, digits and dashes only; no leading or trailing dash");

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(64),
  handle: handleSchema,
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(128),
});

export type RegisterInput = z.input<typeof registerSchema>;

export type RegistrationErrorCode = "email_taken" | "handle_taken" | "handle_reserved" | "unavailable";

const MESSAGES: Record<RegistrationErrorCode, string> = {
  email_taken: "An account with this email already exists",
  handle_taken: "This handle is already taken",
  handle_reserved: "This handle is reserved",
  unavailable: "Registration is unavailable: this deployment has no database configured",
};

export class RegistrationError extends Error {
  readonly status: 400 | 409 | 503;
  constructor(readonly code: RegistrationErrorCode) {
    super(MESSAGES[code]);
    this.name = "RegistrationError";
    this.status = code === "unavailable" ? 503 : code === "handle_reserved" ? 400 : 409;
  }
}

export interface RegisteredUser {
  id: string;
  email: string;
  handle: string;
}

function assertPersistentStore() {
  if (!hasDatabase && isServerless) throw new RegistrationError("unavailable");
}

/** Nested create for the wallet: welcome balance plus the matching ledger row, inside the user insert. */
function welcomeWallet() {
  const amount = BigInt(usdToMicros(WELCOME_CREDIT_USD));
  return { create: { balanceMicros: amount, entries: { create: { type: "topup" as const, amountMicros: amount, memo: WELCOME_CREDIT_MEMO } } } };
}

/** Maps a unique-constraint violation (a concurrent signup won the race) onto the field that clashed. */
function uniqueViolation(err: unknown): RegistrationErrorCode | null {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return null;
  const target = String((err.meta?.target as string[] | string | undefined) ?? "");
  return target.includes("handle") ? "handle_taken" : "email_taken";
}

export async function registerWithPassword(raw: unknown): Promise<RegisteredUser> {
  assertPersistentStore();
  const input = registerSchema.parse(raw);
  if (isReservedHandle(input.handle)) throw new RegistrationError("handle_reserved");

  if (!hasDatabase) {
    if (memoryUsers.some((u) => u.email.toLowerCase() === input.email)) throw new RegistrationError("email_taken");
    if (memoryUsers.some((u) => u.handle.toLowerCase() === input.handle)) throw new RegistrationError("handle_taken");
    const passwordHash = await hash(input.password, BCRYPT_ROUNDS);
    const id = `usr_${Math.random().toString(36).slice(2, 10)}`;
    memoryUsers.push({ id, name: input.name, email: input.email, handle: input.handle, image: null, role: "user", passwordHash });
    await billing.topUp(id, WELCOME_CREDIT_USD, WELCOME_CREDIT_MEMO);
    return { id, email: input.email, handle: input.handle };
  }

  // Cheap pre-check first so a taken email does not cost a bcrypt round; the unique
  // indexes below remain the real guarantee.
  const clash = await prisma.user.findFirst({
    where: { OR: [{ email: { equals: input.email, mode: "insensitive" } }, { handle: { equals: input.handle, mode: "insensitive" } }] },
    select: { email: true },
  });
  if (clash) throw new RegistrationError(clash.email?.toLowerCase() === input.email ? "email_taken" : "handle_taken");

  const passwordHash = await hash(input.password, BCRYPT_ROUNDS);
  try {
    const user = await prisma.user.create({
      data: { name: input.name, handle: input.handle, email: input.email, passwordHash, wallet: welcomeWallet() },
      select: { id: true, email: true, handle: true },
    });
    return { id: user.id, email: user.email ?? input.email, handle: user.handle ?? input.handle };
  } catch (err) {
    const code = uniqueViolation(err);
    if (code) throw new RegistrationError(code);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// OAuth (Auth.js adapter)
// ---------------------------------------------------------------------------

/** Turns a provider login / email local part / display name into a handle candidate. */
export function handleCandidate(...sources: Array<string | null | undefined>): string {
  for (const source of sources) {
    const slug = (source ?? "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24)
      .replace(/-+$/, "");
    if (slug.length >= 3 && !isReservedHandle(slug)) return slug;
  }
  return "dev";
}

async function handleTaken(handle: string): Promise<boolean> {
  if (!hasDatabase) return memoryUsers.some((u) => u.handle.toLowerCase() === handle);
  return Boolean(await prisma.user.findFirst({ where: { handle: { equals: handle, mode: "insensitive" } }, select: { id: true } }));
}

/** First free variant of `base`: `ada`, `ada-2`, `ada-3`…, then a random suffix. */
export async function availableHandle(base: string): Promise<string> {
  for (let n = 1; n <= 20; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (!isReservedHandle(candidate) && !(await handleTaken(candidate))) return candidate;
  }
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface OAuthProfileInput {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  emailVerified?: Date | null;
  /** Provider login (GitHub `login`), when the provider has one. */
  login?: string | null;
}

/** The user row Auth.js expects back from `adapter.createUser`. */
export interface CreatedOAuthUser {
  id: string;
  name: string | null;
  email: string;
  emailVerified: Date | null;
  image: string | null;
  handle: string | null;
  role: UserRole;
}

/** Creates the Synapth user behind a first OAuth sign-in: generated handle, wallet, welcome credit. */
export async function createOAuthUser(data: OAuthProfileInput): Promise<CreatedOAuthUser> {
  const email = data.email?.trim().toLowerCase() ?? "";
  const base = handleCandidate(data.login, email.split("@")[0], data.name);
  // A concurrent signup may grab the same handle between the check and the insert: retry with the next one.
  for (let attempt = 0; attempt < 3; attempt++) {
    const handle = await availableHandle(base);
    try {
      const u = await prisma.user.create({
        data: { name: data.name ?? handle, email: email || null, emailVerified: data.emailVerified ?? null, image: data.image ?? null, handle, wallet: welcomeWallet() },
      });
      return { id: u.id, name: u.name, email: u.email ?? "", emailVerified: u.emailVerified, image: u.image, handle: u.handle, role: toUserRole(u.role) };
    } catch (err) {
      if (uniqueViolation(err) !== "handle_taken") throw err;
    }
  }
  throw new RegistrationError("handle_taken");
}
