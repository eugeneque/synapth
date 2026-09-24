/**
 * Achievement catalogue. Badges are code-defined (id + tier + how to earn);
 * only the award rows live in the store. Labels and descriptions come from
 * `lib/i18n` under `badge.<id>.title` / `badge.<id>.body`.
 *
 * `auto` badges are granted by `cortex/badges.ts` when `evaluateBadges()`
 * sees the criteria met; `manual` ones only via `grantBadge()` (admin / ops).
 * `unique` badges mirror a flag on the account: `evaluateBadges()` also takes
 * them away once the criteria stop holding, and `grantBadge()` refuses them.
 */

/** `astra` is reserved for unique, role-bound achievements (see `unique`). */
export const BADGE_TIERS = ["bronze", "silver", "gold", "signal", "astra"] as const;
export type BadgeTier = (typeof BADGE_TIERS)[number];

export interface BadgeDefinition {
  id: string;
  tier: BadgeTier;
  /** Lucide fallback rendered by `<BadgeMedal />` until the badge has its own artwork. */
  icon: "rocket" | "message-square" | "layers" | "heart" | "sprout" | "crown" | "hourglass" | "users" | "hexagon" | "zap" | "activity" | "cloud-lightning";
  /** Artwork under `public/badges/`; takes precedence over `icon`. */
  image?: string;
  award: "auto" | "manual";
  /** Bound to an account flag: revoked with it, never granted by hand, left out of the hover-card meter unless held. */
  unique?: boolean;
  /** Render the body under the title as a motto instead of the criteria text. */
  motto?: boolean;
}

/** Catalogue order is display order. */
export const BADGES = [
  { id: "platform-developer", tier: "astra", icon: "rocket", award: "auto", unique: true, motto: true },
  { id: "first-skill", tier: "bronze", icon: "sprout", award: "auto" },
  { id: "first-post", tier: "bronze", icon: "message-square", award: "auto" },
  { id: "resonance", tier: "bronze", icon: "zap", award: "auto" },
  { id: "impulse", tier: "silver", icon: "activity", award: "auto" },
  { id: "skillmaster", tier: "gold", icon: "layers", award: "auto" },
  { id: "goat", tier: "gold", icon: "crown", award: "auto" },
  { id: "community-favorite", tier: "gold", icon: "users", award: "auto" },
  { id: "veteran", tier: "gold", icon: "hourglass", award: "auto" },
  { id: "community-pride", tier: "signal", icon: "heart", award: "auto" },
  { id: "thunderstorm", tier: "signal", icon: "cloud-lightning", award: "auto" },
  { id: "five", tier: "signal", icon: "hexagon", award: "auto" },
] as const satisfies readonly BadgeDefinition[];

export type BadgeId = (typeof BADGES)[number]["id"];

export function isBadgeId(value: unknown): value is BadgeId {
  return typeof value === "string" && BADGES.some((b) => b.id === value);
}

/** Badges that count towards the hover-card meter for someone holding `held`. */
export function meterBadgeCount(held: readonly string[]): number {
  return BADGES.filter((b: BadgeDefinition) => !b.unique || held.includes(b.id)).length;
}

export function badgeById(id: BadgeId): BadgeDefinition {
  return BADGES.find((b) => b.id === id)!;
}

/** How many of each kind the "five" badge wants, all verified. `Plugin` has no catalogue category yet, so it stays unreachable until one exists. */
export const FIVE_KINDS = ["skillset", "Prompt", "MCP", "Plugin"] as const;
export type FiveKind = (typeof FIVE_KINDS)[number];

/** Numbers the auto criteria are computed from; `cortex/badges.ts` assembles them per user. */
export interface BadgeSignals {
  skills: number;
  /** Largest `downloadsCount` among the user's own catalogue entries. */
  topInstalls: number;
  /** Verified entries per kind (skills by category, skillsets by `verified`). */
  verified: Record<FiveKind, number>;
  posts: number;
  impulsesReceived: number;
  friends: number;
  /** Whole days since the account was created. */
  accountAgeDays: number;
  /** `User.developer` — builds the platform itself. */
  isDeveloper: boolean;
}

export const BADGE_THRESHOLDS = {
  skillmaster: 25,
  goat: 500,
  communityPride: 1000,
  veteranDays: 5 * 365,
  communityFavorite: 500,
  five: 5,
  resonance: 5,
  impulse: 100,
  thunderstorm: 1000,
} as const;

const T = BADGE_THRESHOLDS;

/** Thresholds live next to the ids so the profile page can show "3 / 10" progress later. */
export const BADGE_CRITERIA: Record<BadgeId, (s: BadgeSignals) => boolean> = {
  "platform-developer": (s) => s.isDeveloper,
  "first-skill": (s) => s.skills >= 1,
  "first-post": (s) => s.posts >= 1,
  resonance: (s) => s.impulsesReceived >= T.resonance,
  impulse: (s) => s.impulsesReceived >= T.impulse,
  skillmaster: (s) => s.skills >= T.skillmaster,
  goat: (s) => s.topInstalls >= T.goat,
  "community-favorite": (s) => s.friends > T.communityFavorite,
  veteran: (s) => s.accountAgeDays >= T.veteranDays,
  "community-pride": (s) => s.topInstalls >= T.communityPride,
  thunderstorm: (s) => s.impulsesReceived >= T.thunderstorm,
  five: (s) => FIVE_KINDS.every((k) => s.verified[k] >= T.five),
};

export interface UserBadge {
  badgeId: BadgeId;
  awardedAt: string;
  /** User id of the admin for manual grants, null for automatic ones. */
  grantedBy: string | null;
}
