import type { ApiKeyScope, CompactPolicy, PolicyPermission } from "./api-keys";
import type { PackTrustLevel, TrustLevel } from "./trust";
import type { JsonSchema, SkillCategory, SecurityLevel } from "./skill";

/**
 * Payload returned by the Agent-First API when the request carries
 * `X-Agent-Request: true`. Keys are deliberately short — this goes
 * straight into a context window, every byte is a token.
 */
export interface AgentContextPayload {
  /** Format version. */
  v: 1;
  /** Combined system prompt fragment (all matched skills, in rank order). */
  sys: string;
  /** Tool definitions in the provider-neutral function-calling shape. */
  tools: AgentToolSchema[];
  /** Ultra-compact catalogue entries so the agent can decide what to install. */
  skills: AgentSkillEntry[];
  /** Total matches on the server (may exceed skills.length). */
  n: number;
}

export interface AgentToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
  /** Which skill provides this tool. */
  s: string;
}

export interface AgentSkillEntry {
  /** id */
  i: string;
  /** name */
  n: string;
  /** one-line description */
  d: string;
  /** category */
  c: SkillCategory;
  /** security level */
  sec: SecurityLevel;
  /** price per call, USD (0 = free) */
  p: number;
  /** install hint: command / URL the agent can act on */
  install: string;
}

// ---------------------------------------------------------------------------
// Agent API (ТЗ §1): the same operations over REST `/api/v1/agent/*` and MCP `/mcp`
// ---------------------------------------------------------------------------


export const AGENT_PROTOCOL_VERSION = "2026-09-01";

/** Error codes with a hint for the agent (FR-AI-60). */
export const AGENT_ERROR_CODES = [
  "policy_denied",
  "budget_exceeded",
  "approval_required",
  "integrity_mismatch",
  "revoked",
  "rate_limited",
  "not_found",
  "scope_missing",
  "unauthorized",
  "invalid_request",
] as const;
export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number];

export interface AgentErrorBody {
  error: AgentErrorCode;
  message: string;
  /** What the agent should do next. */
  hint: string;
  /** Policy rule that fired, for `policy_denied`. */
  rule?: string;
  pol?: CompactPolicy;
}

/** Card an agent client shows before connecting anything (FR-AI-30). Text is written by the server, not the agent. */
export interface ApprovalCard {
  title: string;
  what: string;
  why: string;
  permissions: string[];
  price: string;
  trust: TrustLevel;
}

export interface AgentItemRef {
  id: string;
  slug: string;
  name: string;
  category: SkillCategory;
  version: string;
  trust: SecurityLevel;
  /** USD per call through the gateway; 0 for anything that runs on the agent side. */
  price: number;
}

export interface AgentVariant {
  id: string;
  type: "pack" | "set" | "skill";
  items: AgentItemRef[];
  /** ≤ 200 chars. */
  reason: string;
  /** Estimated context weight. */
  tokens: number;
  permissions: PolicyPermission[];
  trust: TrustLevel | PackTrustLevel;
  price: number;
  findings: { critical: number; high: number; medium: number; low: number };
  /** Share of task intents the variant covers (0..1). */
  coverage: number;
  score: number;
  requiresApproval: boolean;
  approvalCard: ApprovalCard | null;
}

export interface LockEntry {
  id: string;
  slug: string;
  version: string;
  contentHash: string;
  trust: SecurityLevel;
  /** Declared permissions at install time: `check_updates` diffs against them. */
  permissions: string[];
}

export interface AgentToolSpec {
  name: string;
  /** Needed scope; null = anonymous search is allowed. */
  scope: ApiKeyScope | null;
  description: string;
  inputSchema: JsonSchema;
}
