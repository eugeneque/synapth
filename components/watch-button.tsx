"use client";

/**
 * WatchButton — adds a skill to the viewer's "watched" list; new versions
 * then land in their notification inbox.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { useToast } from "@/axon/toast";
import { watchSkill } from "@/app/(site)/social-actions";
import type { WatchSummary } from "@/cortex/social";
import { cn } from "@/lib/utils";

interface Props {
  skillId: string;
  slug: string;
  name: string;
  initial: WatchSummary;
  signedIn: boolean;
  size?: "sm" | "lg";
  className?: string;
}

export function WatchButton({ skillId, slug, name, initial, signedIn, size = "lg", className }: Props) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [state, setState] = useState(initial);
  const [pending, start] = useTransition();

  const base = cn("inline-flex items-center gap-2 rounded-lg border font-mono uppercase tracking-[0.14em] transition-all", size === "lg" ? "h-11 px-5 text-[11px]" : "h-8 px-3 text-[10px]");

  if (!signedIn) {
    return (
      <Link href={`/signin?callbackUrl=/skills/${slug}`} className={cn(base, "border-border bg-muted text-foreground hover:border-foreground/30", className)}>
        <Eye className="h-4 w-4 text-synapse" /> {t("watch.watch")} <span className="text-muted-foreground">· {state.watchers}</span>
      </Link>
    );
  }

  function toggle() {
    start(async () => {
      const res = await watchSkill(skillId, slug);
      if (!res.ok) {
        toast({ tone: "danger", title: t("watch.failed"), body: res.error });
        return;
      }
      setState(res.data);
      toast(res.data.watching ? { tone: "success", title: t("watch.addedTitle"), body: t("watch.addedBody", { name }), action: { label: t("watch.openList"), href: "/dashboard/notifications" } } : { tone: "undo", title: t("watch.removed", { name }), action: { label: t("watch.undo"), onClick: () => toggle() } });
    });
  }

  return (
    <button type="button" onClick={toggle} disabled={pending} aria-pressed={state.watching} className={cn(base, state.watching ? "border-synapse/50 bg-synapse/10 text-synapse" : "border-border bg-muted text-foreground hover:border-synapse/40 hover:text-synapse", className)}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : state.watching ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      {state.watching ? t("watch.watching") : t("watch.watch")}
      <span className={cn(state.watching ? "text-synapse/80" : "text-muted-foreground")}>· {state.watchers}</span>
    </button>
  );
}
