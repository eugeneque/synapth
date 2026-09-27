/**
 * POST /api/v1/billing/webhook/yookassa | cloudpayments
 *
 * Provider notifications. Each adapter authenticates its own way (ЮKassa: the
 * payment is re-read from the API; CloudPayments: HMAC of the raw body), and
 * `applyPaymentEvent` is idempotent, so retries are harmless. Always answers
 * quickly: CloudPayments expects `{"code":0}`, ЮKassa any 200.
 */

import { NextResponse } from "next/server";
import { PROVIDERS } from "@/cortex/payment-providers";
import { applyPaymentEvent } from "@/cortex/payments";
import { enforceRequestLimit, RateLimitError } from "@/cortex/rate-limit";
import type { PaymentProviderId } from "@/types/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ provider: string }> };

export async function POST(request: Request, { params }: Ctx) {
  const { provider: id } = await params;
  if (id !== "yookassa" && id !== "cloudpayments") return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  const provider = PROVIDERS[id as PaymentProviderId];
  if (!provider.configured()) return NextResponse.json({ error: "Provider not configured" }, { status: 404 });
  try {
    enforceRequestLimit("write", request);
  } catch (err) {
    if (err instanceof RateLimitError) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    throw err;
  }
  const raw = await request.text();
  if (raw.length > 64 * 1024) return NextResponse.json({ error: "Too large" }, { status: 413 });
  const event = await provider.verifyWebhook(request, raw);
  // Not authentic or not ours: 200 anyway for CloudPayments' «code» contract, but nothing is applied.
  if (!event) return NextResponse.json(id === "cloudpayments" ? { code: 13 } : { ok: false }, { status: id === "cloudpayments" ? 200 : 400 });
  await applyPaymentEvent(provider.id, event);
  return NextResponse.json(id === "cloudpayments" ? { code: 0 } : { ok: true });
}
