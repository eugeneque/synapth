"use client";

/**
 * Axon · Notification centre state
 *
 * Polls `GET /api/v1/notifications?after=<cursor>` while a user is signed in
 * (every 20 s, plus whenever the tab regains focus). Fresh rows raise a HUD
 * toast and play the notification chime once per batch; the unread count
 * feeds the bell. The drawer and the notifications page subscribe to
 * `version` to refetch their lists after any change.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/axon/i18n";
import { useToast } from "@/axon/toast";
import { describeNotification } from "@/axon/notification-text";
import type { Notification, NotificationPoll } from "@/types/social";

export const NOTIFICATION_SOUND = "/sounds/notification.mp3";
const POLL_MS = 20_000;
const MUTE_KEY = "synapth_notif_muted";

interface NotificationContextValue {
  /** null when signed out — the bell is hidden and nothing polls. */
  userId: string | null;
  viewerHandle: string | null;
  unread: number;
  open: boolean;
  setOpen: (open: boolean) => void;
  muted: boolean;
  setMuted: (muted: boolean) => void;
  /** Bumps whenever the inbox changed (fresh rows, reads, dismissals) so lists refetch. */
  version: number;
  markRead: (ids?: string[]) => Promise<void>;
  dismiss: (id: string) => Promise<void>;
  /** Plays the chime (respects mute) — also used by the "test sound" button. */
  chime: () => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function NotificationProvider({ userId, viewerHandle, initialUnread, children }: { userId: string | null; viewerHandle: string | null; initialUnread: number; children: ReactNode }) {
  const router = useRouter();
  const i18n = useI18n();
  const { toast } = useToast();
  const [unread, setUnread] = useState(initialUnread);
  const [open, setOpen] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [version, setVersion] = useState(0);
  const cursor = useRef<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const mutedRef = useRef(false);

  useEffect(() => {
    const m = readMuted();
    setMutedState(m);
    mutedRef.current = m;
  }, []);

  const setMuted = useCallback((m: boolean) => {
    setMutedState(m);
    mutedRef.current = m;
    try {
      localStorage.setItem(MUTE_KEY, m ? "1" : "0");
    } catch {
      /* private mode */
    }
  }, []);

  const chime = useCallback(() => {
    if (mutedRef.current) return;
    try {
      audio.current ??= new Audio(NOTIFICATION_SOUND);
      audio.current.currentTime = 0;
      void audio.current.play().catch(() => {
        /* autoplay blocked until the first interaction */
      });
    } catch {
      /* no audio support */
    }
  }, []);

  const announce = useCallback(
    (items: Notification[]) => {
      for (const n of items.slice(-3)) {
        const text = describeNotification(n, i18n, viewerHandle);
        toast({ tone: n.actor ? "social" : n.kind === "badge" ? "success" : "info", title: text.title, body: text.body, actor: n.actor, action: text.href ? { label: text.cta, href: text.href } : undefined });
      }
    },
    [i18n, toast, viewerHandle],
  );

  // Polling loop: only when signed in; pauses in hidden tabs, catches up on focus.
  useEffect(() => {
    if (!userId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      if (stopped) return;
      if (document.visibilityState === "visible") {
        try {
          const res = await fetch(`/api/v1/notifications?after=${encodeURIComponent(cursor.current ?? "")}`, { cache: "no-store" });
          if (res.ok) {
            const data = (await res.json()) as NotificationPoll;
            const first = cursor.current === null;
            cursor.current = data.serverTime;
            setUnread(data.unread);
            if (!first && data.fresh.length) {
              announce(data.fresh);
              chime();
              setVersion((v) => v + 1);
              router.refresh();
            }
          }
        } catch {
          /* offline — retry next tick */
        }
      }
      timer = setTimeout(tick, POLL_MS);
    }
    void tick();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        if (timer) clearTimeout(timer);
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId, announce, chime, router]);

  const markRead = useCallback(async (ids?: string[]) => {
    const res = await fetch("/api/v1/notifications/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ids ? { ids } : {}) });
    if (res.ok) {
      const data = (await res.json()) as { unread: number };
      setUnread(data.unread);
      setVersion((v) => v + 1);
    }
  }, []);

  const dismiss = useCallback(async (id: string) => {
    const res = await fetch(`/api/v1/notifications/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) setVersion((v) => v + 1);
  }, []);

  const value = useMemo<NotificationContextValue>(() => ({ userId, viewerHandle, unread, open, setOpen, muted, setMuted, version, markRead, dismiss, chime }), [userId, viewerHandle, unread, open, muted, setMuted, version, markRead, dismiss, chime]);
  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications() must be used inside <NotificationProvider>");
  return ctx;
}
