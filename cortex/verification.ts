/**
 * Cortex · Account verification
 *
 * The check mark next to a developer's name. See types/verification.ts for
 * the rules and the stage model. In short:
 *
 *   submitted — the applicant gave a phone number and meets the account-age
 *               and impulse thresholds (otherwise nothing is filed);
 *   scan      — every skill of the applicant is re-scanned; a single finding
 *               rejects the request on the spot (`scan_failed`);
 *   review    — queued for an admin (`waiting`) until one claims it (`active`);
 *   decision  — approved (the mark is set) or rejected with a reason.
 *
 * Admins can also grant or revoke the mark directly (`grantUserVerification`,
 * `revokeUserVerification`); a grant closes any open request as approved.
 * One open request per user. Same dual store as the rest of Cortex.
 */

import { prisma, hasDatabase } from "@/cortex/db";
import { getAuthorRefs, getProfile, setAccountVerification } from "@/cortex/account";
import { skillRepository } from "@/cortex/repository";
import { impulseSummary } from "@/cortex/social";
import { notify, notifyMany } from "@/cortex/notifications";
import { listStaffIds, requirePermission } from "@/cortex/roles";
import { scanSkill } from "@/lib/sandbox-scanner";
import {
  VERIFICATION_NOTE_MAX,
  VERIFICATION_RULES,
  maskPhone,
  normalizePhone,
  type Eligibility,
  type VerificationEvent,
  type VerificationEventCode,
  type VerificationRequest,
  type VerificationRules,
  type VerificationStage,
  type VerificationState,
  type VerificationStatus,
} from "@/types/verification";
import type { AuthorRef } from "@/types/social";

