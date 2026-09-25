/**
 * Skillsets: hand-made bundles of catalogue entries (skills, MCP servers,
 * plugins/tools — all one `Skill`) that install with one command. Created and
 * edited on the platform only (never crawled); every composition change is
 * written to the history log. `verified` is set by staff (`catalog.verify`)
 * and dropped automatically when the composition changes, so a reviewed set
 * cannot silently gain an unreviewed entry.
 */

import type { AuthorRef } from "@/types/social";
import type { SecurityLevel, SkillCategory } from "@/types/skill";
import type { PackTrustLevel } from "@/types/trust";

export const SKILLSET_NAME_MAX = 80;
export const SKILLSET_SUMMARY_MAX = 280;
export const SKILLSET_DESCRIPTION_MAX = 20_000;
export const SKILLSET_ITEMS_MAX = 50;

/** Square avatar, same pipeline as profile avatars (`axon/image.ts`). */
export const SKILLSET_AVATAR = { width: 256, height: 256, maxBytes: 160 * 1024 } as const;
/** Images inserted into the description: scaled to fit, never cropped. */
export const SKILLSET_IMAGE = { width: 1600, height: 1600, maxBytes: 900 * 1024 } as const;
/** Description images are served from here and referenced by this path in the markdown. */
export const SKILLSET_IMAGE_PATH = "/api/v1/skillsets/images/";

/** The catalogue entry behind an item, as much as cards and the history need. */
export interface SkillsetSkillRef {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: SkillCategory;
  securityLevel: SecurityLevel;
  version: string;
  authorName: string;
}

export interface SkillsetItem {
  /** Null when the entry was removed from the catalogue after it was added. */
  skill: SkillsetSkillRef | null;
  skillId: string;
  addedAt: string;
  addedBy: string;
}

export interface Skillset {
  id: string;
  slug: string;
  name: string;
  summary: string;
  /** Markdown; images point at `SKILLSET_IMAGE_PATH<id>`. */
  description: string;
  /** `data:image/*;base64` or null → generated monogram. */
  avatar: string | null;
  author: AuthorRef;
  items: SkillsetItem[];
  /** Moderator certificate (Certified); `trust` is what agents and filters compare against. */
  verified: boolean;
  /** Derived from the items and the certificate (`packTrust`, types/trust.ts). */
  trust: PackTrustLevel;
  verifiedBy: AuthorRef | null;
  verifiedAt: string | null;
  favorites: number;
  createdAt: string;
  updatedAt: string;
}

/** Card / list shape: no description body, items reduced to counts. */
export interface SkillsetSummary {
  id: string;
  slug: string;
  name: string;
  summary: string;
  avatar: string | null;
  author: AuthorRef;
  verified: boolean;
  favorites: number;
  counts: Record<SkillCategory, number>;
  createdAt: string;
  updatedAt: string;
}

export const SKILLSET_CHANGE_ACTIONS = ["created", "added", "removed", "edited", "verified", "unverified"] as const;
export type SkillsetChangeAction = (typeof SKILLSET_CHANGE_ACTIONS)[number];

/** Metadata fields an `edited` entry can name. */
export const SKILLSET_FIELDS = ["name", "summary", "description", "avatar"] as const;
export type SkillsetField = (typeof SKILLSET_FIELDS)[number];

/**
 * One line of "История изменений". `added` / `removed` carry the skill
 * (name and slug are snapshotted so the line survives a catalogue removal);
 * `unverified` with `auto: true` is the automatic reset after a composition change.
 */
export interface SkillsetChange {
  id: string;
  skillsetId: string;
  actor: AuthorRef | null;
  action: SkillsetChangeAction;
  skillId: string | null;
  skillName: string | null;
  skillSlug: string | null;
  fields: SkillsetField[];
  auto: boolean;
  createdAt: string;
}

export type SkillsetSort = "recent" | "popular" | "updated";

export interface SkillsetQuery {
  q?: string;
  verified?: boolean;
  authorId?: string;
  /** Only sets that contain this skill. */
  skillId?: string;
  sort?: SkillsetSort;
  limit?: number;
}
