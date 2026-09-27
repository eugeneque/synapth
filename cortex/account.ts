/**
 * Cortex · Account profile & preferences
 *
 * What a signed-in developer can edit about themselves: the public identity
 * shown on the profile page (`/u/[handle]`) and the install-target preference
 * the client hooks honour. Same dual store as the rest of Cortex: Prisma when
 * `DATABASE_URL` is set, an in-memory map otherwise.
 *
 * Avatar and cover are stored as `data:image/*;base64` URLs (resized on the
 * client, capped again here), so profiles need no file storage in either mode.
 */

import { z } from "zod";
import { prisma, hasDatabase } from "@/cortex/db";
import { memoryUsers } from "@/cortex/seed";
import { handleSchema, isReservedHandle } from "@/cortex/registration";
import type { InstallTarget } from "@/axon/install";
import { toUserRole, type UserRole } from "@/types/auth";
import { AVATAR_IMAGE, COVER_IMAGE, OCCUPATIONS, dataUrlBytes, isImageDataUrl, isOccupation, type Occupation } from "@/types/profile";
import { httpUrlSchema, isHttpUrl } from "@/lib/url-safety";
import type { AuthorRef } from "@/types/social";
import type { UserVerification } from "@/types/verification";

export const INSTALL_TARGET_IDS = ["cursor", "claude-desktop", "claude-code", "curl"] as const satisfies readonly InstallTarget[];

export interface AccountProfile {
  id: string;
  name: string;
  handle: string;
  email: string | null;
  /** Avatar: OAuth URL, uploaded data URL, or null → initial letter. */
  image: string | null;
  coverImage: string | null;
  role: UserRole;
  /** Builds the platform itself (admin-set flag, not a role). */
  developer: boolean;
  occupation: Occupation | null;
  bio: string;
  organization: string;
  location: string;
  website: string;
  defaultTarget: InstallTarget | null;
  /** Account check mark; null = not verified. */
  verified: UserVerification | null;
  /** ISO timestamp; the in-memory store reports the process start. */
  createdAt: string;
}

/** An uploaded `data:image/*` URL under `maxBytes`, an `https://` URL (OAuth avatars), or null. */
function imageField(maxBytes: number) {
  return z
    .union([z.null(), z.string().trim()])
    .default(null)
    .transform((v) => (v ? v : null))
    .superRefine((v, ctx) => {
      if (v === null) return;
      if (!v.startsWith("data:")) {
        // OAuth avatars arrive as remote URLs; anything that is not plain https is rejected
        // so the value can never end up as a `javascript:`/`data:text/html` image source.
        if (!isHttpUrl(v) || !v.startsWith("https://")) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "expected an https URL or an uploaded image" });
          return;
        }
        if (v.length > 500) ctx.addIssue({ code: z.ZodIssueCode.too_big, maximum: 500, type: "string", inclusive: true, message: "URL too long" });
        return;
      }
      if (!isImageDataUrl(v)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "expected a JPEG, PNG or WebP image" });
        return;
      }
      if (dataUrlBytes(v) > maxBytes) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `image larger than ${Math.round(maxBytes / 1024)} KB` });
    });
}

export const profileUpdateSchema = z.object({
  name: z.string().trim().min(2).max(64),
  handle: handleSchema,
  image: imageField(AVATAR_IMAGE.maxBytes),
  coverImage: imageField(COVER_IMAGE.maxBytes),
  occupation: z.enum(OCCUPATIONS).nullable().default(null),
  bio: z.string().trim().max(280).default(""),
  organization: z.string().trim().max(80).default(""),
  location: z.string().trim().max(80).default(""),
  // `z.string().url()` would accept `javascript:` — this renders as a link on the public profile.
  website: z.union([z.literal(""), httpUrlSchema({ max: 200 })]).default(""),
  defaultTarget: z.enum(INSTALL_TARGET_IDS).nullable().default(null),
});

export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

export class HandleTakenError extends Error {
  status = 409 as const;
  constructor(message = "Handle already taken") {
    super(message);
    this.name = "HandleTakenError";
  }
}

/** In-memory extras that `MemoryUser` does not carry; keyed by user id and versioned like the other singletons. */
interface MemoryExtras {
  coverImage: string | null;
  occupation: Occupation | null;
  bio: string;
  organization: string;
  location: string;
  website: string;
  defaultTarget: InstallTarget | null;
}
const g = globalThis as unknown as { __synapthAccount_v2?: Map<string, MemoryExtras>; __synapthAccountBoot_v2?: string };
const extras = g.__synapthAccount_v2 ?? (g.__synapthAccount_v2 = new Map());
const bootedAt = g.__synapthAccountBoot_v2 ?? (g.__synapthAccountBoot_v2 = new Date().toISOString());
const gv = globalThis as unknown as { __synapthVerified_v1?: Map<string, UserVerification> };
const memoryVerified = gv.__synapthVerified_v1 ?? (gv.__synapthVerified_v1 = new Map());

