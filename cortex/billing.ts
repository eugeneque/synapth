/**
 * Cortex · Creator economy / pay-per-task
 *
 * Every paid execution produces three ledger entries in one transaction:
 *   caller wallet   : charge        (−price)
 *   creator wallet  : earning       (+price − fee)
 *   platform wallet : platform_fee  (+fee)
 * and one UsageEvent row that links them. Free skills still get a UsageEvent
 * (price 0) so retention and execution stats work for everyone.
 */

import { prisma, hasDatabase } from "@/cortex/db";
import { sha256Hex } from "@/lib/utils";
import { MICROS_PER_USD, microsToUsd, usdToMicros, type ExecutionReceipt, type LedgerEntry, type UsageEvent, type Wallet } from "@/types/economy";
import type { Skill } from "@/types/skill";

export const PLATFORM_USER_ID = "usr_platform";
export const PLATFORM_FEE_PERCENT = Number(process.env.SYNAPTH_PLATFORM_FEE_PERCENT ?? 15);

export class InsufficientFundsError extends Error {
  status = 402 as const;
  constructor(public readonly requiredUsd: number, public readonly balanceUsd: number) {
    super(`Insufficient funds: need $${requiredUsd.toFixed(4)}, balance $${balanceUsd.toFixed(4)}`);
    this.name = "InsufficientFundsError";
  }
}

export function splitPrice(priceMicros: number) {
  const platformFeeMicros = Math.floor((priceMicros * PLATFORM_FEE_PERCENT) / 100);
  return { platformFeeMicros, creatorShareMicros: priceMicros - platformFeeMicros };
}

export interface ExecutionRequest {
  skill: Skill;
  callerId: string;
  toolName: string | null;
  input: unknown;
}

export interface ExecutionOutcome {
  status: "succeeded" | "failed";
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface BillingService {
  getWallet(userId: string): Promise<Wallet>;
  topUp(userId: string, usd: number, memo?: string): Promise<Wallet>;
  /** Reserve funds and open a UsageEvent. Throws InsufficientFundsError. */
  openExecution(req: ExecutionRequest): Promise<UsageEvent>;
  /** Close the event: on failure the charge is refunded. */
  closeExecution(executionId: string, outcome: ExecutionOutcome): Promise<ExecutionReceipt>;
  ledger(userId: string, limit?: number): Promise<LedgerEntry[]>;
  creatorSummary(creatorId: string): Promise<{ executions: number; earningsUsd: number; bySkill: Array<{ skillId: string; executions: number; earningsUsd: number }> }>;
}

// ---------------------------------------------------------------------------
// In-memory backend
// ---------------------------------------------------------------------------

const nowIso = () => new Date().toISOString();
const newId = (p: string) => `${p}_${Math.random().toString(36).slice(2, 12)}`;

class MemoryBillingService implements BillingService {
  private wallets = new Map<string, Wallet>();
  private entries: LedgerEntry[] = [];
  private events = new Map<string, UsageEvent>();

  constructor() {
    // Demo user starts with $5 so paid tools can be tried immediately.
    this.topUp("usr_demo", 5, "Welcome credit");
  }

  private wallet(userId: string): Wallet {
    let w = this.wallets.get(userId);
    if (!w) {
      w = { id: newId("wal"), userId, balanceMicros: 0, lifetimeEarningsMicros: 0, currency: "USD", updatedAt: nowIso() };
      this.wallets.set(userId, w);
    }
    return w;
  }

  private post(wallet: Wallet, type: LedgerEntry["type"], amountMicros: number, memo: string, executionId: string | null) {
    wallet.balanceMicros += amountMicros;
    if (type === "earning") wallet.lifetimeEarningsMicros += amountMicros;
    wallet.updatedAt = nowIso();
    this.entries.push({ id: newId("led"), walletId: wallet.id, type, amountMicros, executionId, memo, createdAt: nowIso() });
  }

  async getWallet(userId: string) {
    return { ...this.wallet(userId) };
  }

  async topUp(userId: string, usd: number, memo = "Top-up") {
    const w = this.wallet(userId);
    this.post(w, "topup", usdToMicros(usd), memo, null);
    return { ...w };
  }

  async openExecution(req: ExecutionRequest) {
    const priceMicros = usdToMicros(req.skill.pricePerCall);
    const caller = this.wallet(req.callerId);
    if (caller.balanceMicros < priceMicros) {
      throw new InsufficientFundsError(microsToUsd(priceMicros), microsToUsd(caller.balanceMicros));
    }
    const { platformFeeMicros, creatorShareMicros } = splitPrice(priceMicros);
    const event: UsageEvent = {
      id: newId("exe"),
      skillId: req.skill.id,
      skillVersion: req.skill.version,
      callerId: req.callerId,
      creatorId: req.skill.authorId,
      toolName: req.toolName,
      status: "pending",
      priceMicros,
      platformFeeMicros,
      creatorShareMicros,
      latencyMs: null,
      inputTokens: null,
      outputTokens: null,
      inputHash: await sha256Hex(JSON.stringify(req.input ?? null)),
      createdAt: nowIso(),
    };
    this.events.set(event.id, event);
    if (priceMicros > 0) this.post(caller, "charge", -priceMicros, `${req.skill.name} · ${req.toolName ?? "execute"}`, event.id);
    return { ...event };
  }

