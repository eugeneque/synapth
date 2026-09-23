/**
 * Cortex · Skillsets
 *
 * Hand-made bundles of catalogue entries that install with one command
 * (`types/skillset.ts`). Authors create and edit them on the platform; the
 * crawler never touches this store. Every composition change is written to
 * the history log one skill at a time, favorites are a per-user toggle, and
 * `verified` is a staff decision (`catalog.verify`) that is dropped as soon as
 * the composition changes.
 *
 * Description images are uploaded separately (`uploadSkillsetImage`) and
 * referenced from the markdown by `SKILLSET_IMAGE_PATH<id>`, so the text column
 * stays small and the renderer only has to allow one same-origin path.
 *
 * Dual store like the rest of Cortex: Prisma with a database, arrays on
 * `globalThis` otherwise.
 */

import { z } from "zod";
import { prisma, hasDatabase } from "@/cortex/db";
import { getAuthorRefs } from "@/cortex/account";
import { skillRepository } from "@/cortex/repository";
import { notify, notifyMany } from "@/cortex/notifications";
import { requirePermission } from "@/cortex/roles";
import { seedSkillsetChanges, seedSkillsetFavorites, seedSkillsetItems, seedSkillsets } from "@/cortex/seed";
import { slugify } from "@/lib/utils";
import { dataUrlBytes, isImageDataUrl } from "@/types/profile";
import type { Skill, SkillCategory } from "@/types/skill";
import type { AuthorRef } from "@/types/social";
import {
  SKILLSET_AVATAR,
  SKILLSET_DESCRIPTION_MAX,
  SKILLSET_IMAGE,
  SKILLSET_IMAGE_PATH,
  SKILLSET_ITEMS_MAX,
  SKILLSET_NAME_MAX,
  SKILLSET_SUMMARY_MAX,
  type Skillset,
  type SkillsetChange,
  type SkillsetChangeAction,
  type SkillsetField,
  type SkillsetQuery,
  type SkillsetSkillRef,
  type SkillsetSummary,
} from "@/types/skillset";

export class SkillsetError extends Error {
  status: 400 | 403 | 404 | 409;
  constructor(message: string, status: 400 | 403 | 404 | 409 = 400) {
    super(message);
    this.name = "SkillsetError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const avatarSchema = z
  .union([z.null(), z.string().trim()])
  .default(null)
  .transform((v) => v || null)
  .superRefine((v, ctx) => {
    if (v === null) return;
    if (!isImageDataUrl(v)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "expected a JPEG, PNG or WebP image" });
    else if (dataUrlBytes(v) > SKILLSET_AVATAR.maxBytes) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `image larger than ${Math.round(SKILLSET_AVATAR.maxBytes / 1024)} KB` });
  });

export const skillsetInputSchema = z.object({
  name: z.string().trim().min(2).max(SKILLSET_NAME_MAX),
  summary: z.string().trim().max(SKILLSET_SUMMARY_MAX).default(""),
  description: z.string().max(SKILLSET_DESCRIPTION_MAX).default(""),
  avatar: avatarSchema,
  skillIds: z
    .array(z.string().min(1).max(120))
    .max(SKILLSET_ITEMS_MAX, `A skillset holds at most ${SKILLSET_ITEMS_MAX} entries`)
    .default([])
    .transform((ids) => [...new Set(ids)]),
});
export type SkillsetInput = z.input<typeof skillsetInputSchema>;

/** Route segments under /skillsets that a slug must not shadow. */
const RESERVED_SLUGS = new Set(["new", "edit", "images"]);

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

