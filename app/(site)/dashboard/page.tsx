import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { KeyRound, Lock, Radar, RefreshCw, Rocket } from "lucide-react";
import { auth } from "@/cortex/auth";
import { getI18n } from "@/cortex/locale";
import { rich } from "@/lib/i18n/rich";
import { hasDatabase } from "@/cortex/db";
import { DEMO_API_KEY } from "@/cortex/api-keys";
import { PublishForm } from "@/components/publish-form";
import { CrawlPanel } from "@/components/crawl-panel";
import { Panel, StatTile } from "@/components/panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/copy-button";
import { loadState } from "@/cortex/crawler";
import type { CrawlStatus } from "@/axon/client";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("meta.dashboard.title") };
}
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/dashboard");

  const { t } = await getI18n();
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
  // The crawler writes the shared catalogue; its console is admin-only, like its API.
  const isAdmin = session.user.role === "admin";

  return (
    <div className="space-y-8">
      <header className="flex flex-col justify-between gap-4 border-b border-border pb-4 md:flex-row md:items-center">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="label-mono text-synapse">{t("dash.console")}</span>
            <span className="label-mono">/</span>
            <h1 className="label-mono font-semibold text-foreground">{t("dash.title")}</h1>
          </div>
          <div className="label-mono-sm flex flex-wrap items-center gap-3">
            <span>
              {t("dash.operator")} <span className="text-foreground">@{handle}</span>
            </span>
            <span className="inline-block h-1 w-1 rounded-full bg-border" />
            <span>
              {t("dash.store")} <span className="text-foreground">{hasDatabase ? "postgres" : "in-memory"}</span>
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 self-start md:self-auto">
          <span className="pill h-8 text-foreground">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-synapse opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-synapse" />
            </span>
            {t("dash.online", { name: session.user.name ?? handle })}
          </span>
          <Button asChild variant="mono" size="icon-sm" aria-label={t("common.refresh")}>
            <Link href="/dashboard">
              <RefreshCw />
            </Link>
          </Button>
        </div>
      </header>

      <section className="grid grid-cols-1 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-2 sm:divide-y-0 sm:divide-x">
        <StatTile label={t("dash.apiKeys")} value={hasDatabase ? "—" : "01"} hint={t("dash.scopes")} />
        <StatTile label={t("dash.crawlerQueue")} value={String(crawlStatus.state.repos)} unit={t("dash.repos")} hint={<span className="flex justify-between"><span>{t("dash.target")}</span><span className="text-synapse">{t("dash.indexed", { n: crawlStatus.state.skills })}</span></span>} />
      </section>

      <div className="grid gap-8 lg:grid-cols-12">
        <div className="flex flex-col gap-8 lg:col-span-8">
          <Panel id="publish" title={t("dash.publish.title")} icon={<Rocket className="h-4 w-4 shrink-0 text-synapse" />} corners className="scroll-mt-20" bodyClassName="p-5">
            <p className="mb-4 text-sm text-muted-foreground">{rich(t("dash.publish.lead"))}</p>
            <PublishForm mock={false} />
          </Panel>

          {isAdmin && (
            <Panel id="crawl" title={t("dash.crawl.title")} icon={<Radar className="h-4 w-4 shrink-0 text-synapse" />} actions={<Badge variant="synapse">{t("dash.crawl.status", { s: crawlStatus.state.lastRun ? t("dash.crawl.idle") : t("dash.crawl.never") })}</Badge>} corners className="scroll-mt-20">
              <CrawlPanel initial={crawlStatus} />
            </Panel>
          )}
        </div>

        <div className="flex flex-col gap-8 lg:col-span-4">
          <Panel id="keys" title={t("dash.keys.title")} icon={<KeyRound className="h-4 w-4 shrink-0 text-synapse" />} corners className="scroll-mt-20" bodyClassName="flex flex-col gap-4 p-5">
            <div className="flex items-center justify-between">
              <span className="label-mono-sm">{t("dash.keys.registered")}</span>
              <span className="label-mono-sm text-synapse">{hasDatabase ? t("dash.keys.managed") : t("dash.keys.demo")}</span>
            </div>
            <div className="space-y-2 rounded-lg border border-border bg-muted p-3.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] font-semibold text-synapse">{hasDatabase ? "syn_live_••••" : `${DEMO_API_KEY.slice(0, 12)}…${DEMO_API_KEY.slice(-4)}`}</span>
                <Badge variant={hasDatabase ? "synapse" : "chip"}>{hasDatabase ? t("dash.keys.active") : t("dash.keys.sandbox")}</Badge>
              </div>
              <p className="text-[13px] font-medium">{hasDatabase ? t("dash.keys.prod") : t("dash.keys.local")}</p>
              <p className="label-mono-sm">
                {t("dash.keys.perms")} <span className="font-mono normal-case tracking-normal text-foreground/80">read, install</span>
              </p>
              <div className="label-mono-sm flex items-center justify-between border-t border-border pt-2">
                <span>{t("dash.keys.bound", { handle })}</span>
                {!hasDatabase && <CopyButton text={DEMO_API_KEY} label={t("dash.keys.copy")} />}
              </div>
            </div>
            <div className="well flex items-start gap-2 p-3">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-synapse" />
              <p className="label-mono-sm leading-relaxed normal-case tracking-normal">{rich(t("dash.keys.note"))} {hasDatabase ? t("dash.keys.hashed") : t("dash.keys.demoNote")}</p>
            </div>
          </Panel>
        </div>
      </div>

      <div className="label-mono-sm flex flex-col items-center justify-between gap-4 rounded-xl border border-border bg-muted p-4 md:flex-row">
        <span>{t("dash.foot.scanner", { store: hasDatabase ? "postgres" : "in-memory" })}</span>
        <span className="text-synapse">{t("dash.foot.verified")}</span>
      </div>
    </div>
  );
}
