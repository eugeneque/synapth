/**
 * Cortex · Idempotency-Key for paid calls (ТЗ §5.2, step 7).
 *
 * `begin` claims (caller, key) before any money moves. A repeat within 24 h
 * with the same request gets the stored response back and nothing is charged
 * again; the same key with a different request is refused; a repeat while the
 * first call is still running gets `in_progress`.
 */

import { prisma, hasDatabase } from "@/cortex/db";
import { Prisma } from "@prisma/client";

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60_000;
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;

export interface StoredResponse {
  status: number;
  body: unknown;
}

export type IdempotencyClaim = { state: "new" } | { state: "replay"; response: StoredResponse } | { state: "mismatch" } | { state: "in_progress" };

interface Row {
  callerId: string;
  key: string;
  requestHash: string;
  status: number;
  response: unknown;
  executionId: string | null;
  expiresAt: number;
}

const g = globalThis as unknown as { __synapthIdempotency_v1?: Map<string, Row> };
const mem: Map<string, Row> = g.__synapthIdempotency_v1 ?? (g.__synapthIdempotency_v1 = new Map());
const k = (callerId: string, key: string) => `${callerId}\n${key}`;

/** status 0 marks a claim whose call has not finished yet. */
export async function beginIdempotent(callerId: string, key: string, requestHash: string, now = Date.now()): Promise<IdempotencyClaim> {
  if (!hasDatabase) {
    for (const [id, row] of mem) if (row.expiresAt <= now) mem.delete(id);
    const row = mem.get(k(callerId, key));
    if (!row) {
      mem.set(k(callerId, key), { callerId, key, requestHash, status: 0, response: null, executionId: null, expiresAt: now + IDEMPOTENCY_TTL_MS });
      return { state: "new" };
    }
    return classify(row.requestHash, row.status, row.response, requestHash);
  }
  await prisma.idempotencyRecord.deleteMany({ where: { callerId, key, expiresAt: { lte: new Date(now) } } });
  try {
    await prisma.idempotencyRecord.create({ data: { callerId, key, requestHash, status: 0, response: Prisma.JsonNull, expiresAt: new Date(now + IDEMPOTENCY_TTL_MS) } });
    return { state: "new" };
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") throw err;
    const row = await prisma.idempotencyRecord.findUnique({ where: { callerId_key: { callerId, key } } });
    if (!row) return { state: "in_progress" };
    return classify(row.requestHash, row.status, row.response, requestHash);
  }
}

function classify(storedHash: string, status: number, response: unknown, requestHash: string): IdempotencyClaim {
  if (storedHash !== requestHash) return { state: "mismatch" };
  if (status === 0) return { state: "in_progress" };
  return { state: "replay", response: { status, body: response } };
}

export async function finishIdempotent(callerId: string, key: string, response: StoredResponse, executionId: string | null): Promise<void> {
  if (!hasDatabase) {
    const row = mem.get(k(callerId, key));
    if (row) Object.assign(row, { status: response.status, response: response.body, executionId });
    return;
  }
  await prisma.idempotencyRecord.update({ where: { callerId_key: { callerId, key } }, data: { status: response.status, response: response.body as Prisma.InputJsonValue, executionId } });
}

/** A call that never reached the upstream (validation, funds) frees its key for a corrected retry. */
export async function abandonIdempotent(callerId: string, key: string): Promise<void> {
  if (!hasDatabase) {
    mem.delete(k(callerId, key));
    return;
  }
  await prisma.idempotencyRecord.deleteMany({ where: { callerId, key, status: 0 } });
}

export function resetIdempotencyForTests() {
  mem.clear();
}
