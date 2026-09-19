/**
 * Axon · Install snippets
 *
 * Turns a skill entrypoint into the exact config each client expects.
 * These are what the "Quick install" button copies.
 */

import type { Skill } from "@/types/skill";

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

export function installSnippet(skill: Skill, target: InstallTarget): { language: "json" | "bash" | "markdown"; code: string; note: string } {
  const ep = skill.manifest.entrypoint;
  const key = serverKey(skill);

  if (target === "curl") {
    return {
      language: "bash",
      code: `curl -s -H 'X-Agent-Request: true' '${APP_URL}/api/v1/skills?q=${encodeURIComponent(skill.name)}&limit=1'`,
      note: "Returns a minified payload: system prompt + tool schemas. Inject it into your model's context.",
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
        return { language: "bash", code: `npx degit ${degit} .claude/skills/${skillDir}`, note: "Copies the skill directory (SKILL.md + scripts) into the project; Claude Code picks it up automatically." };
      }
      if (target === "cursor") {
        return { language: "bash", code: `npx degit ${degit} .cursor/skills/${skillDir}`, note: "Cursor reads Agent Skills from .cursor/skills/. Restart the agent after copying." };
      }
      return {
        language: "markdown",
        code: `Read and follow the skill at ${rawUrl}\n\n${skill.description}`,
        note: "Claude Desktop has no skill directory: paste this into Project → Custom instructions, or attach the SKILL.md file.",
      };
    }

    const body = skill.manifest.systemPrompt ?? skill.description;
    if (target === "claude-code") {
      return {
        language: "bash",
        code: `mkdir -p .claude/skills/${key} && cat > .claude/skills/${key}/SKILL.md <<'EOF'\n---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n${body}\nEOF`,
        note: "Creates a project skill; Claude Code picks it up automatically.",
      };
    }
    return {
      language: "markdown",
      code: target === "cursor" ? `# .cursor/rules/${key}.mdc\n---\ndescription: ${skill.description}\nalwaysApply: true\n---\n${body}` : body,
      note: target === "cursor" ? "Save as a Cursor rule." : "Paste into Claude Desktop → Settings → Projects → Custom instructions.",
    };
  }

  if (ep.type === "http") {
    return {
      language: "bash",
      code: `curl -X POST '${APP_URL}/api/v1/skills/${skill.id}/execute' \\\n  -H 'Content-Type: application/json' \\\n  -H 'X-Synapth-Key: $SYNAPTH_KEY' \\\n  -d '{"tool":"${skill.manifest.tools[0]?.name ?? ""}","input":{}}'`,
      note: `Pay-per-call gateway · $${skill.pricePerCall} per execution, billed to your Synapth wallet.`,
    };
  }

  const server = mcpServerConfig(skill);
  if (!server) throw new Error("Unsupported entrypoint");

  if (target === "claude-code") {
    const cmd =
      ep.type === "mcp-stdio"
        ? `claude mcp add ${key} -- ${ep.command} ${(ep.args ?? []).join(" ")}`.trim()
        : `claude mcp add --transport sse ${key} ${ep.url}`;
    return { language: "bash", code: cmd, note: skill.manifest.requiredEnv?.length ? `Set ${skill.manifest.requiredEnv.join(", ")} in your environment first.` : "Run in the project directory." };
  }

  return {
    language: "json",
    code: JSON.stringify({ mcpServers: { [key]: server } }, null, 2),
    note: `Merge into ${INSTALL_TARGETS.find((t) => t.id === target)?.file}${skill.manifest.requiredEnv?.length ? ` · requires ${skill.manifest.requiredEnv.join(", ")}` : ""}.`,
  };
}

export function defaultTarget(skill: Skill): InstallTarget {
  return skill.manifest.entrypoint.type === "http" ? "curl" : "claude-code";
}
