/**
 * Cortex · User card
 *
 * The compact profile summary behind the avatar hover card: identity, a few
 * headline numbers, the viewer's impulse state and the achievement meter.
 * Everything here is already public on `/u/<handle>`.
 */

import { getProfileByHandle } from "@/cortex/account";
import { listBadges } from "@/cortex/badges";
import { skillRepository } from "@/cortex/repository";
import { getProStatuses } from "@/cortex/subscription-store";
import { impulseSummary, socialSignals, type ImpulseSummary } from "@/cortex/social";
import { safeExternalHref, safeImageSrc } from "@/lib/url-safety";
import { meterBadgeCount, type BadgeTier } from "@/types/badges";
import { publicRole, type UserRole } from "@/types/auth";
import type { Occupation } from "@/types/profile";
import type { ProStatus } from "@/types/billing";
import type { ImpulseViewer } from "@/types/social";

export interface UserCard {
  id: string;
  handle: string;
  name: string;
  image: string | null;
  coverImage: string | null;
  occupation: Occupation | null;
  /** `publicRole()` — an admin is shown as a plain user. */
  role: Exclude<UserRole, "admin">;
  developer: boolean;
  /** Account check mark. */
  verified: boolean;
  /** The Pro mark and «subscriber since». */
  pro: ProStatus | null;
  bio: string;
  website: string | null;
  githubOwner: string | null;
  stats: { skills: number; posts: number; installs: number };
  impulses: ImpulseSummary;
  /** How the requester relates to this user — decides what the impulse control does. */
  viewer: ImpulseViewer;
  /** Earned badge tiers in award order, plus the size of the catalogue for the meter. */
  badges: { tiers: BadgeTier[]; total: number };
}

export async function getUserCard(handle: string, viewerId: string | null): Promise<UserCard | null> {
  const profile = await getProfileByHandle(handle.toLowerCase());
  if (!profile) return null;
  const [all, social, impulses, badges, pro] = await Promise.all([skillRepository.all(), socialSignals(profile.id), impulseSummary(profile.id, viewerId), listBadges(profile.id), getProStatuses([profile.id])]);
  // Same merge as the profile page: platform-published plus crawled under the same GitHub owner.
  const skills = all.filter((s) => s.authorId === profile.id || s.source?.owner.toLowerCase() === profile.handle.toLowerCase());
  const githubOwner = skills.find((s) => s.source)?.source?.owner ?? null;
  const image = profile.image ?? skills.find((s) => s.source?.avatarUrl)?.source?.avatarUrl ?? null;
  return {
    id: profile.id,
    handle: profile.handle,
    name: profile.name || profile.handle,
    image: safeImageSrc(image) ?? null,
    coverImage: safeImageSrc(profile.coverImage) ?? null,
    occupation: profile.occupation,
    role: publicRole(profile.role),
    developer: profile.developer,
    verified: Boolean(profile.verified),
    pro: pro.get(profile.id) ?? null,
    bio: profile.bio,
    website: safeExternalHref(profile.website) ?? null,
    githubOwner,
    stats: { skills: skills.length, posts: social.posts, installs: skills.reduce((sum, s) => sum + s.downloadsCount, 0) },
    impulses,
    viewer: !viewerId ? "anonymous" : viewerId === profile.id ? "self" : "member",
    badges: { tiers: badges.map((b) => b.def.tier), total: meterBadgeCount(badges.map((b) => b.badgeId)) },
  };
}
