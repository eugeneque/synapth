/**
 * Public profile vocabulary shared by Cortex (validation), Axon (uploaders)
 * and the UI (labels via `lib/i18n`, key `occupation.<id>`).
 */

/** What a developer does; shown as a badge next to the handle on the profile page. */
export const OCCUPATIONS = [
  "ml-engineer",
  "ai-engineer",
  "ai-architect",
  "system-analyst",
  "data-scientist",
  "research-scientist",
  "backend-engineer",
  "frontend-engineer",
  "fullstack-engineer",
  "platform-engineer",
  "security-researcher",
  "product-manager",
  "founder",
  "student",
  "other",
] as const;

export type Occupation = (typeof OCCUPATIONS)[number];

export function isOccupation(value: unknown): value is Occupation {
  return typeof value === "string" && (OCCUPATIONS as readonly string[]).includes(value);
}

/**
 * Profile images travel as `data:image/*;base64` URLs. The client resizes
 * before upload (see `axon/image.ts`), the server enforces the same ceiling
 * so a hand-crafted request cannot bloat the row.
 */
export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export const AVATAR_IMAGE = { width: 256, height: 256, maxBytes: 160 * 1024 } as const;
export const COVER_IMAGE = { width: 1500, height: 500, maxBytes: 600 * 1024 } as const;

/** Byte length of the payload behind a `data:*;base64,` URL (0 for anything else). */
export function dataUrlBytes(url: string): number {
  const comma = url.indexOf(",");
  if (comma < 0) return 0;
  const payload = url.slice(comma + 1);
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
}

/** Payload must be real base64: a `data:image/png;base64,<anything>` string is not an image. */
const BASE64_PAYLOAD = /^[A-Za-z0-9+/]+={0,2}$/;

export function isImageDataUrl(url: string): boolean {
  const mime = IMAGE_MIME_TYPES.find((m) => url.startsWith(`data:${m};base64,`));
  if (!mime) return false;
  const payload = url.slice(`data:${mime};base64,`.length);
  return payload.length > 0 && payload.length % 4 === 0 && BASE64_PAYLOAD.test(payload);
}
