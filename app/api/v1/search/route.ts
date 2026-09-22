/**
 * GET /api/v1/search?q=…            full search: hits with highlights, facets, corrections
 * GET /api/v1/search?q=…&suggest=1  type-ahead suggestions
 *
 * Query syntax: category:MCP  is:verified  lang:python  author:anthropics
 *               tag:pdf  stars:>100  price:free  "exact phrase"  -excluded
 */

import { z } from "zod";
import { skillRepository, hydratePrompt } from "@/cortex/repository";
import { buildAgentContext, isAgentRequest } from "@/cortex/agent-context";
import { agentJson, json, withErrors } from "@/lib/api";
import { enforceRequestLimit } from "@/cortex/rate-limit";
import { SKILL_CATEGORIES, SECURITY_LEVELS } from "@/types/skill";

export const runtime = "nodejs";

const schema = z.object({
  q: z.string().max(200).default(""),
  category: z.enum(SKILL_CATEGORIES).optional(),
  securityLevel: z.enum(SECURITY_LEVELS).optional(),
  language: z.string().max(40).optional(),
  author: z.string().max(60).optional(),
  sort: z.enum(["relevance", "trending", "recent", "stars"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  suggest: z.coerce.boolean().optional(),
});

export const GET = withErrors(async (request: Request) => {
  enforceRequestLimit("search", request);
  const params = schema.parse(Object.fromEntries(new URL(request.url).searchParams));

  if (params.suggest) {
    return json({ suggestions: await skillRepository.suggest(params.q, 8) }, { headers: { "Cache-Control": "public, max-age=30" } });
  }

  const result = await skillRepository.search(params.q, params);

  if (isAgentRequest(request.headers)) {
    return agentJson(buildAgentContext(await Promise.all(result.hits.slice(0, 20).map((h) => hydratePrompt(h.skill))), result.total));
  }

  return json(
    {
      hits: result.hits.map((h) => ({ skill: h.skill, score: h.score, matched: h.matched, highlights: h.highlights })),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
      facets: result.facets,
      corrections: result.corrections,
      filters: result.parsed.filters,
      tookMs: result.tookMs,
    },
    { headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=120" } },
  );
});
