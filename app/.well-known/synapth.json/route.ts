/**
 * Discovery document for agents (ТЗ FR-AI-01): where the REST API and the
 * MCP server live, which protocol version and how to authenticate, plus the
 * public key that signs fetched content.
 */

import { NextResponse } from "next/server";
import { AGENT_SERVER_INFO, AGENT_TOOLS } from "@/cortex/agent";
import { publicSigningKey } from "@/cortex/signing";
import { API_KEY_SCOPES } from "@/types/api-keys";

export const runtime = "nodejs";

export function GET(request: Request) {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin).replace(/\/$/, "");
  return NextResponse.json(
    {
      name: "Synapth",
      protocol: AGENT_SERVER_INFO.protocol,
      rest: { base: `${base}/api/v1/agent`, tools: `${base}/api/v1/agent` },
      mcp: { url: `${base}/mcp`, transport: "streamable-http", stdio: `npx synapth-mcp --instance ${base}` },
      auth: {
        header: "X-Synapth-Key",
        alternatives: ["Authorization: Bearer <key>"],
        keyFormat: "sk_live_<32>",
        scopes: API_KEY_SCOPES,
        anonymous: { tools: ["search"], rateLimit: "30/min per IP", trust: "Community and above" },
        issue: `${base}/dashboard/developer#keys`,
      },
      tools: AGENT_TOOLS.map((t) => ({ name: t.name, scope: t.scope })),
      signing: publicSigningKey(),
      docs: `${base}/llms.txt`,
    },
    { headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } },
  );
}
