/** GET /api/v1/agent — the tool table (names, scopes, input schemas). */

import { NextResponse } from "next/server";
import { AGENT_SERVER_INFO, AGENT_TOOLS } from "@/cortex/agent";

export const dynamic = "force-static";

export function GET() {
  return NextResponse.json({ server: AGENT_SERVER_INFO, tools: AGENT_TOOLS.map((t) => ({ name: t.name, scope: t.scope, description: t.description, inputSchema: t.inputSchema, rest: `POST /api/v1/agent/${t.name}` })) });
}
