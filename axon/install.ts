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

// ---------------------------------------------------------------------------
// Skillsets: every entry of a set in one command
// ---------------------------------------------------------------------------

/** Why an entry is left out of a skillset install. */
export type SkillsetSkipReason = "sandbox" | "http" | "unsupported";

export interface SkillsetInstallPlan {
  target: InstallTarget;
  /** What the user runs (or pastes, for `claude-desktop`). */
  command: string;
  commandLanguage: "bash" | "json" | "markdown";
  /** The script / config behind `command`, shown in an expander. */
  body: string;
  bodyLanguage: "bash" | "json" | "markdown";
  included: Array<{ slug: string; name: string }>;
  skipped: Array<{ slug: string; name: string; reason: SkillsetSkipReason }>;
  /** Union of `requiredEnv` over the included entries. */
  env: string[];
}

/** POSIX single-quoting: the only safe way to put manifest data (commands, args, URLs) into a script. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** A heredoc terminator that cannot occur as a line of `body`, so a prompt can never end the heredoc early. */
function heredocTag(body: string, key: string): string {
  const lines = new Set(body.split("\n").map((l) => l.trim()));
  let tag = `SYNAPTH_${key.replace(/[^a-z0-9]/gi, "_").toUpperCase()}_EOF`;
  while (lines.has(tag)) tag += "_X";
  return tag;
}

function writeFile(path: string, content: string, key: string): string {
  const tag = heredocTag(content, key);
  const dir = path.split("/").slice(0, -1).join("/");
  return `mkdir -p ${shellQuote(dir)} && cat > ${shellQuote(path)} <<'${tag}'\n${content}\n${tag}`;
}

function degitSource(skill: Skill): { spec: string; dirName: string } | null {
  const src = skill.source;
  if (!src || src.manifestFile !== "SKILL.md") return null;
  const dir = src.manifestPath.split("/").slice(0, -1).join("/");
  const branch = src.defaultBranch !== "main" && src.defaultBranch !== "master" ? `#${src.defaultBranch}` : "";
  return { spec: `${src.fullName}${dir ? `/${dir}` : ""}${branch}`, dirName: (dir.split("/").pop() || serverKey(skill)).replace(/[^A-Za-z0-9._-]/g, "-") };
}

const yamlString = (value: string) => JSON.stringify(value.replace(/\s+/g, " ").trim());

/** URL of the script behind the one-liner; the route renders `skillsetInstall(...).body`. */
export function skillsetScriptUrl(slug: string, target: InstallTarget): string {
  return `${APP_URL}/api/v1/skillsets/${encodeURIComponent(slug)}/install?target=${target}`;
}

/**
 * Install plan for a whole skillset. `claude-code` and `cursor` get a POSIX
 * script (served by `/api/v1/skillsets/<slug>/install`) so the set installs
 * with `curl … | sh`; `claude-desktop` gets one merged `mcpServers` block;
 * `curl` gets the agent-context request. Sandbox entries are never put into a
 * piped script, and HTTP tools have nothing to install locally.
 *
 * Every piece of manifest data is shell-quoted: a set is assembled from other
 * people's entries, so their commands and prompts are untrusted input here.
 */
