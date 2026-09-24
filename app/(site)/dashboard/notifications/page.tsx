import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Eye, Layers } from "lucide-react";
import { auth } from "@/cortex/auth";
import { getI18n } from "@/cortex/locale";
import { countByChannel } from "@/cortex/notifications";
import { skillRepository } from "@/cortex/repository";
import { listWatched, watchSummary } from "@/cortex/social";
import { NotificationFeed } from "@/components/notification-feed";
import { NotificationSoundPanel } from "@/components/notification-sound-panel";
import { Panel } from "@/components/panel";
import { SecurityBadge } from "@/components/security-badge";
import { WatchButton } from "@/components/watch-button";
import { Badge } from "@/components/ui/badge";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("notif.meta") };
}
export const dynamic = "force-dynamic";

/** Full inbox (the drawer's big sibling) plus the "watched" list that feeds it. */
export default async function NotificationsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/dashboard/notifications");
  const [{ t, n }, counts, watched] = await Promise.all([getI18n(), countByChannel(session.user.id), listWatched(session.user.id)]);
  const skills = (await Promise.all(watched.map((w) => skillRepository.byId(w.skillId)))).filter((s): s is NonNullable<typeof s> => Boolean(s));
  const summaries = await Promise.all(skills.map((s) => watchSummary(s.id, session.user.id)));

  return (
    <div className="space-y-8">
      <header className="flex flex-col justify-between gap-4 border-b border-border pb-6 md:flex-row md:items-end">
        <div className="space-y-2">
          <p className="label-mono-sm flex items-center gap-2 tracking-[0.2em]">
            <span className="dot-live animate-pulse-dot" />
            <span className="text-synapse">{t("notif.crumb")}</span>
            <span className="text-border">/</span>
            <span>{t("notif.stream")}</span>
          </p>
          <h1 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">{t("notif.pageTitle")}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">{t("notif.pageLead")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
          <span className="pill h-8">
            <span className="dot-live" /> {t("notif.streamActive")}
          </span>
          <span className="pill h-8">{t("notif.unreadPill", { n: counts.unread })}</span>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-12">
        <section className="min-w-0 lg:col-span-7">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="label-mono">{t("notif.feedLabel")}</span>
            <span className="label-mono-sm">{t("notif.showing", { n: counts.all })}</span>
          </div>
          <NotificationFeed limit={100} />
        </section>

        <aside className="min-w-0 space-y-6 lg:col-span-5">
          <Panel title={t("watch.listTitle")} meta={n("watch.listCount", skills.length)} icon={<Eye className="h-4 w-4 shrink-0 text-synapse" />} bodyClassName="p-4">
            {skills.length === 0 ? (
              <div className="hatch flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-6 text-center">
                <Layers className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm font-semibold tracking-tight">{t("watch.listEmpty")}</span>
                <span className="max-w-xs text-xs text-muted-foreground">{t("watch.listEmptyLead")}</span>
                <Link href="/search?tab=skills" className="label-mono-sm mt-1 text-synapse hover:underline">
                  {t("common.exploreRegistry")} →
                </Link>
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {skills.map((s, i) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-lowest p-3">
                    <div className="min-w-0">
                      <Link href={`/skills/${s.slug}`} className="block truncate text-sm font-semibold text-foreground hover:text-synapse">
                        {s.name}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <SecurityBadge level={s.securityLevel} />
                        <Badge variant="chip">{s.category}</Badge>
                        <Badge variant="chip" className="text-moss">v{s.version}</Badge>
                      </div>
                    </div>
                    <WatchButton skillId={s.id} slug={s.slug} name={s.name} initial={summaries[i]} signedIn size="sm" />
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <NotificationSoundPanel />
        </aside>
      </div>
    </div>
  );
}
