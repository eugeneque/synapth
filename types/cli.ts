/**
 * Synapth CLI: linking machines to an account and installing catalogue
 * entries into local agents.
 *
 * Flow: the user issues a **link key** (`slk_…`) in /dashboard/settings#cli →
 * `synapth link <key>` on a machine trades it for a **device token**
 * (`sdt_…`, stored in ~/.synapth/config.json) → every CLI request carries
 * the device token. The server decides everything that costs or limits
 * (plan, daily quota, device cap, trust); the CLI only renders the answer
 * and writes the files described by a `CliBundle`.
 */

import type { PlanId, SubscriptionStatus } from "@/types/billing";
import type { SecurityLevel } from "@/types/skill";

export const CLI_LINK_KEY_PREFIX = "slk_";
export const CLI_DEVICE_TOKEN_PREFIX = "sdt_";

/** Version shipped at /cli/synapth.mjs; the CLI compares it with its own on `status`. */
export const CLI_VERSION = "0.2.0";
/** Older CLIs are refused with `cli_outdated` (bundle format changes bump this). */
export const CLI_MIN_VERSION = "0.1.0";

/** Agents the CLI can install into. */
export const CLI_TARGETS = ["claude-code", "cursor", "claude-desktop"] as const;
export type CliTarget = (typeof CLI_TARGETS)[number];

export const CLI_DEVICE_NAME_MAX = 64;

/** A linked machine, as the settings page and `synapth status` show it. */
export interface CliDeviceInfo {
  id: string;
  /** Hostname reported at link time. */
  name: string;
  platform: string;
  arch: string;
  cliVersion: string;
  prefix: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  /** Linked while the plan allowed more devices than it does now: may check status, may not install. */
  suspended: boolean;
}

export interface CliLinkKeyInfo {
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export type CliNoticeCode = "grace" | "past_due" | "expired" | "cancel_scheduled" | "quota_low" | "quota_exhausted" | "device_suspended" | "cli_update";

export interface CliStatus {
  user: { id: string; handle: string; name: string };
  device: CliDeviceInfo;
  plan: {
    id: PlanId;
    /** `none` — never subscribed. */
    status: SubscriptionStatus | "none";
    /** The paid plan the user had, when it has lapsed back to Free. */
    lapsedFrom: PlanId | null;
    periodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  };
  limits: { devices: number; installsPerDay: number; bulk: boolean };
  usage: { installsToday: number; devices: number };
  /** Next UTC midnight: the daily quota resets then. */
  resetAt: string;
  notices: CliNoticeCode[];
  cli: { latest: string; minimum: string };
  /** Where to upgrade or manage devices. */
  links: { billing: string; devices: string };
}

// ---------------------------------------------------------------------------
// Install bundles: what to put on disk, described as data (never as shell)
// ---------------------------------------------------------------------------

export type CliSkillSource =
  /** Copy a directory of a public GitHub repository (the SKILL.md folder with its scripts). */
  | { type: "github"; repo: string; ref: string; path: string }
  /** Files written verbatim, paths relative to the skill directory. */
  | { type: "inline"; files: Array<{ path: string; content: string }> };

export type CliMcpServer =
  | { transport: "stdio"; command: string; args: string[]; env?: Record<string, string> }
  | { transport: "sse" | "http"; url: string; headers?: Record<string, string> };

export type CliAction =
  /** A skill directory (`.claude/skills/<dir>` and the like). */
  | { kind: "skill"; dir: string; source: CliSkillSource }
  /** An entry under `mcpServers` in the agent's config. */
  | { kind: "mcp"; name: string; server: CliMcpServer };

export interface CliBundle {
  id: string;
  slug: string;
  name: string;
  version: string;
  securityLevel: SecurityLevel;
  actions: CliAction[];
  /** Variables the user has to set (names only). */
  env: string[];
}

/** Who asked for the install: a person at the terminal or their agent through `synapth mcp`. */
export type CliInstallVia = "cli" | "mcp";

/** One `resolve_task` variant, reduced to what the CLI and its MCP tools need. */
export interface CliRecommendation {
  type: "pack" | "set" | "skill";
  install: { set: string } | { skills: string[] };
  reason: string;
  trust: string;
  coverage: number;
  tokens: number;
  permissions: string[];
  items: Array<{ slug: string; name: string; trust: string; category: string }>;
}

/** One catalogue row in `GET /api/v1/cli/search`. */
export interface CliSearchRow {
  slug: string;
  name: string;
  description: string;
  category: string;
  securityLevel: string;
  version: string;
  entrypoint: string;
}

/** A skillset (pack) matching a search; installs whole by `install_skill { slug, skillset: true }`. */
export interface CliSkillsetRow {
  slug: string;
  name: string;
  summary: string;
  verified: boolean;
  favorites: number;
  entries: Array<{ slug: string; name: string; securityLevel: string }>;
  /** Installable entries in the set (`entries` is capped). */
  total: number;
}

/** Why an entry cannot be installed locally. */
export type CliSkipReason = "sandbox" | "http" | "unsupported" | "target";

export interface CliInstallResult {
  installed: CliBundle[];
  skipped: Array<{ slug: string; name: string; reason: CliSkipReason }>;
  usage: { installsToday: number; installsPerDay: number };
}

export type CliErrorCode =
  | "link_key_invalid"
  | "device_invalid"
  | "device_revoked"
  | "device_limit"
  | "device_suspended"
  | "plan_required"
  | "quota_exceeded"
  | "not_found"
  | "not_installable"
  | "cli_outdated";

/** `a.b.c` comparison without a semver dependency; junk sorts lowest. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}
