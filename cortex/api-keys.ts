/**
 * Cortex · API keys and caller resolution for the v1 API (ТЗ FR-AI-10…14).
 *
 * Browsers arrive with a session cookie, agents with `X-Synapth-Key` (or
 * `Authorization: Bearer`). A key is `sk_live_<32 chars>`, shown once and
 * stored as SHA-256; it carries scopes, an expiry (90 days by default) and a
 * policy that can only tighten the owner's. Revocation is instant: every
 * request looks the hash up again.
 */

import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { auth, UnauthorizedError } from "@/cortex/auth";
import { prisma, hasDatabase } from "@/cortex/db";
import type { Permission, UserRole } from "@/types/auth";
import { requirePermission } from "@/cortex/roles";
import {
  API_KEY_LIVE_PREFIX,
  API_KEY_SCOPES,
  API_KEY_TTL_DAYS,
  API_KEYS_MAX,
  DEFAULT_POLICY,
  keyStatus,
  tightenPolicy,
  type ApiKeyInfo,
  type ApiKeyScope,
  type KeyPolicy,
} from "@/types/api-keys";

/** Legacy prefix; such keys still resolve by hash. */
export const API_KEY_PREFIX = "syn_";
/** Works only on the in-memory store, for local agents and docs examples. */
export const DEMO_API_KEY = "syn_demo_0000000000000000";

export interface Caller {
  userId: string;
  via: "session" | "api-key";
  /** Null for sessions and the demo key. */
  keyId: string | null;
  /** When the key was issued: reports of keys younger than 7 days do not count in ratings (FR-AI-51). */
  keyCreatedAt: string | null;
  scopes: readonly ApiKeyScope[];
  /** Effective policy: the owner's floor tightened by the key. */
  policy: KeyPolicy;
  /** `X-Agent-Name`, journal only (FR-AI-14). */
  agentName: string | null;
}

/** 401 with a reason the agent can act on. */
export class ApiKeyError extends Error {
  status = 401 as const;
  constructor(public readonly code: "key_invalid" | "key_expired" | "key_revoked") {
    super(code === "key_expired" ? "API key expired — issue a new one in the dashboard" : code === "key_revoked" ? "API key was revoked" : "Unknown API key");
    this.name = "ApiKeyError";
  }
}

/** 403 for a key without the scope the operation needs. */
export class ScopeError extends Error {
  status = 403 as const;
  code = "scope_missing" as const;
  constructor(public readonly scope: ApiKeyScope) {
    super(`This key lacks the ${scope} scope`);
    this.name = "ScopeError";
  }
}

export class ApiKeyLimitError extends Error {
  status = 409 as const;
  constructor(limit = API_KEYS_MAX) {
    super(`Your plan allows ${limit} active key${limit === 1 ? "" : "s"}; revoke one or upgrade`);
    this.name = "ApiKeyLimitError";
  }
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** `sk_live_` + 32 base62 characters (~190 bits). */
export function generateApiKey(): { key: string; prefix: string; hash: string } {
  let body = "";
  while (body.length < 32) {
    for (const byte of randomBytes(48)) {
      // 248 = 62 × 4: rejection sampling keeps the alphabet uniform.
      if (byte < 248 && body.length < 32) body += BASE62[byte % 62];
    }
  }
  const key = `${API_KEY_LIVE_PREFIX}${body}`;
  return { key, prefix: key.slice(0, API_KEY_LIVE_PREFIX.length + 4), hash: hashKey(key) };
}

/**
 * The owner's policy — the floor every key inherits. Organisations will set
 * theirs here; today it is the platform default for everyone.
 */
export async function ownerPolicy(_userId: string): Promise<KeyPolicy> {
  return DEFAULT_POLICY;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

interface KeyRow extends ApiKeyInfo {
  userId: string;
  keyHash: string;
}

const g = globalThis as unknown as { __synapthApiKeys_v1?: KeyRow[] };
const memoryKeys: KeyRow[] = g.__synapthApiKeys_v1 ?? (g.__synapthApiKeys_v1 = []);

type DbKey = { id: string; userId: string; label: string; keyHash: string; prefix: string; scopes: string[]; policy: Prisma.JsonValue | null; createdAt: Date; lastUsedAt: Date | null; expiresAt: Date | null; revokedAt: Date | null };

const fromDb = (r: DbKey): KeyRow => ({
  id: r.id,
  userId: r.userId,
  label: r.label,
  keyHash: r.keyHash,
  prefix: r.prefix,
  scopes: r.scopes.filter((s): s is ApiKeyScope => (API_KEY_SCOPES as readonly string[]).includes(s)),
  policy: (r.policy ?? {}) as Partial<KeyPolicy>,
  createdAt: r.createdAt.toISOString(),
  lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
  expiresAt: r.expiresAt?.toISOString() ?? null,
  revokedAt: r.revokedAt?.toISOString() ?? null,
});

const toInfo = ({ userId: _u, keyHash: _h, ...info }: KeyRow): ApiKeyInfo => info;

async function findByHash(hash: string): Promise<KeyRow | null> {
  if (!hasDatabase) return memoryKeys.find((k) => k.keyHash === hash) ?? null;
  const row = await prisma.apiKey.findUnique({ where: { keyHash: hash } });
  return row ? fromDb(row) : null;
}

async function touch(row: KeyRow) {
  const now = new Date();
  // One write per minute is plenty for "last used".
  if (row.lastUsedAt && now.getTime() - Date.parse(row.lastUsedAt) < 60_000) return;
  if (!hasDatabase) {
    row.lastUsedAt = now.toISOString();
    return;
  }
  await prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: now } });
}

