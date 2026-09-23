/**
 * Moderation requests: a user asks staff to review a catalogue entry
 * (skill / MCP server / tool — all one `Skill`); a moderator or admin runs the
 * scanner, reads the entry and closes the request with a verdict.
 * `approved` sets `Verified` through the scanner's review path; `rejected`
 * leaves the level as it was.
 */

import type { AuthorRef } from "@/types/social";
import type { SecurityLevel } from "@/types/skill";

export const MODERATION_STATUSES = ["pending", "approved", "rejected"] as const;
export type ModerationStatus = (typeof MODERATION_STATUSES)[number];
export type ModerationVerdict = "approve" | "reject";

export const MODERATION_NOTE_MAX = 1000;

export interface ModerationRequest {
  id: string;
  skill: { id: string; slug: string; name: string; securityLevel: SecurityLevel; authorId: string; authorName: string } | null;
  requester: AuthorRef | null;
  note: string | null;
  status: ModerationStatus;
  reviewer: AuthorRef | null;
  verdictNote: string | null;
  resultLevel: SecurityLevel | null;
  createdAt: string;
  decidedAt: string | null;
}
