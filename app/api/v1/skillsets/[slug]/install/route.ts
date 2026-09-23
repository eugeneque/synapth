/**
 * GET /api/v1/skillsets/:slug/install?target=claude-code|cursor
 *
 * The POSIX script behind the one-liner `curl -fsSL … | sh`: every entry of
 * the set, installed for the chosen client (`skillsetInstall` in axon/install.ts
 * builds it, shell-quoting all manifest data). Sandbox entries are left out.
 */

import { z } from "zod";
import { hydratePrompt } from "@/cortex/repository";
import { getSkillset, skillsetSkills } from "@/cortex/skillsets";
import { enforceRequestLimit } from "@/cortex/rate-limit";
import { json, withErrors } from "@/lib/api";
import { skillsetInstall } from "@/axon/install";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

const schema = z.object({ target: z.enum(["claude-code", "cursor"]).default("claude-code") });

export const GET = withErrors(async (request: Request, { params }: Ctx) => {
  enforceRequestLimit("install", request);
  const { slug } = await params;
  const { target } = schema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const set = await getSkillset(slug);
  if (!set) return json({ error: "Skillset not found" }, { status: 404 });
  const skills = await Promise.all((await skillsetSkills(set)).map(hydratePrompt));
  const plan = skillsetInstall(set, skills, target);
  return new Response(plan.body, { headers: { "Content-Type": "text/x-shellscript; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
});
