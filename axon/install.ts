/**
 * Axon · Install snippets
 *
 * Turns a skill entrypoint into the exact config each client expects.
 * These are what the "Quick install" button copies.
 */

import type { Skill } from "@/types/skill";
import type { UiKey } from "@/lib/i18n";

export type InstallTarget = "cursor" | "claude-desktop" | "claude-code" | "curl";

export const INSTALL_TARGETS: Array<{ id: InstallTarget; label: string; file: string }> = [
  { id: "cursor", label: "Cursor", file: "~/.cursor/mcp.json" },
  { id: "claude-desktop", label: "Claude Desktop", file: "~/Library/Application Support/Claude/claude_desktop_config.json" },
  { id: "claude-code", label: "Claude Code", file: "terminal" },
  { id: "curl", label: "Any agent (HTTP)", file: "terminal" },
];

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

function serverKey(skill: Skill) {
  return skill.slug.replace(/[^a-z0-9-]/g, "-");
}

function mcpServerConfig(skill: Skill): Record<string, unknown> | null {
  const ep = skill.manifest.entrypoint;
  if (ep.type === "mcp-stdio") {
    return { command: ep.command, args: ep.args ?? [], ...(ep.env ? { env: ep.env } : {}) };
  }
  if (ep.type === "mcp-sse") {
    return { url: ep.url, ...(ep.headers ? { headers: ep.headers } : {}) };
  }
  return null;
}

/** The human note under a snippet is a dictionary key so the panel can render it in the active locale. */
export type InstallNoteKey = Extract<UiKey, `install.note.${string}`>;

export interface InstallSnippet {
  language: "json" | "bash" | "markdown";
  code: string;
  noteKey: InstallNoteKey;
  noteParams?: Record<string, string>;
}

export function installSnippet(skill: Skill, target: InstallTarget): InstallSnippet {
  const ep = skill.manifest.entrypoint;
  const key = serverKey(skill);

  if (target === "curl") {
    return {
      language: "bash",
      code: `curl -s -H 'X-Agent-Request: true' '${APP_URL}/api/v1/skills?q=${encodeURIComponent(skill.name)}&limit=1'`,
      noteKey: "install.note.curl",
    };
  }

  if (ep.type === "prompt") {
    // Skills imported from GitHub are copied straight from the source directory (scripts and
    // reference files included) instead of pasting a 20k-character body into the terminal.
    const src = skill.source;
    if (src && src.manifestFile === "SKILL.md") {
      const dir = src.manifestPath.split("/").slice(0, -1).join("/");
      const skillDir = dir.split("/").pop() || key;
      const degit = `${src.fullName}${dir ? `/${dir}` : ""}${src.defaultBranch !== "main" && src.defaultBranch !== "master" ? `#${src.defaultBranch}` : ""}`;
      const rawUrl = `https://raw.githubusercontent.com/${src.fullName}/${src.defaultBranch}/${src.manifestPath}`;
      if (target === "claude-code") {
        return { language: "bash", code: `npx degit ${degit} .claude/skills/${skillDir}`, noteKey: "install.note.skillmdClaudeCode" };
      }
      if (target === "cursor") {
        return { language: "bash", code: `npx degit ${degit} .cursor/skills/${skillDir}`, noteKey: "install.note.skillmdCursor" };
      }
      return {
        language: "markdown",
        code: `Read and follow the skill at ${rawUrl}\n\n${skill.description}`,
        noteKey: "install.note.skillmdDesktop",
      };
    }

    const body = skill.manifest.systemPrompt ?? skill.description;
    if (target === "claude-code") {
      return {
        language: "bash",
        code: `mkdir -p .claude/skills/${key} && cat > .claude/skills/${key}/SKILL.md <<'EOF'\n---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n${body}\nEOF`,
        noteKey: "install.note.promptClaudeCode",
      };
    }
    return {
      language: "markdown",
      code: target === "cursor" ? `# .cursor/rules/${key}.mdc\n---\ndescription: ${skill.description}\nalwaysApply: true\n---\n${body}` : body,
      noteKey: target === "cursor" ? "install.note.promptCursor" : "install.note.promptDesktop",
    };
  }

  if (ep.type === "http") {
    return {
      language: "bash",
      code: `curl -X POST '${APP_URL}/api/v1/skills/${skill.id}/execute' \\\n  -H 'Content-Type: application/json' \\\n  -H 'X-Synapth-Key: $SYNAPTH_KEY' \\\n  -d '{"tool":"${skill.manifest.tools[0]?.name ?? ""}","input":{}}'`,
      noteKey: "install.note.http",
    };
  }

  const server = mcpServerConfig(skill);
  if (!server) throw new Error("Unsupported entrypoint");

  if (target === "claude-code") {
    const cmd =
      ep.type === "mcp-stdio"
        ? `claude mcp add ${key} -- ${ep.command} ${(ep.args ?? []).join(" ")}`.trim()
        : `claude mcp add --transport sse ${key} ${ep.url}`;
    return skill.manifest.requiredEnv?.length
      ? { language: "bash", code: cmd, noteKey: "install.note.setEnv", noteParams: { env: skill.manifest.requiredEnv.join(", ") } }
      : { language: "bash", code: cmd, noteKey: "install.note.runInProject" };
  }

  return {
    language: "json",
    code: JSON.stringify({ mcpServers: { [key]: server } }, null, 2),
    ...(skill.manifest.requiredEnv?.length
      ? { noteKey: "install.note.mergeEnv" as const, noteParams: { file: INSTALL_TARGETS.find((t) => t.id === target)?.file ?? "", env: skill.manifest.requiredEnv.join(", ") } }
      : { noteKey: "install.note.merge" as const, noteParams: { file: INSTALL_TARGETS.find((t) => t.id === target)?.file ?? "" } }),
  };
}

/** Cookie mirrored from the account's `defaultTarget` preference (set in /dashboard/settings). */
export const TARGET_COOKIE = "synapth_target";

function preferredTarget(): InstallTarget | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${TARGET_COOKIE}=([a-z-]+)`));
  const value = match?.[1];
  return INSTALL_TARGETS.some((t) => t.id === value) ? (value as InstallTarget) : null;
}

/** The account preference wins; otherwise HTTP entrypoints go to curl and everything else to Claude Code. */
export function defaultTarget(skill: Skill): InstallTarget {
  return preferredTarget() ?? (skill.manifest.entrypoint.type === "http" ? "curl" : "claude-code");
}
