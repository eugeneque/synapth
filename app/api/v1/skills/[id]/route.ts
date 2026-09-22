/**
 * GET  /api/v1/skills/:id            — full skill (id or slug).
 * GET  /api/v1/skills/:id?format=prompt — raw system prompt as text/plain (agents `curl` it into context).
 * POST /api/v1/skills/:id  {action:"install", client} — records an install.
 */

import { z } from "zod";
import { skillRepository, hydratePrompt } from "@/cortex/repository";
import { resolveCaller } from "@/cortex/api-keys";
import { isAgentRequest, buildAgentContext } from "@/cortex/agent-context";
import { scanManifest } from "@/lib/sandbox-scanner";
import { agentJson, json, withErrors } from "@/lib/api";
import { enforceRequestLimit } from "@/cortex/rate-limit";

type Ctx = { params: Promise<{ id: string }> };

async function load(id: string) {
  return (await skillRepository.byId(id)) ?? (await skillRepository.bySlug(id));
}

export const GET = withErrors(async (request: Request, { params }: Ctx) => {
  enforceRequestLimit("read", request);
  const { id } = await params;
  const found = await load(id);
  if (!found) return json({ error: "Skill not found" }, { status: 404 });
  const skill = await hydratePrompt(found);

  const format = new URL(request.url).searchParams.get("format");
  if (format === "prompt") {
    return new Response(skill.manifest.systemPrompt ?? "", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  if (isAgentRequest(request.headers)) {
    return agentJson(buildAgentContext([skill], 1));
  }
  if (format === "scan") {
    return json({ skill: skill.id, scan: scanManifest(skill.manifest, { reviewed: skill.securityLevel === "Verified" }) });
  }
  return json(skill);
});

const actionSchema = z.object({
  action: z.literal("install"),
  client: z.enum(["cursor", "claude-desktop", "claude-code", "curl", "api", "web"]).default("web"),
});

export const POST = withErrors(async (request: Request, { params }: Ctx) => {
  const { id } = await params;
  const skill = await load(id);
  if (!skill) return json({ error: "Skill not found" }, { status: 404 });

  const { client } = actionSchema.parse(await request.json());
  const caller = await resolveCaller(request);
  // Install counts feed ranking: without a budget they are trivially inflated.
  enforceRequestLimit("install", request, caller?.userId);
  await skillRepository.recordInstall(skill.id, client, caller?.userId);
  const fresh = await skillRepository.byId(skill.id);
  return json({ ok: true, downloadsCount: fresh?.downloadsCount ?? skill.downloadsCount + 1 });
});
