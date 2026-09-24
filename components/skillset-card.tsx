"use client";

import Link from "next/link";
import { BadgeCheck, Heart } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { CategoryIcon } from "@/components/category-icon";
import { SkillsetAvatar } from "@/components/skillset-avatar";
import { useI18n } from "@/axon/i18n";
import { cn, formatCompact, timeAgo } from "@/lib/utils";
import { SKILL_CATEGORIES } from "@/types/skill";
import type { SkillsetSummary } from "@/types/skillset";

/**
 * Catalogue card of a skillset, in the same voice as the skill card: the
 * person who assembled it on top, the set itself, what's inside, how many
 * people saved it. A stack of kind tiles hints at "a bundle" before reading.
 */
export function SkillsetCard({ set, className }: { set: SkillsetSummary; className?: string }) {
  const i18n = useI18n();
  const { t, n } = i18n;
  const total = set.counts.MCP + set.counts.Prompt + set.counts.Tool;
  const kinds = SKILL_CATEGORIES.filter((c) => set.counts[c] > 0);
  return (
    <article className={cn("lift group relative flex flex-col rounded-2xl border border-border bg-card p-5 hover:border-foreground/25", className)}>
      <header className="flex items-center justify-between gap-3">
        <span className="relative z-10 flex min-w-0 items-center gap-2">
          <Avatar author={set.author} size="xs" className="rounded-full" link />
          <Link href={`/u/${set.author.handle}`} className="truncate text-[13px] font-medium text-foreground/90 transition-opacity hover:opacity-80">
            {set.author.name || set.author.handle}
          </Link>
          <span className="shrink-0 text-xs text-muted-foreground">· {timeAgo(set.updatedAt, i18n)}</span>
        </span>
        {set.verified && (
          <span title={t("skillset.verified.title")} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-synapse/10 px-2 py-0.5 text-[11px] font-medium text-synapse">
            <BadgeCheck className="h-3 w-3" /> {t("skillset.verified")}
          </span>
        )}
      </header>

      <div className="mt-5 flex items-start gap-3.5">
        <span className="relative shrink-0">
          {/* Two offset sheets behind the avatar: a bundle, not a single item. */}
          <span aria-hidden className="absolute inset-0 translate-x-1.5 -translate-y-1.5 rounded-2xl border border-border bg-surface transition-transform duration-300 group-hover:translate-x-2.5 group-hover:-translate-y-2.5" />
          <span aria-hidden className="absolute inset-0 translate-x-0.5 -translate-y-0.5 rounded-2xl border border-border bg-surface-low transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-1" />
          <SkillsetAvatar name={set.name} avatar={set.avatar} size="sm" className="relative h-12 w-12 rounded-2xl" />
        </span>
        <div className="min-w-0 pt-0.5">
          <Link href={`/skillsets/${set.slug}`} className="line-clamp-2 font-display text-xl font-medium leading-tight tracking-tight transition-colors after:absolute after:inset-0 after:content-[''] group-hover:text-synapse">
            {set.name}
          </Link>
          <p className="mt-1 text-xs text-muted-foreground">{total ? n("skillset.entries", total) : t("skillset.empty")}</p>
        </div>
      </div>

      {set.summary && <p className="mt-4 line-clamp-3 text-sm leading-relaxed text-foreground/75">{set.summary}</p>}

      <footer className="relative z-10 mt-auto flex items-center justify-between gap-3 pt-5">
        <span className="flex flex-wrap items-center gap-1.5">
          {kinds.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[11px] text-muted-foreground">
              <CategoryIcon category={c} className="h-3 w-3" /> {set.counts[c]} {t(`skillset.kind.${c}`)}
            </span>
          ))}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground" title={t("skillset.favorites")}>
          <Heart className={cn("h-3.5 w-3.5", set.favorites > 0 && "fill-danger/80 text-danger/80")} /> {formatCompact(set.favorites)}
        </span>
      </footer>
    </article>
  );
}
