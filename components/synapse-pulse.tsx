"use client";

/**
 * SynapsePulse — the interactive pipeline on the overview page.
 *
 * "Fire synaptic pulse" runs a real agent request against the gateway
 * (`GET /api/v1/skills` with `X-Agent-Request: true`) and lights the four
 * nodes as the payload comes back: prompt → cortex search → sandbox scan →
 * agent context. The audit stream prints what actually happened, not a script.
 */

import { useRef, useState } from "react";
import { BadgeCheck, Bolt, Loader2, ShieldCheck, Terminal, Waypoints } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { cn } from "@/lib/utils";
import type { AgentContextPayload } from "@/types/agent";

type Stage = 0 | 1 | 2 | 3 | 4;
type Status = "standby" | "live" | "done" | "error";

interface LogLine {
  text: string;
  tone?: "muted" | "accent" | "danger";
}

const DEFAULT_QUERY = "postgres";

export function SynapsePulse() {
  const { t } = useI18n();
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [stage, setStage] = useState<Stage>(0);
  const [status, setStatus] = useState<Status>("standby");
  const [log, setLog] = useState<LogLine[]>([{ text: t("home.pulse.log.init") }, { text: t("home.pulse.log.idle"), tone: "muted" }]);
  const [nodes, setNodes] = useState<{ search?: string; scan?: string; scanTone?: "synapse" | "warn" | "info"; context?: string }>({});
  const busy = useRef(false);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const push = (line: LogLine) => setLog((l) => [...l.slice(-7), line]);

  async function fire() {
    if (busy.current) return;
    busy.current = true;
    const q = query.trim() || DEFAULT_QUERY;
    setStatus("live");
    setNodes({});
    setLog([]);
    setStage(1);
    push({ text: t("home.pulse.log.prompt", { q }) });
    await sleep(350);

    const started = performance.now();
    try {
      setStage(2);
      push({ text: `> GET /api/v1/skills?q=${encodeURIComponent(q)}&limit=3 · X-Agent-Request: true`, tone: "muted" });
      const res = await fetch(`/api/v1/skills?q=${encodeURIComponent(q)}&limit=3`, { headers: { "X-Agent-Request": "true" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const payload = JSON.parse(text) as AgentContextPayload;
      const ms = Math.max(1, Math.round(performance.now() - started));
      setNodes((n) => ({ ...n, search: t("home.pulse.node2.value", { n: payload.n, ms }) }));
      push({ text: t("home.pulse.log.search", { n: payload.n, ms }) });
      await sleep(450);

      setStage(3);
      const top = payload.skills[0];
      if (top) {
        const tone = top.sec === "Verified" ? "synapse" : top.sec === "Sandbox" ? "warn" : "info";
        setNodes((n) => ({ ...n, scan: `${top.n} · ${top.sec}`, scanTone: tone }));
        push({ text: t("home.pulse.log.scan", { name: top.n, level: top.sec }), tone: tone === "warn" ? "danger" : "accent" });
      } else {
        setNodes((n) => ({ ...n, scan: t("home.pulse.node3.empty"), scanTone: "info" }));
        push({ text: t("home.pulse.log.noHits"), tone: "muted" });
      }
      await sleep(450);

      setStage(4);
      const bytes = new TextEncoder().encode(text).length;
      setNodes((n) => ({ ...n, context: t("home.pulse.node4.value", { tools: payload.tools.length, bytes: (bytes / 1024).toFixed(1) }) }));
      push({ text: t("home.pulse.log.context", { tools: payload.tools.length, chars: payload.sys.length }), tone: "accent" });
      push({ text: t("home.pulse.log.done", { ms: Math.round(performance.now() - started) }) });
      setStatus("done");
    } catch (err) {
      push({ text: t("home.pulse.log.error", { error: err instanceof Error ? err.message : String(err) }), tone: "danger" });
      setStatus("error");
    } finally {
      busy.current = false;
    }
  }

  const nodeDefs = [
    { icon: Terminal, id: "01", title: t("home.pulse.node1.title"), value: `"${query.trim() || DEFAULT_QUERY}"`, tone: "muted" as const },
    { icon: Waypoints, id: "02", title: t("home.pulse.node2.title"), value: nodes.search ?? t("home.pulse.node2.idle"), tone: "muted" as const },
    { icon: ShieldCheck, id: "03", title: t("home.pulse.node3.title"), value: nodes.scan ?? t("home.pulse.node3.idle"), tone: nodes.scanTone ?? ("muted" as const) },
    { icon: BadgeCheck, id: "04", title: t("home.pulse.node4.title"), value: nodes.context ?? t("home.pulse.node4.idle"), tone: nodes.context ? ("synapse" as const) : ("muted" as const) },
  ];

  const statusLabel = { standby: t("home.pulse.status.standby"), live: t("home.pulse.status.live"), done: t("home.pulse.status.done"), error: t("home.pulse.status.error") }[status];

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex h-10 flex-1 items-center gap-2 rounded-lg border border-border bg-surface-lowest px-3 font-mono text-xs focus-within:border-synapse/60">
          <span className="select-none text-synapse">&gt;</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && fire()} placeholder={t("home.pulse.placeholder")} className="w-full bg-transparent text-foreground placeholder:text-muted-foreground/50 focus:outline-none" aria-label={t("home.pulse.placeholder")} />
        </label>
        <button type="button" onClick={fire} disabled={status === "live"} className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-border bg-surface px-4 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-synapse transition-colors hover:bg-surface-high disabled:opacity-60">
          {status === "live" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bolt className="h-4 w-4" />}
          {status === "live" ? t("home.pulse.firing") : t("home.pulse.fire")}
        </button>
      </div>

      <div className="relative flex flex-col items-stretch gap-4 py-2 lg:flex-row lg:items-center">
        <div className="absolute left-12 right-12 top-1/2 hidden h-0.5 -translate-y-1/2 bg-border lg:block" aria-hidden="true">
          <div className="h-full bg-synapse transition-all duration-700" style={{ width: `${(Math.max(stage - 1, 0) / 3) * 100}%` }} />
        </div>
        {nodeDefs.map((node, i) => {
          const active = stage >= i + 1;
          const Icon = node.icon;
          return (
            <div key={node.id} className={cn("relative z-10 flex w-full flex-col items-center rounded-lg border bg-surface p-4 text-center transition-colors lg:w-1/4", active ? "border-synapse/40" : "border-border")}>
              <span className={cn("mb-3 flex h-10 w-10 items-center justify-center rounded-full border bg-surface-high transition-colors", active ? "border-synapse/40 text-synapse" : "border-border text-muted-foreground")}>
                <Icon className="h-5 w-5" />
              </span>
              <span className="label-mono-sm">{t("home.pulse.node", { n: node.id })}</span>
              <span className="text-lg font-semibold tracking-tight text-foreground">{node.title}</span>
              <span className={cn("mt-2 w-full truncate font-mono text-xs", node.tone === "synapse" ? "text-synapse" : node.tone === "warn" ? "text-warn" : node.tone === "info" ? "text-info" : "text-muted-foreground")}>{node.value}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-6 rounded-lg border border-border bg-surface-lowest p-4 font-mono text-xs">
        <div className="label-mono-sm mb-2 flex items-center justify-between border-b border-border pb-2">
          <span>{t("home.pulse.stdout")}</span>
          <span className={cn(status === "error" ? "text-danger" : "text-synapse")}>{statusLabel}</span>
        </div>
        <div className="space-y-1 leading-relaxed" aria-live="polite">
          {log.map((line, i) => (
            <div key={i} className={cn(line.tone === "muted" && "text-muted-foreground", line.tone === "accent" && "text-synapse", line.tone === "danger" && "text-danger", !line.tone && "text-foreground")}>
              {line.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