function verificationFromRow(u: { verifiedAt: Date | null; verifiedById: string | null; verifiedVia: string | null }): UserVerification | null {
  return u.verifiedAt ? { verifiedAt: u.verifiedAt.toISOString(), verifiedBy: u.verifiedById, via: u.verifiedVia === "manual" ? "manual" : "request" } : null;
}

/** Sets or clears the check mark. Callers (cortex/verification.ts) own the permission checks. */
export async function setAccountVerification(userId: string, value: UserVerification | null): Promise<void> {
  if (!hasDatabase) {
    if (value) memoryVerified.set(userId, value);
    else memoryVerified.delete(userId);
    return;
  }
  await prisma.user.update({ where: { id: userId }, data: value ? { verifiedAt: new Date(value.verifiedAt), verifiedById: value.verifiedBy, verifiedVia: value.via } : { verifiedAt: null, verifiedById: null, verifiedVia: null } });
}

/** Test helper for the in-memory store. */
export function resetAccountVerificationForTests() {
  memoryVerified.clear();
}

function isTarget(value: string | null | undefined): value is InstallTarget {
  return (INSTALL_TARGET_IDS as readonly string[]).includes(value ?? "");
}

export async function getProfile(userId: string): Promise<AccountProfile | null> {
  if (!hasDatabase) {
    const u = memoryUsers.find((m) => m.id === userId);
    if (!u) return null;
    const x = extras.get(userId);
    return {
      id: u.id,
      name: u.name,
      handle: u.handle,
      email: u.email,
      image: u.image,
      coverImage: x?.coverImage ?? null,
      role: u.role,
      developer: Boolean(u.developer),
      occupation: x?.occupation ?? null,
      bio: x?.bio ?? "",
      organization: x?.organization ?? "",
      location: x?.location ?? "",
      website: x?.website ?? "",
      defaultTarget: x?.defaultTarget ?? null,
      verified: memoryVerified.get(u.id) ?? null,
      createdAt: bootedAt,
    };
  }
  const u = await prisma.user.findUnique({ where: { id: userId } });
  if (!u) return null;
  return {
    id: u.id,
    name: u.name ?? "",
    handle: u.handle ?? "",
    email: u.email,
    image: u.image,
    coverImage: u.coverImage,
    role: toUserRole(u.role),
    developer: u.developer,
    occupation: isOccupation(u.occupation) ? u.occupation : null,
    bio: u.bio ?? "",
    organization: u.organization ?? "",
    location: u.location ?? "",
    website: u.website ?? "",
    defaultTarget: isTarget(u.defaultTarget) ? u.defaultTarget : null,
    verified: verificationFromRow(u),
    createdAt: u.createdAt.toISOString(),
  };
}

export async function updateProfile(userId: string, raw: unknown): Promise<AccountProfile> {
  const input = profileUpdateSchema.parse(raw);
  // Reserved names stay with whoever already holds them (the platform account), nobody can switch to one.
  if (isReservedHandle(input.handle) && (await getProfile(userId))?.handle !== input.handle) throw new HandleTakenError("This handle is reserved");

  if (!hasDatabase) {
    const u = memoryUsers.find((m) => m.id === userId);
    if (!u) throw new Error("User not found");
    if (memoryUsers.some((m) => m.id !== userId && m.handle === input.handle)) throw new HandleTakenError();
    u.name = input.name;
    u.handle = input.handle;
    u.image = input.image;
    extras.set(userId, {
      coverImage: input.coverImage,
      occupation: input.occupation,
      bio: input.bio,
      organization: input.organization,
      location: input.location,
      website: input.website,
      defaultTarget: input.defaultTarget,
    });
    return (await getProfile(userId))!;
  }

  const clash = await prisma.user.findFirst({ where: { handle: { equals: input.handle, mode: "insensitive" }, NOT: { id: userId } }, select: { id: true } });
  if (clash) throw new HandleTakenError();
  await prisma.user.update({
    where: { id: userId },
    data: {
      name: input.name,
      handle: input.handle,
      image: input.image,
      coverImage: input.coverImage,
      occupation: input.occupation,
      bio: input.bio || null,
      organization: input.organization || null,
      location: input.location || null,
      website: input.website || null,
      defaultTarget: input.defaultTarget,
    },
  });
  return (await getProfile(userId))!;
}

/** Public lookup for the profile page: a crawled GitHub owner may also be a registered developer. */
export async function getProfileByHandle(handle: string): Promise<AccountProfile | null> {
  const needle = handle.toLowerCase();
  if (!hasDatabase) {
    const u = memoryUsers.find((m) => m.handle.toLowerCase() === needle);
    return u ? getProfile(u.id) : null;
  }
  const u = await prisma.user.findFirst({ where: { handle: { equals: needle, mode: "insensitive" } }, select: { id: true } });
  return u ? getProfile(u.id) : null;
}

