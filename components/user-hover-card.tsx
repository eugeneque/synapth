"use client";

/**
 * UserHoverCard — rest the pointer on an avatar (or anything wrapped in this)
 * and a profile card unfolds next to it: cover, avatar, name, bio, headline
 * numbers, the achievement meter and an impulse chip. Mouse only — touch taps
 * keep following the link. Cards are fetched once per handle and cached for
 * the session; an impulse fired from the card updates the cache.
 */

import Link from "next/link";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, Briefcase, Github, Globe, ShieldCheck, User } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { ImpulseButton } from "@/components/impulse-button";
import { VerifiedMark } from "@/components/verified-mark";
import type { UserCard } from "@/cortex/user-card";
import type { BadgeTier } from "@/types/badges";
import { cn, formatCompact } from "@/lib/utils";

const OPEN_DELAY_MS = 550;
const CLOSE_DELAY_MS = 180;
const CARD_WIDTH = 320;
const CARD_HEIGHT = 360;
const GAP = 10;

type Entry = { status: "loading" } | { status: "ready"; card: UserCard } | { status: "error" };
const cache = new Map<string, Promise<UserCard | null>>();
const settled = new Map<string, UserCard>();

function loadCard(handle: string): Promise<UserCard | null> {
  let p = cache.get(handle);
  if (!p) {
    p = fetch(`/api/v1/users/${encodeURIComponent(handle)}/card`, { credentials: "same-origin" })
      .then((r) => (r.ok ? (r.json() as Promise<UserCard>) : null))
      .catch(() => null)
      .then((card) => {
        if (card) settled.set(handle, card);
        else cache.delete(handle); // let a later hover retry
        return card;
      });
    cache.set(handle, p);
  }
  return p;
}