export function skillsetInstall(set: { slug: string; name: string }, skills: Skill[], target: InstallTarget): SkillsetInstallPlan {
  const included: SkillsetInstallPlan["included"] = [];
  const skipped: SkillsetInstallPlan["skipped"] = [];
  const env = new Set<string>();
  const steps: string[] = [];
  const mcpServers: Record<string, Record<string, unknown>> = {};
  const prompts: string[] = [];

  for (const skill of skills) {
    const ep = skill.manifest.entrypoint;
    const key = serverKey(skill);
    const ref = { slug: skill.slug, name: skill.name };
    if (target !== "curl" && skill.securityLevel === "Sandbox") {
      skipped.push({ ...ref, reason: "sandbox" });
      continue;
    }
    if (target !== "curl" && ep.type === "http") {
      skipped.push({ ...ref, reason: "http" });
      continue;
    }
    for (const name of skill.manifest.requiredEnv ?? []) env.add(name);
    included.push(ref);
    const say = `echo ${shellQuote(`→ ${skill.name}`)}`;

    if (target === "curl") continue;

    if (ep.type === "mcp-stdio" || ep.type === "mcp-sse") {
      if (target === "claude-code") {
        const add = ep.type === "mcp-stdio" ? `claude mcp add ${shellQuote(key)} -- ${[ep.command, ...(ep.args ?? [])].map(shellQuote).join(" ")}` : `claude mcp add --transport sse ${shellQuote(key)} ${shellQuote(ep.url)}`;
        steps.push(`${say}\n${add} || echo ${shellQuote(`  ! ${key} is already configured or could not be added`)}`);
      } else {
        mcpServers[key] = mcpServerConfig(skill) ?? {};
      }
      continue;
    }

    if (ep.type === "prompt") {
      const git = degitSource(skill);
      const body = skill.manifest.systemPrompt ?? skill.description;
      if (target === "claude-desktop") {
        prompts.push(`## ${skill.name}\n\n${git ? `Read and follow the skill at https://raw.githubusercontent.com/${skill.source!.fullName}/${skill.source!.defaultBranch}/${skill.source!.manifestPath}\n\n${skill.description}` : body}`);
        continue;
      }
      const root = target === "claude-code" ? ".claude/skills" : ".cursor/skills";
      if (git) {
        steps.push(`${say}\nnpx -y degit --force ${shellQuote(git.spec)} ${shellQuote(`${root}/${git.dirName}`)}`);
      } else if (target === "claude-code") {
        steps.push(`${say}\n${writeFile(`${root}/${key}/SKILL.md`, `---\nname: ${yamlString(skill.name)}\ndescription: ${yamlString(skill.description)}\n---\n${body}`, key)}`);
      } else {
        steps.push(`${say}\n${writeFile(`.cursor/rules/${key}.mdc`, `---\ndescription: ${yamlString(skill.description)}\nalwaysApply: true\n---\n${body}`, key)}`);
      }
      continue;
    }

    included.pop();
    skipped.push({ ...ref, reason: "unsupported" });
  }

  const envList = [...env].sort();

  if (target === "curl") {
    const url = `${APP_URL}/api/v1/skillsets/${encodeURIComponent(set.slug)}`;
    return { target, command: `curl -s -H 'X-Agent-Request: true' ${shellQuote(url)}`, commandLanguage: "bash", body: `# ${set.name}\n# Returns the agent context (system prompts + tool schemas) of every entry in the set.\ncurl -s -H 'X-Agent-Request: true' ${shellQuote(url)}`, bodyLanguage: "bash", included, skipped, env: envList };
  }

  if (target === "claude-desktop") {
    // One block for claude_desktop_config.json; prompt entries have no config file there and go to project instructions.
    const config = JSON.stringify({ mcpServers }, null, 2);
    const instructions = prompts.join("\n\n---\n\n");
    const hasServers = Object.keys(mcpServers).length > 0;
    return {
      target,
      command: hasServers ? config : instructions,
      commandLanguage: hasServers ? "json" : "markdown",
      body: hasServers ? instructions : "",
      bodyLanguage: "markdown",
      included,
      skipped,
      env: envList,
    };
  }

  if (target === "cursor" && Object.keys(mcpServers).length) {
    // Merge into the project's .cursor/mcp.json without clobbering servers that are already there.
    const merge = `const fs=require("fs"),p=".cursor/mcp.json",add=JSON.parse(process.argv[1]);let c={};try{c=JSON.parse(fs.readFileSync(p,"utf8"))}catch(e){}c.mcpServers=Object.assign({},c.mcpServers,add);fs.mkdirSync(".cursor",{recursive:true});fs.writeFileSync(p,JSON.stringify(c,null,2)+"\\n")`;
    steps.push(`echo ${shellQuote(`→ MCP servers: ${Object.keys(mcpServers).join(", ")}`)}\nnode -e ${shellQuote(merge)} ${shellQuote(JSON.stringify(mcpServers))}`);
  }

  const header = [
    "#!/bin/sh",
    `# Synapth skillset: ${set.name.replace(/\n/g, " ")}`,
    `# ${APP_URL}/skillsets/${set.slug}`,
    `# Target: ${INSTALL_TARGETS.find((t) => t.id === target)?.label ?? target} — run in the project directory.`,
    ...skipped.map((s) => `# skipped (${s.reason}): ${s.name.replace(/\n/g, " ")}`),
  ];
  const footer = [`echo ${shellQuote(`✓ ${set.name}: ${included.length} installed${skipped.length ? `, ${skipped.length} skipped` : ""}`)}`, ...(envList.length ? [`echo ${shellQuote(`  Set these environment variables: ${envList.join(", ")}`)}`] : [])];
  const body = [...header, "", ...steps, "", ...footer].join("\n") + "\n";
  return { target, command: `curl -fsSL ${shellQuote(skillsetScriptUrl(set.slug, target))} | sh`, commandLanguage: "bash", body, bodyLanguage: "bash", included, skipped, env: envList };
}

// ---------------------------------------------------------------------------
// Connecting an agent to Synapth itself (ТЗ FR-AI-02)
// ---------------------------------------------------------------------------

/** Remote MCP endpoint (Streamable HTTP) of this instance. */
export const synapthMcpUrl = (base = APP_URL) => `${base.replace(/\/$/, "")}/mcp`;

/**
 * Ready-to-paste commands that connect a client to `synapth-mcp` with the
 * key filled in. Claude Desktop only launches stdio servers, so it goes
 * through `mcp-remote`.
 */
export function connectSnippets(key: string, base = APP_URL): Record<InstallTarget, Pick<InstallSnippet, "language" | "code">> {
  const url = synapthMcpUrl(base);
  const header = `X-Synapth-Key: ${key}`;
  return {
    "claude-code": { language: "bash", code: `claude mcp add --transport http synapth ${url} --header ${shellQuote(header)}` },
    cursor: { language: "json", code: JSON.stringify({ mcpServers: { synapth: { url, headers: { "X-Synapth-Key": key } } } }, null, 2) },
    "claude-desktop": { language: "json", code: JSON.stringify({ mcpServers: { synapth: { command: "npx", args: ["-y", "mcp-remote", url, "--header", `X-Synapth-Key:${key}`] } } }, null, 2) },
    curl: { language: "bash", code: `curl -s ${shellQuote(`${base.replace(/\/$/, "")}/api/v1/agent/search?q=postgres`)} -H ${shellQuote(header)}` },
  };
}
