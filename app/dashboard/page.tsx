import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Download, KeyRound, Lock, Radar, RefreshCw, Rocket } from "lucide-react";
import { auth } from "@/cortex/auth";
import { billing, PLATFORM_FEE_PERCENT } from "@/cortex/billing";
import { hasDatabase } from "@/cortex/db";
import { DEMO_API_KEY } from "@/cortex/api-keys";
import { microsToUsd } from "@/types/economy";
import { PublishForm } from "@/components/publish-form";
import { CrawlPanel } from "@/components/crawl-panel";
import { Panel, StatTile } from "@/components/panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/copy-button";
import { loadState } from "@/cortex/crawler";
import { timeAgo } from "@/lib/utils";
import type { CrawlStatus } from "@/axon/client";

export const metadata: Metadata = { title: "Developer console" };
export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

const TYPE_TONE: Record<string, "synapse" | "sandbox" | "chip"> = {
  topup: "synapse",
  refund: "sandbox",
  charge: "chip",
  earning: "synapse",
  platform_fee: "chip",
  payout: "chip",
};

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/dashboard");

  const userId = session.user.id;
  const [wallet, ledger, creator] = await Promise.all([billing.getWallet(userId), billing.ledger(userId, 15), billing.creatorSummary(userId)]);
  const crawlState = loadState();
  const repos = Object.values(crawlState.repos);
  const crawlStatus: CrawlStatus = {
    running: false,
    error: null,
    progress: null,
    state: {
      repos: repos.length,
      imported: repos.filter((r) => r.status === "imported").length,
      rejected: repos.filter((r) => r.status === "rejected").length,
      errors: repos.filter((r) => r.status === "error").length,
      skills: repos.reduce((n, r) => n + r.skills, 0),
      lastRun: crawlState.runs.at(-1) ?? null,
    },
  };
  const handle = session.user.handle ?? "account";
  const apiKey = hasDatabase ? "syn_live_…" : DEMO_API_KEY;
  const execCurl = `curl -X POST ${APP_URL}/api/v1/skills/skl_weather/execute \\\n  -H 'Content-Type: application/json' \\\n  -H 'X-Synapth-Key: ${apiKey}' \\\n  -d '{"tool":"weather_now","input":{"city":"Berlin"}}'`;

  // Running balance per ledger row (entries arrive newest first).
  let running = wallet.balanceMicros;
  const rows = ledger.map((e) => {
    const balance = running;
    running -= e.amountMicros;
    return { ...e, balance };
  });

  return (
    <div className="container space-y-8 py-8 md:py-12">
      <header className="flex flex-col justify-between gap-4 border-b border-border pb-4 md:flex-row md:items-center">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="label-mono text-synapse">/ Console</span>
            <span className="label-mono">/</span>
            <h1 className="label-mono font-semibold text-foreground">Agent runtime & billing</h1>
          </div>
          <div className="label-mono-sm flex flex-wrap items-center gap-3">
            <span>
              Operator: <span className="text-foreground">@{handle}</span>
            </span>
            <span className="inline-block h-1 w-1 rounded-full bg-border" />
            <span>
              Store: <span className="text-foreground">{hasDatabase ? "postgres" : "in-memory"}</span>
            </span>
            <span className="inline-block h-1 w-1 rounded-full bg-border" />
            <span>
              Ledger: <span className="text-foreground">micro-USD, integer</span>
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 self-start md:self-auto">
          <span className="pill h-8 text-foreground">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-synapse opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-synapse" />
            </span>
            Online — {session.user.name ?? handle}
          </span>
          <span className="pill h-8">
            RTT <span className="text-synapse-dim">in-process</span>
          </span>
          <Button asChild variant="mono" size="icon-sm" aria-label="Refresh">
            <Link href="/dashboard">
              <RefreshCw />
            </Link>
          </Button>
        </div>
      </header>

      <section className="grid grid-cols-1 divide-y divide-border border border-border bg-card sm:grid-cols-2 sm:divide-y-0 sm:divide-x lg:grid-cols-4">
        <StatTile label="Wallet balance" value={`$${microsToUsd(wallet.balanceMicros).toFixed(4)}`} unit={<span className="normal-case">µUSD</span>} tag={<Badge variant="chip">Leverage 1:1</Badge>} hint={<span className="flex justify-between"><span>Gas: normal</span><span className="text-synapse-dim">Auto-refund on</span></span>} />
        <StatTile label="Active API keys" value={hasDatabase ? "—" : "01"} tag={<Badge variant="synapse">Quota ok</Badge>} hint={<span className="flex justify-between"><span>Max allowed: 10</span><span>Scopes: read, install, execute</span></span>} />
        <StatTile label="Crawler queue" value={String(crawlStatus.state.repos)} unit="repos" tag={<Badge variant="sandbox">Parser live</Badge>} hint={<span className="flex justify-between"><span>Target: GitHub</span><span className="text-synapse">{crawlStatus.state.skills} indexed</span></span>} />
        <StatTile label="Creator earnings" value={`+$${creator.earningsUsd.toFixed(4)}`} tag={<Badge variant="chip" className="text-synapse-dim">Fee {PLATFORM_FEE_PERCENT}%</Badge>} hint={<span className="flex justify-between"><span>Calls: {creator.executions.toLocaleString("en")}</span><span className="text-synapse">{creator.bySkill.length} skills</span></span>} className="[&_.stat-value]:text-synapse" />
      </section>

      <div className="grid gap-8 lg:grid-cols-12">
        <div className="flex flex-col gap-8 lg:col-span-8">
          <Panel id="publish" title="Publish from GitHub" meta="cortex/github-parser.ts" icon={<Rocket className="h-4 w-4 shrink-0 text-synapse" />} actions={<Badge variant="synapse">Status: scanner armed</Badge>} corners className="scroll-mt-20" bodyClassName="p-5">
            <p className="mb-4 text-sm text-muted-foreground">Paste a repository URL. The parser reads <code className="font-mono text-foreground">synapth.json</code>, <code className="font-mono text-foreground">mcp-server.json</code> or <code className="font-mono text-foreground">SKILL.md</code>, the scanner grades it, and the skill goes live on publish.</p>
            <PublishForm mock={false} />
          </Panel>

          <Panel id="crawl" title="GitHub catalogue crawler" meta="cortex/crawler.ts" icon={<Radar className="h-4 w-4 shrink-0 text-synapse" />} actions={<Badge variant="synapse">Status: {crawlStatus.state.lastRun ? "idle daemon" : "never run"}</Badge>} corners className="scroll-mt-20">
            <CrawlPanel initial={crawlStatus} />
          </Panel>
        </div>

        <div className="flex flex-col gap-8 lg:col-span-4">
          <Panel title="Auth & keys" meta="cortex/api-keys.ts" icon={<KeyRound className="h-4 w-4 shrink-0 text-synapse" />} corners bodyClassName="flex flex-col gap-4 p-5">
            <div className="flex items-center justify-between">
              <span className="label-mono-sm">Registered tokens</span>
              <span className="label-mono-sm text-synapse">{hasDatabase ? "managed in DB" : "[demo mode]"}</span>
            </div>
            <div className="space-y-2 border border-border bg-muted p-3.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] font-semibold text-synapse">{hasDatabase ? "syn_live_••••" : `${DEMO_API_KEY.slice(0, 12)}…${DEMO_API_KEY.slice(-4)}`}</span>
                <Badge variant={hasDatabase ? "synapse" : "chip"}>{hasDatabase ? "Active" : "Sandbox"}</Badge>
              </div>
              <p className="text-[13px] font-medium">{hasDatabase ? "Production agent key" : "Local in-memory testbench"}</p>
              <p className="label-mono-sm">
                Perms: <span className="font-mono normal-case tracking-normal text-foreground/80">read, install, execute</span>
              </p>
              <div className="label-mono-sm flex items-center justify-between border-t border-border pt-2">
                <span>Bound to: @{handle}</span>
                {!hasDatabase && <CopyButton text={DEMO_API_KEY} label="[Copy]" />}
              </div>
            </div>
            <div className="well p-3">
              <div className="label-mono-sm mb-2 flex items-center justify-between">
                <span>Gateway call</span>
                <CopyButton text={execCurl} label="Copy" />
              </div>
              <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed text-muted-foreground">{execCurl}</pre>
            </div>
            <div className="well flex items-start gap-2 p-3">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-synapse" />
              <p className="label-mono-sm leading-relaxed normal-case tracking-normal">Agents authenticate with <code className="font-mono text-foreground">X-Synapth-Key</code>; paid executions debit this wallet. {hasDatabase ? "Keys are stored hashed and cannot be recovered after rotation." : "In-memory mode: the demo key maps to the demo user."}</p>
            </div>
          </Panel>
        </div>
      </div>

      <Panel
        title="Real-time micro-billing ledger"
        meta="cortex/billing.ts"
        actions={
          <div className="flex items-center gap-2">
            <span className="pill h-7">
              Filter: <span className="text-foreground">all transactions</span>
            </span>
            <Button asChild variant="mono" size="sm" className="h-7">
              <a href="/api/v1/account/wallet" target="_blank" rel="noreferrer">
                <Download /> Export JSON
              </a>
            </Button>
          </div>
        }
        footer={
          <>
            <span className="flex items-center gap-4">
              <span>Showing {rows.length} of last 15</span>
              <span>{"// integer micro-dollars, no float"}</span>
            </span>
            <span>Hash integrity: append-only</span>
          </>
        }
      >
        {rows.length === 0 ? (
          <p className="hatch px-4 py-10 text-center font-mono text-xs text-muted-foreground">No transactions yet — execute a paid tool through the gateway to see the ledger fill up.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="label-mono-sm select-none border-b border-border bg-muted/60">
                  <th className="px-4 py-3 font-medium">Timestamp</th>
                  <th className="px-4 py-3 font-medium">Memo</th>
                  <th className="px-4 py-3 font-medium">Operation</th>
                  <th className="px-4 py-3 text-right font-medium">Delta (USD)</th>
                  <th className="px-4 py-3 text-right font-medium">Balance</th>
                  <th className="px-4 py-3 text-center font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono text-xs">
                {rows.map((e) => {
                  const debit = e.amountMicros < 0;
                  return (
                    <tr key={e.id} className="transition-colors hover:bg-accent/40">
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground" title={e.createdAt}>
                        {new Date(e.createdAt).toISOString().slice(11, 23)}
                        <span className="block text-[10px]">{timeAgo(e.createdAt)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-medium text-foreground">{e.memo}</span>
                        {e.executionId && <span className="block text-[10px] text-muted-foreground">exec: {e.executionId}</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <Badge variant={TYPE_TONE[e.type] ?? "chip"}>{e.type}</Badge>
                      </td>
                      <td className={`whitespace-nowrap px-4 py-3 text-right font-medium ${debit ? "text-danger" : "text-synapse"}`}>
                        {debit ? "−" : "+"}${Math.abs(microsToUsd(e.amountMicros)).toFixed(6)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-foreground">${microsToUsd(e.balance).toFixed(4)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-center">
                        <Badge variant={e.type === "refund" ? "sandbox" : "synapse"}>
                          <span className={`h-1 w-1 rounded-full ${e.type === "refund" ? "bg-warn" : "bg-synapse"}`} /> {e.type === "refund" ? "Refunded" : "Settled"}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="label-mono-sm flex flex-col items-center justify-between gap-4 border border-border bg-muted p-4 md:flex-row">
        <div className="flex items-center gap-3">
          <span className="font-bold text-synapse">[*]</span>
          <span className="text-foreground">Cortex protocol secured</span>
          <span>— sandbox scanner v1 · {hasDatabase ? "postgres" : "in-memory"} store</span>
        </div>
        <div className="flex items-center gap-6">
          <span>Ledger: integer micro-USD</span>
          <span>Verified: review only</span>
          <span className="text-synapse">Synapse active</span>
        </div>
      </div>
    </div>
  );
}
