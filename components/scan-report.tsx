"use client";

import { AlertTriangle, CheckCircle2, Shield, ShieldCheck, XCircle } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/panel";
import { SecurityBadge } from "@/components/security-badge";
import type { FindingKind, ScanReport } from "@/lib/sandbox-scanner";
import { cn } from "@/lib/utils";

const SEVERITY_VARIANT = { low: "default", medium: "community", high: "sandbox", critical: "danger" } as const;

/** The rule families every scan covers; each one is reported as PASS unless a finding of that kind exists. */
const CHECKS: FindingKind[] = ["prompt_injection", "malicious_command", "secret_leak", "exfiltration", "over_permissioned", "malformed"];

export function ScanReportView({ report, compact }: { report: ScanReport; compact?: boolean }) {
  const { t } = useI18n();
  const tone = report.score >= 80 ? "text-synapse" : report.score >= 50 ? "text-warn" : "text-danger";
  const grade = report.score >= 90 ? "A+" : report.score >= 80 ? "A" : report.score >= 65 ? "B" : report.score >= 50 ? "C" : "F";
  const byKind = new Map<FindingKind, typeof report.findings>();
  for (const f of report.findings) byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f]);

  return (
    <Panel
      title={t("scan.title")}
      icon={report.findings.length ? <AlertTriangle className="h-4 w-4 shrink-0 text-warn" /> : <ShieldCheck className="h-4 w-4 shrink-0 text-synapse" />}
      actions={<span className={cn("label-mono-sm font-semibold", tone)}>{t("scan.grade", { grade })}</span>}
      corners
      bodyClassName="flex flex-col gap-4 p-4"
      footer={
        <>
          <span>{t("scan.footer", { v: report.scannerVersion, n: report.surfacesScanned })}</span>
          <span>{report.durationMs} ms</span>
        </>
      }
    >
      <div className="flex items-center justify-between bg-surface-low/60 p-3">
        <div className="flex flex-col">
          <span className="label-mono-sm">{t("scan.score")}</span>
          <span className="stat-value">
            {report.score}
            <span className="label-mono ml-1 text-muted-foreground">/ 100</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <SecurityBadge level={report.level} />
          <span className={cn("flex h-12 w-12 items-center justify-center rounded-full", report.findings.length ? "bg-warn/10 text-warn" : "bg-synapse/10 text-synapse")}>
            <Shield className="h-7 w-7" />
          </span>
        </div>
      </div>

      <ul className="flex flex-col gap-1.5">
        {CHECKS.map((kind) => {
          const hits = byKind.get(kind) ?? [];
          const failed = hits.length > 0;
          if (compact && failed) return null;
          return (
            <li key={kind} className="flex items-start gap-2 bg-surface-low/60 p-2">
              {failed ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-synapse" />}
              <div className="flex min-w-0 flex-col gap-1">
                <span className="label-mono-sm normal-case tracking-normal text-foreground">
                  [{failed ? t("scan.fail") : t("scan.pass")}] {t(`scan.check.${kind}.title`)}
                </span>
                {failed ? (
                  hits.map((f, i) => (
                    <div key={i} className="space-y-1 text-[11px] text-muted-foreground">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={SEVERITY_VARIANT[f.severity]}>{f.severity}</Badge>
                        <span className="font-mono">{f.rule}</span>
                        <span className="font-mono">@ {f.surface}</span>
                      </div>
                      <p>{f.message}</p>
                      <code className="block truncate border border-border bg-background px-2 py-1 font-mono text-[10px]">{f.evidence}</code>
                    </div>
                  ))
                ) : (
                  <span className="text-[10px] text-muted-foreground">{t(`scan.check.${kind}.pass`)}</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
