/**
 * Cortex · Catalogue repository
 *
 * One interface, two backends. Prisma when DATABASE_URL is set, otherwise a
 * file-backed store (`data/catalog.json`) seeded from `seed.ts`, so the whole
 * app — including a crawled catalogue of thousands of skills — runs with
 * `npm run dev` and nothing else. Full-text search always goes through
 * `cortex/search.ts`; the index is rebuilt when the catalogue version changes.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Prisma } from "@prisma/client";
import { prisma, hasDatabase, isServerless } from "@/cortex/db";
import { seedSkills, memoryUsers } from "@/cortex/seed";
import { notifySkillUpdated } from "@/cortex/social";
import { sortSkills } from "@/cortex/ranking";
import { buildIndex, search, suggest, type SearchIndex, type SearchOptions, type SearchResult, type Suggestion } from "@/cortex/search";
import { slugify } from "@/lib/utils";
import { inheritLevel } from "@/lib/sandbox-scanner";
import { appendVersion, MAX_VERSIONS } from "@/lib/skill-versions";
import { isListed } from "@/types/trust";
import { usdToMicros, microsToUsd } from "@/types/economy";
import { skillSource, type Paginated, type Skill, type SkillCreateInput, type SkillManifest, type SkillQuery, type SecurityLevel, type SkillVersionEntry } from "@/types/skill";

export interface SkillRepository {
  list(query: SkillQuery): Promise<Paginated<Skill>>;
  search(q: string, options?: SearchOptions): Promise<SearchResult>;
  suggest(q: string, limit?: number): Promise<Suggestion[]>;
  byId(id: string): Promise<Skill | null>;
  bySlug(slug: string): Promise<Skill | null>;
  /** All skills (for sitemaps, author pages, index rebuilds). */
  all(): Promise<Skill[]>;
  /** Full README / SKILL.md body; `Skill.readme` only carries an excerpt for search and cards. */
  readme(id: string): Promise<string | null>;
  create(input: SkillCreateInput, authorId: string, securityLevel: SecurityLevel): Promise<Skill>;
  /**
   * Insert or update by slug — what the crawler calls. An existing row is only
   * updated by the author that owns it: otherwise an import of a look-alike
   * repository could overwrite somebody else's manifest (`skipped` counts those).
   */
  upsertMany(items: Array<{ input: SkillCreateInput; authorId: string; authorName: string; securityLevel: SecurityLevel }>): Promise<{ created: number; updated: number; skipped: number }>;
  recordInstall(skillId: string, client: string, userId?: string): Promise<void>;
  /** Stored versions, newest first — every manifest change is one (`lib/skill-versions.ts`). */
  versions(skillId: string): Promise<SkillVersionEntry[]>;
  /** The most recent manifest change of a listed entry (two consecutive versions), for the home page. */
  latestChange(): Promise<VersionChange | null>;
  /**
   * Moderation: store a new security level decided by a human review
   * (`cortex/moderation.ts`). The scan that backed the decision is kept as an
   * audit row when a database is attached.
   */
  setSecurityLevel(id: string, level: SecurityLevel, review: SecurityReview): Promise<Skill | null>;
  /** Changes whenever the catalogue changes; used to invalidate the search index. */
  version(): Promise<string>;
}

export interface VersionChange {
  skill: Skill;
  before: SkillVersionEntry;
  after: SkillVersionEntry;
}

/** Recent version rows looked at when searching for the latest change of a listed entry. */
const CHANGE_LOOKBACK = 40;

export interface SecurityReview {
  reviewerId: string;
  scannerVersion: string;
  findings: unknown[];
}

/** Serverless bundles (Netlify / Lambda) are read-only; only `/tmp` is writable there. */
export const CATALOG_PATH =
  process.env.SYNAPTH_CATALOG_PATH ??
  (isServerless ? join("/tmp", "synapth", "catalog.json") : join(process.cwd(), "data", "catalog.json"));
