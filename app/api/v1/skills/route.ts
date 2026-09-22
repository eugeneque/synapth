/**
 * GET  /api/v1/skills  — catalogue search.
 *      Web/JSON clients get the full `Paginated<Skill>`.
 *      Agents (`X-Agent-Request: true`) get a minified context payload:
 *      merged system prompt + function-calling tool schemas, nothing else.
 * POST /api/v1/skills  — publish a skill (runs the sandbox scanner first).
 */

import { z } from "zod";
import { skillRepository, hydratePrompt } from "@/cortex/repository";
import { buildAgentContext, isAgentRequest } from "@/cortex/agent-context";
import { resolveCaller } from "@/cortex/api-keys";
import { UnauthorizedError } from "@/cortex/auth";
import { scanManifest, assertInstallable } from "@/lib/sandbox-scanner";
import { agentJson, json, withErrors } from "@/lib/api";
import { enforceRequestLimit } from "@/cortex/rate-limit";
import { httpUrlSchema, isPubliclyRoutableUrl } from "@/lib/url-safety";
import { SKILL_CATEGORIES, SECURITY_LEVELS, type SkillQuery } from "@/types/skill";

export const runtime = "nodejs";

const querySchema = z.object({
  q: z.string().trim().max(120).optional(),
  category: z.enum(SKILL_CATEGORIES).optional(),
  securityLevel: z.enum(SECURITY_LEVELS).optional(),
  sort: z.enum(["trending", "hidden-gems", "recent"]).default("trending"),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const jsonSchema: z.ZodType<Record<string, unknown>> = z.record(z.unknown());

/**
 * Entrypoints are fetched by the gateway, so the hostname is checked here as
 * well as at call time: `z.string().url()` would accept `file:`, `javascript:`
 * and `http://169.254.169.254/`.
 */
const endpointUrl = httpUrlSchema({ max: 2048 }).refine(isPubliclyRoutableUrl, { message: "endpoint must be a public host" });

const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1).max(80),
  description: z.string().max(2000),
  category: z.enum(SKILL_CATEGORIES),
  systemPrompt: z.string().max(20_000).optional(),
  tools: z.array(
    z.object({
      name: z.string().min(1).max(64),
      description: z.string().max(2000),
      parameters: jsonSchema,
      examples: z.array(z.object({ input: z.record(z.unknown()), note: z.string().optional() })).optional(),
    }),
  ),
  entrypoint: z.discriminatedUnion("type", [
    z.object({ type: z.literal("mcp-stdio"), command: z.string(), args: z.array(z.string()).optional(), env: z.record(z.string()).optional() }),
    z.object({ type: z.literal("mcp-sse"), url: endpointUrl, headers: z.record(z.string()).optional() }),
    z.object({ type: z.literal("http"), url: endpointUrl, method: z.enum(["GET", "POST"]).optional() }),
    z.object({ type: z.literal("prompt") }),
  ]),
  permissions: z.array(z.enum(["network", "filesystem:read", "filesystem:write", "shell", "env", "clipboard"])).optional(),
  requiredEnv: z.array(z.string()).optional(),
  flow: z
    .array(z.object({ id: z.string(), label: z.string(), kind: z.enum(["trigger", "tool", "decision", "output"]), tool: z.string().optional(), next: z.array(z.string()).optional() }))
    .optional(),
});

const createSchema = z.object({
  name: z.string().min(1).max(80),
  slug: z.string().regex(/^[a-z0-9-]{3,64}$/).optional(),
  description: z.string().min(1).max(2000),
  version: z.string().regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/, "semver expected"),
  category: z.enum(SKILL_CATEGORIES),
  pricePerCall: z.number().min(0).max(100).default(0),
  manifest: manifestSchema,
  repoUrl: httpUrlSchema({ max: 500 }).nullable().optional(),
  tags: z.array(z.string().max(32)).max(12).optional(),
  githubStars: z.number().int().min(0).optional(),
});

export const GET = withErrors(async (request: Request) => {
  enforceRequestLimit("read", request);
  const url = new URL(request.url);
  const query = querySchema.parse(Object.fromEntries(url.searchParams)) as SkillQuery;

  if (isAgentRequest(request.headers)) {
    // Agents are usually pulling a handful of skills into a prompt: cap the page, keep it small.
    const page = await skillRepository.list({ ...query, limit: Math.min(query.limit ?? 5, 20) });
    return agentJson(buildAgentContext(await Promise.all(page.items.map(hydratePrompt)), page.total));
  }

  const page = await skillRepository.list(query);
  return json(page, { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=300" } });
});

export const POST = withErrors(async (request: Request) => {
  const caller = await resolveCaller(request);
  if (!caller) throw new UnauthorizedError();
  enforceRequestLimit("publish", request, caller.userId);

  const input = createSchema.parse(await request.json());
  const scan = scanManifest(input.manifest);
  assertInstallable(scan);

  // Slugs are namespaced from the author's handle by the repository: letting a
  // publisher pick one would allow squatting on `anthropics-…`-looking names.
  const skill = await skillRepository.create({ ...input, slug: undefined }, caller.userId, scan.level);
  return json({ skill, scan }, { status: 201 });
});

export function OPTIONS() {
  return new Response(null, { status: 204 });
}
