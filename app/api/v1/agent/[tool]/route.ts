/**
 * REST transport of the agent API (ТЗ §1, the fallback to MCP):
 *   GET  /api/v1/agent/search?q=…            — also get_skill?id=, get_pack?id=, fetch_skill?id=
 *   POST /api/v1/agent/<tool>  { …arguments } — every tool from AGENT_TOOLS
 * Same operations, schemas, policy, journal and error codes as `/mcp`.
 */

import { NextResponse } from "next/server";
import { isAgentTool, runAgentTool, AgentError } from "@/cortex/agent";
import { agentCaller, agentErrorBody, limitAgent } from "@/cortex/agent-http";
import type { Caller } from "@/cortex/api-keys";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ tool: string }> };

const GET_TOOLS = new Set(["search", "get_skill", "get_pack", "fetch_skill"]);

async function handle(request: Request, tool: string, args: () => Promise<unknown>) {
  let caller: Caller | null = null;
  try {
    if (!isAgentTool(tool)) throw new AgentError("not_found", `Unknown tool "${tool}"; see GET /api/v1/agent`);
    caller = await agentCaller(request);
    await limitAgent(request, caller, tool);
    const result = await runAgentTool(caller, tool, await args());
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store", "X-Synapth-Protocol": "agent/1" } });
  } catch (err) {
    const { status, body, retryAfter } = agentErrorBody(err, caller);
    return NextResponse.json(body, { status, headers: retryAfter ? { "Retry-After": String(retryAfter) } : {} });
  }
}

export async function GET(request: Request, { params }: Ctx) {
  const { tool } = await params;
  if (!GET_TOOLS.has(tool)) return NextResponse.json({ error: "invalid_request", message: `Use POST for ${tool}`, hint: "Send the arguments as a JSON body." }, { status: 405, headers: { Allow: "POST" } });
  const sp = new URL(request.url).searchParams;
  return handle(request, tool, async () => ({
    ...(sp.get("q") !== null ? { q: sp.get("q") } : {}),
    ...(sp.get("id") ? { id: sp.get("id") } : {}),
    ...(sp.get("category") ? { category: sp.get("category") } : {}),
    ...(sp.get("limit") ? { limit: Number(sp.get("limit")) } : {}),
  }));
}

export async function POST(request: Request, { params }: Ctx) {
  const { tool } = await params;
  return handle(request, tool, async () => {
    const text = await request.text();
    if (text.length > 256 * 1024) throw new AgentError("invalid_request", "Body over 256 KB");
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new AgentError("invalid_request", "Body is not JSON");
    }
  });
}

