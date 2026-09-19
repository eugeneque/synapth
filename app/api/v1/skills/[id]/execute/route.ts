/**
 * POST /api/v1/skills/:id/execute — pay-per-task gateway.
 *
 * 1. resolve caller (session or X-Synapth-Key)
 * 2. open execution: reserve price from caller's wallet
 * 3. forward to the skill's HTTP entrypoint (or run the prompt-only "execution")
 * 4. close execution: pay the creator + platform, or refund on failure
 */

import { z } from "zod";
import { skillRepository } from "@/cortex/repository";
import { billing } from "@/cortex/billing";
import { resolveCaller } from "@/cortex/api-keys";
import { UnauthorizedError } from "@/cortex/auth";
import { json, withErrors } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  tool: z.string().max(64).nullable().default(null),
  input: z.unknown().default({}),
});

async function forwardToSkill(url: string, method: "GET" | "POST", tool: string | null, input: unknown, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", "User-Agent": "synapth-gateway/0.1" },
    body: method === "POST" ? JSON.stringify({ tool, input }) : undefined,
    signal,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Upstream ${res.status}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const POST = withErrors(async (request: Request, { params }: Ctx) => {
  const caller = await resolveCaller(request);
  if (!caller) throw new UnauthorizedError();

  const { id } = await params;
  const skill = (await skillRepository.byId(id)) ?? (await skillRepository.bySlug(id));
  if (!skill) return json({ error: "Skill not found" }, { status: 404 });
  if (skill.securityLevel === "Sandbox") return json({ error: "Sandbox-level skills cannot be executed through the gateway" }, { status: 403 });

  const { tool, input } = bodySchema.parse(await request.json().catch(() => ({})));
  if (tool && !skill.manifest.tools.some((t) => t.name === tool)) {
    return json({ error: `Unknown tool "${tool}"`, tools: skill.manifest.tools.map((t) => t.name) }, { status: 400 });
  }

  const event = await billing.openExecution({ skill, callerId: caller.userId, toolName: tool, input });
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);

  try {
    let result: unknown;
    const ep = skill.manifest.entrypoint;
    if (ep.type === "http") {
      result = await forwardToSkill(ep.url, ep.method ?? "POST", tool, input, controller.signal);
    } else if (ep.type === "prompt") {
      // Prompt skills have nothing to run server-side: the "execution" hands back the prompt.
      result = { systemPrompt: skill.manifest.systemPrompt };
    } else {
      return json({ error: "MCP skills run on the agent side; install them instead of executing through the gateway", install: true }, { status: 400 });
    }
    const receipt = await billing.closeExecution(event.id, { status: "succeeded", latencyMs: Date.now() - started });
    return json({ receipt, result });
  } catch (err) {
    const receipt = await billing.closeExecution(event.id, { status: "failed", latencyMs: Date.now() - started });
    return json({ receipt, error: (err as Error).message }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
});
