/**
 * GET /api/v1/posts/images/:id — a photo of a post's carousel (published posts only).
 * Stored rows never change, so responses are cacheable for good.
 */

import { getPostImage } from "@/cortex/social";
import { enforceRequestLimit } from "@/cortex/rate-limit";
import { json, withErrors } from "@/lib/api";
import { IMAGE_MIME_TYPES } from "@/types/profile";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withErrors(async (request: Request, { params }: Ctx) => {
  enforceRequestLimit("read", request);
  const { id } = await params;
  const image = /^[A-Za-z0-9_-]{1,64}$/.test(id) ? await getPostImage(id) : null;
  // The MIME type was validated on upload; re-check so a stored row can never be served as HTML.
  if (!image || !(IMAGE_MIME_TYPES as readonly string[]).includes(image.mime)) return json({ error: "Image not found" }, { status: 404 });
  return new Response(new Uint8Array(image.body), {
    headers: { "Content-Type": image.mime, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" },
  });
});
