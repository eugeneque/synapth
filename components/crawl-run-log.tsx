/**
 * CrawlRunLog — the crawler's run history in the admin panel: one row per
 * run (scheduled or manual) with counters; the log tail unfolds in place.
 */

import { CalendarClock, ChevronRight, Hand } from "lucide-react";
import type { CrawlRunRecord } from "@/cortex/crawl-jobs";
import type { Translator, UiKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<CrawlRunRecord["status"], string> = {
  running: "bg-synapse/10 text-synapse",
  done: "bg-muted text-foreground",
  aborted: "bg-warn/10 text-warn",
  failed: "bg-danger/10 text-danger",
};

const fmt = (iso: string) => iso.replace("T", " ").slice(0, 16);

function duration(run: CrawlRunRecord): string {
  if (!run.finishedAt) return "…";
  const s = Math.max(0, Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

export function CrawlRunLog({ runs, t }: { runs: CrawlRunRecord[]; t: Translator<UiKey>["t"] }) {
  if (!runs.length) return <p className="px-5 py-6 text-sm text-muted-foreground">{t("admin.runs.empty")}</p>;
  return (
    <ul className="divide-y divide-border">
      {runs.map((run) => (
        <li key={run.id}>
          <details className="group/run">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-surface-low/60 [&::-webkit-details-marker]:hidden">
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open/run:rotate-90" />
              <span className="inline-flex items-center gap-1.5 font-mono text-xs text-foreground">
                {run.trigger === "schedule" ? <CalendarClock className="h-3.5 w-3.5 text-synapse" /> : <Hand className="h-3.5 w-3.5 text-info" />}
                {fmt(run.startedAt)} UTC
              </span>
              <span className={cn("label-mono-sm rounded px-2 py-0.5", STATUS_TONE[run.status])}>{t(`admin.runs.status.${run.status}`)}</span>
              <span className="label-mono-sm">{t(run.trigger === "schedule" ? "admin.runs.trigger.schedule" : "admin.runs.trigger.manual")}</span>
              <span className="label-mono-sm ml-auto normal-case tracking-normal">
                {t("admin.runs.counters", { processed: run.processed, imported: run.imported, rejected: run.rejected, errors: run.errors, created: run.created, updated: run.updated })} · {duration(run)}
              </span>
            </summary>
            <div className="border-t border-border bg-muted/40 px-5 py-3">
              {run.error && <p className="mb-2 font-mono text-xs text-danger">{run.error}</p>}
              {run.log.length ? (
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground/90">{run.log.join("\n")}</pre>
              ) : (
                <p className="font-mono text-xs text-muted-foreground">{t("admin.runs.noLog")}</p>
              )}
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}
