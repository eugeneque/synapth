/**
 * Cortex · Agent audit log (ТЗ FR-AI-62).
 *
 * Every agent-facing call writes one row: key and agent, the action, the
 * object with its version and content hash, the policy decision and the
 * result. Rows are append-only; the dashboard reads them back per owner and
 * the retention window depends on the plan (`planRetentionDays`).
 */

import { randomBytes } from "node:crypto";
import { prisma, hasDatabase } from "@/cortex/db";
import type { Caller } from "@/cortex/api-keys";

export interface AgentAuditEntry {
  id: string;
  userId: string | null;
  keyId: string | null;
  agentName: string | null;
  action: string;
  objectType: string | null;
  objectId: string | null;
  objectVersion: string | null;
  objectHash: string | null;
  decision: "allow" | "deny";
  rule: string | null;
  result: string;
  createdAt: string;
}

export type AgentAuditInput = Omit<AgentAuditEntry, "id" | "createdAt" | "userId" | "keyId" | "agentName" | "objectType" | "objectId" | "objectVersion" | "objectHash" | "rule"> &
  Partial<Pick<AgentAuditEntry, "objectType" | "objectId" | "objectVersion" | "objectHash" | "rule">>;

/** Ring buffer for the in-memory store; the database keeps everything until retention sweeps it. */
const MEMORY_CAP = 5_000;

const g = globalThis as unknown as { __synapthAgentAudit_v1?: AgentAuditEntry[] };
const memoryAudit: AgentAuditEntry[] = g.__synapthAgentAudit_v1 ?? (g.__synapthAgentAudit_v1 = []);

/** Never throws: a journal failure must not fail the agent's call, but it is logged. */
export async function recordAgentAction(caller: Pick<Caller, "userId" | "keyId" | "agentName"> | null, entry: AgentAuditInput): Promise<void> {
  const row: AgentAuditEntry = {
    id: `aud_${randomBytes(6).toString("hex")}`,
    userId: caller?.userId ?? null,
    keyId: caller?.keyId ?? null,
    agentName: caller?.agentName ?? null,
    action: entry.action,
    objectType: entry.objectType ?? null,
    objectId: entry.objectId ?? null,
    objectVersion: entry.objectVersion ?? null,
    objectHash: entry.objectHash ?? null,
    decision: entry.decision,
    rule: entry.rule ?? null,
    result: entry.result,
    createdAt: new Date().toISOString(),
  };
  try {
    if (!hasDatabase) {
      memoryAudit.push(row);
      if (memoryAudit.length > MEMORY_CAP) memoryAudit.splice(0, memoryAudit.length - MEMORY_CAP);
      return;
    }
    const { id: _id, createdAt: _at, ...data } = row;
    await prisma.agentAuditLog.create({ data });
  } catch (err) {
    console.error("[cortex] agent audit write failed", err);
  }
}

export async function listAgentAudit(userId: string, { limit = 50, keyId }: { limit?: number; keyId?: string } = {}): Promise<AgentAuditEntry[]> {
  if (!hasDatabase) {
    return memoryAudit
      .filter((r) => r.userId === userId && (!keyId || r.keyId === keyId))
      .slice(-limit)
      .reverse();
  }
  const rows = await prisma.agentAuditLog.findMany({ where: { userId, ...(keyId ? { keyId } : {}) }, orderBy: { createdAt: "desc" }, take: limit });
  return rows.map((r) => ({ ...r, decision: r.decision === "deny" ? "deny" : "allow", createdAt: r.createdAt.toISOString() }));
}

/** Drops rows older than the owner's retention window (cron / admin). */
export async function sweepAgentAudit(olderThan: Date): Promise<number> {
  if (!hasDatabase) {
    const before = memoryAudit.length;
    const keep = memoryAudit.filter((r) => Date.parse(r.createdAt) >= olderThan.getTime());
    memoryAudit.splice(0, memoryAudit.length, ...keep);
    return before - keep.length;
  }
  const res = await prisma.agentAuditLog.deleteMany({ where: { createdAt: { lt: olderThan } } });
  return res.count;
}

export function resetAgentAuditForTests() {
  memoryAudit.length = 0;
}
