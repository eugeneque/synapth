"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Github, Loader2, Rocket, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScanReportView } from "@/components/scan-report";
import { axon, AxonError } from "@/axon/client";
import { useI18n } from "@/axon/i18n";
import { rich } from "@/lib/i18n/rich";
import type { ScanReport } from "@/lib/sandbox-scanner";
import type { ImportResult } from "@/lib/github-parser";

/** GitHub → Synapth: parse, scan, publish. */
export function PublishForm({ mock }: { mock: boolean }) {
  const router = useRouter();
  const { t } = useI18n();
  const [url, setUrl] = useState(mock ? "https://github.com/acme/postgres-mcp" : "https://github.com/anthropics/skills");
  const [preview, setPreview] = useState<{ import: ImportResult; scan: ScanReport } | null>(null);
  const [busy, setBusy] = useState<"preview" | "publish" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(dryRun: boolean, e?: FormEvent) {
    e?.preventDefault();
    setBusy(dryRun ? "preview" : "publish");
    setError(null);
    try {
      const res = await axon.import.github(url, { dryRun, mock });
      setPreview({ import: res.import, scan: res.scan });
      if (!dryRun && res.skill) {
        router.push(`/skills/${res.skill.slug}`);
      }
    } catch (err) {
      setError(err instanceof AxonError ? err.message : t("pf.failed"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={(e) => run(true, e)} className="flex flex-col gap-2 sm:flex-row">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="repo" className="sr-only">{t("pf.repoUrl")}</Label>
          <div className="relative">
            <Github className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="repo" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repo" className="pl-9 font-mono text-xs" required />
          </div>
        </div>
        <Button type="submit" variant="mono" disabled={busy !== null}>
          {busy === "preview" ? <Loader2 className="animate-spin" /> : <Search />} {t("pf.preview")}
        </Button>
        <Button type="button" className="font-mono text-[11px] uppercase tracking-[0.14em]" onClick={() => run(false)} disabled={busy !== null || !preview || preview.scan.findings.some((f) => f.severity === "critical")}>
          {busy === "publish" ? <Loader2 className="animate-spin" /> : <Rocket />} {t("pf.publish")}
        </Button>
      </form>
      {mock && (
        <p className="text-xs text-muted-foreground">{rich(t("pf.mock"), { codeClassName: "font-mono" })}</p>
      )}
      {error && <p role="alert" className="border border-danger/30 bg-danger/10 px-3 py-2 font-mono text-xs text-danger">{error}</p>}

      {preview && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="well p-4 text-sm">
            <h3 className="mb-2 font-semibold">{preview.import.input.name}</h3>
            <p className="text-muted-foreground">{preview.import.input.description}</p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <dt className="label-mono">{t("pf.manifest")}</dt><dd className="font-mono">{preview.import.manifestFile}</dd>
              <dt className="label-mono">{t("pf.category")}</dt><dd>{preview.import.input.category}</dd>
              <dt className="label-mono">{t("pf.tools")}</dt><dd>{preview.import.input.manifest.tools.length}</dd>
              <dt className="label-mono">{t("pf.stars")}</dt><dd>{preview.import.meta.stars}</dd>
              <dt className="label-mono">{t("pf.license")}</dt><dd>{preview.import.meta.license ?? "—"}</dd>
            </dl>
            {preview.import.warnings.length > 0 && (
              <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-warn">
                {preview.import.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}
          </div>
          <ScanReportView report={preview.scan} />
        </div>
      )}
    </div>
  );
}
