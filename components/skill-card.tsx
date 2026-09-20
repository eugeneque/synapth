"use client";

import Link from "next/link";
import { Download, Star, Terminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Corners } from "@/components/corners";
import { SecurityBadge } from "@/components/security-badge";
import { CategoryIcon } from "@/components/category-icon";
import { InstallButton } from "@/components/install-button";
import { Highlighted } from "@/components/highlighted";
import { useI18n } from "@/axon/i18n";
import { cn, formatCompact, timeAgo } from "@/lib/utils";
import type { Highlight } from "@/cortex/search";
import type { Skill } from "@/types/skill";

interface Props {
  skill: Skill;
  /** Search highlights from Cortex; omitted outside search results. */
  highlights?: Highlight[];
  /** Compact single-row layout for the list view. */
  layout?: "grid" | "list";
}

export function SkillCard({ skill, highlights, layout = "grid" }: Props) {
  const i18n = useI18n();
  const { t } = i18n;
  const hl = (field: Highlight["field"]) => highlights?.find((h) => h.field === field);
  const name = hl("name");
  const description = hl("description");
  const readme = hl("readme");
  const license = skill.source?.license;
  const list = layout === "list";

  return (
    <article className={cn("group relative flex rounded-xl border border-border bg-card transition-colors duration-150 hover:border-foreground/30", list ? "flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-5" : "flex-col")}>
      <Corners hover />

      <div className={cn("flex flex-col gap-3", list ? "min-w-0 flex-1" : "p-5")}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-synapse">
              <CategoryIcon category={skill.category} className="h-[18px] w-[18px]" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/skills/${skill.slug}`} className="truncate text-base font-semibold leading-tight tracking-tight transition-colors after:absolute after:inset-0 after:content-[''] group-hover:text-synapse">
                  {name ? <Highlighted segments={name.segments} /> : skill.name}
                </Link>
                <SecurityBadge level={skill.securityLevel} className="shrink-0" />
              </div>
              <p className="label-mono-sm mt-1 truncate normal-case tracking-normal">
                {t("card.by", { author: skill.authorName, version: skill.version })}
                {skill.source?.language && <> • {skill.source.language}</>}
              </p>
            </div>
          </div>
          {!list && (
            <div className="flex shrink-0 flex-col items-end">
              <span className="font-mono text-xs font-medium text-synapse">{t("common.free")}</span>
              <span className="label-mono-sm">{license ?? t("card.openSource")}</span>
            </div>
          )}
        </div>

        <p className={cn("text-sm leading-relaxed text-muted-foreground", list ? "line-clamp-1" : "line-clamp-2")}>{description ? <Highlighted segments={description.segments} /> : skill.description}</p>
        {readme && !list && (
          <p className="line-clamp-2 border-l-2 border-synapse/40 pl-2 font-mono text-[11px] text-muted-foreground">
            <Highlighted segments={readme.segments} />
          </p>
        )}

        {!list && (
          <div className="mt-auto flex flex-wrap gap-1.5">
            <Badge variant="outline">{skill.category}</Badge>
            {skill.tags
              .filter((t) => t !== skill.category.toLowerCase())
              .slice(0, 3)
              .map((t) => (
                <Badge key={t} variant="chip">
                  {t}
                </Badge>
              ))}
          </div>
        )}
      </div>

      {/* Footer strip; z-10 lifts the buttons above the card-wide link overlay. */}
      <div className={cn("relative z-10 flex items-center justify-between gap-3", list ? "shrink-0 sm:w-auto" : "border-t border-border bg-surface-low/40 px-5 py-3")}>
        <div className="label-mono-sm flex items-center gap-4">
          <span className="inline-flex items-center gap-1" title={t("card.installs")}>
            <Download className="h-3.5 w-3.5" /> {formatCompact(skill.downloadsCount)}
          </span>
          <span className="inline-flex items-center gap-1" title={t("card.stars")}>
            <Star className="h-3.5 w-3.5" /> {formatCompact(skill.githubStars)}
          </span>
          <span className="hidden whitespace-nowrap text-synapse sm:inline-flex" title={t("card.lastUpdate")}>
            {timeAgo(skill.source?.pushedAt ?? skill.updatedAt, i18n)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/skills/${skill.slug}`} aria-label={t("card.open")} className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground">
            <Terminal className="h-4 w-4" />
          </Link>
          <InstallButton skill={skill} size="sm" label={t("card.install")} className="h-8 font-mono text-[11px] uppercase tracking-[0.1em]" />
        </div>
      </div>
    </article>
  );
}
