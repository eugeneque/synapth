/**
 * Account verification (the check mark next to a developer's name).
 *
 * Two ways to get it:
 *   1. a request from /dashboard/settings#verification — only when the
 *      account is old enough, has enough impulses and gives a phone number;
 *      the scanner then re-checks every skill of the applicant (a single
 *      finding rejects the request), and an admin reviews it;
 *   2. an admin grants it by hand from the admin panel, no request needed.
 *
 * A request moves through `VERIFICATION_STAGES`; every transition is an
 * event in its timeline, which the applicant watches live in settings.
 */

import type { AuthorRef } from "@/types/social";

export const VERIFICATION_RULES = {
  /** Days since registration. */
  minAccountAgeDays: 365,
  /** Impulses received from other developers. */
  minImpulses: 500,
} as const;
export type VerificationRules = { minAccountAgeDays: number; minImpulses: number };

export const VERIFICATION_STAGES = ["submitted", "scan", "review", "decision"] as const;
export type VerificationStage = (typeof VERIFICATION_STAGES)[number];

/** `waiting` — queued for the stage (review before an admin picks it up). */
export type VerificationStageState = "waiting" | "active" | "done" | "failed";

export const VERIFICATION_STATUSES = ["pending", "approved", "rejected", "withdrawn"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** Machine-readable reasons the UI translates (`verify.code.<code>`); free text goes to `note`. */
export type VerificationEventCode = "eligible" | "scan_clean" | "scan_failed" | "queued" | "claimed" | "approved" | "rejected" | "withdrawn" | "granted";

export interface VerificationEvent {
  stage: VerificationStage;
  state: VerificationStageState;
  code: VerificationEventCode;
  at: string;
  actorId: string | null;
  note: string | null;
}

export interface EligibilityCheck {
  id: "phone" | "age" | "impulses" | "skills";
  ok: boolean;
  /** Current value (days, impulses, skills with findings). */
  value: number;
  /** Threshold the value is compared against. */
  required: number;
}

export interface Eligibility {
  /** Everything needed to file a request (phone / age / impulses; skills are checked by the scan stage). */
  canApply: boolean;
  checks: EligibilityCheck[];
  /** Skills with at least one scanner finding, for the preview and the reviewer. */
  flaggedSkills: Array<{ id: string; slug: string; name: string; findings: number }>;
  skillsScanned: number;
}

export interface VerificationRequest {
  id: string;
  user: AuthorRef;
  /** Full number for staff; masked for the applicant's own view. */
  phone: string;
  status: VerificationStatus;
  stage: VerificationStage;
  events: Array<VerificationEvent & { actor: AuthorRef | null }>;
  /** Snapshot taken when the request was filed. */
  eligibility: Eligibility;
  reviewer: AuthorRef | null;
  decisionNote: string | null;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
}

export interface UserVerification {
  verifiedAt: string;
  verifiedBy: string | null;
  via: "request" | "manual";
}

/** What the settings panel polls: own status, the latest request and a fresh eligibility check. */
export interface VerificationState {
  verified: UserVerification | null;
  request: VerificationRequest | null;
  eligibility: Eligibility;
  serverTime: string;
}

export const VERIFICATION_NOTE_MAX = 1000;

/** E.164: "+", country code, 8–15 digits in total. Spaces, dashes and brackets are stripped first. */
export function normalizePhone(raw: string): string | null {
  const compact = raw.replace(/[\s\-().]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : null;
}

/** "+7 ••• ••• 12 34" — enough for the owner to recognise the number. */
export function maskPhone(phone: string): string {
  if (phone.length < 6) return "•••";
  return `${phone.slice(0, 2)} ••• ••• ${phone.slice(-4, -2)} ${phone.slice(-2)}`;
}

/** Latest state of each stage, from the event log. */
export function stageStates(events: Pick<VerificationEvent, "stage" | "state">[]): Record<VerificationStage, VerificationStageState | null> {
  const out: Record<VerificationStage, VerificationStageState | null> = { submitted: null, scan: null, review: null, decision: null };
  for (const e of events) out[e.stage] = e.state;
  return out;
}
