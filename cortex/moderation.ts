/**
 * Cortex · Catalogue moderation
 *
 * `Verified` is the one level the scanner never assigns: a moderator (or an
 * admin) reviews the entry and the scanner is re-run with `reviewed: true`.
 * The scan still has the last word — an entry with high/critical findings
 * stays `Sandbox` whatever the reviewer says. Revoking re-runs the scan
 * without the review flag.
 *
 * Every catalogue kind goes through here (skills, MCP servers and tools are
 * one `Skill` today; skill packs will join as another entry kind).
 */

import { skillRepository } from "@/cortex/repository";
import { requirePermission } from "@/cortex/roles";
import { scanManifest } from "@/lib/sandbox-scanner";
import type { Skill } from "@/types/skill";

export class VerificationRefusedError extends Error {
  status = 422 as const;
  constructor(message: string) {
    super(message);
    this.name = "VerificationRefusedError";
  }
}

export class EntryNotFoundError extends Error {
  status = 404 as const;
  constructor() {
    super("Catalogue entry not found");
    this.name = "EntryNotFoundError";
  }
}

export async function setVerification(actorId: string, skillId: string, verified: boolean): Promise<Skill> {
  await requirePermission(actorId, "catalog.verify");
  const skill = await skillRepository.byId(skillId);
  if (!skill) throw new EntryNotFoundError();

  const scan = scanManifest(skill.manifest, { reviewed: verified });
  if (verified && scan.level !== "Verified") {
    const worst = scan.findings.filter((f) => f.severity === "critical" || f.severity === "high").map((f) => f.rule);
    throw new VerificationRefusedError(`The sandbox scan blocks verification (${worst.join(", ") || "too many medium findings"}); the manifest has to be fixed first`);
  }
  if (scan.level === skill.securityLevel) return skill;

  const updated = await skillRepository.setSecurityLevel(skill.id, scan.level, { reviewerId: actorId, scannerVersion: scan.scannerVersion, findings: scan.findings });
  if (!updated) throw new EntryNotFoundError();
  return updated;
}

export interface ModerationQueue {
  /** Clean scan, not yet human-reviewed: the entries a moderator can verify. */
  pending: Skill[];
  verified: Skill[];
  /** Blocked by the scanner; shown for context, cannot be verified until fixed. */
  sandboxed: number;
}

export async function moderationQueue(limit = 100): Promise<ModerationQueue> {
  const all = await skillRepository.all();
  const byReach = (a: Skill, b: Skill) => b.downloadsCount - a.downloadsCount || b.githubStars - a.githubStars;
  return {
    pending: all.filter((s) => s.securityLevel === "Community").sort(byReach).slice(0, limit),
    verified: all.filter((s) => s.securityLevel === "Verified").sort(byReach).slice(0, limit),
    sandboxed: all.filter((s) => s.securityLevel === "Sandbox").length,
  };
}