/** Batch lookup of the attribution card (`AuthorRef`) for feeds, comments and notifications; unknown ids are skipped. */
export async function getAuthorRefs(ids: Iterable<string>): Promise<Map<string, AuthorRef>> {
  const unique = [...new Set(ids)];
  const out = new Map<string, AuthorRef>();
  if (!unique.length) return out;
  if (!hasDatabase) {
    for (const u of memoryUsers) {
      if (unique.includes(u.id)) out.set(u.id, { id: u.id, name: u.name, handle: u.handle, image: u.image, occupation: extras.get(u.id)?.occupation ?? null, verified: memoryVerified.has(u.id) });
    }
    return out;
  }
  const rows = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, handle: true, image: true, occupation: true, verifiedAt: true } });
  for (const r of rows) out.set(r.id, { id: r.id, name: r.name ?? "", handle: r.handle ?? "", image: r.image, occupation: isOccupation(r.occupation) ? r.occupation : null, verified: Boolean(r.verifiedAt) });
  return out;
}

/** Batch lookup by handle (case-insensitive) for @mentions; keys are lowercased handles, unknown ones are skipped. */
export async function getAuthorRefsByHandles(handles: Iterable<string>): Promise<Map<string, AuthorRef>> {
  const wanted = [...new Set([...handles].map((h) => h.toLowerCase()))].filter((h) => h && !h.startsWith("gh-")).slice(0, 100);
  const out = new Map<string, AuthorRef>();
  if (!wanted.length) return out;
  let ids: string[];
  if (!hasDatabase) ids = memoryUsers.filter((u) => wanted.includes(u.handle.toLowerCase())).map((u) => u.id);
  else ids = (await prisma.user.findMany({ where: { OR: wanted.map((h) => ({ handle: { equals: h, mode: "insensitive" as const } })) }, select: { id: true } })).map((r) => r.id);
  for (const ref of (await getAuthorRefs(ids)).values()) out.set(ref.handle.toLowerCase(), ref);
  return out;
}

export async function getAuthorRef(id: string): Promise<AuthorRef | null> {
  return (await getAuthorRefs([id])).get(id) ?? null;
}

/** A people-search hit: the attribution card plus the one-line bio. */
export type ProfileHit = AuthorRef & { bio: string };

/**
 * People search by name, handle, bio or organization (case-insensitive
 * substring). An empty query lists the newest members. Crawler placeholders
 * (`gh-…` handles) are not people and never show up.
 */
export async function searchProfiles(rawQuery: string, limit = 40): Promise<ProfileHit[]> {
  const q = rawQuery.trim().replace(/^@/, "").toLowerCase().slice(0, 80);
  const take = Math.min(Math.max(limit, 1), 100);
  if (!hasDatabase) {
    const hits = memoryUsers
      .filter((u) => !u.handle.startsWith("gh-"))
      .map((u) => ({ u, x: extras.get(u.id) }))
      .filter(({ u, x }) => !q || [u.name, u.handle, x?.bio ?? "", x?.organization ?? ""].some((f) => f.toLowerCase().includes(q)))
      // Handle prefix matches first, then name order.
      .sort((a, b) => Number(b.u.handle.toLowerCase().startsWith(q)) - Number(a.u.handle.toLowerCase().startsWith(q)) || a.u.name.localeCompare(b.u.name))
      .slice(0, take);
    return hits.map(({ u, x }) => ({ id: u.id, name: u.name, handle: u.handle, image: u.image, occupation: x?.occupation ?? null, verified: memoryVerified.has(u.id), bio: x?.bio ?? "" }));
  }
  const contains = { contains: q, mode: "insensitive" as const };
  const rows = await prisma.user.findMany({
    where: { handle: { not: null }, NOT: { handle: { startsWith: "gh-" } }, ...(q ? { OR: [{ name: contains }, { handle: contains }, { bio: contains }, { organization: contains }] } : {}) },
    orderBy: q ? { name: "asc" } : { createdAt: "desc" },
    take,
    select: { id: true, name: true, handle: true, image: true, occupation: true, verifiedAt: true, bio: true },
  });
  return rows
    .map((r) => ({ id: r.id, name: r.name ?? "", handle: r.handle ?? "", image: r.image, occupation: isOccupation(r.occupation) ? r.occupation : null, verified: Boolean(r.verifiedAt), bio: r.bio ?? "" }))
    .sort((a, b) => (q ? Number(b.handle.toLowerCase().startsWith(q)) - Number(a.handle.toLowerCase().startsWith(q)) : 0));
}
