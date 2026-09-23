import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Radar, ShieldCheck, Users } from "lucide-react";
import { getI18n } from "@/cortex/locale";
import { countUsersByRole } from "@/cortex/roles";
import { listCrawlRuns, nextScheduledRun, scheduleMode } from "@/cortex/crawl-jobs";
import { listModerationRequests } from "@/cortex/moderation";
import { StatTile } from "@/components/panel";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("admin.meta") };
}
export const dynamic = "force-dynamic";

/** Admin panel · overview: headcount by role, crawler health, open review requests. The layout gates access. */
export default async function AdminOverviewPage() {
  const [{ t }, roles, runs, pending] = await Promise.all([getI18n(), countUsersByRole(), listCrawlRuns(1), listModerationRequests("pending", 200)]);
  const last = runs[0] ?? null;
  const mode = scheduleMode();

  const cards = [
    { href: "/dashboard/admin/users", icon: Users, title: t("admin.tab.users"), body: t("admin.card.users") },
    { href: "/dashboard/admin/crawler", icon: Radar, title: t("admin.tab.crawler"), body: t("admin.card.crawler") },
    { href: "/dashboard/moderation", icon: ShieldCheck, title: t("console.nav.moderation"), body: t("admin.card.moderation") },
  ];

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <StatTile label={t("admin.stat.accounts")} value={String(roles.user + roles.moderator + roles.admin)} hint={t("admin.stat.staff", { moderators: roles.moderator, admins: roles.admin })} />
        <StatTile
          label={t("admin.stat.crawler")}
          value={last ? t(`admin.runs.status.${last.status}`) : "—"}
          hint={mode === "off" ? t("admin.schedule.mode.off") : t("admin.stat.nextRun", { at: nextScheduledRun().toISOString().slice(11, 16) })}
        />
        <StatTile label={t("admin.stat.requests")} value={String(pending.length).padStart(2, "0")} hint={t("admin.stat.requestsHint")} />
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        {cards.map(({ href, icon: Icon, title, body }) => (
          <Link key={href} href={href} className="group flex flex-col gap-2 rounded-xl border border-border bg-card p-5 transition-colors hover:border-synapse/40">
            <span className="flex items-center justify-between">
              <Icon className="h-5 w-5 text-synapse" />
              <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-synapse" />
            </span>
            <span className="font-medium">{title}</span>
            <span className="text-sm text-muted-foreground">{body}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
