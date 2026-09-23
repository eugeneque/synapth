"use client";

import { useEffect, useState } from "react";
import { Loader2, Play, Square, RefreshCw, Radar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { axon, AxonError, type CrawlStatus } from "@/axon/client";
import { useI18n } from "@/axon/i18n";

/** Dashboard control for the GitHub crawler: start / abort / live progress as a stdout stream. */
export function CrawlPanel({ initial }: { initial: CrawlStatus }) {
  const { t } = useI18n();
  const [status, setStatus] = useState(initial);
  const [maxRepos, setMaxRepos] = useState(100);
  const [minStars, setMinStars] = useState(3);
  const [repos, setRepos] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!status.running) return;
    const t = setInterval(async () => {
      try {
        setStatus(await axon.crawl.status());
      } catch {
        /* keep the last snapshot */
      }
    }, 1500);
    return () => clearInterval(t);
  }, [status.running]);

  async function run(fn: () => Promise<CrawlStatus>) {
    setBusy(true);
    setError(null);
    try {
      setStatus(await fn());
    } catch (e) {
      setError(e instanceof AxonError ? e.message : t("cp.failed"));
    } finally {
      setBusy(false);
    }
  }

  const p = status.progress;
  const pct = p && p.discovered ? Math.round((p.processed / p.discovered) * 100) : 0;
  const log = p?.log.slice(-40) ?? [];
  const last = status.state.lastRun;
  const scheduled = status.running && status.trigger === "schedule";

  return (
    <div className="flex flex-col gap-5 p-5 text-sm">
      <div className="flex flex-wrap items-end gap-3">
        {status.running ? (
          <Button variant="destructive" size="sm" className="font-mono text-[11px] uppercase tracking-[0.14em]" disabled={busy} onClick={() => run(() => axon.crawl.abort())}>
            <Square /> {t("cp.abort")}
          </Button>
        ) : (
          <Button size="sm" className="font-mono text-[11px] uppercase tracking-[0.14em]" disabled={busy} onClick={() => run(() => axon.crawl.start({ maxRepos, minStars, repos: repos.trim() ? repos.split(",").map((r) => r.trim()).filter(Boolean) : undefined }))}>
            {busy ? <Loader2 className="animate-spin" /> : <Play />} {t("cp.run")}
          </Button>
        )}
        <Button variant="mono" size="sm" aria-label={t("common.refresh")} onClick={() => run(() => axon.crawl.status())}>
          <RefreshCw /> {t("cp.refresh")}
        </Button>
        <div className="well ml-auto hidden items-center gap-2 px-3 py-1.5 font-mono text-xs text-muted-foreground sm:flex">
          <span className="text-synapse">$</span> npm run crawl -- --max {maxRepos} --min-stars {minStars}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[6rem_6rem_1fr]">
        <div className="space-y-1">
          <Label htmlFor="maxRepos" className="label-mono-sm">{t("cp.repos")}</Label>
          <Input id="maxRepos" type="number" min={1} max={2000} value={maxRepos} onChange={(e) => setMaxRepos(Number(e.target.value))} className="font-mono text-xs" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="minStars" className="label-mono-sm">{t("cp.minStars")}</Label>
          <Input id="minStars" type="number" min={0} value={minStars} onChange={(e) => setMinStars(Number(e.target.value))} className="font-mono text-xs" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="repos" className="label-mono-sm">{t("cp.specific")}</Label>
          <Input id="repos" value={repos} onChange={(e) => setRepos(e.target.value)} placeholder="anthropics/skills, modelcontextprotocol/servers" className="font-mono text-xs" />
        </div>
      </div>

      {error && <p role="alert" className="border border-danger/30 bg-danger/10 px-3 py-2 font-mono text-xs text-danger">{error}</p>}

      <div className="well overflow-hidden">
        <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-2">
          <span className="label-mono-sm inline-flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 rounded-full ${status.running ? "bg-synapse animate-pulse-dot" : "bg-border"}`} /> {t("cp.stream")}
          </span>
          <span className="label-mono-sm text-synapse">{t("cp.events", { n: log.length })}</span>
        </div>
        <div className="h-56 overflow-y-auto p-4 font-mono text-xs leading-relaxed text-foreground">
          {log.length === 0 ? (
            <>
              <p className="text-muted-foreground">{t("cp.idle")}</p>
              {last && (
                <p className="text-muted-foreground">{t("cp.lastRun", { at: last.finishedAt.replace("T", " ").slice(0, 16), processed: last.processed, created: last.created, updated: last.updated })}</p>
              )}
              {status.error && <p className="text-danger">{t("cp.lastError", { err: status.error })}</p>}
            </>
          ) : (
            log.map((line, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="select-none text-muted-foreground">[{String(i + 1).padStart(3, "0")}]</span>
                <span className="text-synapse">&gt;</span>
                <span className="whitespace-pre-wrap">{line}</span>
              </div>
            ))
          )}
        </div>
        <div className="label-mono-sm flex items-center justify-between border-t border-border bg-surface px-3 py-1.5">
          <span className="inline-flex items-center gap-2">
            {status.running && <Radar className="h-3.5 w-3.5 animate-pulse text-synapse" />}
            {scheduled && <span className="text-synapse">{t("cp.scheduled")}</span>}
            {p ? `${t("cp.progress", { phase: p.phase, processed: p.processed, discovered: p.discovered, created: p.skillsCreated, updated: p.skillsUpdated })}${p.current ? ` · ${p.current}` : ""}` : t("cp.listener")}
          </span>
          <span>{p ? `${pct}%` : t("cp.runtime", { state: status.running ? t("cp.active") : t("cp.idleState") })}</span>
        </div>
        {p && (
          <div className="h-1 w-full bg-muted">
            <div className="h-full bg-synapse transition-all" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
        <Stat label={t("cp.reposSeen")} value={status.state.repos} />
        <Stat label={t("cp.imported")} value={status.state.imported} />
        <Stat label={t("cp.rejected")} value={status.state.rejected} />
        <Stat label={t("cp.skillsFromGithub")} value={status.state.skills} accent />
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-muted p-2">
      <p className="label-mono-sm">{label}</p>
      <p className={`mt-0.5 font-mono text-sm font-medium ${accent ? "text-synapse" : "text-foreground"}`}>{value.toLocaleString("en")}</p>
    </div>
  );
}
