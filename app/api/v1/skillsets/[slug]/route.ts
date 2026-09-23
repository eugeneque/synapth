/**
 * GET /api/v1/skillsets/:slug  — the set with its entries (id or slug).
 * With `X-Agent-Request: true`: the merged agent context of every entry, like the skill endpoints.
 */

import { hydratePrompt } from "@/cortex/repository";
import { getSkillset, skillsetSkills } from "@/cortex/skillsets";
import { buildAgentContext, isAgentRequest } from "@/cortex/agent-context";
import { enforceRequestLimit } from "@/cortex/rate-limit";
import { agentJson, json, withErrors } from "@/lib/api";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

export const GET = withErrors(async (request: Request, { params }: Ctx) => {
  enforceRequestLimit("read", request);
  const { slug } = await params;
  const set = await getSkillset(slug);
  if (!set) return json({ error: "Skillset not found" }, { status: 404 });
  if (isAgentRequest(request.headers)) {
    const skills = await Promise.all((await skillsetSkills(set)).filter((s) => s.securityLevel !== "Sandbox").map(hydratePrompt));
    return agentJson(buildAgentContext(skills, skills.length));
  }
  return json(set);
});
