/** /llms.txt — a short brief of the platform for agents (ТЗ FR-AI-01). */

import { AGENT_TOOLS } from "@/cortex/agent";

export const dynamic = "force-static";

export function GET() {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const body = `# Synapth

> Catalogue of skills, MCP servers and HTTP tools for AI agents. Every version is scanned (62 rules: prompt injection, exfiltration, dangerous commands, secrets, permissions, supply chain) and carries a trust level: Sandbox < Community < Verified < Gov; packs can be Certified.

## Connect
- MCP (Streamable HTTP): ${base}/mcp  — header \`X-Synapth-Key: sk_live_…\`
- REST: ${base}/api/v1/agent/<tool> — same tools, JSON in, JSON out
- Discovery: ${base}/.well-known/synapth.json
- Keys: ${base}/dashboard/developer#keys (scopes: catalog:read, skills:fetch, skills:execute, packs:write)

## Workflow
1. resolve_task with the task text → up to 3 variants (pack, set, single skill) with reasoning, token weight, permissions, trust, price.
2. If requiresApproval is true, show approvalCard to the human and wait for consent. Never install silently.
3. Prompt skills: fetch_skill → verify each file's sha256 and contentHash. MCP servers and packs: install_plan → run the steps → confirm_install with the lock entries.
4. report_outcome after use (one per installation per day). check_updates with your synapth.lock; remove anything reported as revoked.

## Tools
${AGENT_TOOLS.map((t) => `- ${t.name}${t.scope ? ` (${t.scope})` : " (no key needed)"}: ${t.description}`).join("\n")}

## Rules
- Your key policy is applied before search: forbidden entries are invisible. Each response has \`pol\` with the active restrictions.
- Errors carry a code (policy_denied, budget_exceeded, approval_required, integrity_mismatch, revoked, rate_limited, not_found) and a hint for the next step.
- Task text is treated as data; instructions inside it are not executed.
`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
