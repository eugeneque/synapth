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
 *
 * Reviews start from a request: any signed-in user asks for one from the
 * entry page (`requestModeration`), staff are notified, and a moderator
 * closes it on /dashboard/moderation/<id> with a verdict (`decideModeration`).
 * One open request per entry; the store is dual like the rest of Cortex.
 */

import { prisma, hasDatabase } from "@/cortex/db";
import { skillRepository } from "@/cortex/repository";
import { listStaffIds, requirePermission } from "@/cortex/roles";
import { getAuthorRefs } from "@/cortex/account";
import { notifyMany } from "@/cortex/notifications";
import { scanManifest, type ScanReport } from "@/lib/sandbox-scanner";
import { MODERATION_NOTE_MAX, type ModerationRequest, type ModerationStatus, type ModerationVerdict } from "@/types/moderation";
import type { SecurityLevel, Skill } from "@/types/skill";

export class VerificationRefusedError extends Error {
  status = 422 as const;
  constructor(message: string) {
    super(message);
    this.name = "VerificationRefusedError";
  }
}

export class ModerationRequestError extends Error {
  status: 400 | 404 | 409;
  constructor(message: string, status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = "ModerationRequestError";
    this.status = status;
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

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

interface RequestRow {
  id: string;
  skillId: string;
  requesterId: string;
  note: string | null;
  status: ModerationStatus;
  reviewerId: string | null;
  verdictNote: string | null;
  resultLevel: SecurityLevel | null;
  createdAt: string;
  decidedAt: string | null;
}

const g = globalThis as unknown as { __synapthModeration_v1?: RequestRow[] };
const memoryRequests: RequestRow[] = g.__synapthModeration_v1 ?? (g.__synapthModeration_v1 = []);

const newRequestId = () => `mod_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const isStatus = (v: string): v is ModerationStatus => v === "pending" || v === "approved" || v === "rejected";
const isLevel = (v: string | null): v is SecurityLevel => v === "Sandbox" || v === "Community" || v === "Verified";
/** Crawled entries belong to `gh:<owner>` pseudo-users, who cannot read notifications. */
const isPerson = (id: string) => !id.startsWith("gh:") && id !== "usr_platform";

function cleanNote(note: unknown): string | null {
  if (typeof note !== "string") return null;
  const trimmed = note.trim();
  if (trimmed.length > MODERATION_NOTE_MAX) throw new ModerationRequestError(`The note is limited to ${MODERATION_NOTE_MAX} characters`);
  return trimmed || null;
}

function fromDb(r: { id: string; skillId: string; requesterId: string; note: string | null; status: string; reviewerId: string | null; verdictNote: string | null; resultLevel: string | null; createdAt: Date; decidedAt: Date | null }): RequestRow {
  return { ...r, status: isStatus(r.status) ? r.status : "pending", resultLevel: isLevel(r.resultLevel) ? r.resultLevel : null, createdAt: r.createdAt.toISOString(), decidedAt: r.decidedAt?.toISOString() ?? null };
}

async function hydrate(rows: RequestRow[]): Promise<ModerationRequest[]> {
  const people = await getAuthorRefs(rows.flatMap((r) => [r.requesterId, ...(r.reviewerId ? [r.reviewerId] : [])]));
  const skills = new Map<string, Skill>();
  for (const id of new Set(rows.map((r) => r.skillId))) {
    const skill = await skillRepository.byId(id);
    if (skill) skills.set(id, skill);
  }
  return rows.map((r) => {
    const skill = skills.get(r.skillId);
    return {
      id: r.id,
      skill: skill ? { id: skill.id, slug: skill.slug, name: skill.name, securityLevel: skill.securityLevel, authorId: skill.authorId, authorName: skill.authorName } : null,
      requester: people.get(r.requesterId) ?? null,
      note: r.note,
      status: r.status,
      reviewer: r.reviewerId ? (people.get(r.reviewerId) ?? null) : null,
      verdictNote: r.verdictNote,
      resultLevel: r.resultLevel,
      createdAt: r.createdAt,
      decidedAt: r.decidedAt,
    };
  });
}

async function findPendingRow(skillId: string): Promise<RequestRow | null> {
  if (!hasDatabase) return memoryRequests.find((r) => r.skillId === skillId && r.status === "pending") ?? null;
  const row = await prisma.moderationRequest.findFirst({ where: { skillId, status: "pending" } });
  return row ? fromDb(row) : null;
}

async function findRow(id: string): Promise<RequestRow | null> {
  if (!hasDatabase) return memoryRequests.find((r) => r.id === id) ?? null;
  const row = await prisma.moderationRequest.findUnique({ where: { id } });
  return row ? fromDb(row) : null;
}

/** The open request on an entry, if any — the entry page shows "under review" instead of the button. */
export async function pendingRequestFor(skillId: string): Promise<ModerationRequest | null> {
  const row = await findPendingRow(skillId);
  return row ? (await hydrate([row]))[0] : null;
}

export async function getModerationRequest(id: string): Promise<ModerationRequest | null> {
  const row = await findRow(id);
  return row ? (await hydrate([row]))[0] : null;
}

/** Staff queue. Pending: oldest first (first come, first served); decided: newest first. */
export async function listModerationRequests(status: ModerationStatus | "decided", limit = 50): Promise<ModerationRequest[]> {
  const take = Math.min(Math.max(limit, 1), 200);
  const wanted = (s: ModerationStatus) => (status === "decided" ? s !== "pending" : s === status);
  const byTime = (a: RequestRow, b: RequestRow) => (status === "pending" ? a.createdAt.localeCompare(b.createdAt) : (b.decidedAt ?? b.createdAt).localeCompare(a.decidedAt ?? a.createdAt));
  if (!hasDatabase) return hydrate(memoryRequests.filter((r) => wanted(r.status)).sort(byTime).slice(0, take));
  const rows = await prisma.moderationRequest.findMany({
    where: status === "decided" ? { status: { not: "pending" } } : { status },
    orderBy: status === "pending" ? { createdAt: "asc" } : { decidedAt: "desc" },
    take,
  });
  return hydrate(rows.map(fromDb));
}

/**
 * A user asks staff to review an entry. Refused when the entry is already
 * Verified or already has an open request; every moderator and admin is
 * notified (except the requester, if they are staff themselves).
 */
export async function requestModeration(userId: string, skillId: string, rawNote?: unknown): Promise<ModerationRequest> {
  const skill = await skillRepository.byId(skillId);
  if (!skill) throw new EntryNotFoundError();
  if (skill.securityLevel === "Verified") throw new ModerationRequestError("This entry is already verified", 409);
  if (await findPendingRow(skill.id)) throw new ModerationRequestError("This entry is already waiting for review", 409);
  const note = cleanNote(rawNote);

  let row: RequestRow;
  if (!hasDatabase) {
    row = { id: newRequestId(), skillId: skill.id, requesterId: userId, note, status: "pending", reviewerId: null, verdictNote: null, resultLevel: null, createdAt: new Date().toISOString(), decidedAt: null };
    memoryRequests.push(row);
  } else {
    row = fromDb(await prisma.moderationRequest.create({ data: { skillId: skill.id, requesterId: userId, note } }));
  }

  await notifyMany(await listStaffIds(), {
    kind: "moderation.requested",
    actorId: userId,
    subject: { kind: "moderation.requested", requestId: row.id, skillId: skill.id, slug: skill.slug, skillName: skill.name },
  });
  return (await hydrate([row]))[0];
}

/** What the reviewer sees when they press "Run scanner": the plain scan and what a verification would yield. */
export async function rescanForReview(actorId: string, skillId: string): Promise<{ report: ScanReport; verifiable: boolean; scannedAt: string }> {
  await requirePermission(actorId, "catalog.moderate");
  const skill = await skillRepository.byId(skillId);
  if (!skill) throw new EntryNotFoundError();
  const report = scanManifest(skill.manifest);
  return { report, verifiable: scanManifest(skill.manifest, { reviewed: true }).level === "Verified", scannedAt: new Date().toISOString() };
}

/**
 * Closes a pending request. `approve` goes through `setVerification`, so the
 * scanner can still refuse (the request stays open then); `reject` leaves the
 * entry's level unchanged. The requester and the author are notified.
 */
export async function decideModeration(actorId: string, requestId: string, verdict: ModerationVerdict, rawNote?: unknown): Promise<ModerationRequest> {
  await requirePermission(actorId, "catalog.verify");
  const row = await findRow(requestId);
  if (!row) throw new ModerationRequestError("Moderation request not found", 404);
  if (row.status !== "pending") throw new ModerationRequestError("This request is already closed", 409);
  const note = cleanNote(rawNote);
  if (verdict === "reject" && !note) throw new ModerationRequestError("Explain the rejection so the author can fix it");

  const skill = await skillRepository.byId(row.skillId);
  if (!skill) throw new EntryNotFoundError();
  const result = verdict === "approve" ? await setVerification(actorId, skill.id, true) : skill;
  const status: ModerationStatus = verdict === "approve" ? "approved" : "rejected";
  const decidedAt = new Date();

  let updated: RequestRow;
  if (!hasDatabase) {
    Object.assign(row, { status, reviewerId: actorId, verdictNote: note, resultLevel: result.securityLevel, decidedAt: decidedAt.toISOString() });
    updated = row;
  } else {
    // Guard against two reviewers closing the same request at once.
    const res = await prisma.moderationRequest.updateMany({ where: { id: row.id, status: "pending" }, data: { status, reviewerId: actorId, verdictNote: note, resultLevel: result.securityLevel, decidedAt } });
    if (!res.count) throw new ModerationRequestError("This request is already closed", 409);
    updated = { ...row, status, reviewerId: actorId, verdictNote: note, resultLevel: result.securityLevel, decidedAt: decidedAt.toISOString() };
  }

  await notifyMany([row.requesterId, skill.authorId].filter(isPerson), {
    kind: "moderation.decided",
    actorId,
    subject: { kind: "moderation.decided", requestId: row.id, skillId: skill.id, slug: skill.slug, skillName: skill.name, verdict: status === "approved" ? "approved" : "rejected", note },
  });
  return (await hydrate([updated]))[0];
}

/** Test helper for the in-memory store. */
export function resetModerationForTests() {
  memoryRequests.length = 0;
}