export class VerificationError extends Error {
  status: 400 | 404 | 409 | 422;
  code: string;
  constructor(message: string, code: string, status: 400 | 404 | 409 | 422 = 400) {
    super(message);
    this.name = "VerificationError";
    this.code = code;
    this.status = status;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/** Test seam: the clock and the thresholds; production code passes nothing. */
export interface EligibilityOptions {
  now?: Date;
  rules?: VerificationRules;
}

/**
 * Where the user stands against the rules. `phone` is the number they are
 * about to submit (null in the settings preview until they type one).
 * Skills are those the profile page shows: published on the platform or
 * crawled under the same GitHub owner as the handle.
 */
export async function checkEligibility(userId: string, phone: string | null, { now = new Date(), rules = VERIFICATION_RULES }: EligibilityOptions = {}): Promise<Eligibility> {
  const profile = await getProfile(userId);
  if (!profile) throw new VerificationError("User not found", "not_found", 404);
  const [all, impulses] = await Promise.all([skillRepository.all(), impulseSummary(userId)]);
  const handle = profile.handle.toLowerCase();
  const skills = all.filter((s) => s.authorId === userId || (handle && s.source?.owner.toLowerCase() === handle));
  const flaggedSkills = skills
    // Only findings that keep an entry out of Community count: medium hygiene (unpinned npx, permission combos) does not.
    .map((s) => ({ id: s.id, slug: s.slug, name: s.name, findings: scanSkill(s).findings.filter((f) => f.verdict || f.severity === "high" || f.severity === "critical").length }))
    .filter((s) => s.findings > 0);
  const ageDays = Math.max(0, Math.floor((now.getTime() - new Date(profile.createdAt).getTime()) / DAY_MS));
  const checks: Eligibility["checks"] = [
    { id: "phone", ok: Boolean(phone && normalizePhone(phone)), value: phone && normalizePhone(phone) ? 1 : 0, required: 1 },
    { id: "age", ok: ageDays >= rules.minAccountAgeDays, value: ageDays, required: rules.minAccountAgeDays },
    { id: "impulses", ok: impulses.total >= rules.minImpulses, value: impulses.total, required: rules.minImpulses },
    { id: "skills", ok: flaggedSkills.length === 0, value: flaggedSkills.length, required: 0 },
  ];
  return { canApply: checks.filter((c) => c.id !== "skills").every((c) => c.ok), checks, flaggedSkills, skillsScanned: skills.length };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface Row {
  id: string;
  userId: string;
  phone: string;
  status: VerificationStatus;
  stage: VerificationStage;
  events: VerificationEvent[];
  eligibility: Eligibility;
  reviewerId: string | null;
  decisionNote: string | null;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
}

const g = globalThis as unknown as { __synapthVerification_v1?: Row[] };
const memoryRows: Row[] = g.__synapthVerification_v1 ?? (g.__synapthVerification_v1 = []);

const newId = () => `ver_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const isStatus = (v: string): v is VerificationStatus => v === "pending" || v === "approved" || v === "rejected" || v === "withdrawn";
const isStage = (v: string): v is VerificationStage => v === "submitted" || v === "scan" || v === "review" || v === "decision";

type DbRow = { id: string; userId: string; phone: string; status: string; stage: string; events: unknown; eligibility: unknown; reviewerId: string | null; decisionNote: string | null; createdAt: Date; updatedAt: Date; decidedAt: Date | null };

function fromDb(r: DbRow): Row {
  return {
    id: r.id,
    userId: r.userId,
    phone: r.phone,
    status: isStatus(r.status) ? r.status : "pending",
    stage: isStage(r.stage) ? r.stage : "submitted",
    events: Array.isArray(r.events) ? (r.events as VerificationEvent[]) : [],
    eligibility: r.eligibility as Eligibility,
    reviewerId: r.reviewerId,
    decisionNote: r.decisionNote,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
  };
}

async function findRow(id: string): Promise<Row | null> {
  if (!hasDatabase) return memoryRows.find((r) => r.id === id) ?? null;
  const row = await prisma.verificationRequest.findUnique({ where: { id } });
  return row ? fromDb(row) : null;
}

async function latestRowFor(userId: string): Promise<Row | null> {
  if (!hasDatabase) return [...memoryRows].reverse().find((r) => r.userId === userId) ?? null;
  const row = await prisma.verificationRequest.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
  return row ? fromDb(row) : null;
}

async function openRowFor(userId: string): Promise<Row | null> {
  if (!hasDatabase) return memoryRows.find((r) => r.userId === userId && r.status === "pending") ?? null;
  const row = await prisma.verificationRequest.findFirst({ where: { userId, status: "pending" } });
  return row ? fromDb(row) : null;
}

/**
 * Writes the row back. Transitions of a pending request are guarded on the
 * status still being `pending`, so two admins cannot decide the same request.
 */
async function save(row: Row, { guardPending = true }: { guardPending?: boolean } = {}): Promise<Row> {
  row.updatedAt = new Date().toISOString();
  if (!hasDatabase) return row;
  const data = { status: row.status, stage: row.stage, events: row.events as unknown as object[], reviewerId: row.reviewerId, decisionNote: row.decisionNote, decidedAt: row.decidedAt ? new Date(row.decidedAt) : null };
  const res = await prisma.verificationRequest.updateMany({ where: { id: row.id, ...(guardPending ? { status: "pending" } : {}) }, data });
  if (!res.count) throw new VerificationError("This request is already closed", "closed", 409);
  return row;
}

function event(stage: VerificationStage, state: VerificationEvent["state"], code: VerificationEventCode, actorId: string | null = null, note: string | null = null): VerificationEvent {
  return { stage, state, code, at: new Date().toISOString(), actorId, note };
}

function cleanNote(note: unknown, { required = false }: { required?: boolean } = {}): string | null {
  const trimmed = typeof note === "string" ? note.trim() : "";
  if (trimmed.length > VERIFICATION_NOTE_MAX) throw new VerificationError(`The note is limited to ${VERIFICATION_NOTE_MAX} characters`, "note_too_long");
  if (required && !trimmed) throw new VerificationError("Explain the decision so the developer knows what to fix", "note_required");
  return trimmed || null;
}

async function hydrate(rows: Row[], { maskFor }: { maskFor?: string } = {}): Promise<VerificationRequest[]> {
  const ids = rows.flatMap((r) => [r.userId, ...(r.reviewerId ? [r.reviewerId] : []), ...r.events.flatMap((e) => (e.actorId ? [e.actorId] : []))]);
  const people = await getAuthorRefs(ids);
  const ref = (id: string): AuthorRef => people.get(id) ?? { id, name: "Unknown", handle: id, image: null, occupation: null };
  return rows.map((r) => ({
    id: r.id,
    user: ref(r.userId),
    phone: maskFor === r.userId ? maskPhone(r.phone) : r.phone,
    status: r.status,
    stage: r.stage,
    events: r.events.map((e) => ({ ...e, actor: e.actorId ? ref(e.actorId) : null })),
    eligibility: r.eligibility,
    reviewer: r.reviewerId ? ref(r.reviewerId) : null,
    decisionNote: r.decisionNote,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    decidedAt: r.decidedAt,
  }));
}

// ---------------------------------------------------------------------------
// Applicant
// ---------------------------------------------------------------------------

/** What the settings panel polls. The phone in the request is masked: this is the owner's own view. */
export async function verificationState(userId: string): Promise<VerificationState> {
  const [profile, row, eligibility] = await Promise.all([getProfile(userId), latestRowFor(userId), checkEligibility(userId, null)]);
  return {
    verified: profile?.verified ?? null,
    request: row ? (await hydrate([row], { maskFor: userId }))[0] : null,
    eligibility,
    serverTime: new Date().toISOString(),
  };
}

/**
 * Files a request. Refused (nothing stored) unless the phone, account age and
 * impulse thresholds are met. The scan stage runs right away: any finding in
 * any of the applicant's skills closes the request as `rejected`; a clean scan
 * queues it for review and notifies the admins.
 */
export async function submitVerification(userId: string, rawPhone: unknown, options: EligibilityOptions = {}): Promise<VerificationRequest> {
  const profile = await getProfile(userId);
  if (!profile) throw new VerificationError("User not found", "not_found", 404);
  if (profile.verified) throw new VerificationError("This account is already verified", "already_verified", 409);
  if (await openRowFor(userId)) throw new VerificationError("A verification request is already in progress", "already_pending", 409);
  const phone = normalizePhone(typeof rawPhone === "string" ? rawPhone : "");
  if (!phone) throw new VerificationError("Enter the phone number in international format, e.g. +79991234567", "phone_invalid");

  const eligibility = await checkEligibility(userId, phone, options);
  if (!eligibility.canApply) {
    const missing = eligibility.checks.filter((c) => !c.ok && c.id !== "skills").map((c) => c.id);
    throw new VerificationError(`Requirements not met: ${missing.join(", ")}`, "not_eligible", 422);
  }

  const now = new Date().toISOString();
  let row: Row = { id: newId(), userId, phone, status: "pending", stage: "scan", events: [event("submitted", "done", "eligible")], eligibility, reviewerId: null, decisionNote: null, createdAt: now, updatedAt: now, decidedAt: null };
  if (!hasDatabase) memoryRows.push(row);
  else row = fromDb(await prisma.verificationRequest.create({ data: { userId, phone, status: row.status, stage: row.stage, events: row.events as unknown as object[], eligibility: eligibility as unknown as object } }));

  // Scan stage: the eligibility snapshot above already ran the scanner over every skill.
  if (eligibility.flaggedSkills.length > 0) {
    const names = eligibility.flaggedSkills.map((s) => s.name).join(", ");
    row.events.push(event("scan", "failed", "scan_failed", null, names), event("decision", "failed", "scan_failed"));
    Object.assign(row, { status: "rejected", stage: "decision", decisionNote: names, decidedAt: new Date().toISOString() });
    await save(row);
    await notify({ userId, kind: "verification.updated", actorId: null, subject: { kind: "verification.updated", requestId: row.id, code: "scan_failed", note: names } });
  } else {
    row.events.push(event("scan", "done", "scan_clean", null, String(eligibility.skillsScanned)), event("review", "waiting", "queued"));
    row.stage = "review";
    await save(row);
    await notifyMany(await listStaffIds("users.verify"), { kind: "verification.requested", actorId: userId, subject: { kind: "verification.requested", requestId: row.id } });
  }
  return (await hydrate([row], { maskFor: userId }))[0];
}

/** The applicant takes back an open request. */
export async function withdrawVerification(userId: string): Promise<VerificationRequest> {
  const row = await openRowFor(userId);
  if (!row) throw new VerificationError("There is no open request to withdraw", "no_open_request", 404);
  row.events.push(event("decision", "failed", "withdrawn", userId));
  Object.assign(row, { status: "withdrawn", stage: "decision", decidedAt: new Date().toISOString() });
  await save(row);
  return (await hydrate([row], { maskFor: userId }))[0];
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

/** Queue: open requests oldest first (first come, first served); closed ones newest first. */
export async function listVerificationRequests(actorId: string, filter: "open" | "closed", limit = 50): Promise<VerificationRequest[]> {
  await requirePermission(actorId, "users.verify");
  const take = Math.min(Math.max(limit, 1), 200);
  if (!hasDatabase) {
    const rows = memoryRows.filter((r) => (filter === "open" ? r.status === "pending" : r.status !== "pending"));
    rows.sort((a, b) => (filter === "open" ? a.createdAt.localeCompare(b.createdAt) : (b.decidedAt ?? b.updatedAt).localeCompare(a.decidedAt ?? a.updatedAt)));
    return hydrate(rows.slice(0, take));
  }
  const rows = await prisma.verificationRequest.findMany({
    where: filter === "open" ? { status: "pending" } : { status: { not: "pending" } },
    orderBy: filter === "open" ? { createdAt: "asc" } : { updatedAt: "desc" },
    take,
  });
  return hydrate(rows.map(fromDb));
}

export async function countOpenVerifications(): Promise<number> {
  if (!hasDatabase) return memoryRows.filter((r) => r.status === "pending").length;
  return prisma.verificationRequest.count({ where: { status: "pending" } });
}

export async function getVerificationRequest(actorId: string, id: string): Promise<VerificationRequest | null> {
  await requirePermission(actorId, "users.verify");
  const row = await findRow(id);
  return row ? (await hydrate([row]))[0] : null;
}

async function requireOpen(id: string): Promise<Row> {
  const row = await findRow(id);
  if (!row) throw new VerificationError("Verification request not found", "not_found", 404);
  if (row.status !== "pending") throw new VerificationError("This request is already closed", "closed", 409);
  return row;
}

/** "Take into review": the applicant sees the review stage go live with the admin's name. */
export async function claimVerification(actorId: string, id: string): Promise<VerificationRequest> {
  await requirePermission(actorId, "users.verify");
  const row = await requireOpen(id);
  if (row.stage !== "review") throw new VerificationError("The request is not waiting for review", "wrong_stage", 409);
  if (row.userId === actorId) throw new VerificationError("You cannot review your own request", "self", 409);
  if (row.reviewerId === actorId) return (await hydrate([row]))[0];
  row.events.push(event("review", "active", "claimed", actorId));
  row.reviewerId = actorId;
  await save(row);
  await notify({ userId: row.userId, kind: "verification.updated", actorId, subject: { kind: "verification.updated", requestId: row.id, code: "claimed", note: null } });
  return (await hydrate([row]))[0];
}

/**
 * Closes a request under review. Approval re-runs the skills scan (the
 * applicant may have published since) and refuses while anything is flagged;
 * rejection needs a reason. The applicant is notified either way.
 */
export async function decideVerification(actorId: string, id: string, verdict: "approve" | "reject", rawNote?: unknown): Promise<VerificationRequest> {
  await requirePermission(actorId, "users.verify");
  const row = await requireOpen(id);
  if (row.stage !== "review") throw new VerificationError("The request is not waiting for review", "wrong_stage", 409);
  if (row.userId === actorId) throw new VerificationError("You cannot decide your own request", "self", 409);
  const note = cleanNote(rawNote, { required: verdict === "reject" });

  if (verdict === "approve") {
    const fresh = await checkEligibility(row.userId, row.phone);
    if (fresh.flaggedSkills.length > 0) throw new VerificationError(`The scanner flags ${fresh.flaggedSkills.map((s) => s.name).join(", ")} — reject or wait for a fix`, "scan_failed", 422);
  }

  const approved = verdict === "approve";
  if (!row.reviewerId) row.events.push(event("review", "active", "claimed", actorId));
  row.events.push(event("review", "done", approved ? "approved" : "rejected", actorId), event("decision", approved ? "done" : "failed", approved ? "approved" : "rejected", actorId, note));
  Object.assign(row, { status: approved ? "approved" : "rejected", stage: "decision", reviewerId: actorId, decisionNote: note, decidedAt: new Date().toISOString() });
  await save(row);
  if (approved) await setAccountVerification(row.userId, { verifiedAt: row.decidedAt!, verifiedBy: actorId, via: "request" });
  await notify({ userId: row.userId, kind: "verification.updated", actorId, subject: { kind: "verification.updated", requestId: row.id, code: approved ? "approved" : "rejected", note } });
  return (await hydrate([row]))[0];
}

/** Manual check mark, no request needed. Closes the user's open request as approved if there is one. */
export async function grantUserVerification(actorId: string, userId: string, rawNote?: unknown): Promise<void> {
  await requirePermission(actorId, "users.verify");
  if (actorId === userId) throw new VerificationError("You cannot verify your own account", "self", 409);
  const profile = await getProfile(userId);
  if (!profile) throw new VerificationError("User not found", "not_found", 404);
  if (profile.verified) return;
  const note = cleanNote(rawNote);
  const at = new Date().toISOString();

  const open = await openRowFor(userId);
  if (open) {
    open.events.push(event("decision", "done", "granted", actorId, note));
    Object.assign(open, { status: "approved", stage: "decision", reviewerId: actorId, decisionNote: note, decidedAt: at });
    await save(open);
  }
  await setAccountVerification(userId, { verifiedAt: at, verifiedBy: actorId, via: "manual" });
  await notify({ userId, kind: "verification.updated", actorId, subject: { kind: "verification.updated", requestId: open?.id ?? null, code: "granted", note } });
}

export async function revokeUserVerification(actorId: string, userId: string, rawNote?: unknown): Promise<void> {
  await requirePermission(actorId, "users.verify");
  if (actorId === userId) throw new VerificationError("You cannot revoke your own check mark", "self", 409);
  const profile = await getProfile(userId);
  if (!profile) throw new VerificationError("User not found", "not_found", 404);
  if (!profile.verified) return;
  const note = cleanNote(rawNote);
  await setAccountVerification(userId, null);
  await notify({ userId, kind: "verification.updated", actorId, subject: { kind: "verification.updated", requestId: null, code: "revoked", note } });
}

/** Test helper for the in-memory store. */
export function resetVerificationForTests() {
  memoryRows.length = 0;
}
