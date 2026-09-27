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
import { codeFilesFor, permissionsFromCode, permissionsFromDependencies, refinePermissions, type CodeAnalysis } from "@/lib/permissions";
import type { RepositoryAudit, SkillCreateInput } from "@/types/skill";
import { auditDependencies, type AuditOptions } from "@/cortex/dependency-audit";

const IGNORED = /(^|\/)(node_modules|\.git|vendor|dist|build|\.venv|venv|__pycache__|test|tests|fixtures|examples?)\//i;
const BINARY = /\.(exe|dll|so|dylib|elf|msi|appimage)$/i;
/** Probed when the tree is unavailable (no token): the manifests that matter most. */
const PROBE_WITHOUT_TREE = ["package.json", "package-lock.json", "requirements.txt", "pyproject.toml"];
/** Source files read per manifest directory and per repository for permission detection. */
const CODE_FILES_PER_DIR = 8;
const CODE_FILES_PER_REPO = 30;
/** Only the head of a huge (usually generated) file is scanned. */
const CODE_FILE_CAP = 200_000;

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
    permissions: await detectPermissions(ref, fetcher, tree, [...wanted].filter((d) => dirs.includes(d)), files),
  };
}

/**
 * Permission evidence next to each manifest: source files of that directory
 * (a server's code, a skill's scripts) and its dependency manifests. Without a
 * tree (no token) only dependencies count, and a guessed list stays a guess.
 */
async function detectPermissions(ref: RepoRef, fetcher: RepoFetcher, tree: string[] | null, dirs: string[], depFiles: Record<string, string>): Promise<Record<string, CodeAnalysis>> {
  const out: Record<string, CodeAnalysis> = {};
  let budget = CODE_FILES_PER_REPO;
  for (const dir of dirs) {
    const paths = tree ? codeFilesFor(tree, dir, Math.min(CODE_FILES_PER_DIR, budget)) : [];
    budget -= paths.length;
    const texts = await Promise.all(paths.map((p) => fetcher.readFile(ref, p).catch(() => null)));
    const code: Record<string, string> = {};
    paths.forEach((p, i) => {
      if (texts[i] !== null) code[p] = texts[i]!.slice(0, CODE_FILE_CAP);
    });
    const prefix = dir ? `${dir}/` : "";
    const deps = Object.fromEntries(Object.entries(depFiles).filter(([p]) => p.split("/").slice(0, -1).join("/") === dir || (!p.includes("/") && !prefix)));
    out[dir] = { files: Object.keys(code), evidence: [...permissionsFromCode(code), ...permissionsFromDependencies(deps)] };
  }
  return out;
}

/** An imported entry with the repository audit attached and its permissions refined by the code next to its manifest. */
export function applyAudit(input: SkillCreateInput, manifestPath: string, audit: RepositoryAudit | null): SkillCreateInput {
  if (!audit) return input;
  const dir = manifestPath.split("/").slice(0, -1).join("/");
  const manifest = refinePermissions(input.manifest, audit.permissions?.[dir]);
  return input.source ? { ...input, manifest, source: { ...input.source, audit } } : { ...input, manifest };
}