  async closeExecution(executionId: string, outcome: ExecutionOutcome) {
    const event = this.events.get(executionId);
    if (!event) throw new Error(`Unknown execution ${executionId}`);
    if (event.status !== "pending") throw new Error(`Execution ${executionId} already ${event.status}`);

    event.latencyMs = outcome.latencyMs;
    event.inputTokens = outcome.inputTokens ?? null;
    event.outputTokens = outcome.outputTokens ?? null;

    const caller = this.wallet(event.callerId);
    if (outcome.status === "succeeded") {
      event.status = "succeeded";
      if (event.priceMicros > 0) {
        this.post(this.wallet(event.creatorId), "earning", event.creatorShareMicros, `Execution ${event.id}`, event.id);
        this.post(this.wallet(PLATFORM_USER_ID), "platform_fee", event.platformFeeMicros, `Fee ${event.id}`, event.id);
      }
    } else {
      event.status = "refunded";
      if (event.priceMicros > 0) this.post(caller, "refund", event.priceMicros, `Refund ${event.id} (failed)`, event.id);
    }

    return {
      executionId: event.id,
      skillId: event.skillId,
      status: event.status,
      chargedUsd: event.status === "succeeded" ? microsToUsd(event.priceMicros) : 0,
      creatorShareUsd: event.status === "succeeded" ? microsToUsd(event.creatorShareMicros) : 0,
      platformFeeUsd: event.status === "succeeded" ? microsToUsd(event.platformFeeMicros) : 0,
      remainingBalanceUsd: microsToUsd(caller.balanceMicros),
    };
  }

  async ledger(userId: string, limit = 50) {
    const w = this.wallet(userId);
    return this.entries.filter((e) => e.walletId === w.id).slice(-limit).reverse();
  }

  async creatorSummary(creatorId: string) {
    const mine = [...this.events.values()].filter((e) => e.creatorId === creatorId && e.status === "succeeded");
    const bySkillMap = new Map<string, { executions: number; earningsMicros: number }>();
    for (const e of mine) {
      const cur = bySkillMap.get(e.skillId) ?? { executions: 0, earningsMicros: 0 };
      cur.executions += 1;
      cur.earningsMicros += e.creatorShareMicros;
      bySkillMap.set(e.skillId, cur);
    }
    return {
      executions: mine.length,
      earningsUsd: microsToUsd(mine.reduce((s, e) => s + e.creatorShareMicros, 0)),
      bySkill: [...bySkillMap.entries()].map(([skillId, v]) => ({ skillId, executions: v.executions, earningsUsd: microsToUsd(v.earningsMicros) })),
    };
  }
}

// ---------------------------------------------------------------------------
// Prisma backend
// ---------------------------------------------------------------------------

class PrismaBillingService implements BillingService {
  private async ensureWallet(userId: string) {
    return prisma.wallet.upsert({ where: { userId }, create: { userId }, update: {} });
  }

  private toWallet(w: { id: string; userId: string; balanceMicros: bigint; lifetimeEarningsMicros: bigint; updatedAt: Date }): Wallet {
    return { id: w.id, userId: w.userId, balanceMicros: Number(w.balanceMicros), lifetimeEarningsMicros: Number(w.lifetimeEarningsMicros), currency: "USD", updatedAt: w.updatedAt.toISOString() };
  }

  async getWallet(userId: string) {
    return this.toWallet(await this.ensureWallet(userId));
  }

  async topUp(userId: string, usd: number, memo = "Top-up") {
    const w = await this.ensureWallet(userId);
    const amount = BigInt(usdToMicros(usd));
    const updated = await prisma.wallet.update({
      where: { id: w.id },
      data: { balanceMicros: { increment: amount }, entries: { create: { type: "topup", amountMicros: amount, memo } } },
    });
    return this.toWallet(updated);
  }

