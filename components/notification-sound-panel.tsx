"use client";

/** Delivery settings on the notifications page: chime on/off, interface sounds (Cuelume) with their material, test button, what triggers a ping. */

import { Bell, Volume2, VolumeX, Zap, MessageSquare, Layers, Award } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { useNotifications } from "@/axon/notifications";
import { SOUND_THEMES, useSoundPrefs } from "@/axon/sound";
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
  const ui = useSoundPrefs();
  return (
    <Panel title={t("notif.soundTitle")} icon={<Bell className="h-4 w-4 shrink-0 text-synapse" />} bodyClassName="p-4">
      <SwitchRow label={t("notif.soundLabel")} hint={t("notif.soundHint")} on={!muted} onChange={(on) => setMuted(!on)} />
      <SwitchRow label={t("sound.ui.label")} hint={t("sound.ui.hint")} on={ui.enabled} onChange={ui.setEnabled} className="mt-2">
        {ui.enabled && (
          <div role="radiogroup" aria-label={t("sound.ui.theme")} className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="label-mono-sm mr-1">{t("sound.ui.theme")}</span>
            {SOUND_THEMES.map((theme) => (
              <button
                key={theme}
                type="button"
                role="radio"
                aria-checked={ui.theme === theme}
                onClick={() => ui.setTheme(theme)}
                className={cn("h-7 rounded-md border px-2.5 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors", ui.theme === theme ? "border-synapse/40 bg-synapse/10 text-synapse" : "border-border text-muted-foreground hover:text-foreground")}
              >
                {t(`sound.theme.${theme}` as UiKey)}
              </button>
            ))}
          </div>
        )}
      </SwitchRow>
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

function SwitchRow({ label, hint, on, onChange, className, children }: { label: string; hint: string; on: boolean; onChange: (on: boolean) => void; className?: string; children?: React.ReactNode }) {
  return (
    <div className={cn("rounded-lg border border-border bg-surface-lowest p-3", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-tight">{label}</p>
          <p className="label-mono-sm mt-0.5 normal-case tracking-normal">{hint}</p>
        </div>
        <button type="button" role="switch" data-cuelume-toggle="" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={cn("relative h-5 w-10 shrink-0 rounded-full border transition-colors", on ? "border-synapse/40 bg-synapse" : "border-border bg-surface-high")}>
          <span className={cn("absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all", on ? "left-[22px] bg-synapse-foreground" : "left-0.5 bg-muted-foreground")} />
        </button>
      </div>
      {children}
    </div>
  );
}
