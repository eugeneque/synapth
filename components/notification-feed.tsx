"use client";

/**
 * NotificationFeed — segmented filter + inbox cards grouped by day, shared by
 * the header drawer and /dashboard/notifications. Fetches
 * `GET /api/v1/notifications` on open and again whenever the provider's
 * `version` bumps (fresh rows, reads).
 *
 * In the drawer (`compact`) each day collapses into a stack: the newest card
 * on top with the rest peeking out behind it, "View all" fans the group out.
 * Card anatomy: round avatar with a kind badge, one sentence (name bold, verb
 * muted), time line, optional quote bubble, chips and the CTA button.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Award, BadgeCheck, Boxes, CheckCheck, Gavel, Inbox, Info, Layers, MessageSquare, Newspaper, ShieldCheck, UserPlus, Users, X, Zap } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { useNotifications } from "@/axon/notifications";
import { describeNotification } from "@/axon/notification-text";
import { Avatar } from "@/components/avatar";
import { VerifiedMark } from "@/components/verified-mark";
import { cn, timeAgo } from "@/lib/utils";
import type { UiKey } from "@/lib/i18n";
import type { Notification, NotificationChannel, NotificationFeed as Feed } from "@/types/social";

type Tab = "all" | "unread" | NotificationChannel;
/** `short` replaces the label in the drawer, where the segmented control has to fit one row. */
const TABS: Array<{ id: Tab; key: UiKey; short?: UiKey }> = [
  { id: "all", key: "notif.tab.all" },
  { id: "unread", key: "notif.tab.unread" },
  { id: "social", key: "notif.tab.social" },
  { id: "skills", key: "notif.tab.skills", short: "notif.tab.skillsShort" },
  { id: "system", key: "notif.tab.system" },
];

const KIND_ICON: Record<Notification["kind"], typeof Zap> = { impulse: Zap, "friend.request": UserPlus, "friend.accepted": Users, "post.new": Newspaper, "comment.post": MessageSquare, "comment.skill": MessageSquare, "skill.updated": Layers, "moderation.requested": ShieldCheck, "moderation.decided": Gavel, "skillset.updated": Boxes, "skillset.verified": ShieldCheck, "verification.requested": BadgeCheck, "verification.updated": BadgeCheck, badge: Award, system: Info };

/** Kinds that ask the viewer to act — their CTA gets the filled synapse button. */
const ACTIONABLE = new Set<Notification["kind"]>(["moderation.requested", "verification.requested"]);

type Day = "today" | "yesterday" | "earlier";
const DAY_KEY: Record<Day, UiKey> = { today: "notif.group.today", yesterday: "notif.group.yesterday", earlier: "notif.group.earlier" };

function dayOf(iso: string, now: Date): Day {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const at = new Date(iso).getTime();
  if (at >= midnight) return "today";
  if (at >= midnight - 86_400_000) return "yesterday";
  return "earlier";
}

function groupByDay(items: Notification[]): Array<{ day: Day; items: Notification[] }> {
  const now = new Date();
  const groups: Array<{ day: Day; items: Notification[] }> = [];
  for (const n of items) {
    const day = dayOf(n.createdAt, now);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.items.push(n);
    else groups.push({ day, items: [n] });
  }
  return groups;
}

