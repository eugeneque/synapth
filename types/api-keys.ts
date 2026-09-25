/**
 * API keys, scopes and key policies (ТЗ §1, step 2 — FR-AI-10…14).
 *
 * A key is `sk_live_<32 chars>`, shown once, stored as SHA-256, valid for
 * 90 days by default and revoked instantly. Scopes say which operations the
 * key may call; the policy says which catalogue entries it may see, fetch or
 * execute. The policy is applied on the server *before* search, so an agent
 * never sees a forbidden option.
 *
 * Policies inherit: the owner's (organisation) policy is the floor and a key
 * can only tighten it (`tightenPolicy`).
 */

import type { SecurityLevel, SkillCategory, SkillManifest } from "@/types/skill";
import { SKILL_CATEGORIES } from "@/types/skill";
import { TRUST_RANK, type TrustLevel } from "@/types/trust";

export const API_KEY_SCOPES = ["catalog:read", "skills:fetch", "skills:execute", "packs:write"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const API_KEY_LIVE_PREFIX = "sk_live_";
export const API_KEY_TTL_DAYS = 90;
export const API_KEY_TTL_CHOICES = [30, 90, 180, 365] as const;
export const API_KEY_LABEL_MAX = 60;
/** Keys a user can hold at once, whatever the plan says about active ones. */
export const API_KEYS_MAX = 20;

/** Capability classes a policy can forbid (`filesystem` covers read and write). */
export const POLICY_PERMISSIONS = ["network", "filesystem", "shell", "env", "clipboard"] as const;
export type PolicyPermission = (typeof POLICY_PERMISSIONS)[number];

export interface KeyPolicy {
  /** Lowest trust level the key may receive. */
  minTrust: TrustLevel;
  deniedPermissions: PolicyPermission[];
  /** Allowed categories; null = all. */
  categories: SkillCategory[] | null;
  /** Skill / pack ids or slugs. A non-empty allow list admits only its entries. */
  allow: string[];
  deny: string[];
  /** Spend caps in micro-dollars (types/economy.ts); null = no cap. */
  maxPerCallMicros: number | null;
  maxDailyMicros: number | null;
}

/** The platform floor: Sandbox is never handed to agents by default (ТЗ §2, stage 6). */
export const DEFAULT_POLICY: KeyPolicy = {
  minTrust: "Community",
  deniedPermissions: [],
  categories: null,
  allow: [],
  deny: [],
  maxPerCallMicros: null,
  maxDailyMicros: null,
};

const minNullable = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.min(a, b));

/** Key policy on top of the owner's: every field can only get stricter. */
export function tightenPolicy(base: KeyPolicy, key: Partial<KeyPolicy> | null | undefined): KeyPolicy {
  if (!key) return base;
  const categories =
    base.categories && key.categories ? base.categories.filter((c) => key.categories!.includes(c)) : (base.categories ?? key.categories ?? null);
  const allow = base.allow.length && key.allow?.length ? base.allow.filter((a) => key.allow!.includes(a)) : base.allow.length ? base.allow : (key.allow ?? []);
  return {
    minTrust: key.minTrust && TRUST_RANK[key.minTrust] > TRUST_RANK[base.minTrust] ? key.minTrust : base.minTrust,
    deniedPermissions: [...new Set([...base.deniedPermissions, ...(key.deniedPermissions ?? [])])],
    categories,
    allow,
    deny: [...new Set([...base.deny, ...(key.deny ?? [])])],
    maxPerCallMicros: minNullable(base.maxPerCallMicros, key.maxPerCallMicros ?? null),
    maxDailyMicros: minNullable(base.maxDailyMicros, key.maxDailyMicros ?? null),
  };
}

/** What the policy needs to know about an entry. */
export interface PolicySubject {
  id: string;
  slug: string;
  category: SkillCategory;
  securityLevel: SecurityLevel;
  manifest: Pick<SkillManifest, "permissions">;
  /** Price per call in micro-dollars. */
  priceMicros: number;
}

export type PolicyRule = "min_trust" | "denied_permission" | "category" | "not_allowlisted" | "denylisted" | "price_per_call";

export type PolicyDecision = { ok: true } | { ok: false; rule: PolicyRule; detail: string };

/** Capability classes an entry needs, folded onto the policy's vocabulary. */
export function capabilityClasses(permissions: SkillManifest["permissions"]): PolicyPermission[] {
  const out = new Set<PolicyPermission>();
  for (const p of permissions ?? []) out.add(p.startsWith("filesystem") ? "filesystem" : (p as PolicyPermission));
  return [...out];
}

export function evaluatePolicy(policy: KeyPolicy, subject: PolicySubject): PolicyDecision {
  const ids = [subject.id, subject.slug];
  if (policy.deny.some((d) => ids.includes(d))) return { ok: false, rule: "denylisted", detail: `${subject.slug} is on the deny list` };
  if (policy.allow.length && !policy.allow.some((a) => ids.includes(a))) return { ok: false, rule: "not_allowlisted", detail: `${subject.slug} is not on the allow list` };
  if (subject.securityLevel === "Quarantine" || TRUST_RANK[subject.securityLevel] < TRUST_RANK[policy.minTrust]) {
    return { ok: false, rule: "min_trust", detail: `${subject.securityLevel} is below ${policy.minTrust}` };
  }
  if (policy.categories && !policy.categories.includes(subject.category)) return { ok: false, rule: "category", detail: `${subject.category} is not allowed` };
  const denied = capabilityClasses(subject.manifest.permissions).filter((p) => policy.deniedPermissions.includes(p));
  if (denied.length) return { ok: false, rule: "denied_permission", detail: `needs ${denied.join(", ")}` };
  if (policy.maxPerCallMicros !== null && subject.priceMicros > policy.maxPerCallMicros) return { ok: false, rule: "price_per_call", detail: "price per call is above the key limit" };
  return { ok: true };
}

/**
 * `pol` — the short restriction summary every agent response carries
 * (FR-AI-12), so the agent knows up front what it cannot get.
 */
export interface CompactPolicy {
  /** minimum trust */
  t: TrustLevel;
  /** denied capability classes */
  np?: PolicyPermission[];
  /** allowed categories */
  c?: SkillCategory[];
  /** per-call / daily caps, USD */
  pc?: number;
  pd?: number;
  /** allow-list active */
  al?: true;
}

export function compactPolicy(p: KeyPolicy): CompactPolicy {
  const out: CompactPolicy = { t: p.minTrust };
  if (p.deniedPermissions.length) out.np = p.deniedPermissions;
  if (p.categories && p.categories.length < SKILL_CATEGORIES.length) out.c = p.categories;
  if (p.maxPerCallMicros !== null) out.pc = p.maxPerCallMicros / 1_000_000;
  if (p.maxDailyMicros !== null) out.pd = p.maxDailyMicros / 1_000_000;
  if (p.allow.length) out.al = true;
  return out;
}

/** Public shape of a key: never the secret, never the hash. */
export interface ApiKeyInfo {
  id: string;
  label: string;
  prefix: string;
  scopes: ApiKeyScope[];
  policy: Partial<KeyPolicy>;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

export type ApiKeyStatus = "active" | "expired" | "revoked";

export function keyStatus(key: Pick<ApiKeyInfo, "expiresAt" | "revokedAt">, now = Date.now()): ApiKeyStatus {
  if (key.revokedAt) return "revoked";
  if (key.expiresAt && Date.parse(key.expiresAt) <= now) return "expired";
  return "active";
}
