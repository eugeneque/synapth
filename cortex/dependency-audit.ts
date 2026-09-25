/**
 * Cortex · Dependency audit (ТЗ §2, stage 4 — the parts that need the network).
 *
 *   DP-01 — known vulnerabilities from OSV (one `querybatch` per repository,
 *           advisory details for the first few hits to read their severity)
 *   DP-05 — package younger than 30 days or with < 100 weekly downloads
 *           (npm registry + downloads API, PyPI JSON API)
 *
 * The hosts are fixed public APIs, not user data, so plain `fetch` is fine;
 * every call has a short timeout and any failure just skips the check — an
 * unreachable registry must never block publishing.
 */

import type { ScanFinding, Severity } from "@/lib/sandbox-scanner";
import type { PackageRef } from "@/lib/dependency-scanner";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface AuditOptions {
  fetch?: FetchLike;
  /** Registry lookups per repository (DP-05); OSV always gets the whole list. */
  maxRegistryLookups?: number;
  /** Advisory detail fetches per repository (severity of DP-01). */
  maxAdvisories?: number;
  timeoutMs?: number;
  now?: number;
}

const OSV_BATCH = "https://api.osv.dev/v1/querybatch";
const OSV_VULN = "https://api.osv.dev/v1/vulns/";
const DAY = 86_400_000;

async function getJson<T>(f: FetchLike, url: string, init: RequestInit | undefined, timeoutMs: number): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await f(url, { ...init, signal: controller.signal, headers: { Accept: "application/json", "User-Agent": "synapth-scanner", ...(init?.headers ?? {}) } });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface OsvVuln {
  id: string;
  summary?: string;
  database_specific?: { severity?: string };
  severity?: Array<{ type: string; score: string }>;
}

/** GHSA labels map onto ours; CVSS vectors without a label count as high. */
export function osvSeverity(v: OsvVuln): Severity {
  const label = v.database_specific?.severity?.toUpperCase();
  if (label === "CRITICAL") return "critical";
  if (label === "HIGH") return "high";
  if (label === "MODERATE" || label === "MEDIUM") return "medium";
  if (label === "LOW") return "low";
  return "high";
}

export async function auditDependencies(packages: PackageRef[], surface: string, options: AuditOptions = {}): Promise<ScanFinding[]> {
  const f = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const now = options.now ?? Date.now();
  const findings: ScanFinding[] = [];
  const pinned = packages.filter((p) => p.version).slice(0, 500);

  // ---- DP-01 · OSV ------------------------------------------------------------
  if (pinned.length) {
    const batch = await getJson<{ results?: Array<{ vulns?: Array<{ id: string }> }> }>(
      f,
      OSV_BATCH,
      { method: "POST", body: JSON.stringify({ queries: pinned.map((p) => ({ package: { name: p.name, ecosystem: p.ecosystem }, version: p.version })) }), headers: { "Content-Type": "application/json" } },
      timeoutMs,
    );
    const hits = (batch?.results ?? []).flatMap((r, i) => (r.vulns ?? []).map((v) => ({ pkg: pinned[i], id: v.id })));
    let budget = options.maxAdvisories ?? 10;
    for (const hit of hits) {
      const detail = budget-- > 0 ? await getJson<OsvVuln>(f, `${OSV_VULN}${encodeURIComponent(hit.id)}`, undefined, timeoutMs) : null;
      findings.push({
        kind: "dependency",
        severity: detail ? osvSeverity(detail) : "high",
        surface,
        message: `${hit.pkg.name}@${hit.pkg.version} has a known vulnerability${detail?.summary ? `: ${detail.summary}` : ""}.`,
        evidence: `${hit.id} · ${hit.pkg.ecosystem}:${hit.pkg.name}@${hit.pkg.version}`.slice(0, 140),
        rule: "DP-01",
      });
    }
  }

  // ---- DP-05 · young or unpopular packages ---------------------------------------
  const young: string[] = [];
  for (const p of packages.filter((x) => x.ecosystem !== "Go").slice(0, options.maxRegistryLookups ?? 15)) {
    if (p.ecosystem === "npm") {
      const meta = await getJson<{ time?: { created?: string } }>(f, `https://registry.npmjs.org/${p.name.replace("/", "%2F")}`, undefined, timeoutMs);
      const dl = await getJson<{ downloads?: number }>(f, `https://api.npmjs.org/downloads/point/last-week/${p.name}`, undefined, timeoutMs);
      const created = meta?.time?.created ? Date.parse(meta.time.created) : NaN;
      if ((!Number.isNaN(created) && now - created < 30 * DAY) || (typeof dl?.downloads === "number" && dl.downloads < 100)) young.push(p.name);
    } else {
      const meta = await getJson<{ releases?: Record<string, Array<{ upload_time_iso_8601?: string }>> }>(f, `https://pypi.org/pypi/${encodeURIComponent(p.name)}/json`, undefined, timeoutMs);
      const uploads = Object.values(meta?.releases ?? {}).flat().map((r) => Date.parse(r.upload_time_iso_8601 ?? "")).filter((t) => !Number.isNaN(t));
      if (uploads.length && now - Math.min(...uploads) < 30 * DAY) young.push(p.name);
    }
  }
  if (young.length) findings.push({ kind: "dependency", severity: "low", surface, message: "Dependencies younger than 30 days or with fewer than 100 weekly downloads.", evidence: young.slice(0, 6).join(", "), rule: "DP-05" });

  return findings;
}
