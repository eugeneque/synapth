/**
 * POST /api/v1/skills/:id/execute — pay-per-call gateway (ТЗ §5.2).
 * Headers: `X-Synapth-Key` (scope skills:execute), optional `Idempotency-Key`.
 * The work — checks, hold, upstream, settle/release — is `cortex/gateway.ts`.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { executeSkill } from "@/cortex/gateway";
import { agentCaller, agentErrorBody } from "@/cortex/agent-http";
import { AgentError } from "@/cortex/agent";
import { enforceRequestLimit } from "@/cortex/rate-limit";
import type { Caller } from "@/cortex/api-keys";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  tool: z.string().max(64).nullable().default(null),
  input: z.unknown().default({}),
});

export async function POST(request: Request, { params }: Ctx) {
  let caller: Caller | null = null;
  try {
    caller = await agentCaller(request);
    if (!caller) throw new AgentError("unauthorized", "execute needs an API key or a session");
    enforceRequestLimit("execute", request, caller.userId);
    const { id } = await params;
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new AgentError("invalid_request", parsed.error.issues.map((i) => i.message).join("; "));
    const res = await executeSkill(caller, id, parsed.data, { idempotencyKey: request.headers.get("idempotency-key") });
    return NextResponse.json(res.body, { status: res.status, headers: res.replayed ? { "Idempotent-Replayed": "true" } : {} });
  } catch (err) {
    const { status, body, retryAfter } = agentErrorBody(err, caller);
    return NextResponse.json(body, { status, headers: retryAfter ? { "Retry-After": String(retryAfter) } : {} });
  }
}