interface SetRow {
  id: string;
  slug: string;
  name: string;
  summary: string;
  description: string;
  avatar: string | null;
  authorId: string;
  verified: boolean;
  verifiedById: string | null;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
interface ItemRow {
  skillsetId: string;
  skillId: string;
  position: number;
  addedById: string;
  addedAt: string;
}
interface ChangeRow {
  id: string;
  skillsetId: string;
  actorId: string | null;
  action: SkillsetChangeAction;
  skillId: string | null;
  skillName: string | null;
  skillSlug: string | null;
  fields: SkillsetField[];
  auto: boolean;
  createdAt: string;
}
interface FavoriteRow {
  userId: string;
  skillsetId: string;
  createdAt: string;
}
interface ImageRow {
  id: string;
  ownerId: string;
  mime: string;
  data: string;
  bytes: number;
  createdAt: string;
}
interface MemoryStore {
  sets: SetRow[];
  items: ItemRow[];
  changes: ChangeRow[];
  favorites: FavoriteRow[];
  images: ImageRow[];
}

const g = globalThis as unknown as { __synapthSkillsets_v1?: MemoryStore };
const mem: MemoryStore =
  g.__synapthSkillsets_v1 ??
  (g.__synapthSkillsets_v1 = { sets: seedSkillsets.map((s) => ({ ...s })), items: seedSkillsetItems.map((i) => ({ ...i })), changes: seedSkillsetChanges.map((c) => ({ ...c })), favorites: [...seedSkillsetFavorites], images: [] });

const newId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
const now = () => new Date().toISOString();
const unknownAuthor = (id: string): AuthorRef => ({ id, name: "Unknown", handle: id, image: null, occupation: null });

type DbSet = { id: string; slug: string; name: string; summary: string; description: string; avatar: string | null; authorId: string; verified: boolean; verifiedById: string | null; verifiedAt: Date | null; createdAt: Date; updatedAt: Date };
const setFromDb = (r: DbSet): SetRow => ({ ...r, verifiedAt: r.verifiedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() });

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function findSetRow(idOrSlug: string): Promise<SetRow | null> {
  if (!hasDatabase) return mem.sets.find((s) => s.id === idOrSlug || s.slug === idOrSlug) ?? null;
  const row = await prisma.skillset.findFirst({ where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] } });
  return row ? setFromDb(row) : null;
}

async function itemRows(skillsetIds: string[]): Promise<ItemRow[]> {
  if (!skillsetIds.length) return [];
  if (!hasDatabase) return mem.items.filter((i) => skillsetIds.includes(i.skillsetId)).sort((a, b) => a.position - b.position);
  const rows = await prisma.skillsetItem.findMany({ where: { skillsetId: { in: skillsetIds } }, orderBy: { position: "asc" } });
  return rows.map((r) => ({ skillsetId: r.skillsetId, skillId: r.skillId, position: r.position, addedById: r.addedById, addedAt: r.addedAt.toISOString() }));
}

async function favoriteCounts(skillsetIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!skillsetIds.length) return out;
  if (!hasDatabase) {
    for (const f of mem.favorites) if (skillsetIds.includes(f.skillsetId)) out.set(f.skillsetId, (out.get(f.skillsetId) ?? 0) + 1);
    return out;
  }
  const grouped = await prisma.skillsetFavorite.groupBy({ by: ["skillsetId"], where: { skillsetId: { in: skillsetIds } }, _count: { _all: true } });
  for (const row of grouped) out.set(row.skillsetId, row._count._all);
  return out;
}

async function loadSkills(ids: Iterable<string>): Promise<Map<string, Skill>> {
  const unique = [...new Set(ids)];
  const found = await Promise.all(unique.map((id) => skillRepository.byId(id)));
  const out = new Map<string, Skill>();
  for (const skill of found) if (skill) out.set(skill.id, skill);
  return out;
}

const skillRef = (s: Skill): SkillsetSkillRef => ({ id: s.id, slug: s.slug, name: s.name, description: s.description, category: s.category, securityLevel: s.securityLevel, version: s.version, authorName: s.authorName });

