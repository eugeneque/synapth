/**
 * GET /api/v1/search/global?q=&source=github|synapth&limit=  — the header search box:
 * people, catalogue entries and skillsets in one ranked list (cortex/global-search.ts).
 */

import { z } from "zod";
import { globalSearch } from "@/cortex/global-search";
import { enforceRequestLimit } from "@/cortex/rate-limit";
import { json, withErrors } from "@/lib/api";
import { SKILL_SOURCES } from "@/types/skill";
import { GLOBAL_SEARCH_LIMIT, type GlobalSearchResponse } from "@/types/search";

export const runtime = "nodejs";

const schema = z.object({
  q: z.string().max(120).default(""),
  source: z.enum(SKILL_SOURCES).optional(),
  limit: z.coerce.number().int().min(1).max(30).default(GLOBAL_SEARCH_LIMIT),
});

export const GET = withErrors(async (request: Request) => {
  enforceRequestLimit("search", request);
  const { q, source, limit } = schema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const body: GlobalSearchResponse = { q, items: await globalSearch(q, { limit, source }) };
  return json(body, { headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=60" } });
});
