/**
 * synapth-mcp — remote MCP server over Streamable HTTP (ТЗ FR-AI-03).
 *
 * Stateless JSON-RPC 2.0 on POST: `initialize`, `ping`, `tools/list`,
 * `tools/call`; responses are plain `application/json` (no SSE stream is
 * needed: every tool answers in one message). Auth is the same
 * `X-Synapth-Key` as REST; without a key only `search` works.
 *
 *   claude mcp add --transport http synapth https://<host>/mcp --header "X-Synapth-Key: sk_live_…"
 */

import { NextResponse } from "next/server";
import { AGENT_SERVER_INFO, AGENT_TOOLS, AgentError, isAgentTool, runAgentTool } from "@/cortex/agent";
import { agentCaller, agentErrorBody, limitAgent } from "@/cortex/agent-http";
import type { Caller } from "@/cortex/api-keys";

export const runtime = "nodejs";

const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

type RpcResponse = { jsonrpc: "2.0"; id: string | number | null; result: unknown } | { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string; data?: unknown } };

const rpcError = (id: RpcRequest["id"], code: number, message: string, data?: unknown): RpcResponse => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data ? { data } : {}) } });

async function dispatch(request: Request, msg: RpcRequest, caller: () => Promise<Caller | null>): Promise<RpcResponse | null> {
  if (msg?.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(msg?.id, -32600, "Invalid Request");
  const isNotification = msg.id === undefined;
  switch (msg.method) {
    case "initialize": {
      const asked = typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : SUPPORTED_VERSIONS[0];
      return {
        jsonrpc: "2.0",
        id: msg.id ?? null,
        result: {
          protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: AGENT_SERVER_INFO.name, version: AGENT_SERVER_INFO.version },
          instructions:
            "Synapth is a catalogue of agent skills, MCP servers and tools. Call resolve_task with the task to get up to 3 vetted variants; never install anything with requiresApproval=true without showing approvalCard to the human. Verify contentHash of fetched files. Every response carries `pol` — your key's restrictions.",
        },
      };
    }
    case "ping":
      return isNotification ? null : { jsonrpc: "2.0", id: msg.id ?? null, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id: msg.id ?? null, result: { tools: AGENT_TOOLS.map((t) => ({ name: t.name, description: `${t.description}${t.scope ? ` Scope: ${t.scope}.` : ""}`, inputSchema: t.inputSchema })) } };
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      let who: Caller | null = null;
      try {
        if (!isAgentTool(name)) return rpcError(msg.id, -32602, `Unknown tool: ${name}`);
        who = await caller();
        await limitAgent(request, who, name);
        const result = await runAgentTool(who, name, msg.params?.arguments ?? {});
        return { jsonrpc: "2.0", id: msg.id ?? null, result: { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result, isError: false } };
      } catch (err) {
        // Tool failures are results with isError, so the model sees the code and the hint.
        const { body } = agentErrorBody(err, who);
        return { jsonrpc: "2.0", id: msg.id ?? null, result: { content: [{ type: "text", text: JSON.stringify(body) }], structuredContent: body, isError: true } };
      }
    }
    default:
      if (msg.method.startsWith("notifications/")) return null;
      return isNotification ? null : rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    const text = await request.text();
    if (text.length > 256 * 1024) return NextResponse.json(rpcError(null, -32600, "Request too large"), { status: 413 });
    payload = JSON.parse(text);
  } catch {
    return NextResponse.json(rpcError(null, -32700, "Parse error"), { status: 400 });
  }
  // Resolve the key once per HTTP request, lazily: `initialize` and `tools/list` work without one.
  let resolved: Promise<Caller | null> | null = null;
  const caller = () => (resolved ??= agentCaller(request));
  try {
    if (Array.isArray(payload)) {
      const out = (await Promise.all(payload.slice(0, 20).map((m) => dispatch(request, m as RpcRequest, caller)))).filter(Boolean);
      return out.length ? NextResponse.json(out) : new NextResponse(null, { status: 202 });
    }
    const out = await dispatch(request, payload as RpcRequest, caller);
    return out ? NextResponse.json(out) : new NextResponse(null, { status: 202 });
  } catch (err) {
    const message = err instanceof AgentError ? err.message : "Internal error";
    return NextResponse.json(rpcError(null, -32603, message), { status: 500 });
  }
}

/** No server-initiated stream: every response comes back on the POST. */
export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}

export function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
