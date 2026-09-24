"use client";

/**
 * NotificationCenter — the header bell and the right-hand drawer ("шторка").
 * The bell shows the unread count from `useNotifications()`; the drawer
 * is a floating panel hosting the shared `NotificationFeed`, a mute toggle,
 * "mark all as read" and a link to the full inbox page.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell, CheckCheck, Volume2, VolumeX, X } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { useNotifications } from "@/axon/notifications";
import { NotificationFeed } from "@/components/notification-feed";
import { cn } from "@/lib/utils";

export function NotificationBell({ className }: { className?: string }) {
  const { t } = useI18n();
  const { userId, unread, open, setOpen } = useNotifications();
  if (!userId) return null;
  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      aria-label={unread ? t("notif.bellUnread", { n: unread }) : t("notif.bell")}
      aria-expanded={open}
      className={cn("relative flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface-low text-muted-foreground transition-all hover:border-foreground/40 hover:text-foreground active:scale-95", open && "border-synapse/40 text-synapse", className)}
    >
      {/* Re-keyed on the count so a new notification rings the bell and pops the counter. */}
      <Bell key={`bell-${unread}`} className={cn("h-4 w-4 origin-top", unread > 0 && "animate-bell-ring")} />
      {unread > 0 && (
        <span key={`count-${unread}`} className="absolute -right-1.5 -top-1.5 flex animate-pop-in h-4 min-w-4 items-center justify-center rounded-full bg-synapse px-1 font-mono text-[9px] font-semibold text-synapse-foreground shadow-glow">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );
}

/** Matches `drawer-out` / `fade-out` in tailwind.config.ts. */
const DRAWER_EXIT_MS = 220;

export function NotificationDrawer() {
  const { t } = useI18n();
  const { userId, open, setOpen, muted, setMuted, unread, markRead } = useNotifications();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  // Stay mounted for the exit animation after `open` flips off.
  const [mounted, setMounted] = useState(open);
  const leaving = mounted && !open;
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timer = setTimeout(() => setMounted(false), DRAWER_EXIT_MS);
    return () => clearTimeout(timer);
  }, [open]);

  if (!userId || !mounted) return null;
  return (
    <div className={cn("fixed inset-0 z-50 flex justify-end", leaving && "pointer-events-none")}>
      <button type="button" aria-label={t("notif.close")} onClick={() => setOpen(false)} className={cn("absolute inset-0 bg-background/60 backdrop-blur-[2px]", leaving ? "animate-fade-out" : "animate-fade-in")} />
      <aside
        role="dialog"
        aria-label={t("notif.title")}
        className={cn(
          "relative m-2 flex h-[calc(100%-1rem)] w-full max-w-[30rem] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[0_24px_60px_-20px_rgb(0_0_0/0.9),inset_0_1px_0_hsl(var(--foreground)/0.05)] sm:m-3 sm:h-[calc(100%-1.5rem)]",
          leaving ? "animate-drawer-out" : "animate-drawer-in",
        )}
      >
        <header className="flex items-center justify-between gap-3 px-5 pb-4 pt-5">
          <h2 className="flex items-baseline gap-2 font-display text-2xl font-medium tracking-tight">
            {t("notif.title")}
            {unread > 0 && <span className="font-mono text-sm text-synapse">{unread}</span>}
          </h2>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setMuted(!muted)} aria-pressed={muted} title={muted ? t("notif.unmute") : t("notif.mute")} className={cn("flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-high hover:text-foreground", muted && "text-warn")}>
              {muted ? <VolumeX className="h-[18px] w-[18px]" /> : <Volume2 className="h-[18px] w-[18px]" />}
            </button>
            <button type="button" onClick={() => setOpen(false)} aria-label={t("notif.close")} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-high hover:text-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>
        <NotificationFeed compact limit={30} />
        <footer className="flex items-center justify-between gap-3 border-t border-border/70 px-5 py-4">
          <button type="button" onClick={() => void markRead()} disabled={unread === 0} className="inline-flex items-center gap-2 text-sm font-medium text-foreground transition-colors hover:text-synapse disabled:pointer-events-none disabled:text-muted-foreground/60">
            <CheckCheck className="h-4 w-4" /> {t("notif.markAll")}
          </button>
          <Link href="/dashboard/notifications" onClick={() => setOpen(false)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-synapse/60 bg-synapse px-3.5 text-sm font-medium text-synapse-foreground shadow-[0_0_20px_-6px_hsl(var(--synapse)/0.6)] transition-colors hover:bg-synapse-dim">
            {t("notif.openPage")}
          </Link>
        </footer>
      </aside>
    </div>
  );
}
