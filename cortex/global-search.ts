/**
 * Cortex · Global search
 *
 * The header search box, social-network style: a handle or a name finds the
 * person, anything else finds skills / MCP servers / tools and skillsets. One
 * ranked list:
 *
 *   1. people whose handle or name starts with the query (a `@` prefix
 *      searches people first and only);
 *   2. the best catalogue hits;
 *   3. matching skillsets;
 *   4. the remaining people, then more catalogue hits to fill the list.
 *
 * With an empty query the list is a "what's popular" mix. The `source`
 * filter mirrors the search page: `github` keeps only crawled entries (people
 * and skillsets live on Synapth), `synapth` drops crawled entries.
 */

import { searchProfiles } from "@/cortex/account";
import { skillRepository } from "@/cortex/repository";
import { listSkillsets } from "@/cortex/skillsets";
import { safeImageSrc } from "@/lib/url-safety";
import { skillSource, type Skill, type SkillSource } from "@/types/skill";
import type { SkillsetSummary } from "@/types/skillset";
import { GLOBAL_SEARCH_LIMIT, type GlobalHit } from "@/types/search";

export function skillHit(s: Skill): GlobalHit {
  return { kind: "skill", id: s.id, slug: s.slug, name: s.name, category: s.category, description: s.description, authorName: s.authorName, image: safeImageSrc(s.source?.avatarUrl) ?? null, securityLevel: s.securityLevel, downloads: s.downloadsCount, source: skillSource(s) };
}

export function skillsetHit(s: SkillsetSummary): GlobalHit {
  return { kind: "skillset", id: s.id, slug: s.slug, name: s.name, summary: s.summary, avatar: s.avatar, author: s.author, verified: s.verified, entries: s.counts.MCP + s.counts.Prompt + s.counts.Tool };
}

export async function globalSearch(rawQuery: string, { limit = GLOBAL_SEARCH_LIMIT, source }: { limit?: number; source?: SkillSource } = {}): Promise<GlobalHit[]> {
  const raw = rawQuery.trim().slice(0, 120);
  const peopleOnly = raw.startsWith("@");
  const q = raw.replace(/^@+/, "");
  const needle = q.toLowerCase();
  const withPeople = source !== "github";
  const withSets = source !== "github" && !peopleOnly;

  const [people, skills, sets] = await Promise.all([
    withPeople ? searchProfiles(q, peopleOnly ? limit : 6) : Promise.resolve([]),
    peopleOnly ? Promise.resolve([]) : skillRepository.search(q, { limit, sort: q ? "relevance" : "trending", source }).then((r) => r.hits.map((h) => h.skill)),
    withSets ? listSkillsets({ q, sort: "popular", limit: 4 }) : Promise.resolve([]),
  ]);

  const personHits: GlobalHit[] = people.map((p) => ({ kind: "user", id: p.id, person: { id: p.id, name: p.name, handle: p.handle, image: p.image, occupation: p.occupation, verified: p.verified }, bio: p.bio }));
  if (peopleOnly) return personHits.slice(0, limit);

  const starts = (h: GlobalHit) => h.kind === "user" && Boolean(needle) && (h.person.handle.toLowerCase().startsWith(needle) || h.person.name.toLowerCase().startsWith(needle));
  const skillHits = skills.map(skillHit);
  const setHits = sets.map(skillsetHit);
  // Empty query: a small taste of everything instead of a wall of skills.
  const head = needle ? personHits.filter(starts).slice(0, 3) : personHits.slice(0, 2);
  const restPeople = personHits.filter((h) => !head.includes(h)).slice(0, needle ? 3 : 0);

  const out: GlobalHit[] = [...head, ...skillHits.slice(0, 4), ...setHits.slice(0, 2), ...restPeople, ...skillHits.slice(4), ...setHits.slice(2)];
  const seen = new Set<string>();
  return out.filter((h) => (seen.has(`${h.kind}:${h.id}`) ? false : (seen.add(`${h.kind}:${h.id}`), true))).slice(0, limit);
}
