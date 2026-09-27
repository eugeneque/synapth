/**
 * Version history of catalogue entries. Every change of the manifest is a
 * version, whether or not the author bumped the version string (SKILL.md has
 * no version field; most repos never change it): a change under an already
 * used label is recorded as `<version>+<content tag>`. Pure and isomorphic —
 * the repository stores, the versions page diffs `manifestText()` line by line.
 */

import type { SkillManifest, SkillVersionEntry } from "@/types/skill";

/** Oldest entries beyond this are dropped from the in-memory history. */
export const MAX_VERSIONS = 50;

/** Fields that describe how an entry was analysed, not what it is: they never make a version. */
const VOLATILE = new Set<keyof SkillManifest>(["permissionEvidence", "systemPromptTruncated"]);

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
        .map((k) => [k, stable((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/** Key-order independent JSON of what a version is made of. */
export function canonicalManifest(manifest: SkillManifest): string {
  const copy: Record<string, unknown> = { ...manifest };
  for (const k of VOLATILE) delete copy[k];
  return JSON.stringify(stable(copy));
}

/** FNV-1a (32 bit) of the canonical manifest — a short label suffix, not a security hash (`cortex/signing.ts` has those). */
export function contentTag(manifest: SkillManifest): string {
  const text = canonicalManifest(manifest);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0").slice(0, 7);
}

export function sameContent(a: SkillManifest, b: SkillManifest): boolean {
  return canonicalManifest(a) === canonicalManifest(b);
}

/** The label a new manifest is stored under: the declared version, or `version+tag` when that label is taken. */
export function versionLabel(version: string, manifest: SkillManifest, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(version)) return version;
  const tagged = `${version}+${contentTag(manifest)}`;
  return used.has(tagged) ? `${tagged}.${used.size}` : tagged;
}

/**
 * Appends `manifest` to a history (oldest first) when it differs from the latest entry.
 * Returns the new history, or null when nothing changed.
 */
export function appendVersion(history: SkillVersionEntry[], version: string, manifest: SkillManifest, at: string): SkillVersionEntry[] | null {
  const last = history[history.length - 1];
  if (last && sameContent(last.manifest, manifest)) return null;
  const entry: SkillVersionEntry = { version: versionLabel(version, manifest, history.map((h) => h.version)), manifest, createdAt: at };
  return [...history, entry].slice(-MAX_VERSIONS);
}

/**
 * A manifest as reviewable text: one fact per line, tools and the prompt last,
 * so a line diff reads like a changelog (`+ permissions: network`).
 */
export function manifestText(m: SkillManifest): string {
  const ep = m.entrypoint;
  const launch =
    ep.type === "mcp-stdio"
      ? `mcp-stdio · ${[ep.command, ...(ep.args ?? [])].join(" ")}`
      : ep.type === "mcp-sse"
        ? `mcp-sse · ${ep.url}`
        : ep.type === "http"
          ? `http · ${ep.method ?? "POST"} ${ep.url}`
          : "prompt";
  const lines = [`name: ${m.name}`, `description: ${m.description}`, `category: ${m.category}`, `entrypoint: ${launch}`];
  if (ep.type === "mcp-stdio" && ep.env && Object.keys(ep.env).length) lines.push(`env: ${Object.keys(ep.env).sort().join(", ")}`);
  lines.push(`permissions: ${m.permissions?.length ? m.permissions.join(", ") : "—"}`);
  if (m.requiredEnv?.length) lines.push(`required env: ${m.requiredEnv.join(", ")}`);
  if (m.tools.length) {
    lines.push("tools:");
    for (const t of m.tools) {
      lines.push(`  - ${t.name}: ${t.description.replace(/\s+/g, " ")}`);
      const required = new Set(t.parameters?.required ?? []);
      for (const [name, schema] of Object.entries(t.parameters?.properties ?? {})) {
        const type = schema?.type ?? "any";
        lines.push(`      ${name}${required.has(name) ? "*" : ""}: ${type}${schema?.description ? ` — ${schema.description.replace(/\s+/g, " ")}` : ""}`);
      }
    }
  }
  if (m.flow?.length) lines.push(`flow: ${m.flow.map((s) => s.label).join(" → ")}`);
  if (m.systemPrompt) {
    lines.push("", "system prompt:");
    lines.push(...m.systemPrompt.replace(/\r\n?/g, "\n").split("\n"));
  }
  return lines.join("\n");
}
