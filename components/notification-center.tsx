"use client";

/**
 * NotificationCenter — the header bell and the right-hand drawer ("шторка").
 * The bell shows the unread count from `useNotifications()`; the drawer
 * hosts the shared `NotificationFeed`, a mute toggle and a link to the
 * full inbox page.
 */

import Link from "next/link";
import { useEffect } from "react";
import { Bell, BellOff, ExternalLink, Volume2, VolumeX, X } from "lucide-react";
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
      className={cn("relative flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface-low text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground", open && "border-synapse/40 text-synapse", className)}
    >
      <Bell className="h-4 w-4" />
      {unread > 0 && (
        <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-synapse px-1 font-mono text-[9px] font-semibold text-synapse-foreground shadow-glow">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );
}

export function NotificationDrawer() {
  const { t } = useI18n();
  const { userId, open, setOpen, muted, setMuted, unread, chime } = useNotifications();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!userId || !open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label={t("notif.close")} onClick={() => setOpen(false)} className="absolute inset-0 bg-background/60 backdrop-blur-[2px]" />
      <aside role="dialog" aria-label={t("notif.title")} className="relative flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-2xl animate-drawer-in">
        <header className="flex items-center justify-between gap-3 border-b border-border bg-surface-lowest px-4 py-3">
          <div className="min-w-0">
            <p className="label-mono-sm flex items-center gap-2 tracking-[0.2em] text-synapse">
              <span className="dot-live animate-pulse-dot" /> {t("notif.stream")}
            </p>
            <h2 className="mt-0.5 text-base font-semibold tracking-tight">
              {t("notif.title")} {unread > 0 && <span className="font-mono text-xs text-synapse">· {unread}</span>}
            </h2>
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setMuted(!muted)} aria-pressed={muted} title={muted ? t("notif.unmute") : t("notif.mute")} className={cn("flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:text-foreground", muted && "text-warn")}>
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <button type="button" onClick={chime} title={t("notif.testSound")} className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:text-foreground">
              {muted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
            </button>
            <button type="button" onClick={() => setOpen(false)} aria-label={t("notif.close")} className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>
        <NotificationFeed compact limit={30} />
        <footer className="flex items-center justify-between gap-3 border-t border-border bg-surface-lowest px-4 py-2.5">
          <span className="label-mono-sm">{t("notif.pollHint")}</span>
          <Link href="/dashboard/notifications" onClick={() => setOpen(false)} className="label-mono-sm inline-flex items-center gap-1.5 text-synapse hover:underline">
            {t("notif.openPage")} <ExternalLink className="h-3 w-3" />
          </Link>
        </footer>
      </aside>
    </div>
  );
}