export function UserHoverCard({ handle, children, className }: { handle: string; children: ReactNode; className?: string }) {
  const key = handle.toLowerCase();
  const anchor = useRef<HTMLSpanElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [open, setOpen] = useState(false);
  const [entry, setEntry] = useState<Entry>({ status: "loading" });
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);

  const clear = () => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
  };
  useEffect(() => clear, []);

  const scheduleOpen = useCallback(() => {
    clearTimeout(closeTimer.current);
    if (open) return;
    clearTimeout(openTimer.current);
    openTimer.current = setTimeout(() => {
      const cached = settled.get(key);
      setEntry(cached ? { status: "ready", card: cached } : { status: "loading" });
      setOpen(true);
      loadCard(key).then((card) => setEntry(card ? { status: "ready", card } : { status: "error" }));
    }, OPEN_DELAY_MS);
  }, [key, open]);

  const scheduleClose = useCallback(() => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }, []);

  // Place the card below the anchor, or above it when the viewport runs out; clamp horizontally.
  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const r = anchor.current.getBoundingClientRect();
    const above = r.bottom + GAP + CARD_HEIGHT > window.innerHeight && r.top - GAP - CARD_HEIGHT > 0;
    const left = Math.min(Math.max(8, r.left - 12), window.innerWidth - CARD_WIDTH - 8);
    setPos({ top: above ? r.top - GAP : r.bottom + GAP, left, above });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("scroll", close, { passive: true, capture: true });
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, { capture: true });
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <span
        ref={anchor}
        className={cn("inline-flex shrink-0", className)}
        onPointerEnter={(e) => e.pointerType === "mouse" && scheduleOpen()}
        onPointerLeave={(e) => e.pointerType === "mouse" && scheduleClose()}
        onFocus={scheduleOpen}
        onBlur={scheduleClose}
        onClick={clear}
      >
        {children}
      </span>
      {open &&
        pos &&
        createPortal(
          <div
            role="dialog"
            aria-label={`@${handle}`}
            onPointerEnter={() => clearTimeout(closeTimer.current)}
            onPointerLeave={scheduleClose}
            style={{ top: pos.top, left: pos.left, width: CARD_WIDTH, transform: pos.above ? "translateY(-100%)" : undefined }}
            className="fixed z-[60]"
          >
            <div className={cn("animate-pop-in", pos.above ? "origin-bottom-left" : "origin-top-left")}>
              {entry.status === "ready" ? (
                <CardBody card={entry.card} onImpulse={(impulses) => settled.set(key, { ...entry.card, impulses })} />
              ) : entry.status === "error" ? (
                <CardShell>
                  <p className="p-6 text-center text-sm text-muted-foreground">@{handle}</p>
                </CardShell>
              ) : (
                <CardSkeleton />
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function CardShell({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9)]">{children}</div>;
}

function CardSkeleton() {
  return (
    <CardShell>
      <div className="p-1.5">
        <div className="skeleton h-24 rounded-xl" />
      </div>
      <div className="space-y-3 px-4 pb-4">
        <div className="skeleton -mt-8 h-16 w-16 rounded-xl border-4 border-card" />
        <div className="skeleton h-5 w-40" />
        <div className="skeleton h-3 w-full" />
        <div className="skeleton h-3 w-2/3" />
        <div className="skeleton mt-4 h-12 w-full" />
      </div>
    </CardShell>
  );
}

const TIER_SEGMENT: Record<BadgeTier, string> = {
  bronze: "bg-secondary-foreground/70",
  silver: "bg-foreground",
  gold: "bg-warn",
  signal: "bg-synapse shadow-[0_0_6px_hsl(var(--synapse)/0.8)]",
};

function CardBody({ card, onImpulse }: { card: UserCard; onImpulse: (next: UserCard["impulses"]) => void }) {
  const { t } = useI18n();
  const initial = (card.name || card.handle).trim()[0]?.toUpperCase() ?? "?";
  const links = [
    { href: `/u/${card.handle}`, icon: User, label: t("usercard.openProfile"), external: false },
    ...(card.website ? [{ href: card.website, icon: Globe, label: t("profile.about.website"), external: true }] : []),
    ...(card.githubOwner ? [{ href: `https://github.com/${card.githubOwner}`, icon: Github, label: t("profile.about.github"), external: true }] : []),
  ];
  const earned = card.badges.tiers.length;

  return (
    <CardShell>
      {/* Cover, inset like a photo in a frame, with the impulse chip in the corner. */}
      <div className="p-1.5">
        <div className="relative h-24 overflow-hidden rounded-xl border border-border/60">
          {card.coverImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={card.coverImage} alt="" className="absolute inset-0 h-full w-full animate-fade-in object-cover" />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-surface-high via-surface-low to-surface-lowest">
              <div className="dot-matrix absolute inset-0 opacity-50" />
              <div className="absolute -right-6 -top-10 h-28 w-28 rounded-full bg-synapse/15 blur-2xl" />
            </div>
          )}
          <div className="absolute right-2 top-2">
            <ImpulseButton size="sm" toId={card.id} handle={card.handle} name={card.name} initial={card.impulses} viewer={card.viewer} onChange={onImpulse} className="shadow-lg" />
          </div>
        </div>
      </div>

      <div className="px-4 pb-4">
        <div className="-mt-9 flex items-end justify-between gap-3">
          <span className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border-4 border-card bg-surface-lowest font-display text-2xl font-medium">
            {card.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={card.image} alt="" className="h-full w-full object-cover" />
            ) : (
              initial
            )}
          </span>
          {/* Achievement meter: one tick per catalogue badge, lit in the tier colour of each one earned. */}
          <div className="mb-1 flex min-w-0 flex-col items-end gap-1" title={t("usercard.achievements", { n: earned, total: card.badges.total })}>
            <span className="label-mono-sm normal-case tracking-normal">{t("usercard.achievements", { n: earned, total: card.badges.total })}</span>
            <span className="flex h-3.5 items-end gap-[3px]">
              {Array.from({ length: card.badges.total }, (_, i) => {
                const tier = card.badges.tiers[i];
                return <span key={i} className={cn("h-full w-[3px] origin-bottom animate-segment-in rounded-[1px]", tier ? TIER_SEGMENT[tier] : "bg-surface-high")} style={{ animationDelay: `${120 + i * 28}ms` }} />;
              })}
            </span>
          </div>
        </div>

        <div className="mt-3 space-y-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <Link href={`/u/${card.handle}`} className="truncate font-display text-xl font-medium tracking-tight transition-colors hover:text-synapse">
              {card.name}
            </Link>
            {card.verified && <VerifiedMark size="md" />}
            {card.role !== "user" && <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" aria-label={t(`settings.role.${card.role}`)} />}
          </div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
            <span>@{card.handle}</span>
            {card.occupation && (
              <span className="inline-flex items-center gap-1 text-synapse">
                <Briefcase className="h-3 w-3" /> {t(`occupation.${card.occupation}`)}
              </span>
            )}
          </div>
          <p className={cn("line-clamp-2 text-sm leading-relaxed", card.bio ? "text-foreground/80" : "text-muted-foreground")}>{card.bio || t("profile.bioEmpty")}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 divide-x divide-border border-t border-border">
        <CardStat value={formatCompact(card.impulses.total)} label={t("profile.stats.impulses")} accent />
        <CardStat value={formatCompact(card.stats.skills)} label={t("profile.stats.skills")} />
        <CardStat value={formatCompact(card.stats.posts)} label={t("usercard.posts")} />
      </div>

      <div className={cn("grid divide-x divide-border border-t border-border bg-surface-lowest", links.length === 3 ? "grid-cols-3" : links.length === 2 ? "grid-cols-2" : "grid-cols-1")}>
        {links.map(({ href, icon: Icon, label, external }) =>
          external ? (
            <a key={href} href={href} target="_blank" rel="noreferrer nofollow" aria-label={label} title={label} className="group/link flex h-11 items-center justify-center gap-1 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-synapse">
              <Icon className="h-4 w-4 transition-transform group-hover/link:scale-110" />
              <ArrowUpRight className="h-3 w-3 opacity-0 transition-all group-hover/link:translate-x-0.5 group-hover/link:opacity-100" />
            </a>
          ) : (
            <Link key={href} href={href} aria-label={label} title={label} className="group/link flex h-11 items-center justify-center gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-synapse">
              <Icon className="h-4 w-4 transition-transform group-hover/link:scale-110" />
              {links.length === 1 && label}
            </Link>
          ),
        )}
      </div>
    </CardShell>
  );
}

function CardStat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="px-2 py-3 text-center">
      <div className={cn("font-display text-lg font-medium leading-none tracking-tight tabular-nums", accent ? "text-synapse" : "text-foreground")}>{value}</div>
      <div className="label-mono-sm mt-1.5 truncate">{label}</div>
    </div>
  );
}