async function hydrate(row: SetRow): Promise<Skillset> {
  const [items, favorites] = await Promise.all([itemRows([row.id]), favoriteCounts([row.id])]);
  const [people, skills] = await Promise.all([getAuthorRefs([row.authorId, ...(row.verifiedById ? [row.verifiedById] : [])]), loadSkills(items.map((i) => i.skillId))]);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    summary: row.summary,
    description: row.description,
    avatar: row.avatar,
    author: people.get(row.authorId) ?? unknownAuthor(row.authorId),
    items: items.map((i) => {
      const skill = skills.get(i.skillId);
      return { skill: skill ? skillRef(skill) : null, skillId: i.skillId, addedAt: i.addedAt, addedBy: i.addedById };
    }),
    verified: row.verified,
    verifiedBy: row.verifiedById ? (people.get(row.verifiedById) ?? null) : null,
    verifiedAt: row.verifiedAt,
    favorites: favorites.get(row.id) ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function summarize(rows: SetRow[]): Promise<SkillsetSummary[]> {
  const ids = rows.map((r) => r.id);
  const [items, favorites, people] = await Promise.all([itemRows(ids), favoriteCounts(ids), getAuthorRefs(rows.map((r) => r.authorId))]);
  const skills = await loadSkills(items.map((i) => i.skillId));
  return rows.map((r) => {
    const counts: Record<SkillCategory, number> = { MCP: 0, Prompt: 0, Tool: 0 };
    for (const i of items) {
      const skill = i.skillsetId === r.id ? skills.get(i.skillId) : undefined;
      if (skill) counts[skill.category] += 1;
    }
    return { id: r.id, slug: r.slug, name: r.name, summary: r.summary, avatar: r.avatar, author: people.get(r.authorId) ?? unknownAuthor(r.authorId), verified: r.verified, favorites: favorites.get(r.id) ?? 0, counts, createdAt: r.createdAt, updatedAt: r.updatedAt };
  });
}

export async function getSkillset(idOrSlug: string): Promise<Skillset | null> {
  const row = await findSetRow(idOrSlug);
  return row ? hydrate(row) : null;
}

/** The catalogue entries of a set, in order — what the installer and the agent API need in full. */
export async function skillsetSkills(set: Pick<Skillset, "items">): Promise<Skill[]> {
  const skills = await loadSkills(set.items.map((i) => i.skillId));
  return set.items.map((i) => skills.get(i.skillId)).filter((s): s is Skill => Boolean(s));
}

export async function listSkillsets(query: SkillsetQuery = {}): Promise<SkillsetSummary[]> {
  const limit = Math.min(Math.max(query.limit ?? 60, 1), 200);
  const q = query.q?.trim().toLowerCase() ?? "";
  let rows: SetRow[];
  if (!hasDatabase) {
    const containing = query.skillId ? new Set(mem.items.filter((i) => i.skillId === query.skillId).map((i) => i.skillsetId)) : null;
    rows = mem.sets.filter(
      (s) =>
        (query.verified === undefined || s.verified === query.verified) &&
        (!query.authorId || s.authorId === query.authorId) &&
        (!containing || containing.has(s.id)) &&
        (!q || `${s.name} ${s.summary} ${s.slug}`.toLowerCase().includes(q)),
    );
  } else {
    const found = await prisma.skillset.findMany({
      where: {
        ...(query.verified === undefined ? {} : { verified: query.verified }),
        ...(query.authorId ? { authorId: query.authorId } : {}),
        ...(query.skillId ? { items: { some: { skillId: query.skillId } } } : {}),
        ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { summary: { contains: q, mode: "insensitive" as const } }, { slug: { contains: q, mode: "insensitive" as const } }] } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 500,
    });
    rows = found.map(setFromDb);
  }

  const summaries = await summarize(rows);
  const sort = query.sort ?? "recent";
  summaries.sort((a, b) =>
    sort === "popular" ? b.favorites - a.favorites || b.updatedAt.localeCompare(a.updatedAt) : sort === "updated" ? b.updatedAt.localeCompare(a.updatedAt) : b.createdAt.localeCompare(a.createdAt),
  );
  return summaries.slice(0, limit);
}