  async openExecution(req: ExecutionRequest) {
    const priceMicros = usdToMicros(req.skill.pricePerCall);
    const { platformFeeMicros, creatorShareMicros } = splitPrice(priceMicros);
    const inputHash = await sha256Hex(JSON.stringify(req.input ?? null));

    return prisma.$transaction(async (tx) => {
      const caller = await tx.wallet.upsert({ where: { userId: req.callerId }, create: { userId: req.callerId }, update: {} });
      if (caller.balanceMicros < BigInt(priceMicros)) {
        throw new InsufficientFundsError(priceMicros / MICROS_PER_USD, Number(caller.balanceMicros) / MICROS_PER_USD);
      }
      const event = await tx.usageEvent.create({
        data: {
          skillId: req.skill.id,
          skillVersion: req.skill.version,
          callerId: req.callerId,
          creatorId: req.skill.authorId,
          toolName: req.toolName,
          priceMicros,
          platformFeeMicros,
          creatorShareMicros,
          inputHash,
        },
      });
      if (priceMicros > 0) {
        await tx.wallet.update({
          where: { id: caller.id },
          data: {
            balanceMicros: { decrement: BigInt(priceMicros) },
            entries: { create: { type: "charge", amountMicros: BigInt(-priceMicros), executionId: event.id, memo: `${req.skill.name} · ${req.toolName ?? "execute"}` } },
          },
        });
      }
      return { ...event, latencyMs: null, inputTokens: null, outputTokens: null, createdAt: event.createdAt.toISOString() } as UsageEvent;
    });
  }

  async closeExecution(executionId: string, outcome: ExecutionOutcome) {
    return prisma.$transaction(async (tx) => {
      const event = await tx.usageEvent.findUniqueOrThrow({ where: { id: executionId } });
      if (event.status !== "pending") throw new Error(`Execution ${executionId} already ${event.status}`);

      const status = outcome.status === "succeeded" ? "succeeded" : "refunded";
      await tx.usageEvent.update({
        where: { id: executionId },
        data: { status, latencyMs: outcome.latencyMs, inputTokens: outcome.inputTokens ?? null, outputTokens: outcome.outputTokens ?? null },
      });

      if (event.priceMicros > 0) {
        if (status === "succeeded") {
          const creator = await tx.wallet.upsert({ where: { userId: event.creatorId }, create: { userId: event.creatorId }, update: {} });
          await tx.wallet.update({
            where: { id: creator.id },
            data: {
              balanceMicros: { increment: BigInt(event.creatorShareMicros) },
              lifetimeEarningsMicros: { increment: BigInt(event.creatorShareMicros) },
              entries: { create: { type: "earning", amountMicros: BigInt(event.creatorShareMicros), executionId, memo: `Execution ${executionId}` } },
            },
          });
          const platform = await tx.wallet.upsert({ where: { userId: PLATFORM_USER_ID }, create: { userId: PLATFORM_USER_ID }, update: {} });
          await tx.wallet.update({
            where: { id: platform.id },
            data: {
              balanceMicros: { increment: BigInt(event.platformFeeMicros) },
              entries: { create: { type: "platform_fee", amountMicros: BigInt(event.platformFeeMicros), executionId, memo: `Fee ${executionId}` } },
            },
          });
        } else {
          const caller = await tx.wallet.findUniqueOrThrow({ where: { userId: event.callerId } });
          await tx.wallet.update({
            where: { id: caller.id },
            data: {
              balanceMicros: { increment: BigInt(event.priceMicros) },
              entries: { create: { type: "refund", amountMicros: BigInt(event.priceMicros), executionId, memo: `Refund ${executionId} (failed)` } },
            },
          });
        }
      }

      const callerWallet = await tx.wallet.findUniqueOrThrow({ where: { userId: event.callerId } });
      return {
        executionId,
        skillId: event.skillId,
        status,
        chargedUsd: status === "succeeded" ? microsToUsd(event.priceMicros) : 0,
        creatorShareUsd: status === "succeeded" ? microsToUsd(event.creatorShareMicros) : 0,
        platformFeeUsd: status === "succeeded" ? microsToUsd(event.platformFeeMicros) : 0,
        remainingBalanceUsd: Number(callerWallet.balanceMicros) / MICROS_PER_USD,
      } satisfies ExecutionReceipt;
    });
  }

  async ledger(userId: string, limit = 50) {
    const w = await this.ensureWallet(userId);
    const rows = await prisma.ledgerEntry.findMany({ where: { walletId: w.id }, orderBy: { createdAt: "desc" }, take: limit });
    return rows.map((r) => ({ id: r.id, walletId: r.walletId, type: r.type, amountMicros: Number(r.amountMicros), executionId: r.executionId, memo: r.memo, createdAt: r.createdAt.toISOString() }));
  }

  async creatorSummary(creatorId: string) {
    const grouped = await prisma.usageEvent.groupBy({
      by: ["skillId"],
      where: { creatorId, status: "succeeded" },
      _count: { _all: true },
      _sum: { creatorShareMicros: true },
    });
    const bySkill = grouped.map((g) => ({ skillId: g.skillId, executions: g._count._all, earningsUsd: microsToUsd(g._sum.creatorShareMicros ?? 0) }));
    return {
      executions: bySkill.reduce((s, b) => s + b.executions, 0),
      earningsUsd: bySkill.reduce((s, b) => s + b.earningsUsd, 0),
      bySkill,
    };
  }
}

const g = globalThis as unknown as { __synapthBilling?: BillingService };
export const billing: BillingService = g.__synapthBilling ?? (g.__synapthBilling = hasDatabase ? new PrismaBillingService() : new MemoryBillingService());
