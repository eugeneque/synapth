import type { ScanFinding } from "@/lib/sandbox-scanner";

/**
 * Core domain model of Synapth.
 *
 * A "Skill" is any cognitive modification an agent can install:
 * an MCP server, a reusable prompt, or a callable tool.
 */

export const SKILL_CATEGORIES = ["MCP", "Prompt", "Tool"] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

/**
 * Trust level of a catalogue entry (full ladder in `types/trust.ts`).
 *  - Quarantine: a trap fired or explicit malware was found; hidden everywhere.
 *  - Sandbox:    scan found high/critical findings; never executed through the gateway.
 *  - Community:  medium findings at most, not reviewed by a human.
 *  - Verified:   clean scan + moderator review; never set by the scanner alone.
 *  - Gov:        Verified + the GV-* criteria, granted by a gov-moderator.
 */
export const SECURITY_LEVELS = ["Quarantine", "Sandbox", "Community", "Verified", "Gov"] as const;
/** Levels a visitor can filter by: quarantined entries are never listed. */
export const PUBLIC_SECURITY_LEVELS = ["Sandbox", "Community", "Verified", "Gov"] as const;
export type SecurityLevel = (typeof SECURITY_LEVELS)[number];

/** Minimal JSON Schema subset used for tool parameters (matches what LLM APIs accept). */
export interface JsonSchema {
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array" | "null";
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: Array<string | number | boolean | null>;
  default?: unknown;
  additionalProperties?: boolean | JsonSchema;
  [keyword: string]: unknown;
}

/** One callable tool exposed by a skill — the shape an LLM sees in its tool list. */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
  /** Free-form usage hints that the agent receives alongside the schema. */
  examples?: Array<{ input: Record<string, unknown>; note?: string }>;
}

/** How the skill is started/connected on the agent side. */
export type SkillEntrypoint =
  | { type: "mcp-stdio"; command: string; args?: string[]; env?: Record<string, string> }
  | { type: "mcp-sse"; url: string; headers?: Record<string, string> }
  | { type: "http"; url: string; method?: "GET" | "POST" }
  | { type: "prompt" };

/**
 * The Synapth manifest — what a publisher ships in the repo (`synapth.json`,
 * `mcp-server.json`, `tool.json` or the frontmatter of `SKILL.md`) and what
 * gets injected into the agent context.
 */
export interface SkillManifest {
  schemaVersion: 1;
  name: string;
  description: string;
  category: SkillCategory;
  /** Text that is appended to the agent's system prompt when the skill is active. */
  systemPrompt?: string;
  /** Set by the catalogue when `systemPrompt` was cut to an excerpt; the full text comes from `SkillRepository.readme()`. */
  systemPromptTruncated?: boolean;
  tools: ToolDefinition[];
  entrypoint: SkillEntrypoint;
  /** Capabilities the skill needs; used by the scanner and displayed to users. */
  permissions?: Array<"network" | "filesystem:read" | "filesystem:write" | "shell" | "env" | "clipboard">;
  /** Environment variables the user must provide (names only — never values). */
  requiredEnv?: string[];
  /** Optional ordered execution flow rendered by the Prompt Visualizer. */
  flow?: FlowStep[];
}

/** A step in the declared execution flow (rendered as a graph). */
export interface FlowStep {
  id: string;
  label: string;
  kind: "trigger" | "tool" | "decision" | "output";
  /** Name of the tool invoked at this step (for kind = "tool"). */
  tool?: string;
  next?: string[];
}

export interface SkillStats {
  /** Installs in the last 7 days — the "velocity" component of Trending. */
  installVelocity7d: number;
  /** Share of installers that executed the skill again after 14 days (0..1). */
  retentionRate: number;
  /** Total executions through the pay-per-task gateway. */
  executions: number;
  /** Average rating 0..5 (null when there are no reviews). */
  rating: number | null;
}

/** Where a catalogue entry came from. */
export type SkillOrigin = "seed" | "manual" | "github";

/** Where an entry comes from, as the search filters see it: parsed by the GitHub crawler, or put on Synapth by hand. */
export const SKILL_SOURCES = ["github", "synapth"] as const;
export type SkillSource = (typeof SKILL_SOURCES)[number];
export const skillSource = (skill: { origin: SkillOrigin }): SkillSource => (skill.origin === "github" ? "github" : "synapth");

/** Snapshot of the GitHub repository a skill was imported from. */
export interface GithubSource {
  owner: string;
  repo: string;
  fullName: string;
  defaultBranch: string;
  /** Path of the manifest inside the repo ("" for README-only imports). */
  manifestPath: string;
  manifestFile: string;
  language: string | null;
  license: string | null;
  topics: string[];
  stars: number;
  forks: number;
  openIssues: number;
  homepage: string | null;
  avatarUrl: string | null;
  pushedAt: string;
  /** When Cortex last fetched this repo. */
  crawledAt: string;
  /** Supply-chain snapshot taken at import (DP-* and ST-04 findings); absent for old imports. */
  audit?: RepositoryAudit | null;
}

/** What the crawler learned about the repository beyond the manifest (ТЗ §2, stages 1 and 4). */
export interface RepositoryAudit {
  auditedAt: string;
  /** Dependency manifests and lock files found next to the skill. */
  files: string[];
  lockfiles: string[];
  packages: number;
  /** Executable binaries found in the tree. */
  binaries: string[];
  findings: ScanFinding[];
}

export interface Skill {
  id: string;
  slug: string;
  name: string;
  description: string;
  authorId: string;
  authorName: string;
  version: string;
  category: SkillCategory;
  securityLevel: SecurityLevel;
  downloadsCount: number;
  githubStars: number;
  /** USD per execution. 0 means the skill is free. */
  pricePerCall: number;
  manifest: SkillManifest;
  repoUrl: string | null;
  tags: string[];
  stats: SkillStats;
  origin: SkillOrigin;
  source: GithubSource | null;
  /** README / SKILL.md body as markdown, rendered on the skill page and indexed by search. */
  readme: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Input accepted by `POST /api/v1/skills`. */
export type SkillCreateInput = Pick<
  Skill,
  "name" | "description" | "version" | "category" | "pricePerCall" | "manifest"
> & {
  slug?: string;
  repoUrl?: string | null;
  tags?: string[];
  githubStars?: number;
  origin?: SkillOrigin;
  source?: GithubSource | null;
  readme?: string | null;
};

export type SortMode = "trending" | "hidden-gems" | "recent" | "relevance";

export interface SkillQuery {
  q?: string;
  category?: SkillCategory;
  securityLevel?: SecurityLevel;
  /** Filter by repository language (case-insensitive). */
  language?: string;
  /** Filter by GitHub owner / author handle. */
  author?: string;
  source?: SkillSource;
  sort?: SortMode;
  limit?: number;
  offset?: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
