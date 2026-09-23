import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CalendarClock, Radar, ScrollText } from "lucide-react";
import { auth } from "@/cortex/auth";
import { hasPermission } from "@/cortex/roles";
import { getI18n } from "@/cortex/locale";
import { rich } from "@/lib/i18n/rich";
import { CRAWL_INTERVAL_HOURS, crawlStatus, listCrawlRuns, nextScheduledRun, scheduleMode } from "@/cortex/crawl-jobs";
import { Panel } from "@/components/panel";
import { Badge } from "@/components/ui/badge";
import { CrawlPanel } from "@/components/crawl-panel";
import { CrawlRunLog } from "@/components/crawl-run-log";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("admin.crawler.meta") };
}
export const dynamic = "force-dynamic";

/** Admin panel · crawler: the automatic schedule, a manual run, and the log of every run. */
export default async function AdminCrawlerPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/dashboard/admin/crawler");
  if (!(await hasPermission(session.user.id, "crawler.run"))) notFound();
  const [runs, { t }] = await Promise.all([listCrawlRuns(30), getI18n()]);
  const status = crawlStatus();
  const mode = scheduleMode();
  const lastScheduled = runs.find((r) => r.trigger === "schedule") ?? null;

  return (
    <div className="space-y-6">
      <Panel
        title={t("admin.schedule.title")}
        icon={<CalendarClock className="h-4 w-4 shrink-0 text-synapse" />}
        actions={<Badge variant={mode === "off" ? "chip" : "synapse"}>{t(`admin.schedule.mode.${mode}`)}</Badge>}
        corners
        bodyClassName="grid gap-4 p-5 sm:grid-cols-3"
      >
        <Fact label={t("admin.schedule.every")} value={t("admin.schedule.hours", { n: CRAWL_INTERVAL_HOURS })} />
        <Fact label={t("admin.schedule.next")} value={mode === "off" ? "—" : `${nextScheduledRun().toISOString().replace("T", " ").slice(0, 16)} UTC`} />
        <Fact label={t("admin.schedule.last")} value={lastScheduled ? `${lastScheduled.startedAt.replace("T", " ").slice(0, 16)} UTC · ${t(`admin.runs.status.${lastScheduled.status}`)}` : t("admin.schedule.never")} />
        <p className="label-mono-sm leading-relaxed normal-case tracking-normal sm:col-span-3">{rich(t(mode === "off" ? "admin.schedule.offHint" : "admin.schedule.hint"))}</p>
      </Panel>

      <Panel id="crawl" title={t("dash.crawl.title")} icon={<Radar className="h-4 w-4 shrink-0 text-synapse" />} actions={<Badge variant="synapse">{t("dash.crawl.status", { s: status.running ? t("cp.active") : status.state.lastRun ? t("dash.crawl.idle") : t("dash.crawl.never") })}</Badge>} corners className="scroll-mt-20">
        <CrawlPanel initial={status} />
      </Panel>

      <Panel title={t("admin.runs.title")} meta={String(runs.length)} icon={<ScrollText className="h-4 w-4 shrink-0 text-synapse" />} corners>
        <CrawlRunLog runs={runs} t={t} />
      </Panel>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted p-3">
      <p className="label-mono-sm">{label}</p>
      <p className="mt-1 font-mono text-sm text-foreground">{value}</p>
    </div>
  );
}
