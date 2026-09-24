"use client";

/**
 * FeaturedSlider — the carousel on top of the "Skills & MCP" and "Skillsets"
 * search tabs: the most popular entries, one per slide, advancing every 5 s.
 * Hover / focus pauses it (the remaining time is kept, so the progress bar
 * and the timer stay in step), arrows and dots jump. The timer is JS, not
 * `animationend`: reduced motion zeroes CSS durations, which would spin it.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, BadgeCheck, ChevronLeft, ChevronRight, Download, Github, Heart, Star } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { CategoryIcon } from "@/components/category-icon";
import { InstallButton } from "@/components/install-button";
import { SecurityBadge } from "@/components/security-badge";
import { SkillsetAvatar } from "@/components/skillset-avatar";
import { useI18n } from "@/axon/i18n";
import { cn, formatCompact } from "@/lib/utils";
import { SKILL_CATEGORIES, type Skill } from "@/types/skill";
import type { SkillsetSummary } from "@/types/skillset";

export type FeaturedItem = { kind: "skill"; skill: Skill } | { kind: "skillset"; set: SkillsetSummary };

const DURATION = 5000;

const TINT: Record<Skill["category"], string> = {
  MCP: "from-synapse/25 text-synapse",
  Prompt: "from-moss/25 text-moss",
  Tool: "from-warn/25 text-warn",
};

export function FeaturedSlider({ items, title, className }: { items: FeaturedItem[]; title: string; className?: string }) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const remaining = useRef(DURATION);
  const started = useRef(0);
  const count = items.length;

  // Declared before the timer: a new slide starts with a full budget.
  useEffect(() => {
    remaining.current = DURATION;
  }, [index]);

  useEffect(() => {
    if (paused || count < 2) return;
    started.current = Date.now();
    const id = setTimeout(() => setIndex((i) => (i + 1) % count), remaining.current);
    return () => {
      clearTimeout(id);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started.current));
    };
  }, [index, paused, count]);

  useEffect(() => {
    const onVis = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  if (!count) return null;
  const go = (i: number) => setIndex(((i % count) + count) % count);

  return (
    <section
      aria-roledescription="carousel"
      aria-label={title}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cn("relative overflow-hidden rounded-3xl border border-border bg-card", className)}
    >
      <div className="flex transition-transform duration-700 ease-[cubic-bezier(.2,.8,.2,1)]" style={{ transform: `translateX(-${index * 100}%)` }}>
        {items.map((item, i) => (
          <div key={item.kind === "skill" ? item.skill.id : item.set.id} role="group" aria-roledescription="slide" aria-label={`${i + 1} / ${count}`} aria-hidden={i !== index} inert={i !== index} className="w-full shrink-0">
            {item.kind === "skill" ? <SkillSlide skill={item.skill} rank={i + 1} /> : <SkillsetSlide set={item.set} rank={i + 1} />}
          </div>
        ))}
      </div>

      {/* Controls. */}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-4 px-6 pb-5 sm:px-8">
        <div className="flex items-center gap-1.5">
          {items.map((item, i) => (
            <button key={i} type="button" onClick={() => go(i)} aria-label={`${i + 1} / ${count}`} aria-current={i === index} className={cn("relative h-1.5 overflow-hidden rounded-full bg-foreground/15 transition-all duration-300", i === index ? "w-10" : "w-1.5 hover:bg-foreground/30")}>
              {i === index && <span key={index} className="absolute inset-0 origin-left rounded-full bg-synapse" style={{ animation: `slider-progress ${DURATION}ms linear forwards`, animationPlayState: paused || count < 2 ? "paused" : "running" }} />}
            </button>
          ))}
        </div>
        {count > 1 && (
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => go(index - 1)} aria-label={t("slider.prev")} className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card/80 text-muted-foreground backdrop-blur transition-colors hover:border-foreground/30 hover:text-foreground">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => go(index + 1)} aria-label={t("slider.next")} className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card/80 text-muted-foreground backdrop-blur transition-colors hover:border-foreground/30 hover:text-foreground">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function Shell({ tint, visual, children }: { tint: string; visual: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="relative grid min-h-[19rem] gap-6 p-6 pb-20 sm:p-8 sm:pb-20 md:grid-cols-[minmax(0,1fr)_16rem] md:items-center">
      <div aria-hidden className={cn("pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-gradient-to-br to-transparent opacity-60 blur-3xl", tint)} />
      <div className="relative min-w-0 space-y-4">{children}</div>
      <div className="relative hidden md:flex md:justify-center">{visual}</div>
    </div>
  );
}

function Rank({ rank, label }: { rank: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
      <span className="rounded-full bg-foreground/10 px-2 py-0.5 tabular-nums text-foreground">#{rank}</span> {label}
    </span>
  );
}

function SkillSlide({ skill, rank }: { skill: Skill; rank: number }) {
  const { t } = useI18n();
  const owner = skill.source?.owner ?? "";
  return (
    <Shell
      tint={TINT[skill.category]}
      visual={
        <span className={cn("dot-matrix relative flex h-44 w-44 items-center justify-center rounded-[2rem] border border-border bg-gradient-to-br to-surface-lowest", TINT[skill.category])}>
          <CategoryIcon category={skill.category} className="h-16 w-16" />
        </span>
      }
    >
      <Rank rank={rank} label={t(`slider.popular.${skill.category}`)} />
      <div className="space-y-2">
        <Link href={`/skills/${skill.slug}`} className="block font-display text-3xl font-medium leading-tight tracking-tight hover:text-synapse sm:text-4xl">
          {skill.name}
        </Link>
        <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Avatar author={{ name: skill.authorName, handle: owner, image: skill.source?.avatarUrl ?? null }} size="xs" className="rounded-full" />
          <span className="text-foreground/90">{skill.authorName}</span>
          {skill.origin === "github" ? <Github className="h-3.5 w-3.5" aria-label="GitHub" /> : <span className="rounded-full bg-synapse/10 px-2 py-px text-[11px] text-synapse">{t("search.source.synapth")}</span>}
          <SecurityBadge level={skill.securityLevel} />
        </span>
      </div>
      <p className="line-clamp-2 max-w-xl text-base leading-relaxed text-foreground/75">{skill.description}</p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <span className="flex items-center gap-4 text-sm tabular-nums text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Download className="h-4 w-4" /> {formatCompact(skill.downloadsCount)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Star className="h-4 w-4" /> {formatCompact(skill.githubStars)}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <InstallButton skill={skill} size="sm" label={t("card.install")} className="h-9 rounded-full px-5" />
          <Link href={`/skills/${skill.slug}`} className="group inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm text-muted-foreground transition-colors hover:text-foreground">
            {t("slider.open")} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </span>
      </div>
    </Shell>
  );
}

function SkillsetSlide({ set, rank }: { set: SkillsetSummary; rank: number }) {
  const { t, n } = useI18n();
  const total = set.counts.MCP + set.counts.Prompt + set.counts.Tool;
  return (
    <Shell
      tint="from-synapse/20 text-synapse"
      visual={
        <span className="relative">
          <span aria-hidden className="absolute inset-0 translate-x-5 -translate-y-5 rounded-[2rem] border border-border bg-surface" />
          <span aria-hidden className="absolute inset-0 translate-x-2.5 -translate-y-2.5 rounded-[2rem] border border-border bg-surface-low" />
          <SkillsetAvatar name={set.name} avatar={set.avatar} size="lg" className="relative h-40 w-40 rounded-[2rem] text-5xl sm:h-40 sm:w-40" />
        </span>
      }
    >
      <Rank rank={rank} label={t("slider.popular.skillset")} />
      <div className="space-y-2">
        <Link href={`/skillsets/${set.slug}`} className="block font-display text-3xl font-medium leading-tight tracking-tight hover:text-synapse sm:text-4xl">
          {set.name}
        </Link>
        <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Avatar author={set.author} size="xs" className="rounded-full" link />
          <Link href={`/u/${set.author.handle}`} className="text-foreground/90 hover:underline">
            {set.author.name || set.author.handle}
          </Link>
          {set.verified && (
            <span className="inline-flex items-center gap-1 rounded-full bg-synapse/10 px-2 py-px text-[11px] text-synapse">
              <BadgeCheck className="h-3 w-3" /> {t("skillset.verified")}
            </span>
          )}
        </span>
      </div>
      {set.summary && <p className="line-clamp-2 max-w-xl text-base leading-relaxed text-foreground/75">{set.summary}</p>}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {SKILL_CATEGORIES.filter((c) => set.counts[c] > 0).map((c) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-1">
              <CategoryIcon category={c} className="h-3 w-3" /> {set.counts[c]} {t(`skillset.kind.${c}`)}
            </span>
          ))}
          <span className="ml-1 inline-flex items-center gap-1 tabular-nums">
            <Heart className="h-3.5 w-3.5" /> {formatCompact(set.favorites)}
          </span>
        </span>
        <Link href={`/skillsets/${set.slug}`} className="group inline-flex h-9 items-center gap-1.5 rounded-full bg-synapse px-5 text-sm font-medium text-synapse-foreground transition-transform hover:-translate-y-px">
          {t("slider.openSet", { n: n("skillset.entries", total) })} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </Shell>
  );
}
