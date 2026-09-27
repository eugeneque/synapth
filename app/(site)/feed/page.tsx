import type { Metadata } from "next";
import Link from "next/link";
import { Newspaper, Sparkles, UserPlus } from "lucide-react";
import { auth } from "@/cortex/auth";
import { getAuthorRef } from "@/cortex/account";
import { hasPermission } from "@/cortex/roles";
import { getI18n } from "@/cortex/locale";
import { feedSuggestions, getFeed } from "@/cortex/feed";
import { HomeFeed } from "@/components/home-feed";
import { Avatar } from "@/components/avatar";
import { FriendButton } from "@/components/friend-button";
import { VerifiedMark } from "@/components/verified-mark";
import { FEED_TABS, type FeedTab } from "@/types/feed";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("feed.meta") };
}

type Props = { searchParams: Promise<{ tab?: string }> };

/** Everyone's posts: a ranked "For you" tab (`cortex/feed.ts`) and a chronological "Following" tab for signed-in readers. */
export default async function FeedPage({ searchParams }: Props) {
  const [{ tab: rawTab }, session, { t, n }] = await Promise.all([searchParams, auth(), getI18n()]);
  const viewerId = session?.user?.id ?? null;
  const tab: FeedTab = viewerId && (FEED_TABS as readonly string[]).includes(rawTab ?? "") ? (rawTab as FeedTab) : "for-you";
  const [page, viewer, canModerate, suggestions] = await Promise.all([
    getFeed(viewerId, { tab }),
    viewerId ? getAuthorRef(viewerId) : Promise.resolve(null),
    hasPermission(viewerId, "content.moderate"),
    viewerId ? feedSuggestions(viewerId) : Promise.resolve([]),
  ]);

  return (
    <div className="container py-8 md:py-12">
      <header className="space-y-2 border-b border-border pb-6">
        <p className="label-mono-sm flex items-center gap-2 tracking-[0.2em]">
          <Newspaper className="h-3.5 w-3.5 text-synapse" />
          <span className="text-synapse">{t("nav.feed")}</span>
        </p>
        <h1 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">{t("feed.title")}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{t("feed.lead")}</p>
      </header>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <main className="min-w-0 space-y-5">
          {viewerId && (
            <nav className="flex gap-6 border-b border-border" aria-label={t("feed.tabs")}>
              {FEED_TABS.map((id) => (
                <Link key={id} href={id === "for-you" ? "/feed" : `/feed?tab=${id}`} className="tab-line" aria-current={tab === id ? "page" : undefined}>
                  {t(`feed.tab.${id}`)}
                </Link>
              ))}
            </nav>
          )}
          <HomeFeed key={tab} tab={tab} viewer={viewer} canModerate={canModerate} initial={page} />
        </main>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          {viewerId ? (
            suggestions.length > 0 && (
              <section className="overflow-hidden rounded-xl border border-border bg-card">
                <h2 className="flex items-center gap-2 px-5 pb-2 pt-5 text-sm font-semibold tracking-tight">
                  <UserPlus className="h-4 w-4 text-synapse" /> {t("feed.suggest.title")}
                </h2>
                <ul className="divide-y divide-border">
                  {suggestions.map((s) => (
                    <li key={s.id} className="flex items-center gap-3 px-5 py-3">
                      <Avatar author={s} size="sm" link />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1">
                          <Link href={`/u/${s.handle}`} className="truncate text-sm font-medium hover:underline">
                            {s.name || s.handle}
                          </Link>
                          {s.verified && <VerifiedMark size="sm" />}
                        </div>
                        <span className="label-mono-sm block truncate normal-case tracking-normal">{s.mutual ? n("feed.suggest.mutual", s.mutual) : t("feed.suggest.popular")}</span>
                      </div>
                      <FriendButton toId={s.id} handle={s.handle} name={s.name || s.handle} initial="none" size="icon" />
                    </li>
                  ))}
                </ul>
              </section>
            )
          ) : (
            <section className="rounded-xl border border-border bg-card p-5 text-sm">
              <p className="text-muted-foreground">{t("feed.anonLead")}</p>
              <Link href="/signin?callbackUrl=/feed" className="mt-3 inline-block font-mono text-[11px] uppercase tracking-[0.14em] text-synapse hover:underline">
                {t("header.signIn")} →
              </Link>
            </section>
          )}
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
              <Sparkles className="h-4 w-4 text-synapse" /> {t("feed.how.title")}
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t("feed.how.body")}</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
