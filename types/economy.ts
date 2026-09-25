/**
 * Creator economy: wallets, per-execution charges and payouts.
 * Money is stored in integer micro-dollars (1 USD = 1_000_000) to avoid
 * floating point drift on sub-cent prices.
 */

export const MICROS_PER_USD = 1_000_000;

export type LedgerEntryType =
  | "topup" // user added funds
  | "hold" // price reserved when a paid call opens
  | "release" // hold returned when the call closes (before the charge, or instead of it)
  | "charge" // caller paid for an execution
  | "earning" // creator received their share
  | "platform_fee" // Synapth share
  | "refund"
  | "payout"; // creator withdrew

export interface Wallet {
  id: string;
  userId: string;
  /** Available balance in micro-dollars. */
  balanceMicros: number;
  /** Lifetime earnings as a creator, micro-dollars. */
  lifetimeEarningsMicros: number;
  currency: "USD";
  updatedAt: string;
}

export interface LedgerEntry {
  id: string;
  walletId: string;
  type: LedgerEntryType;
  /** Signed amount in micro-dollars (negative = debit). */
  amountMicros: number;
  /** Links a charge, earning and platform fee produced by the same execution. */
  executionId: string | null;
  memo: string;
  createdAt: string;
}

export type ExecutionStatus = "pending" | "succeeded" | "failed" | "refunded";

/** One paid call through the Synapth gateway. */
export interface UsageEvent {
  id: string;
  skillId: string;
  skillVersion: string;
  callerId: string;
  creatorId: string;
  toolName: string | null;
  status: ExecutionStatus;
  priceMicros: number;
  platformFeeMicros: number;
  creatorShareMicros: number;
  /** Key that made the call; null for sessions. */
  apiKeyId: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Upstream HTTP status and response size (author quality monitoring). */
  httpStatus: number | null;
  responseBytes: number | null;
  /** SHA-256 of the input payload; the payload itself is never stored. */
  inputHash: string;
  createdAt: string;
}

export interface ExecutionReceipt {
  executionId: string;
  skillId: string;
  status: ExecutionStatus;
  chargedUsd: number;
  creatorShareUsd: number;
  platformFeeUsd: number;
  remainingBalanceUsd: number;
}

export function usdToMicros(usd: number): number {
  return Math.round(usd * MICROS_PER_USD);
}

export function microsToUsd(micros: number): number {
  return micros / MICROS_PER_USD;
}