export interface IssueKeyInput {
  label: string;
  scopes: ApiKeyScope[];
  /** Days until expiry; 0 is not allowed — keys always expire. */
  ttlDays?: number;
  /** Active keys the owner's plan allows (cortex/plans.ts); never above API_KEYS_MAX. */
  maxActive?: number;
  policy?: Partial<KeyPolicy>;
}

/** Issues a key; the plain value is returned once and never stored. */
export async function issueApiKey(userId: string, input: IssueKeyInput): Promise<{ key: string; info: ApiKeyInfo }> {
  const active = (await listApiKeys(userId)).filter((k) => keyStatus(k) === "active");
  const cap = Math.min(input.maxActive ?? API_KEYS_MAX, API_KEYS_MAX);
  if (active.length >= cap) throw new ApiKeyLimitError(cap);
  const { key, prefix, hash } = generateApiKey();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (input.ttlDays ?? API_KEY_TTL_DAYS) * 86_400_000);
  const scopes = [...new Set(input.scopes)];
  const policy = input.policy ?? {};
  if (!hasDatabase) {
    const row: KeyRow = { id: `key_${randomBytes(6).toString("hex")}`, userId, label: input.label, keyHash: hash, prefix, scopes, policy, createdAt: now.toISOString(), lastUsedAt: null, expiresAt: expiresAt.toISOString(), revokedAt: null };
    memoryKeys.push(row);
    return { key, info: toInfo(row) };
  }
  const row = await prisma.apiKey.create({ data: { userId, label: input.label, keyHash: hash, prefix, scopes, policy: policy as Prisma.InputJsonValue, expiresAt } });
  return { key, info: toInfo(fromDb(row)) };
}

export async function listApiKeys(userId: string): Promise<ApiKeyInfo[]> {
  if (!hasDatabase) return memoryKeys.filter((k) => k.userId === userId).map(toInfo).reverse();
  const rows = await prisma.apiKey.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 100 });
  return rows.map((r) => toInfo(fromDb(r)));
}

/** Revocation is immediate: the next request with this key gets `key_revoked`. */
export async function revokeApiKey(userId: string, keyId: string): Promise<boolean> {
  if (!hasDatabase) {
    const row = memoryKeys.find((k) => k.id === keyId && k.userId === userId && !k.revokedAt);
    if (!row) return false;
    row.revokedAt = new Date().toISOString();
    return true;
  }
  const res = await prisma.apiKey.updateMany({ where: { id: keyId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
  return res.count > 0;
}

// ---------------------------------------------------------------------------
// Caller resolution
// ---------------------------------------------------------------------------

function agentName(request: Request): string | null {
  const raw = request.headers.get("x-agent-name")?.trim();
  // Printable, bounded: it only lands in the journal.
  return raw ? raw.replace(/[^\x20-\x7E]/g, "").slice(0, 80) || null : null;
}

export async function resolveCaller(request: Request): Promise<Caller | null> {
  const key = request.headers.get("x-synapth-key") ?? bearer(request.headers.get("authorization"));
  const agent = agentName(request);
  if (key) {
    if (!hasDatabase && key === DEMO_API_KEY) return { userId: "usr_demo", via: "api-key", keyId: null, keyCreatedAt: null, scopes: API_KEY_SCOPES, policy: await ownerPolicy("usr_demo"), agentName: agent };
    const row = await findByHash(hashKey(key));
    if (!row) throw new ApiKeyError("key_invalid");
    const status = keyStatus(row);
    if (status !== "active") throw new ApiKeyError(status === "revoked" ? "key_revoked" : "key_expired");
    await touch(row);
    return { userId: row.userId, via: "api-key", keyId: row.id, keyCreatedAt: row.createdAt, scopes: row.scopes, policy: tightenPolicy(await ownerPolicy(row.userId), row.policy), agentName: agent };
  }

  // No cookie, no session: skip the Auth.js round-trip for agents and scripts.
  if (!request.headers.get("cookie")) return null;
  const session = await auth();
  if (!session?.user?.id) return null;
  // A signed-in person has every scope; the policy floor still applies.
  return { userId: session.user.id, via: "session", keyId: null, keyCreatedAt: null, scopes: API_KEY_SCOPES, policy: await ownerPolicy(session.user.id), agentName: agent };
}

/** `resolveCaller` or 401 — for handlers that agents reach with `X-Synapth-Key`. */
export async function requireCaller(request: Request): Promise<Caller> {
  const caller = await resolveCaller(request);
  if (!caller) throw new UnauthorizedError();
  return caller;
}

export const hasScope = (caller: Pick<Caller, "scopes">, scope: ApiKeyScope) => caller.scopes.includes(scope);

export function requireScope(caller: Caller, scope: ApiKeyScope): Caller {
  if (!hasScope(caller, scope)) throw new ScopeError(scope);
  return caller;
}

/**
 * Permission check that works for both credentials: the JWT carries the role
 * for a session, but an API key only carries a user id, so the stored role is
 * read either way (`cortex/roles.ts`).
 */
export async function requireCallerPermission(request: Request, permission: Permission): Promise<Caller & { role: UserRole }> {
  const caller = await requireCaller(request);
  const role = await requirePermission(caller.userId, permission);
  return { ...caller, role };
}

function bearer(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

/** Test helper. */
export function resetApiKeysForTests() {
  memoryKeys.length = 0;
}
