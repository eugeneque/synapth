/**
 * Install bundles for the Synapth CLI: a catalogue entry turned into data the
 * CLI applies itself (skill directories, `mcpServers` entries) — never into
 * shell. Manifests come from other people, so every name and path that will
 * become a file system path is reduced to a safe single segment here, and the
 * CLI checks again before writing.
 */

import type { CliAction, CliBundle, CliSkipReason, CliTarget } from "@/types/cli";
import type { Skill } from "@/types/skill";

/** One path segment: letters, digits, `.`, `_`, `-`; never `.` or `..`. */
export function safeSegment(raw: string, fallback = "skill"): string {
  const s = raw.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 80);
  return s && s !== "." && s !== ".." ? s : fallback;
}

/** Relative path inside a skill directory: no absolute paths, no `..`, no empty segments. */
export function isSafeRelativePath(path: string): boolean {
  if (!path || path.length > 240 || path.startsWith("/") || path.includes("\\") || path.includes("\0")) return false;
  return path.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

const yamlString = (value: string) => JSON.stringify(value.replace(/\s+/g, " ").trim());

export type BundleOutcome = { ok: true; bundle: CliBundle } | { ok: false; reason: CliSkipReason };

/**
 * What installing `skill` means on disk. Sandbox entries need the caller's
 * explicit opt-in (`allowSandbox`); HTTP tools live on the gateway and have
 * nothing to install; Claude Desktop has no skill directories.
 */
export function cliBundle(skill: Skill, target: CliTarget, opts: { allowSandbox?: boolean } = {}): BundleOutcome {
  if (skill.securityLevel === "Sandbox" && !opts.allowSandbox) return { ok: false, reason: "sandbox" };
  const ep = skill.manifest.entrypoint;
  const name = safeSegment(skill.slug);
  const actions: CliAction[] = [];

  if (ep.type === "http") return { ok: false, reason: "http" };

  if (ep.type === "mcp-stdio") {
    actions.push({ kind: "mcp", name, server: { transport: "stdio", command: ep.command, args: ep.args ?? [], ...(ep.env ? { env: ep.env } : {}) } });
  } else if (ep.type === "mcp-sse") {
    actions.push({ kind: "mcp", name, server: { transport: "sse", url: ep.url, ...(ep.headers ? { headers: ep.headers } : {}) } });
  } else if (ep.type === "prompt") {
    if (target === "claude-desktop") return { ok: false, reason: "target" };
    const src = skill.source;
    if (src && src.manifestFile === "SKILL.md") {
      const dir = src.manifestPath.split("/").slice(0, -1).join("/");
      actions.push({ kind: "skill", dir: safeSegment(dir.split("/").pop() || skill.slug), source: { type: "github", repo: src.fullName, ref: src.defaultBranch, path: dir } });
    } else {
      const body = skill.manifest.systemPrompt ?? skill.description;
      const content = `---\nname: ${yamlString(skill.name)}\ndescription: ${yamlString(skill.description)}\n---\n${body}\n`;
      actions.push({ kind: "skill", dir: name, source: { type: "inline", files: [{ path: "SKILL.md", content }] } });
    }
  } else {
    return { ok: false, reason: "unsupported" };
  }

  return {
    ok: true,
    bundle: { id: skill.id, slug: skill.slug, name: skill.name, version: skill.version, securityLevel: skill.securityLevel, actions, env: [...(skill.manifest.requiredEnv ?? [])] },
  };
}
