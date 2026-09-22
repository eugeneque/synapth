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
import { enforceRequestLimit } from "@/cortex/rate-limit";
import { BlockedUrlError, safeFetch } from "@/cortex/ssrf";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  tool: z.string().max(64).nullable().default(null),
  input: z.unknown().default({}),
});

/**
 * The entrypoint URL comes from a publisher-controlled manifest, so the hop
 * goes through `safeFetch`: public hosts only, every redirect re-validated,
 * body capped. Upstream bodies are never echoed back — a 500 page from an
 * internal service is exactly what an SSRF probe wants to read.
 */
async function forwardToSkill(url: string, method: "GET" | "POST", tool: string | null, input: unknown, signal: AbortSignal): Promise<unknown> {
  const res = await safeFetch(url, {
    method,
    headers: { "Content-Type": "application/json", "User-Agent": "synapth-gateway/0.1", Accept: "application/json" },
    body: JSON.stringify({ tool, input }),
    signal,
    maxBytes: 256 * 1024,
  });
  if (!res.ok) throw new UpstreamError(`Upstream responded ${res.status}`);
  try {
    return JSON.parse(res.text);
  } catch {
    return res.text;
  }
}

class UpstreamError extends Error {
  name = "UpstreamError";
}

export const POST = withErrors(async (request: Request, { params }: Ctx) => {
  const caller = await resolveCaller(request);
  if (!caller) throw new UnauthorizedError();
  enforceRequestLimit("execute", request, caller.userId);

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
    // Only our own, non-reflective messages reach the caller; the rest stays in the logs.
    const safeMessage = err instanceof BlockedUrlError || err instanceof UpstreamError ? err.message : "Skill execution failed";
    if (!(err instanceof BlockedUrlError || err instanceof UpstreamError)) console.error("execute failed", { skill: skill.id, err });
    return json({ receipt, error: safeMessage }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
});
