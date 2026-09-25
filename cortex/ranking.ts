/**
 * Cortex · Sorting engine
 *
 * Three views over the same catalogue:
 *   trending    — installation velocity × GitHub stars, log-damped so a
 *                 single viral repo does not pin the top forever.
 *   hidden-gems — Verified, high retention, *low* downloads: quality that
 *                 has not been discovered yet.
 *   recent      — chronological.
 */

import type { Skill, SortMode } from "@/types/skill";

export const HIDDEN_GEM_RULES = {
  maxDownloads: 5_000,
  minRetention: 0.6,
  minRating: 4.4,
  requiredLevel: "Verified" as const,
};

export function trendingScore(skill: Skill): number {
  const velocity = Math.log10(1 + skill.stats.installVelocity7d) * 3; // 0..~13
  const stars = Math.log10(1 + skill.githubStars); // 0..~5
  const retention = skill.stats.retentionRate * 2; // 0..2
  const freshness = recencyBoost(skill.updatedAt); // 0..1
  const trust = skill.securityLevel === "Verified" || skill.securityLevel === "Gov" ? 1 : skill.securityLevel === "Community" ? 0.6 : skill.securityLevel === "Sandbox" ? 0.2 : 0;
  return velocity + stars + retention + freshness + trust;
}

export function isHiddenGem(skill: Skill): boolean {
  return (
    skill.securityLevel === HIDDEN_GEM_RULES.requiredLevel &&
    skill.downloadsCount <= HIDDEN_GEM_RULES.maxDownloads &&
    skill.stats.retentionRate >= HIDDEN_GEM_RULES.minRetention &&
    (skill.stats.rating ?? 0) >= HIDDEN_GEM_RULES.minRating
  );
}

/** For gems, rank by "quality per download": high retention + rating, few installs. */
export function hiddenGemScore(skill: Skill): number {
  const quality = skill.stats.retentionRate * 5 + (skill.stats.rating ?? 0);
  const obscurity = 1 / Math.log10(10 + skill.downloadsCount);
  return quality * obscurity;
}

function recencyBoost(iso: string): number {
  const ageDays = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  return Math.max(0, 1 - ageDays / 30);
}

export function sortSkills(skills: Skill[], mode: SortMode): Skill[] {
  switch (mode) {
    case "trending":
      return [...skills].sort((a, b) => trendingScore(b) - trendingScore(a));
    case "hidden-gems":
      return skills.filter(isHiddenGem).sort((a, b) => hiddenGemScore(b) - hiddenGemScore(a));
    case "recent":
      return [...skills].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    case "relevance":
      // Relevance only exists with a query; without one it degrades to trending.
      return [...skills].sort((a, b) => trendingScore(b) - trendingScore(a));
  }
}

export const SORT_MODES: Array<{ value: SortMode; label: string; hint: string }> = [
  { value: "trending", label: "Trending", hint: "Installation velocity × GitHub stars" },
  { value: "hidden-gems", label: "Hidden Gems", hint: "Verified, high retention, few downloads" },
  { value: "recent", label: "Recently Added", hint: "Newest first" },
];
