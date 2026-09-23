"use client";

import Link from "next/link";
import { BadgeCheck, Heart } from "lucide-react";
import { Corners } from "@/components/corners";
import { Badge } from "@/components/ui/badge";
import { CategoryIcon } from "@/components/category-icon";
import { SkillsetAvatar } from "@/components/skillset-avatar";
import { useI18n } from "@/axon/i18n";
import { cn, timeAgo } from "@/lib/utils";
import { SKILL_CATEGORIES } from "@/types/skill";
import type { SkillsetSummary } from "@/types/skillset";

/** Catalogue card of a skillset: avatar, name, author, composition by kind, favorites. */
export function SkillsetCard({ set, className }: { set: SkillsetSummary; className?: string }) {
  const i18n = useI18n();
  const { t, n } = i18n;
  const total = set.counts.MCP + set.counts.Prompt + set.counts.Tool;
  return (
    <article className={cn("group relative flex flex-col rounded-xl border border-border bg-card transition-colors duration-150 hover:border-foreground/30", className)}>
      <Corners hover />
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-start gap-3">
          <SkillsetAvatar name={set.name} avatar={set.avatar} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/skillsets/${set.slug}`} className="truncate text-base font-semibold leading-tight tracking-tight transition-colors after:absolute after:inset-0 after:content-[''] group-hover:text-synapse">
                {set.name}
              </Link>
              {set.verified && (
                <Badge variant="verified" title={t("skillset.verified.title")}>
                  <BadgeCheck className="h-3 w-3" /> {t("skillset.verified")}
                </Badge>
              )}
            </div>
            <p className="label-mono-sm mt-1 truncate normal-case tracking-normal">{t("skillset.byAuthor", { author: set.author.name || set.author.handle })}</p>
          </div>
        </div>
        {set.summary && <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">{set.summary}</p>}
        <div className="mt-auto flex flex-wrap gap-1.5">
          {SKILL_CATEGORIES.filter((c) => set.counts[c] > 0).map((c) => (
            <Badge key={c} variant="chip" className="gap-1.5">
              <CategoryIcon category={c} className="h-3 w-3" /> {set.counts[c]} · {t(`skillset.kind.${c}`)}
            </Badge>
          ))}
          {total === 0 && <Badge variant="outline">{t("skillset.empty")}</Badge>}
        </div>
      </div>
      <div className="label-mono-sm flex items-center justify-between gap-3 border-t border-border bg-surface-low/40 px-5 py-3">
        <span>{n("skillset.entries", total)}</span>
        <span className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1" title={t("skillset.favorites")}>
            <Heart className="h-3.5 w-3.5" /> {set.favorites}
          </span>
          <span className="text-synapse">{timeAgo(set.updatedAt, i18n)}</span>
        </span>
      </div>
    </article>
  );
}
