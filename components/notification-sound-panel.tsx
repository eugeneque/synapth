"use client";

/** Delivery settings on the notifications page: chime on/off, test button, what triggers a ping. */

import { Bell, Volume2, VolumeX, Zap, MessageSquare, Layers, Award } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { useNotifications } from "@/axon/notifications";
import { Panel } from "@/components/panel";
import { cn } from "@/lib/utils";
import type { UiKey } from "@/lib/i18n";

const TRIGGERS: Array<{ key: UiKey; icon: typeof Zap }> = [
  { key: "notif.trigger.impulse", icon: Zap },
  { key: "notif.trigger.comment", icon: MessageSquare },
  { key: "notif.trigger.release", icon: Layers },
  { key: "notif.trigger.badge", icon: Award },
];

export function NotificationSoundPanel() {
  const { t } = useI18n();
  const { muted, setMuted, chime } = useNotifications();
  return (
    <Panel title={t("notif.soundTitle")} icon={<Bell className="h-4 w-4 shrink-0 text-synapse" />} bodyClassName="p-4">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-lowest p-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-tight">{t("notif.soundLabel")}</p>
          <p className="label-mono-sm mt-0.5 normal-case tracking-normal">{t("notif.soundHint")}</p>
        </div>
        <button type="button" role="switch" aria-checked={!muted} onClick={() => setMuted(!muted)} className={cn("relative h-5 w-10 shrink-0 rounded-full border transition-colors", muted ? "border-border bg-surface-high" : "border-synapse/40 bg-synapse")}>
          <span className={cn("absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all", muted ? "left-0.5 bg-muted-foreground" : "left-[22px] bg-synapse-foreground")} />
        </button>
      </div>
      <button type="button" onClick={chime} disabled={muted} className="mt-3 inline-flex h-8 items-center gap-2 rounded-lg border border-border bg-muted px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-foreground transition-colors hover:border-foreground/30 disabled:opacity-40">
        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4 text-synapse" />} {t("notif.testSound")}
      </button>
      <ul className="mt-4 grid gap-1.5 border-t border-border pt-4">
        {TRIGGERS.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.key} className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
              <Icon className="h-3.5 w-3.5 text-synapse" /> {t(item.key)}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
