"use client";

/** FavoriteButton — adds a skillset to the viewer's favorites (listed in /favorites). */

import { useState, useTransition } from "react";
import Link from "next/link";
import { Heart, Loader2 } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { useToast } from "@/axon/toast";
import { favoriteSkillset } from "@/app/(site)/skillset-actions";
import type { FavoriteSummary } from "@/cortex/skillsets";
import { cn } from "@/lib/utils";

interface Props {
  skillsetId: string;
  slug: string;
  name: string;
  initial: FavoriteSummary;
  signedIn: boolean;
  className?: string;
}

export function FavoriteButton({ skillsetId, slug, name, initial, signedIn, className }: Props) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [state, setState] = useState(initial);
  const [pending, start] = useTransition();
  const base = "inline-flex h-11 items-center gap-2 rounded-lg border px-5 font-mono text-[11px] uppercase tracking-[0.14em] transition-all";

  if (!signedIn) {
    return (
      <Link href={`/signin?callbackUrl=/skillsets/${slug}`} className={cn(base, "border-border bg-muted text-foreground hover:border-foreground/30", className)}>
        <Heart className="h-4 w-4 text-synapse" /> {t("skillset.favorite")} <span className="text-muted-foreground">· {state.favorites}</span>
      </Link>
    );
  }

  function toggle() {
    start(async () => {
      const res = await favoriteSkillset(skillsetId, slug);
      if (!res.ok) {
        toast({ tone: "danger", title: t("skillset.favoriteFailed"), body: res.error });
        return;
      }
      setState(res.data);
      toast(res.data.favorited ? { tone: "success", title: t("skillset.favoritedTitle"), body: name, action: { label: t("skillset.openFavorites"), href: "/favorites" } } : { tone: "undo", title: t("skillset.unfavorited", { name }), action: { label: t("watch.undo"), onClick: () => toggle() } });
    });
  }

  return (
    <button type="button" onClick={toggle} disabled={pending} aria-pressed={state.favorited} className={cn(base, state.favorited ? "border-synapse/50 bg-synapse/10 text-synapse" : "border-border bg-muted text-foreground hover:border-synapse/40 hover:text-synapse", className)}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Heart className={cn("h-4 w-4", state.favorited && "fill-current")} />}
      {state.favorited ? t("skillset.favorited") : t("skillset.favorite")}
      <span className={state.favorited ? "text-synapse/80" : "text-muted-foreground"}>· {state.favorites}</span>
    </button>
  );
}