/** Characters of README kept inline in the catalogue; the rest lives in a side file / column. */
export const README_EXCERPT = 4_000;
/** `SkillStats.installVelocity7d` is counted over this window from install events, never accumulated. */
export const VELOCITY_WINDOW_MS = 7 * 86_400_000;

// ---------------------------------------------------------------------------
// Shared filtering
// ---------------------------------------------------------------------------

function matchesQuery(skill: Skill, q: SkillQuery): boolean {
  if (q.category && skill.category !== q.category) return false;
  if (q.securityLevel && skill.securityLevel !== q.securityLevel) return false;
  if (q.language && (skill.source?.language ?? "").toLowerCase() !== q.language.toLowerCase()) return false;
  if (q.source && skillSource(skill) !== q.source) return false;
  if (q.author && skill.authorName.toLowerCase() !== q.author.toLowerCase() && skill.source?.owner.toLowerCase() !== q.author.toLowerCase()) return false;
  if (q.q) {
    const needle = q.q.toLowerCase();
    const hay = [skill.name, skill.description, skill.authorName, ...skill.tags, ...skill.manifest.tools.map((t) => t.name)].join(" ").toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  return true;
}

function paginate<T>(items: T[], q: SkillQuery): Paginated<T> {
  const limit = Math.min(Math.max(q.limit ?? 24, 1), 100);
  const offset = Math.max(q.offset ?? 0, 0);
  return { items: items.slice(offset, offset + limit), total: items.length, limit, offset };
}

// ---------------------------------------------------------------------------
// Search index cache (shared by both backends)
// ---------------------------------------------------------------------------

class IndexCache {
  private index: SearchIndex | null = null;
  private stamp = "";

  async get(repo: SkillRepository): Promise<SearchIndex> {
    const stamp = await repo.version();
    if (!this.index || stamp !== this.stamp) {
      // Quarantined entries never reach search, suggestions or agents.
      this.index = buildIndex((await repo.all()).filter((s) => isListed(s.securityLevel)));
      this.stamp = stamp;
    }
    return this.index;
  }
}

/** Prompt skills carry their whole SKILL.md as the system prompt; keep only an excerpt inline. */
function trimManifest(manifest: SkillManifest): SkillManifest {
  if (!manifest.systemPrompt || manifest.systemPrompt.length <= README_EXCERPT) return manifest;
  return { ...manifest, systemPrompt: manifest.systemPrompt.slice(0, README_EXCERPT), systemPromptTruncated: true };
}

/** Restores the full system prompt for API responses that inject it into an agent. */
export async function hydratePrompt(skill: Skill): Promise<Skill> {
  if (!skill.manifest.systemPromptTruncated) return skill;
  const full = await skillRepository.readme(skill.id);
  if (!full) return skill;
  return { ...skill, manifest: { ...skill.manifest, systemPrompt: full, systemPromptTruncated: false } };
}

/** Watchers of a skill are told about a version bump (`cortex/social.ts`); a failure here must not break the import. */
async function announceRelease(skill: Pick<Skill, "id" | "slug" | "name" | "version" | "securityLevel" | "authorId">, previousVersion: string | null) {
  try {
    await notifySkillUpdated({ id: skill.id, slug: skill.slug, name: skill.name, version: skill.version, previousVersion, verified: skill.securityLevel === "Verified", authorId: skill.authorId });
  } catch (err) {
    console.error("[cortex] release notification failed", err);
  }
}

function toSkill(input: SkillCreateInput, id: string, slug: string, authorId: string, authorName: string, securityLevel: SecurityLevel, existing?: Skill): Skill {
  const now = new Date().toISOString();
  return {
    id,
    slug,
    name: input.name,
    description: input.description,
    authorId,
    authorName,
    version: input.version,
    category: input.category,
    securityLevel: inheritLevel(existing ? { level: existing.securityLevel, manifest: existing.manifest } : null, { manifest: trimManifest(input.manifest), scanned: securityLevel }),
    downloadsCount: existing?.downloadsCount ?? 0,
    githubStars: input.githubStars ?? existing?.githubStars ?? 0,
    pricePerCall: input.pricePerCall,
    manifest: trimManifest(input.manifest),
    repoUrl: input.repoUrl ?? null,
    tags: input.tags ?? [],
    stats: existing?.stats ?? { installVelocity7d: 0, retentionRate: 0, executions: 0, rating: null },
    origin: input.origin ?? "manual",
    source: input.source ?? null,
    // Prompt skills: the README *is* the system prompt — don't store it twice.
    readme: input.readme && input.readme !== input.manifest.systemPrompt ? input.readme.slice(0, README_EXCERPT) : null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// File-backed backend (default without DATABASE_URL)
// ---------------------------------------------------------------------------

interface CatalogFile {
  version: number;
  savedAt: string;
  skills: Skill[];
  /** Install timestamps (epoch ms) inside the velocity window, per skill id. */
  installs?: Record<string, number[]>;
}

class FileSkillRepository implements SkillRepository {
  private skills: Skill[] = [];
  private bySlugMap = new Map<string, Skill>();
  private byIdMap = new Map<string, Skill>();
  private stamp = 0;
  private loadedMtime = 0;
  private readonly cache = new IndexCache();
  private installs = new Map<string, number[]>();
  private velocityAt = 0;

  private readonly readmeDir: string;
  private readonly versionsDir: string;

  constructor(private readonly path = CATALOG_PATH) {
    this.readmeDir = join(dirname(path), "readme");
    // `data/catalog.json` → `data/catalog.versions/`: next to the catalogue it belongs to, one JSON file per entry.
    this.versionsDir = `${path.replace(/\.json$/, "")}.versions`;
    this.load();
  }

  private versionsPath(id: string) {
    return join(this.versionsDir, `${id.replace(/[^\w-]/g, "_")}.json`);
  }

  /** History oldest first; null when the entry predates version tracking. */
  private readHistory(id: string): SkillVersionEntry[] | null {
    const p = this.versionsPath(id);
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, "utf8")) as SkillVersionEntry[];
    } catch {
      return null;
    }
  }

  private writeHistory(id: string, history: SkillVersionEntry[]) {
    mkdirSync(this.versionsDir, { recursive: true });
    writeFileSync(this.versionsPath(id), JSON.stringify(history.slice(-MAX_VERSIONS)));
  }

  /** The stored manifest with its full prompt (the catalogue keeps an excerpt). */
  private async fullManifest(skill: Skill): Promise<SkillManifest> {
    if (!skill.manifest.systemPromptTruncated) return skill.manifest;
    const full = await this.readme(skill.id);
    return full ? { ...skill.manifest, systemPrompt: full, systemPromptTruncated: undefined } : skill.manifest;
  }

  async versions(id: string) {
    this.load();
    const skill = this.byIdMap.get(id);
    if (!skill) return [];
    const history = this.readHistory(id) ?? [{ version: skill.version, manifest: await this.fullManifest(skill), createdAt: skill.createdAt }];
    return [...history].reverse();
  }

  async latestChange(): Promise<VersionChange | null> {
    this.load();
    if (!existsSync(this.versionsDir)) return null;
    const files = readdirSync(this.versionsDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ f, t: statSync(join(this.versionsDir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
      .slice(0, CHANGE_LOOKBACK);
    for (const { f } of files) {
      const id = f.slice(0, -5);
      const skill = this.byIdMap.get(id);
      const history = skill && isListed(skill.securityLevel) ? this.readHistory(id) : null;
      if (history && history.length >= 2) return { skill: skill!, before: history[history.length - 2], after: history[history.length - 1] };
    }
    return null;
  }

  /**
   * Installs per skill over the last seven days, from the event log. Seed
   * entries without events keep their demo numbers; everything else decays
   * as time passes, even with no new installs. Recomputed at most once a minute.
   */
  private refreshVelocity(force = false) {
    const now = Date.now();
    if (!force && now - this.velocityAt < 60_000) return;
    this.velocityAt = now;
    const since = now - VELOCITY_WINDOW_MS;
    for (const [id, log] of this.installs) {
      const fresh = log.filter((t) => t > since);
      if (fresh.length) this.installs.set(id, fresh);
      else this.installs.delete(id);
    }
    for (const skill of this.skills) {
      if (skill.origin === "seed" && !this.installs.has(skill.id)) continue;
      skill.stats.installVelocity7d = this.installs.get(skill.id)?.length ?? 0;
    }
  }

  private readmePath(id: string) {
    return join(this.readmeDir, `${id.replace(/[^\w-]/g, "_")}.md`);
  }

  /** Full bodies are kept out of catalog.json so the whole catalogue stays cheap to load. */
  private storeReadme(id: string, readme: string | null | undefined, prompt?: string) {
    readme = readme && readme.length >= (prompt?.length ?? 0) ? readme : prompt;
    if (!readme || readme.length <= README_EXCERPT) return;
    mkdirSync(this.readmeDir, { recursive: true });
    writeFileSync(this.readmePath(id), readme);
  }

  async readme(id: string) {
    this.load();
    const p = this.readmePath(id);
    if (existsSync(p)) return readFileSync(p, "utf8");
    const skill = this.byIdMap.get(id);
    return skill?.readme ?? skill?.manifest.systemPrompt ?? null;
  }

  /** Re-read the file when another process (the crawler CLI) wrote it. */
  private load() {
    if (existsSync(this.path)) {
      const mtime = statSync(this.path).mtimeMs;
      if (mtime === this.loadedMtime) return;
      try {
        const file = JSON.parse(readFileSync(this.path, "utf8")) as CatalogFile;
        this.replaceAll(file.skills);
        this.installs = new Map(Object.entries(file.installs ?? {}));
        this.refreshVelocity(true);
        this.loadedMtime = mtime;
        return;
      } catch (err) {
        console.error(`[cortex] catalog at ${this.path} is unreadable, falling back to seed:`, (err as Error).message);
      }
    }
    if (!this.skills.length) this.replaceAll(structuredClone(seedSkills));
  }

  private replaceAll(skills: Skill[]) {
    this.skills = skills;
    this.bySlugMap = new Map(skills.map((s) => [s.slug, s]));
    this.byIdMap = new Map(skills.map((s) => [s.id, s]));
    this.stamp += 1;
  }

  private save() {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    const payload: CatalogFile = { version: 1, savedAt: new Date().toISOString(), skills: this.skills, installs: Object.fromEntries(this.installs) };
    writeFileSync(tmp, JSON.stringify(payload));
    renameSync(tmp, this.path);
    this.loadedMtime = statSync(this.path).mtimeMs;
    this.stamp += 1;
  }

  private uniqueSlug(base: string, keepId?: string): string {
    let slug = base;
    for (let i = 2; this.bySlugMap.has(slug) && this.bySlugMap.get(slug)?.id !== keepId; i++) slug = `${base}-${i}`;
    return slug;
  }

  async version() {
    this.load();
    return `file:${this.stamp}`;
  }

  async all() {
    this.load();
    this.refreshVelocity();
    return this.skills;
  }

  async list(query: SkillQuery) {
    this.load();
    this.refreshVelocity();
    if (query.q?.trim()) {
      const res = search(await this.cache.get(this), query.q, {
        limit: query.limit,
        offset: query.offset,
        category: query.category,
        securityLevel: query.securityLevel,
        language: query.language,
        author: query.author,
        source: query.source,
        sort: query.sort === "hidden-gems" ? "relevance" : query.sort === "trending" ? "relevance" : query.sort === "recent" ? "recent" : "relevance",
      });
      let items = res.hits.map((h) => h.skill);
      if (query.sort === "hidden-gems") items = sortSkills(items, "hidden-gems");
      return { items, total: res.total, limit: res.limit, offset: res.offset };
    }
    const filtered = this.skills.filter((s) => isListed(s.securityLevel) && matchesQuery(s, query));
    const sort = query.sort === "relevance" ? "trending" : (query.sort ?? "trending");
    return paginate(sortSkills(filtered, sort), query);
  }

  async search(q: string, options: SearchOptions = {}): Promise<SearchResult> {
    this.load();
    return search(await this.cache.get(this), q, options);
  }

  async suggest(q: string, limit = 8): Promise<Suggestion[]> {
    this.load();
    return suggest(await this.cache.get(this), q, limit);
  }

  async byId(id: string) {
    this.load();
    this.refreshVelocity();
    return this.byIdMap.get(id) ?? null;
  }

  async bySlug(slug: string) {
    this.load();
    this.refreshVelocity();
    return this.bySlugMap.get(slug) ?? null;
  }

  async create(input: SkillCreateInput, authorId: string, securityLevel: SecurityLevel) {
    this.load();
    const author = memoryUsers.find((u) => u.id === authorId);
    const slug = this.uniqueSlug(input.slug ?? slugify(`${author?.handle ?? "user"}-${input.name}`));
    const skill = toSkill(input, `skl_${Math.random().toString(36).slice(2, 10)}`, slug, authorId, author?.name ?? "Unknown", securityLevel);
    this.storeReadme(skill.id, input.readme, input.manifest.systemPrompt);
    this.writeHistory(skill.id, [{ version: input.version, manifest: input.manifest, createdAt: skill.createdAt }]);
    this.skills.unshift(skill);
    this.bySlugMap.set(slug, skill);
    this.byIdMap.set(skill.id, skill);
    this.save();
    return skill;
  }

  async upsertMany(items: Array<{ input: SkillCreateInput; authorId: string; authorName: string; securityLevel: SecurityLevel }>) {
    this.load();
    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (const { input, authorId, authorName, securityLevel } of items) {
      const base = input.slug ?? slugify(`${authorName}-${input.name}`);
      const existing = this.bySlugMap.get(base);
      if (existing && existing.authorId !== authorId) {
        skipped += 1;
        continue;
      }
      if (existing) {
        const previousVersion = existing.version;
        // Read the previous manifest before its prompt file is overwritten below.
        const history = this.readHistory(existing.id) ?? [{ version: existing.version, manifest: await this.fullManifest(existing), createdAt: existing.createdAt }];
        const nextHistory = appendVersion(history, input.version, input.manifest, new Date().toISOString());
        if (nextHistory) this.writeHistory(existing.id, nextHistory);
        const next = toSkill(input, existing.id, existing.slug, authorId, authorName, securityLevel, existing);
        Object.assign(existing, next);
        this.storeReadme(existing.id, input.readme, input.manifest.systemPrompt);
        updated += 1;
        if (previousVersion !== existing.version) await announceRelease(existing, previousVersion);
      } else {
        const skill = toSkill(input, `skl_${Math.random().toString(36).slice(2, 10)}`, base, authorId, authorName, securityLevel);
        this.storeReadme(skill.id, input.readme, input.manifest.systemPrompt);
        this.writeHistory(skill.id, [{ version: input.version, manifest: input.manifest, createdAt: skill.createdAt }]);
        this.skills.push(skill);
        this.bySlugMap.set(skill.slug, skill);
        this.byIdMap.set(skill.id, skill);
        created += 1;
      }
    }
    if (created || updated) this.save();
    return { created, updated, skipped };
  }

  async setSecurityLevel(id: string, level: SecurityLevel) {
    this.load();
    const skill = this.byIdMap.get(id);
    if (!skill) return null;
    skill.securityLevel = level;
    skill.updatedAt = new Date().toISOString();
    this.save();
    return skill;
  }

  async recordInstall(skillId: string) {
    this.load();
    const skill = this.byIdMap.get(skillId);
    if (skill) {
      skill.downloadsCount += 1;
      this.installs.set(skillId, [...(this.installs.get(skillId) ?? []), Date.now()]);
      this.refreshVelocity(true);
      this.save();
    }
  }
}

// ---------------------------------------------------------------------------
// Prisma backend
// ---------------------------------------------------------------------------

const skillInclude = { author: { select: { name: true, handle: true } }, stats: true } satisfies Prisma.SkillInclude;
type SkillRow = Prisma.SkillGetPayload<{ include: typeof skillInclude }>;

/** `velocity`: installs per skill over the last seven days (`PrismaSkillRepository.velocity`). */
function toDomain(row: SkillRow, velocity: Map<string, number> = new Map()): Skill {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    authorId: row.authorId,
    authorName: row.author.name ?? row.author.handle ?? "Unknown",
    version: row.version,
    category: row.category,
    securityLevel: row.securityLevel,
    downloadsCount: row.downloadsCount,
    githubStars: row.githubStars,
    pricePerCall: microsToUsd(row.priceMicros),
    manifest: row.manifest as unknown as SkillManifest,
    repoUrl: row.repoUrl,
    tags: row.tags,
    stats: {
      installVelocity7d: velocity.get(row.id) ?? 0,
      retentionRate: row.stats?.retentionRate ?? 0,
      executions: row.stats?.executions ?? 0,
      rating: row.stats?.rating ?? null,
    },
    origin: (row.origin as Skill["origin"]) ?? "manual",
    source: (row.source as unknown as Skill["source"]) ?? null,
    readme: row.readme ? row.readme.slice(0, README_EXCERPT) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

class PrismaSkillRepository implements SkillRepository {
  private readonly cache = new IndexCache();

  /** Install events inside the window, grouped by skill (indexed on skillId + createdAt). */
  private async velocity(ids?: string[]): Promise<Map<string, number>> {
    const rows = await prisma.install.groupBy({
      by: ["skillId"],
      where: { createdAt: { gte: new Date(Date.now() - VELOCITY_WINDOW_MS) }, ...(ids ? { skillId: { in: ids } } : {}) },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.skillId, r._count._all]));
  }

  async latestChange(): Promise<VersionChange | null> {
    const recent = await prisma.skillVersion.findMany({ orderBy: { createdAt: "desc" }, take: CHANGE_LOOKBACK, select: { skillId: true, version: true, manifest: true, createdAt: true } });
    const seen = new Set<string>();
    for (const row of recent) {
      if (seen.has(row.skillId)) continue;
      seen.add(row.skillId);
      const before = await prisma.skillVersion.findFirst({ where: { skillId: row.skillId, createdAt: { lt: row.createdAt } }, orderBy: { createdAt: "desc" } });
      if (!before) continue;
      const skill = await this.byId(row.skillId);
      if (!skill || !isListed(skill.securityLevel)) continue;
      const entry = (r: { version: string; manifest: Prisma.JsonValue; createdAt: Date }): SkillVersionEntry => ({ version: r.version, manifest: r.manifest as unknown as SkillManifest, createdAt: r.createdAt.toISOString() });
      return { skill, before: entry(before), after: entry(row) };
    }
    return null;
  }

  async versions(id: string) {
    const rows = await prisma.skillVersion.findMany({ where: { skillId: id }, orderBy: { createdAt: "desc" }, take: MAX_VERSIONS });
    if (rows.length) return rows.map((r) => ({ version: r.version, manifest: r.manifest as unknown as SkillManifest, createdAt: r.createdAt.toISOString() }));
    const skill = await this.byId(id);
    return skill ? [{ version: skill.version, manifest: skill.manifest, createdAt: skill.createdAt }] : [];
  }

  async version() {
    const agg = await prisma.skill.aggregate({ _count: { _all: true }, _max: { updatedAt: true } });
    return `db:${agg._count._all}:${agg._max.updatedAt?.getTime() ?? 0}`;
  }

  async all() {
    const [rows, velocity] = await Promise.all([prisma.skill.findMany({ include: skillInclude }), this.velocity()]);
    return rows.map((r) => toDomain(r, velocity));
  }

  async readme(id: string) {
    const row = await prisma.skill.findUnique({ where: { id }, select: { readme: true } });
    return row?.readme ?? null;
  }

  async search(q: string, options: SearchOptions = {}): Promise<SearchResult> {
    return search(await this.cache.get(this), q, options);
  }

  async suggest(q: string, limit = 8): Promise<Suggestion[]> {
    return suggest(await this.cache.get(this), q, limit);
  }

  async upsertMany(items: Array<{ input: SkillCreateInput; authorId: string; authorName: string; securityLevel: SecurityLevel }>) {
    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (const { input, authorId, authorName, securityLevel } of items) {
      const slug = input.slug ?? slugify(`${authorName}-${input.name}`);
      await prisma.user.upsert({ where: { id: authorId }, create: { id: authorId, name: authorName, handle: authorId.replace(/^gh:/, "gh-").toLowerCase(), role: "user" }, update: {} });
      const existing = await prisma.skill.findUnique({ where: { slug }, select: { id: true, securityLevel: true, version: true, name: true, authorId: true, manifest: true } });
      if (existing && existing.authorId !== authorId) {
        skipped += 1;
        continue;
      }
      const data = {
        name: input.name,
        description: input.description,
        version: input.version,
        category: input.category,
        githubStars: input.githubStars ?? 0,
        manifest: input.manifest as unknown as Prisma.InputJsonValue,
        repoUrl: input.repoUrl ?? null,
        tags: input.tags ?? [],
        origin: input.origin ?? "manual",
        source: (input.source ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
        readme: input.readme ?? null,
      };
      if (existing) {
        const level = inheritLevel({ level: existing.securityLevel, manifest: existing.manifest as unknown as SkillManifest }, { manifest: input.manifest, scanned: securityLevel });
        await prisma.skill.update({ where: { id: existing.id }, data: { ...data, securityLevel: level } });
        await this.recordVersion(existing.id, input.version, input.manifest);
        updated += 1;
        if (existing.version !== input.version) await announceRelease({ id: existing.id, slug, name: input.name, version: input.version, securityLevel: level, authorId }, existing.version);
      } else {
        await prisma.skill.create({ data: { ...data, slug, authorId, securityLevel, priceMicros: usdToMicros(input.pricePerCall), stats: { create: {} }, versions: { create: { version: input.version, manifest: data.manifest } } } });
        created += 1;
      }
    }
    return { created, updated, skipped };
  }

  async list(query: SkillQuery) {
    if (query.q?.trim()) {
      const res = await this.search(query.q, { limit: query.limit, offset: query.offset, category: query.category, securityLevel: query.securityLevel, language: query.language, author: query.author, source: query.source, sort: query.sort === "recent" ? "recent" : "relevance" });
      return { items: res.hits.map((h) => h.skill), total: res.total, limit: res.limit, offset: res.offset };
    }
    // Ranking formulas live in TS, so we filter in SQL and rank in memory.
    // At catalogue scale this becomes a materialised `trending_score` column
    // refreshed by the stats cron — the interface does not change.
    const where: Prisma.SkillWhereInput = {
      ...(query.category ? { category: query.category } : {}),
      securityLevel: query.securityLevel && query.securityLevel !== "Quarantine" ? query.securityLevel : { not: "Quarantine" },
      ...(query.source ? { origin: query.source === "github" ? "github" : { not: "github" } } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: "insensitive" } },
              { description: { contains: query.q, mode: "insensitive" } },
              { tags: { has: query.q.toLowerCase() } },
            ],
          }
        : {}),
    };
    const [rows, velocity] = await Promise.all([prisma.skill.findMany({ where, include: skillInclude, take: 5_000 }), this.velocity()]);
    return paginate(sortSkills(rows.map((r) => toDomain(r, velocity)), query.sort === "relevance" ? "trending" : (query.sort ?? "trending")), query);
  }

  async byId(id: string) {
    const [row, velocity] = await Promise.all([prisma.skill.findUnique({ where: { id }, include: skillInclude }), this.velocity([id])]);
    return row ? toDomain(row, velocity) : null;
  }

  async bySlug(slug: string) {
    const row = await prisma.skill.findUnique({ where: { slug }, include: skillInclude });
    return row ? toDomain(row, await this.velocity([row.id])) : null;
  }

  async create(input: SkillCreateInput, authorId: string, securityLevel: SecurityLevel) {
    const author = await prisma.user.findUniqueOrThrow({ where: { id: authorId }, select: { handle: true } });
    const slug = input.slug ?? slugify(`${author.handle ?? "user"}-${input.name}`);
    const row = await prisma.skill.create({
      data: {
        slug,
        name: input.name,
        description: input.description,
        authorId,
        version: input.version,
        category: input.category,
        securityLevel,
        githubStars: input.githubStars ?? 0,
        priceMicros: usdToMicros(input.pricePerCall),
        manifest: input.manifest as unknown as Prisma.InputJsonValue,
        repoUrl: input.repoUrl ?? null,
        tags: input.tags ?? [],
        origin: input.origin ?? "manual",
        source: (input.source ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
        readme: input.readme ?? null,
        stats: { create: {} },
        versions: { create: { version: input.version, manifest: input.manifest as unknown as Prisma.InputJsonValue } },
      },
      include: skillInclude,
    });
    return toDomain(row);
  }

  async setSecurityLevel(id: string, level: SecurityLevel, review: SecurityReview) {
    const existing = await prisma.skill.findUnique({ where: { id }, select: { version: true } });
    if (!existing) return null;
    const [row] = await prisma.$transaction([
      prisma.skill.update({ where: { id }, data: { securityLevel: level }, include: skillInclude }),
      prisma.securityScan.create({
        data: { skillId: id, version: existing.version, level, findings: review.findings as Prisma.InputJsonValue, scannerVersion: review.scannerVersion, reviewedBy: review.reviewerId },
      }),
    ]);
    return toDomain(row);
  }

  async recordInstall(skillId: string, client: string, userId?: string) {
    // The seven-day figure is counted from these rows (`velocity`); the stats column is not incremented any more.
    await prisma.$transaction([
      prisma.install.create({ data: { skillId, client, userId: userId ?? null } }),
      prisma.skill.update({ where: { id: skillId }, data: { downloadsCount: { increment: 1 } } }),
    ]);
  }

  /** A new `SkillVersion` row when the manifest differs from the latest stored one. */
  private async recordVersion(skillId: string, version: string, manifest: SkillManifest) {
    const rows = await prisma.skillVersion.findMany({ where: { skillId }, orderBy: { createdAt: "asc" }, select: { version: true, manifest: true, createdAt: true } });
    const history = rows.map((r) => ({ version: r.version, manifest: r.manifest as unknown as SkillManifest, createdAt: r.createdAt.toISOString() }));
    const next = appendVersion(history, version, manifest, new Date().toISOString());
    const entry = next?.[next.length - 1];
    if (!entry) return;
    await prisma.skillVersion.create({ data: { skillId, version: entry.version, manifest: manifest as unknown as Prisma.InputJsonValue } }).catch((err) => {
      // A concurrent import may have stored the same label first; history is best effort, the import is not.
      console.error("[cortex] version not recorded", err);
    });
  }
}

// Module-level singleton so the store survives HMR in dev. The key carries a shape
// version: bump it when the interface changes so a hot reload never keeps an old instance.
const REPO_KEY = "__synapthRepo_v4";
const g = globalThis as unknown as Record<string, SkillRepository | undefined>;
export const skillRepository: SkillRepository = g[REPO_KEY] ?? (g[REPO_KEY] = hasDatabase ? new PrismaSkillRepository() : new FileSkillRepository());