export function NotificationFeed({ compact = false, limit = 50 }: { compact?: boolean; limit?: number }) {
  const { t } = useI18n();
  const { version, markRead, dismiss, viewerHandle } = useNotifications();
  const [tab, setTab] = useState<Tab>("all");
  const [feed, setFeed] = useState<Feed | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<Day>>(new Set());

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

  const groups = useMemo(() => groupByDay(feed?.items ?? []), [feed]);

  function selectTab(next: Tab) {
    setTab(next);
    setExpanded(new Set());
  }

  function toggleGroup(day: Day) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  async function onRead(n: Notification) {
    if (n.readAt) return;
    setFeed((f) => (f ? { ...f, unread: Math.max(0, f.unread - 1), items: f.items.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)) } : f));
    await markRead([n.id]);
  }

  async function onDismiss(n: Notification) {
    setFeed((f) => (f ? { ...f, total: f.total - 1, unread: n.readAt ? f.unread : Math.max(0, f.unread - 1), items: f.items.filter((x) => x.id !== n.id) } : f));
    await dismiss(n.id);
  }

  const unread = feed?.unread ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cn("flex flex-wrap items-center justify-between gap-3", compact ? "px-5 pb-1" : "px-1")}>
        <div role="tablist" aria-label={t("notif.title")} className={cn("no-scrollbar flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface-lowest p-1", compact ? "w-full" : "w-full sm:w-auto")}>
          {TABS.map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => selectTab(item.id)}
                className={cn(
                  "inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border py-1.5 text-[13px] font-medium transition-[color,background-color,border-color,box-shadow] duration-200",
                  compact ? "px-2" : "px-3",
                  active ? "border-border bg-surface-high text-foreground shadow-[inset_0_1px_0_hsl(var(--foreground)/0.06),0_2px_6px_-2px_rgb(0_0_0/0.6)]" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t(compact && item.short ? item.short : item.key)}
                {/* The drawer header already shows the unread count. */}
                {!compact && item.id === "unread" && unread > 0 && <span className="rounded-md bg-synapse/15 px-1.5 font-mono text-[10px] leading-4 text-synapse">{unread}</span>}
              </button>
            );
          })}
        </div>
        {!compact && unread > 0 && (
          <button type="button" onClick={() => void markRead()} className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground">
            <CheckCheck className="h-4 w-4" /> {t("notif.markAll")}
          </button>
        )}
      </div>

      <div className={cn("flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto", compact ? "px-5 py-5" : "py-5")}>
        {feed && feed.items.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-surface-lowest/60 p-10 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface-low">
              <Inbox className="h-5 w-5 text-muted-foreground" />
            </span>
            <span className="mt-1 text-sm font-semibold tracking-tight">{t("notif.empty")}</span>
            <span className="max-w-xs text-xs text-muted-foreground">{t("notif.emptyLead")}</span>
          </div>
        ) : (
          groups.map((g) => {
            const stacked = compact && g.items.length > 1 && !expanded.has(g.day);
            const shown = stacked ? g.items.slice(0, 1) : g.items;
            return (
              <section key={g.day} className="flex flex-col gap-3">
                <header className="flex items-center justify-between gap-3">
                  <h3 className="flex items-center gap-2 text-[15px] font-medium text-muted-foreground">
                    {t(DAY_KEY[g.day])}
                    <span className="rounded-md border border-border bg-surface-low px-1.5 font-mono text-[11px] leading-5 text-foreground/80">{g.items.length}</span>
                  </h3>
                  {compact && g.items.length > 1 && (
                    <button type="button" onClick={() => toggleGroup(g.day)} aria-expanded={!stacked} className="text-[13px] font-medium text-foreground transition-colors hover:text-synapse">
                      {t(stacked ? "notif.group.showAll" : "notif.group.collapse")}
                    </button>
                  )}
                </header>
                <div className={cn("relative flex flex-col gap-3", stacked && "pt-4")}>
                  {stacked && (
                    <>
                      {/* Cards waiting behind the newest one; clicking the edges fans the group out. */}
                      {g.items.length > 2 && <button type="button" tabIndex={-1} aria-hidden onClick={() => toggleGroup(g.day)} className="absolute inset-x-8 top-0 h-8 rounded-t-xl border border-b-0 border-border/70 bg-surface-high/20" />}
                      <button type="button" tabIndex={-1} aria-hidden onClick={() => toggleGroup(g.day)} className="absolute inset-x-4 top-2 h-8 rounded-t-xl border border-b-0 border-border bg-surface-high/45" />
                    </>
                  )}
                  {shown.map((n, i) => (
                    <NotificationCard key={n.id} n={n} viewerHandle={viewerHandle} onRead={() => void onRead(n)} onDismiss={() => void onDismiss(n)} style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }} />
                  ))}
                </div>
              </section>
            );
          })
        )}
        {loading && !feed && (
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-24 rounded-xl" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NotificationCard({ n, viewerHandle, onRead, onDismiss, style }: { n: Notification; viewerHandle: string | null; onRead: () => void; onDismiss: () => void; style?: React.CSSProperties }) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const text = describeNotification(n, i18n, viewerHandle);
  const Icon = KIND_ICON[n.kind];
  const unread = n.readAt === null;
  const s = n.subject;
  const quote = s.kind === "comment.post" || s.kind === "comment.skill" ? s.excerpt : null;
  const today = dayOf(n.createdAt, new Date()) === "today";
  const at = new Date(n.createdAt);
  const clock = at.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const when = today ? timeAgo(n.createdAt, i18n) : at.toLocaleDateString(locale, { day: "numeric", month: "long" });

  const chips: Array<{ label: string; tone?: "synapse" | "danger" }> = [];
  if (s.kind === "skill.updated") {
    chips.push({ label: `v${s.version}` });
    if (s.verified) chips.push({ label: "Verified", tone: "synapse" });
  }
  if (s.kind === "moderation.decided") chips.push({ label: t(`moderation.status.${s.verdict}`), tone: s.verdict === "approved" ? "synapse" : "danger" });
  if (s.kind === "badge") chips.push({ label: t("notif.badgeChip"), tone: "synapse" });

  return (
    <article
      onClick={onRead}
      style={style}
      className={cn(
        "group relative animate-fade-in rounded-xl border p-4 transition-colors duration-200",
        unread ? "border-border bg-surface-low shadow-[inset_0_1px_0_hsl(var(--foreground)/0.05),0_12px_24px_-16px_rgb(0_0_0/0.8)] hover:bg-surface" : "border-border/60 bg-card/70 hover:bg-surface-low",
      )}
    >
      <div className="flex items-start gap-3.5">
        {n.actor ? (
          <span className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
            <Avatar author={n.actor} size="md" link className="h-11 w-11 rounded-full" />
            <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-card bg-surface-high">
              <Icon className={cn("h-2.5 w-2.5", n.kind === "impulse" ? "text-synapse" : "text-foreground/80")} />
            </span>
          </span>
        ) : (
          <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full border", n.kind === "badge" ? "border-synapse/30 bg-synapse/10 text-synapse" : "border-border bg-surface-high text-foreground")}>
            <Icon className="h-5 w-5" />
          </span>
        )}

        <div className="min-w-0 flex-1 pr-5">
          <p className={cn("text-[15px] leading-snug", !unread && "opacity-80")}>
            {n.actor ? (
              <>
                <Link href={`/u/${n.actor.handle}`} className="font-semibold text-foreground hover:underline" onClick={(e) => e.stopPropagation()}>
                  {n.actor.name || n.actor.handle}
                </Link>
                {n.actor.verified && <VerifiedMark size="sm" className="ml-1 align-[-2px]" />} <span className="text-muted-foreground">{text.verb}</span>
              </>
            ) : (
              <span className="font-semibold text-foreground">{text.title}</span>
            )}
          </p>
          <p className="mt-1 text-[13px] text-muted-foreground/80">
            {when} <span className="mx-1 text-border">•</span> {clock}
          </p>

          {quote ? (
            <blockquote className="mt-3 rounded-xl bg-surface-high/70 px-4 py-3 text-sm leading-relaxed text-foreground/90">{quote}</blockquote>
          ) : (
            text.body && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{text.body}</p>
          )}

          {(chips.length > 0 || text.href) && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {text.href && (
                <Link
                  href={text.href}
                  onClick={(e) => e.stopPropagation()}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors",
                    ACTIONABLE.has(n.kind) ? "border-synapse/60 bg-synapse text-synapse-foreground hover:bg-synapse-dim" : "border-border bg-surface-high/40 text-foreground hover:border-foreground/30 hover:bg-surface-high",
                  )}
                >
                  {text.cta} <ArrowUpRight className="h-3.5 w-3.5 opacity-70" />
                </Link>
              )}
              {chips.map((c) => (
                <span key={c.label} className={cn("rounded-md border px-2 py-0.5 text-[12px]", c.tone === "synapse" ? "border-synapse/25 bg-synapse/10 text-synapse" : c.tone === "danger" ? "border-danger/25 bg-danger/10 text-danger" : "border-border bg-surface-high/50 text-muted-foreground")}>
                  {c.label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {unread && <span className="absolute right-4 top-4 h-2.5 w-2.5 rounded-full bg-synapse shadow-glow transition-opacity group-hover:opacity-0" title={t("notif.unreadDot")} />}
      <button
        type="button"
        aria-label={t("toast.dismiss")}
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        className="absolute right-2.5 top-2.5 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-surface-high hover:text-foreground focus:opacity-100 group-hover:opacity-100"
      >
        <X className="h-4 w-4" />
      </button>
    </article>
  );
}
