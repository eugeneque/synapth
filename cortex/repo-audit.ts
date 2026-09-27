/**
 * Cortex · Repository audit at import time (ТЗ §2, stages 1 and 4).
 *
 * Collects what the manifest scanner cannot see: dependency manifests and
 * lock files next to each skill, executable binaries in the tree. The static
 * DP-* rules run in `lib/dependency-scanner.ts`; OSV and registry lookups
 * (DP-01, DP-05) in `cortex/dependency-audit.ts` when `online` is set.
 * The snapshot lands in `GithubSource.audit` and feeds `scanSkill()`.
 */

import { DEPENDENCY_FILES, scanDependencies } from "@/lib/dependency-scanner";
import type { RepoFetcher, RepoRef } from "@/lib/github-parser";
import type { RepositoryAudit } from "@/types/skill";
import { auditDependencies, type AuditOptions } from "@/cortex/dependency-audit";

const IGNORED = /(^|\/)(node_modules|\.git|vendor|dist|build|\.venv|venv|__pycache__|test|tests|fixtures|examples?)\//i;
const BINARY = /\.(exe|dll|so|dylib|elf|msi|appimage)$/i;
/** Probed when the tree is unavailable (no token): the manifests that matter most. */
const PROBE_WITHOUT_TREE = ["package.json", "package-lock.json", "requirements.txt", "pyproject.toml"];

export interface RepoAuditOptions extends AuditOptions {
  /** Query OSV and the registries (network). */
  online?: boolean;
}

/** `dirs` — directories of the imported manifests ("" = repository root). */
export async function auditRepository(ref: RepoRef, fetcher: RepoFetcher, dirs: string[], options: RepoAuditOptions = {}): Promise<RepositoryAudit> {
  const tree = await fetcher.tree(ref).catch(() => null);
  const wanted = new Set(["", ...dirs]);
  const candidates = tree
    ? tree.filter((p) => {
        const parts = p.split("/");
        const base = parts.pop() ?? "";
        return (DEPENDENCY_FILES as readonly string[]).includes(base) && wanted.has(parts.join("/"));
      })
    : PROBE_WITHOUT_TREE;

  const files: Record<string, string> = {};
  for (const path of candidates.slice(0, 40)) {
    const text = await fetcher.readFile(ref, path).catch(() => null);
    // Lock files can be huge; the head is enough to know they exist, versions come from package-lock only.
    if (text !== null) files[path] = text.length > 2_000_000 ? "" : text;
  }

  // Scan per directory so a monorepo collection does not mix lock files across packages.
  const byDir = new Map<string, Record<string, string>>();
  for (const [path, text] of Object.entries(files)) {
    const dir = path.split("/").slice(0, -1).join("/");
    byDir.set(dir, { ...byDir.get(dir), [path]: text });
  }
  const scans = [...byDir.values()].map((group) => scanDependencies(group));
  const findings = scans.flatMap((s) => s.findings);
  const packages = scans.flatMap((s) => s.packages);
  if (options.online && packages.length) findings.push(...(await auditDependencies(packages, scans.flatMap((s) => s.files).join(", ") || "dependencies", options)));

  return {
    auditedAt: new Date().toISOString(),
    files: scans.flatMap((s) => s.files),
    lockfiles: scans.flatMap((s) => s.lockfiles),
    packages: packages.length,
    binaries: (tree ?? []).filter((p) => BINARY.test(p) && !IGNORED.test(p)).slice(0, 20),
    findings,
  };
}
