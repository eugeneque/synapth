"use client";

/**
 * ReviewScanner — the reviewer's scanner run on /dashboard/moderation/<id>:
 * shows the scan of the stored manifest and re-runs it on demand, with a
 * verdict on whether a verification would pass the scanner.
 */

import { useState, useTransition } from "react";
import { Loader2, ScanSearch } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { useToast } from "@/axon/toast";
import { rescanEntry } from "@/app/(site)/moderation-actions";
import { ScanReportView } from "@/components/scan-report";
import type { ScanReport } from "@/lib/sandbox-scanner";
import { cn } from "@/lib/utils";

interface Props {
  skillId: string;
  initial: { report: ScanReport; verifiable: boolean; scannedAt: string };
}

export function ReviewScanner({ skillId, initial }: Props) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [scan, setScan] = useState(initial);
  const [runs, setRuns] = useState(0);
  const [busy, start] = useTransition();

  function rescan() {
    start(async () => {
      const res = await rescanEntry(skillId);
      if (!res.ok) {
        toast({ tone: "danger", title: t("review.scanFailed"), body: res.error });
        return;
      }
      setScan(res.data);
      setRuns((n) => n + 1);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card p-3">
        <div className="space-y-0.5">
          <p className={cn("label-mono-sm", scan.verifiable ? "text-synapse" : "text-danger")}>{t(scan.verifiable ? "review.verifiable" : "review.blocked")}</p>
          <p className="label-mono-sm normal-case tracking-normal">
            {t("review.scannedAt", { at: scan.scannedAt.replace("T", " ").slice(0, 19) })}
            {runs > 0 && ` · ${t("review.reruns", { n: runs })}`}
          </p>
        </div>
        <button type="button" onClick={rescan} disabled={busy} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-synapse/50 bg-synapse/10 px-3 font-mono text-[10px] uppercase tracking-[0.14em] text-synapse hover:bg-synapse/20 disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanSearch className="h-3.5 w-3.5" />} {t("review.runScanner")}
        </button>
      </div>
      <ScanReportView report={scan.report} />
    </div>
  );
}
