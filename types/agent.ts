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