/** Newest first. */
export async function skillsetHistory(skillsetId: string, limit = 100): Promise<SkillsetChange[]> {
  let rows: ChangeRow[];
  if (!hasDatabase) {
    rows = mem.changes.filter((c) => c.skillsetId === skillsetId).reverse().slice(0, limit);
  } else {
    const found = await prisma.skillsetChange.findMany({ where: { skillsetId }, orderBy: { seq: "desc" }, take: limit });
    rows = found.map((r) => ({ ...r, action: r.action as SkillsetChangeAction, fields: r.fields as SkillsetField[], createdAt: r.createdAt.toISOString() }));
  }
  const people = await getAuthorRefs(rows.map((r) => r.actorId).filter((id): id is string => Boolean(id)));
  return rows.map((r) => ({ id: r.id, skillsetId: r.skillsetId, actor: r.actorId ? (people.get(r.actorId) ?? null) : null, action: r.action, skillId: r.skillId, skillName: r.skillName, skillSlug: r.skillSlug, fields: r.fields, auto: r.auto, createdAt: r.createdAt }));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

type ChangeInput = Omit<ChangeRow, "id" | "skillsetId" | "createdAt" | "skillId" | "skillName" | "skillSlug" | "fields" | "auto"> & Partial<Pick<ChangeRow, "skillId" | "skillName" | "skillSlug" | "fields" | "auto">>;

/** Appends history lines in order. Reads sort by insertion (array order / the `seq` column), not by timestamp, so a batch keeps its sequence. */
async function logChanges(skillsetId: string, changes: ChangeInput[]): Promise<void> {
  if (!changes.length) return;
  const at = now();
  const rows: ChangeRow[] = changes.map((c) => ({ id: newId("ssc"), skillsetId, skillId: null, skillName: null, skillSlug: null, fields: [], auto: false, ...c, createdAt: at }));
  if (!hasDatabase) {
    mem.changes.push(...rows);
    return;
  }
  await prisma.skillsetChange.createMany({ data: rows.map(({ id: _id, ...r }) => ({ ...r, createdAt: new Date(r.createdAt) })) });
}

async function slugTaken(slug: string): Promise<boolean> {
  if (RESERVED_SLUGS.has(slug)) return true;
  if (!hasDatabase) return mem.sets.some((s) => s.slug === slug);
  return Boolean(await prisma.skillset.findUnique({ where: { slug }, select: { id: true } }));
}

/** Cyrillic → Latin, so "Разработка игр" becomes `razrabotka-igr` instead of an empty slug. */
const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", ґ: "g", д: "d", е: "e", ё: "e", є: "ye", ж: "zh", з: "z", и: "i", і: "i", ї: "yi", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};
export const transliterate = (text: string) => text.toLowerCase().replace(/[а-яёґєії]/g, (c) => TRANSLIT[c] ?? "");

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(transliterate(name)) || "skillset";
  if (!(await slugTaken(base))) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base.slice(0, 58)}-${n}`;
    if (!(await slugTaken(candidate))) return candidate;
  }
  return `${base.slice(0, 50)}-${Date.now().toString(36)}`;
}

/** Every id must name a catalogue entry; returns them in the requested order. */
async function resolveSkills(ids: string[]): Promise<Skill[]> {
  const skills = await loadSkills(ids);
  const missing = ids.filter((id) => !skills.has(id));
  if (missing.length) throw new SkillsetError(`Unknown catalogue entries: ${missing.slice(0, 3).join(", ")}`, 404);
  return ids.map((id) => skills.get(id)!);
}

const skillFacts = (s: Skill) => ({ skillId: s.id, skillName: s.name, skillSlug: s.slug });

export async function createSkillset(authorId: string, raw: unknown): Promise<Skillset> {
  const input = skillsetInputSchema.parse(raw);
  const skills = await resolveSkills(input.skillIds);
  const slug = await uniqueSlug(input.name);
  const at = now();

  let row: SetRow;
  if (!hasDatabase) {
    row = { id: newId("sks"), slug, name: input.name, summary: input.summary, description: input.description, avatar: input.avatar, authorId, verified: false, verifiedById: null, verifiedAt: null, createdAt: at, updatedAt: at };
    mem.sets.push(row);
    mem.items.push(...skills.map((s, position) => ({ skillsetId: row.id, skillId: s.id, position, addedById: authorId, addedAt: at })));
  } else {
    row = setFromDb(
      await prisma.skillset.create({
        data: {
          slug,
          name: input.name,
          summary: input.summary,
          description: input.description,
          avatar: input.avatar,
          authorId,
          items: { create: skills.map((s, position) => ({ skillId: s.id, position, addedById: authorId })) },
        },
      }),
    );
  }

  await logChanges(row.id, [{ actorId: authorId, action: "created" }, ...skills.map((s) => ({ actorId: authorId, action: "added" as const, ...skillFacts(s) }))]);
  return hydrate(row);
}

function assertAuthor(row: SetRow, userId: string) {
  if (row.authorId !== userId) throw new SkillsetError("Only the author can edit this skillset", 403);
}

/**
 * Author-only. Metadata edits are logged as one `edited` line naming the
 * fields; every added or removed entry gets its own line. A composition change
 * drops `verified` (logged as an automatic `unverified`) and tells everyone
 * who favorited the set.
 */
export async function updateSkillset(actorId: string, idOrSlug: string, raw: unknown): Promise<Skillset> {
  const row = await findSetRow(idOrSlug);
  if (!row) throw new SkillsetError("Skillset not found", 404);
  assertAuthor(row, actorId);
  const input = skillsetInputSchema.parse(raw);

  const current = (await itemRows([row.id])).map((i) => i.skillId);
  const addedIds = input.skillIds.filter((id) => !current.includes(id));
  const removedIds = current.filter((id) => !input.skillIds.includes(id));
  const added = await resolveSkills(addedIds);
  // Removed entries may already be gone from the catalogue; the history keeps whatever is known.
  const removedSkills = await loadSkills(removedIds);
  const reordered = !addedIds.length && !removedIds.length && current.join() !== input.skillIds.join();

  const fields = (["name", "summary", "description", "avatar"] as const).filter((f) => (row[f] ?? null) !== (input[f] ?? null));
  const composition = addedIds.length > 0 || removedIds.length > 0;
  if (!fields.length && !composition && !reordered) return hydrate(row);

  const at = now();
  const unverify = composition && row.verified;
  const patch = { name: input.name, summary: input.summary, description: input.description, avatar: input.avatar, ...(unverify ? { verified: false, verifiedById: null, verifiedAt: null } : {}) };
  const order = (skillId: string) => input.skillIds.indexOf(skillId);

  if (!hasDatabase) {
    Object.assign(row, patch, { updatedAt: at });
    mem.items = mem.items.filter((i) => i.skillsetId !== row.id || input.skillIds.includes(i.skillId));
    for (const i of mem.items) if (i.skillsetId === row.id) i.position = order(i.skillId);
    mem.items.push(...added.map((s) => ({ skillsetId: row.id, skillId: s.id, position: order(s.id), addedById: actorId, addedAt: at })));
  } else {
    await prisma.$transaction([
      prisma.skillsetItem.deleteMany({ where: { skillsetId: row.id, skillId: { in: removedIds } } }),
      ...current.filter((id) => input.skillIds.includes(id)).map((skillId) => prisma.skillsetItem.update({ where: { skillsetId_skillId: { skillsetId: row.id, skillId } }, data: { position: order(skillId) } })),
      prisma.skillsetItem.createMany({ data: added.map((s) => ({ skillsetId: row.id, skillId: s.id, position: order(s.id), addedById: actorId })) }),
      prisma.skillset.update({ where: { id: row.id }, data: patch }),
    ]);
    Object.assign(row, patch, { updatedAt: at });
  }

  await logChanges(row.id, [
    ...(fields.length ? [{ actorId, action: "edited" as const, fields: [...fields] }] : []),
    ...added.map((s) => ({ actorId, action: "added" as const, ...skillFacts(s) })),
    ...removedIds.map((id) => {
      const s = removedSkills.get(id);
      return { actorId, action: "removed" as const, skillId: id, skillName: s?.name ?? null, skillSlug: s?.slug ?? null };
    }),
    ...(unverify ? [{ actorId: null, action: "unverified" as const, auto: true }] : []),
  ]);

  if (composition) {
    await notifyMany((await favoritedBy(row.id)).filter((id) => id !== actorId), {
      kind: "skillset.updated",
      actorId,
      subject: { kind: "skillset.updated", skillsetId: row.id, slug: row.slug, name: row.name, added: addedIds.length, removed: removedIds.length },
    });
  }
  return hydrate(row);
}

/** Authors delete their own sets; holders of `content.moderate` delete any. History, items and favorites go with it. */
export async function deleteSkillset(actorId: string, idOrSlug: string, { moderator = false }: { moderator?: boolean } = {}): Promise<void> {
  const row = await findSetRow(idOrSlug);
  if (!row) throw new SkillsetError("Skillset not found", 404);
  if (row.authorId !== actorId && !moderator) throw new SkillsetError("Only the author can delete this skillset", 403);
  if (!hasDatabase) {
    mem.sets = mem.sets.filter((s) => s.id !== row.id);
    mem.items = mem.items.filter((i) => i.skillsetId !== row.id);
    mem.changes = mem.changes.filter((c) => c.skillsetId !== row.id);
    mem.favorites = mem.favorites.filter((f) => f.skillsetId !== row.id);
    return;
  }
  await prisma.skillset.delete({ where: { id: row.id } });
}

/** Staff decision (`catalog.verify`). Logged in the history; the author is notified. */
export async function setSkillsetVerification(actorId: string, idOrSlug: string, verified: boolean): Promise<Skillset> {
  await requirePermission(actorId, "catalog.verify");
  const row = await findSetRow(idOrSlug);
  if (!row) throw new SkillsetError("Skillset not found", 404);
  if (row.verified === verified) return hydrate(row);
  if (verified && !(await itemRows([row.id])).length) throw new SkillsetError("An empty skillset cannot be verified", 409);

  const patch = verified ? { verified: true, verifiedById: actorId, verifiedAt: now() } : { verified: false, verifiedById: null, verifiedAt: null };
  if (!hasDatabase) Object.assign(row, patch);
  else await prisma.skillset.update({ where: { id: row.id }, data: { ...patch, verifiedAt: patch.verifiedAt ? new Date(patch.verifiedAt) : null } });

  await logChanges(row.id, [{ actorId, action: verified ? "verified" : "unverified" }]);
  await notify({ userId: row.authorId, kind: "skillset.verified", actorId, subject: { kind: "skillset.verified", skillsetId: row.id, slug: row.slug, name: row.name, verified } });
  return hydrate(row);
}

// ---------------------------------------------------------------------------
// Favorites
// ---------------------------------------------------------------------------

export interface FavoriteSummary {
  favorites: number;
  favorited: boolean;
}

export async function favoriteSummary(skillsetId: string, viewerId?: string | null): Promise<FavoriteSummary> {
  if (!hasDatabase) {
    const list = mem.favorites.filter((f) => f.skillsetId === skillsetId);
    return { favorites: list.length, favorited: Boolean(viewerId) && list.some((f) => f.userId === viewerId) };
  }
  const [favorites, mine] = await Promise.all([
    prisma.skillsetFavorite.count({ where: { skillsetId } }),
    viewerId ? prisma.skillsetFavorite.findUnique({ where: { userId_skillsetId: { userId: viewerId, skillsetId } }, select: { userId: true } }) : Promise.resolve(null),
  ]);
  return { favorites, favorited: Boolean(mine) };
}

export async function toggleFavorite(userId: string, idOrSlug: string): Promise<FavoriteSummary> {
  const row = await findSetRow(idOrSlug);
  if (!row) throw new SkillsetError("Skillset not found", 404);
  if (!hasDatabase) {
    const i = mem.favorites.findIndex((f) => f.userId === userId && f.skillsetId === row.id);
    if (i >= 0) mem.favorites.splice(i, 1);
    else mem.favorites.push({ userId, skillsetId: row.id, createdAt: now() });
  } else {
    const key = { userId_skillsetId: { userId, skillsetId: row.id } };
    const existing = await prisma.skillsetFavorite.findUnique({ where: key });
    if (existing) await prisma.skillsetFavorite.delete({ where: key });
    else await prisma.skillsetFavorite.create({ data: { userId, skillsetId: row.id } });
  }
  return favoriteSummary(row.id, userId);
}

async function favoritedBy(skillsetId: string): Promise<string[]> {
  if (!hasDatabase) return mem.favorites.filter((f) => f.skillsetId === skillsetId).map((f) => f.userId);
  return (await prisma.skillsetFavorite.findMany({ where: { skillsetId }, select: { userId: true } })).map((r) => r.userId);
}

/** The user's favorites, most recently added first. */
export async function listFavoriteSkillsets(userId: string): Promise<SkillsetSummary[]> {
  let ids: string[];
  if (!hasDatabase) ids = mem.favorites.filter((f) => f.userId === userId).reverse().map((f) => f.skillsetId);
  else ids = (await prisma.skillsetFavorite.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, select: { skillsetId: true } })).map((r) => r.skillsetId);
  if (!ids.length) return [];
  const rows = !hasDatabase ? mem.sets.filter((s) => ids.includes(s.id)) : (await prisma.skillset.findMany({ where: { id: { in: ids } } })).map(setFromDb);
  const summaries = await summarize(rows);
  return ids.map((id) => summaries.find((s) => s.id === id)).filter((s): s is SkillsetSummary => Boolean(s));
}

// ---------------------------------------------------------------------------
// Description images
// ---------------------------------------------------------------------------

const imageSchema = z.string().refine(isImageDataUrl, "expected a JPEG, PNG or WebP image").refine((v) => dataUrlBytes(v) <= SKILLSET_IMAGE.maxBytes, `image larger than ${Math.round(SKILLSET_IMAGE.maxBytes / 1024)} KB`);

/** Stores an uploaded description image; the markdown references the returned `url`. */
export async function uploadSkillsetImage(ownerId: string, dataUrl: unknown): Promise<{ id: string; url: string }> {
  const value = imageSchema.parse(dataUrl);
  const comma = value.indexOf(",");
  const mime = value.slice("data:".length, value.indexOf(";"));
  const data = value.slice(comma + 1);
  const bytes = dataUrlBytes(value);
  let id: string;
  if (!hasDatabase) {
    id = newId("img");
    mem.images.push({ id, ownerId, mime, data, bytes, createdAt: now() });
  } else {
    id = (await prisma.skillsetImage.create({ data: { ownerId, mime, data, bytes }, select: { id: true } })).id;
  }
  return { id, url: `${SKILLSET_IMAGE_PATH}${id}` };
}

export async function getSkillsetImage(id: string): Promise<{ mime: string; body: Buffer } | null> {
  const row = !hasDatabase ? mem.images.find((i) => i.id === id) : await prisma.skillsetImage.findUnique({ where: { id }, select: { mime: true, data: true } });
  return row ? { mime: row.mime, body: Buffer.from(row.data, "base64") } : null;
}

/** Test helper for the in-memory store. */
export function resetSkillsetsForTests() {
  mem.sets.length = 0;
  mem.items.length = 0;
  mem.changes.length = 0;
  mem.favorites.length = 0;
  mem.images.length = 0;
}
