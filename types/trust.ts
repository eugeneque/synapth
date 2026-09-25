/**
 * Trust ladder (ТЗ §2): what a skill or a pack is allowed to do depends on
 * how far it climbed.
 *
 *   skills : Quarantine < Sandbox < Community < Verified < Gov
 *   packs  :              Sandbox < Community < Certified < Gov
 *
 * Automated stages never lift trust above Community. Verified and Certified
 * come only from moderators (`reviewed: true` / `catalog.verify`), Gov only
 * from a gov-moderator on top of Verified.
 *
 * "Rejected" is a scan outcome, not a level: the version is never published.
 * "Quarantine" is stored: the entry is hidden from the catalogue and the
 * agent API, installs receive `revoked`.
 */

import type { SecurityLevel } from "@/types/skill";

/** Outcome of the automated pipeline (stages 1–6) before any human review. */
export const SCAN_OUTCOMES = ["Rejected", "Quarantine", "Sandbox", "Community"] as const;
export type ScanOutcome = (typeof SCAN_OUTCOMES)[number];

export const PACK_TRUST_LEVELS = ["Sandbox", "Community", "Certified", "Gov"] as const;
export type PackTrustLevel = (typeof PACK_TRUST_LEVELS)[number];

/** Any rung of either ladder — what key policies compare against. */
export type TrustLevel = SecurityLevel | PackTrustLevel;

/** Ordinal on a shared axis: Verified (skills) and Certified (packs) sit on the same rung. */
export const TRUST_RANK: Record<TrustLevel, number> = {
  Quarantine: -1,
  Sandbox: 0,
  Community: 1,
  Verified: 2,
  Certified: 2,
  Gov: 3,
};

/** `trust` term of the agent ranking formula (ТЗ §1, step 4). */
export const TRUST_WEIGHT: Record<TrustLevel, number> = {
  Quarantine: 0,
  Sandbox: 0,
  Community: 0.5,
  Verified: 0.8,
  Certified: 1,
  Gov: 1,
};

export function meetsTrust(level: TrustLevel, min: TrustLevel): boolean {
  return TRUST_RANK[level] >= TRUST_RANK[min];
}

/** Levels a human decision produced; a new version keeps them only when nothing relevant changed. */
export const REVIEWED_LEVELS: readonly SecurityLevel[] = ["Verified", "Gov"];
export const isReviewedLevel = (level: SecurityLevel) => REVIEWED_LEVELS.includes(level);

/** Quarantined entries never reach the catalogue, search or agents. */
export const isListed = (level: SecurityLevel) => level !== "Quarantine";

/** Minimum risk score (0..100) to file for Verified (ТЗ §2, stage 7). */
export const VERIFIED_MIN_SCORE = 85;

/**
 * Trust of a pack (skillset) from its items and the moderator's certificate
 * (`Skillset.verified`). PK-SEC: any Sandbox or quarantined item pulls the pack
 * to Sandbox and voids the certificate. Whether Certified also requires every
 * item to be Verified is an open question of the ТЗ (§6, q. 2) — today the
 * moderator's review is enough; Gov needs every item to be Gov.
 */
export function packTrust(itemLevels: readonly SecurityLevel[], certified: boolean): PackTrustLevel {
  if (itemLevels.some((l) => l === "Sandbox" || l === "Quarantine")) return "Sandbox";
  if (!certified) return "Community";
  return itemLevels.length > 0 && itemLevels.every((l) => l === "Gov") ? "Gov" : "Certified";
}
