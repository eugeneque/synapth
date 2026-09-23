/**
 * GET /api/v1/skillsets?q=&verified=1&sort=recent|popular|updated&limit=  — public list (summaries).
 * Mutations are server actions (`app/(site)/skillset-actions.ts`).
 */

import { z } from "zod";
import { listSkillsets } from "@/cortex/skillsets";
import { enforceRequestLimit } from "@/cortex/rate-limit";
import { json, withErrors } from "@/lib/api";

export const runtime = "nodejs";

const schema = z.object({
  q: z.string().max(200).optional(),
  verified: z.enum(["1", "0", "true", "false"]).optional(),
  sort: z.enum(["recent", "popular", "updated"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const GET = withErrors(async (request: Request) => {
  enforceRequestLimit("read", request);
  const p = schema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const items = await listSkillsets({ q: p.q, sort: p.sort, limit: p.limit, verified: p.verified === undefined ? undefined : p.verified === "1" || p.verified === "true" });
  return json({ items }, { headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=120" } });
});
