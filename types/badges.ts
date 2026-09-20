/**
 * Achievement catalogue. Badges are code-defined (id + tier + how to earn);
 * only the award rows live in the store. Labels and descriptions come from
 * `lib/i18n` under `badge.<id>.title` / `badge.<id>.body`.
 *
 * `auto` badges are granted by `cortex/badges.ts` when `evaluateBadges()`
 * sees the criteria met; `manual` ones only via `grantBadge()` (admin / ops).
 */

export const BADGE_TIERS = ["bronze", "silver", "gold", "signal"] as const;
export type BadgeTier = (typeof BADGE_TIERS)[number];

export interface BadgeDefinition {
  id: string;
  tier: BadgeTier;
  /** Lucide icon name rendered by `<BadgeIcon />`. */
  icon: "layers" | "shield-check" | "bolt" | "sparkles" | "wrench" | "github" | "message-square" | "messages-square" | "zap" | "radio" | "eye" | "award" | "flag";
  award: "auto" | "manual";
}

export const BADGES = [
  { id: "first-skill", tier: "bronze", icon: "layers", award: "auto" },
  { id: "verified-publisher", tier: "gold", icon: "shield-check", award: "auto" },
  { id: "mcp-author", tier: "silver", icon: "bolt", award: "auto" },
  { id: "prompt-author", tier: "silver", icon: "sparkles", award: "auto" },
  { id: "tool-author", tier: "silver", icon: "wrench", award: "auto" },
  { id: "github-importer", tier: "bronze", icon: "github", award: "auto" },
  { id: "first-post", tier: "bronze", icon: "message-square", award: "auto" },
  { id: "conversationalist", tier: "silver", icon: "messages-square", award: "auto" },
  { id: "resonance", tier: "silver", icon: "zap", award: "auto" },
  { id: "magnet", tier: "gold", icon: "radio", award: "auto" },
  { id: "curator", tier: "bronze", icon: "eye", award: "auto" },
  { id: "early-adopter", tier: "signal", icon: "flag", award: "manual" },
  { id: "platform-admin", tier: "signal", icon: "award", award: "auto" },
] as const satisfies readonly BadgeDefinition[];

export type BadgeId = (typeof BADGES)[number]["id"];

export function isBadgeId(value: unknown): value is BadgeId {
  return typeof value === "string" && BADGES.some((b) => b.id === value);
}

export function badgeById(id: BadgeId): BadgeDefinition {
  return BADGES.find((b) => b.id === id)!;
}

/** Numbers the auto criteria are computed from; `cortex/badges.ts` assembles them per user. */
export interface BadgeSignals {
  skills: number;
  verifiedSkills: number;
  mcpSkills: number;
  promptSkills: number;
  toolSkills: number;
  githubSkills: number;
  posts: number;
  comments: number;
  impulsesReceived: number;
  watching: number;
  isAdmin: boolean;
}

/** Thresholds live next to the ids so the profile page can show "3 / 10" progress later. */
export const BADGE_CRITERIA: Record<Exclude<BadgeId, "early-adopter">, (s: BadgeSignals) => boolean> = {
  "first-skill": (s) => s.skills >= 1,
  "verified-publisher": (s) => s.verifiedSkills >= 1,
  "mcp-author": (s) => s.mcpSkills >= 1,
  "prompt-author": (s) => s.promptSkills >= 1,
  "tool-author": (s) => s.toolSkills >= 1,
  "github-importer": (s) => s.githubSkills >= 1,
  "first-post": (s) => s.posts >= 1,
  conversationalist: (s) => s.comments >= 10,
  resonance: (s) => s.impulsesReceived >= 5,
  magnet: (s) => s.impulsesReceived >= 50,
  curator: (s) => s.watching >= 5,
  "platform-admin": (s) => s.isAdmin,
};

export interface UserBadge {
  badgeId: BadgeId;
  awardedAt: string;
  /** User id of the admin for manual grants, null for automatic ones. */
  grantedBy: string | null;
}
