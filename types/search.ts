/**
 * Global search: one box in the header over people, catalogue entries and
 * skillsets. Rows are compact so the dropdown renders without extra lookups.
 */

import type { SecurityLevel, SkillCategory, SkillSource } from "@/types/skill";
import type { AuthorRef } from "@/types/social";

export const SEARCH_TABS = ["all", "people", "skills", "skillsets"] as const;
export type SearchTab = (typeof SEARCH_TABS)[number];

export type GlobalHit =
  | { kind: "user"; id: string; person: AuthorRef; bio: string }
  | { kind: "skill"; id: string; slug: string; name: string; category: SkillCategory; description: string; authorName: string; image: string | null; securityLevel: SecurityLevel; downloads: number; source: SkillSource }
  | { kind: "skillset"; id: string; slug: string; name: string; summary: string; avatar: string | null; author: AuthorRef; verified: boolean; entries: number };

export interface GlobalSearchResponse {
  q: string;
  items: GlobalHit[];
}

/** How many rows the header dropdown shows. */
export const GLOBAL_SEARCH_LIMIT = 10;
