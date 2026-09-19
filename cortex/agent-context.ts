/**
 * Cortex · Agent-first payload builder
 *
 * Turns catalogue entries into a context-window-ready blob:
 * one merged system prompt + provider-neutral tool schemas + a compact
 * catalogue so the agent can pick what to install next.
 */

import type { Skill } from "@/types/skill";
import type { AgentContextPayload, AgentSkillEntry, AgentToolSchema } from "@/types/agent";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export function installHint(skill: Skill): string {
  const ep = skill.manifest.entrypoint;
  switch (ep.type) {
    case "mcp-stdio":
      return `${ep.command} ${(ep.args ?? []).join(" ")}`.trim();
    case "mcp-sse":
      return ep.url;
    case "http":
      return `${APP_URL}/api/v1/skills/${skill.id}/execute`;
    case "prompt":
      return `${APP_URL}/api/v1/skills/${skill.id}?format=prompt`;
  }
}

/** Squeeze whitespace: newlines inside prompts are meaningful, runs of spaces are not. */
function tight(text: string): string {
  return text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function buildAgentContext(skills: Skill[], total: number): AgentContextPayload {
  const sys = skills
    .filter((s) => s.manifest.systemPrompt)
    .map((s) => `## ${s.name} v${s.version}\n${tight(s.manifest.systemPrompt!)}`)
    .join("\n\n");

  const tools: AgentToolSchema[] = skills.flatMap((s) =>
    s.manifest.tools.map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: tight(t.description), parameters: t.parameters },
      s: s.id,
    })),
  );

  const entries: AgentSkillEntry[] = skills.map((s) => ({
    i: s.id,
    n: s.name,
    d: tight(s.description).slice(0, 160),
    c: s.category,
    sec: s.securityLevel,
    p: s.pricePerCall,
    install: installHint(s),
  }));

  return { v: 1, sys, tools, skills: entries, n: total };
}

export function isAgentRequest(headers: Headers): boolean {
  const flag = headers.get("x-agent-request");
  return flag === "true" || flag === "1";
}
