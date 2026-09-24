"use client";

import Link from "next/link";
import { ArrowUpRight, Download, Star } from "lucide-react";
import { Avatar } from "@/components/avatar";
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

/** Tinted tile per kind, so a grid reads at a glance without reading the labels. */
const TILE: Record<Skill["category"], string> = {
  MCP: "bg-synapse/10 text-synapse ring-synapse/20",
  Prompt: "bg-moss/10 text-moss ring-moss/20",
  Tool: "bg-warn/10 text-warn ring-warn/20",
};

/**
 * Catalogue card, written like a post from its author: who shared it and
 * when, what it is, how many people use it. The whole card opens the skill;
 * the author line and install button sit above that link overlay.
 */
export function SkillCard({ skill, highlights, layout = "grid" }: Props) {
  const i18n = useI18n();
  const { t } = i18n;
  const hl = (field: Highlight["field"]) => highlights?.find((h) => h.field === field);
  const name = hl("name");
  const description = hl("description");
  const readme = hl("readme");
  const owner = skill.source?.owner ?? null;
  const author = { name: skill.authorName, handle: owner ?? "", image: skill.source?.avatarUrl ?? null };
  const updated = timeAgo(skill.source?.pushedAt ?? skill.updatedAt, i18n);
  const tags = skill.tags.filter((tag) => tag !== skill.category.toLowerCase()).slice(0, 3);

  const byline = (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar author={author} size="xs" className="rounded-full" />
      <span className="truncate text-[13px] font-medium text-foreground/90">{skill.authorName}</span>
    </span>
  );
  const authorLine = owner ? (
    <Link href={`/authors/${encodeURIComponent(owner)}`} className="relative z-10 min-w-0 transition-opacity hover:opacity-80">
      {byline}
    </Link>
  ) : (
    byline
  );

  if (layout === "list") {
    return (
      <article className="lift group relative flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 hover:border-foreground/25 sm:flex-row sm:items-center sm:gap-5">
        <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset", TILE[skill.category])}>
          <CategoryIcon category={skill.category} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link href={`/skills/${skill.slug}`} className="truncate text-base font-semibold tracking-tight transition-colors after:absolute after:inset-0 after:content-[''] group-hover:text-synapse">
              {name ? <Highlighted segments={name.segments} /> : skill.name}
            </Link>
            <SecurityBadge level={skill.securityLevel} className="shrink-0" />
          </div>
          <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">{description ? <Highlighted segments={description.segments} /> : skill.description}</p>
        </div>
        <div className="relative z-10 flex shrink-0 items-center gap-4">
          <span className="hidden sm:block">{authorLine}</span>
          <Stats skill={skill} />
          <InstallButton skill={skill} size="sm" label={t("card.install")} className="h-8 rounded-full px-4" />
        </div>
      </article>
    );
  }

  return (
    <article className="lift group relative flex flex-col rounded-2xl border border-border bg-card p-5 hover:border-foreground/25">
      {/* Who shared it, and when. */}
      <header className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-1.5">
          {authorLine}
          <span className="shrink-0 text-xs text-muted-foreground">· {updated}</span>
        </span>
        <SecurityBadge level={skill.securityLevel} className="shrink-0" />
      </header>

      {/* What it is. */}
      <div className="mt-5 flex items-start gap-3.5">
        <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ring-1 ring-inset transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105", TILE[skill.category])}>
          <CategoryIcon category={skill.category} className="h-[22px] w-[22px]" />
        </span>
        <div className="min-w-0 pt-0.5">
          <Link href={`/skills/${skill.slug}`} className="line-clamp-2 font-display text-xl font-medium leading-tight tracking-tight transition-colors after:absolute after:inset-0 after:content-[''] group-hover:text-synapse">
            {name ? <Highlighted segments={name.segments} /> : skill.name}
          </Link>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {t(`category.${skill.category}.label`)}
            {skill.source?.language && <> · {skill.source.language}</>}
            <> · v{skill.version}</>
          </p>
        </div>
      </div>

      <p className="mt-4 line-clamp-3 text-sm leading-relaxed text-foreground/75">{description ? <Highlighted segments={description.segments} /> : skill.description}</p>
      {readme && (
        <p className="mt-2 line-clamp-2 border-l-2 border-synapse/40 pl-2 text-xs text-muted-foreground">
          <Highlighted segments={readme.segments} />
        </p>
      )}
      {tags.length > 0 && (
        <p className="mt-3 flex flex-wrap gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
          {tags.map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </p>
      )}

      {/* How many people use it + the one action. */}
      <footer className="relative z-10 mt-auto flex items-center justify-between gap-3 pt-5">
        <Stats skill={skill} />
        <span className="flex items-center gap-1.5">
          <Link href={`/skills/${skill.slug}`} aria-label={t("card.open")} className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground opacity-0 transition-all hover:bg-surface hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100">
            <ArrowUpRight className="h-4 w-4" />
          </Link>
          <InstallButton skill={skill} size="sm" label={t("card.install")} className="h-8 rounded-full px-4" />
        </span>
      </footer>
    </article>
  );
}

function Stats({ skill }: { skill: Skill }) {
  const { t } = useI18n();
  return (
    <span className="flex items-center gap-3.5 text-xs tabular-nums text-muted-foreground">
      <span className="inline-flex items-center gap-1" title={t("card.installs")}>
        <Download className="h-3.5 w-3.5" /> {formatCompact(skill.downloadsCount)}
      </span>
      <span className="inline-flex items-center gap-1" title={t("card.stars")}>
        <Star className="h-3.5 w-3.5" /> {formatCompact(skill.githubStars)}
      </span>
    </span>
  );
}
