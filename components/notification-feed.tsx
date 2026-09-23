"use client";

/**
 * NotificationFeed — filter tabs + inbox cards, shared by the header drawer
 * and /dashboard/notifications. Fetches `GET /api/v1/notifications` on open
 * and again whenever the provider's `version` bumps (fresh rows, reads).
 *
 * Card anatomy follows the Stitch spec: avatar (or tool icon) with a kind
 * badge overlay, headline, relative time, unread pip + dismiss ✕, and an
 * action sub-bar with a context chip and the primary CTA.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Award, BadgeCheck, Boxes, CheckCheck, Gavel, Inbox, Info, Layers, MessageSquare, ShieldCheck, X, Zap } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { useNotifications } from "@/axon/notifications";
import { describeNotification } from "@/axon/notification-text";
import { Avatar } from "@/components/avatar";
import { cn, timeAgo } from "@/lib/utils";
import type { UiKey } from "@/lib/i18n";
import { NOTIFICATION_CHANNEL, type Notification, type NotificationChannel, type NotificationFeed as Feed } from "@/types/social";

type Tab = "all" | "unread" | NotificationChannel;
const TABS: Array<{ id: Tab; key: UiKey }> = [
  { id: "all", key: "notif.tab.all" },
  { id: "unread", key: "notif.tab.unread" },
  { id: "social", key: "notif.tab.social" },
  { id: "skills", key: "notif.tab.skills" },
  { id: "system", key: "notif.tab.system" },
];

const KIND_ICON: Record<Notification["kind"], typeof Zap> = { impulse: Zap, "comment.post": MessageSquare, "comment.skill": MessageSquare, "skill.updated": Layers, "moderation.requested": ShieldCheck, "moderation.decided": Gavel, "skillset.updated": Boxes, "skillset.verified": ShieldCheck, "verification.requested": BadgeCheck, "verification.updated": BadgeCheck, badge: Award, system: Info };

export function NotificationFeed({ compact = false, limit = 50 }: { compact?: boolean; limit?: number }) {
  const { t } = useI18n();
  const { version, markRead, dismiss, viewerHandle } = useNotifications();
  const [tab, setTab] = useState<Tab>("all");
  const [feed, setFeed] = useState<Feed | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/v1/notifications?channel=${tab}&limit=${limit}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Feed>) : null))
      .then((data) => {
        if (!cancelled && data) setFeed(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, limit, version]);

  // Tab chips count from the loaded "all" view when we have it; otherwise fall back to the feed totals.
  const counts = useMemo(() => {
    const c: Record<Tab, number> = { all: feed?.total ?? 0, unread: feed?.unread ?? 0, social: 0, skills: 0, system: 0 };
    if (tab === "all" && feed) for (const n of feed.items) c[NOTIFICATION_CHANNEL[n.kind]] += 1;
    return c;
  }, [feed, tab]);

  async function onRead(n: Notification) {
    if (n.readAt) return;
    setFeed((f) => (f ? { ...f, unread: Math.max(0, f.unread - 1), items: f.items.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)) } : f));
    await markRead([n.id]);
  }

  async function onDismiss(n: Notification) {
    setFeed((f) => (f ? { ...f, total: f.total - 1, unread: n.readAt ? f.unread : Math.max(0, f.unread - 1), items: f.items.filter((x) => x.id !== n.id) } : f));
    await dismiss(n.id);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cn("flex flex-wrap items-center justify-between gap-x-3 border-b border-border", compact ? "px-4" : "px-1")}>
        <nav className="flex flex-wrap items-center gap-x-4">
          {TABS.map((item) => {
            const n = counts[item.id];
            return (
              <button key={item.id} type="button" onClick={() => setTab(item.id)} className={cn("tab-line h-9 shrink-0 gap-1.5", tab === item.id && "text-foreground after:bg-synapse")} data-active={tab === item.id}>
                {t(item.key)}
                {(item.id === "all" || item.id === "unread" || tab === "all") && (
                  <span className={cn("rounded px-1.5 py-px font-mono text-[10px] normal-case tracking-normal", item.id === "unread" && n > 0 ? "bg-synapse/20 text-synapse" : "bg-surface-high text-muted-foreground")}>{n}</span>
                )}
              </button>
            );
          })}
        </nav>
        {(feed?.unread ?? 0) > 0 && (
          <button type="button" onClick={() => void markRead()} className="label-mono-sm hidden shrink-0 items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground sm:inline-flex">
            <CheckCheck className="h-3.5 w-3.5" /> {t("notif.markAll")}
          </button>
        )}
      </div>

      <div className={cn("flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto", compact ? "p-4" : "py-4")}>
        {feed && feed.items.length === 0 && !loading ? (
          <div className="hatch flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-10 text-center">
            <Inbox className="h-6 w-6 text-muted-foreground" />
            <span className="text-sm font-semibold tracking-tight">{t("notif.empty")}</span>
            <span className="max-w-xs text-xs text-muted-foreground">{t("notif.emptyLead")}</span>
          </div>
        ) : (
          feed?.items.map((n) => <NotificationCard key={n.id} n={n} viewerHandle={viewerHandle} onRead={() => void onRead(n)} onDismiss={() => void onDismiss(n)} />)
        )}
        {loading && !feed && <div className="label-mono-sm animate-pulse-dot px-1">{t("notif.loading")}</div>}
      </div>
    </div>
  );
}

function NotificationCard({ n, viewerHandle, onRead, onDismiss }: { n: Notification; viewerHandle: string | null; onRead: () => void; onDismiss: () => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const text = describeNotification(n, i18n, viewerHandle);
  const Icon = KIND_ICON[n.kind];
  const unread = n.readAt === null;
  const s = n.subject;
  const quote = s.kind === "comment.post" || s.kind === "comment.skill" ? s.excerpt : null;

  return (
    <article onClick={onRead} className={cn("group relative rounded-xl border p-4 transition-colors", unread ? "border-border bg-surface-low hover:bg-surface" : "border-border/60 bg-card/60 hover:bg-card")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {n.actor ? (
            <span className="relative shrink-0">
              <Avatar author={n.actor} size="md" link />
              <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface-lowest">
                <Icon className={cn("h-3 w-3", n.kind === "impulse" ? "text-synapse" : "text-info")} />
              </span>
            </span>
          ) : (
            <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border", n.kind === "badge" ? "bg-synapse/15 text-synapse" : "bg-surface-high text-foreground")}>
              <Icon className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0">
            <p className="text-sm leading-snug text-foreground">
              {n.actor && (
                <Link href={`/u/${n.actor.handle}`} className="font-semibold hover:underline" onClick={(e) => e.stopPropagation()}>
                  {n.actor.name || n.actor.handle}
                </Link>
              )}
              {n.actor && <span className="label-mono-sm ml-1.5 normal-case tracking-normal">@{n.actor.handle}</span>}
              <span className={cn("block", n.actor && "text-muted-foreground")}>{n.actor ? text.verb : text.title}</span>
            </p>
            <span className="label-mono-sm mt-0.5 block normal-case tracking-normal">{timeAgo(n.createdAt, i18n)}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {unread && <span className="h-2 w-2 rounded-full bg-synapse" title={t("notif.unreadDot")} />}
          <button
            type="button"
            aria-label={t("toast.dismiss")}
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
            className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus:opacity-100 group-hover:opacity-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {quote && <blockquote className="mt-3 rounded-lg border border-border bg-surface-lowest p-3 text-xs italic leading-relaxed text-muted-foreground sm:ml-[52px]">“{quote}”</blockquote>}
      {!quote && text.body && n.kind !== "impulse" && <p className="mt-2 text-xs leading-relaxed text-muted-foreground sm:ml-[52px]">{text.body}</p>}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 sm:ml-[52px]">
        <div className="flex flex-wrap items-center gap-2">
          {s.kind === "impulse" && <span className="label-mono-sm rounded bg-muted px-2 py-0.5 normal-case tracking-normal">{text.body}</span>}
          {s.kind === "skill.updated" && (
            <>
              <span className="label-mono-sm rounded bg-muted px-2 py-0.5">v{s.version}</span>
              {s.verified && <span className="label-mono-sm rounded bg-synapse/10 px-2 py-0.5 text-synapse">Verified</span>}
            </>
          )}
          {s.kind === "moderation.decided" && (
            <span className={cn("label-mono-sm rounded px-2 py-0.5", s.verdict === "approved" ? "bg-synapse/10 text-synapse" : "bg-danger/10 text-danger")}>{t(`moderation.status.${s.verdict}`)}</span>
          )}
          {s.kind === "badge" && <span className="label-mono-sm rounded bg-synapse/10 px-2 py-0.5 text-synapse">{t("notif.badgeChip")}</span>}
          {n.actor?.occupation && <span className="label-mono-sm rounded bg-muted px-2 py-0.5">{t(`occupation.${n.actor.occupation}`)}</span>}
        </div>
        {text.href && (
          <Link href={text.href} onClick={(e) => e.stopPropagation()} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-foreground transition-colors hover:border-foreground/40">
            {text.cta} <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>
    </article>
  );
}
