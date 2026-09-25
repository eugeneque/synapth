"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z, ZodError } from "zod";
import { requireUser } from "@/cortex/auth";
import { enforceRateLimit, RateLimitError } from "@/cortex/rate-limit";
import { cancelSubscription, PaymentError, resumeSubscription, settleMockPayment, startCheckout, type CheckoutOutcome } from "@/cortex/payments";
import { PaymentProviderError } from "@/cortex/payment-providers";
import { getProfile } from "@/cortex/account";
import { BILLING_PERIODS, PAYMENT_METHODS, PAYMENT_PROVIDERS, PLAN_IDS, TOPUP_MAX_USD, TOPUP_MIN_USD } from "@/types/billing";

const checkoutSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("subscription"), plan: z.enum(PLAN_IDS), period: z.enum(BILLING_PERIODS), seats: z.number().int().min(1).max(1000).optional(), method: z.enum(PAYMENT_METHODS), provider: z.enum(PAYMENT_PROVIDERS).optional() }),
  z.object({ kind: z.literal("topup"), amountUsd: z.number().min(TOPUP_MIN_USD).max(TOPUP_MAX_USD), method: z.enum(PAYMENT_METHODS), provider: z.enum(PAYMENT_PROVIDERS).optional() }),
]);

export type CheckoutActionResult = { ok: true; outcome: CheckoutOutcome } | { ok: false; error: string };

/** Where the provider sends the browser back: the configured site URL, else this request's origin. */
async function returnBase(): Promise<string> {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${h.get("x-forwarded-proto") ?? "https"}://${host}`;
}

export async function checkoutAction(input: z.input<typeof checkoutSchema>): Promise<CheckoutActionResult> {
  const user = await requireUser();
  try {
    enforceRateLimit("checkout", `user:${user.id}`);
    const v = checkoutSchema.parse(input);
    const profile = await getProfile(user.id);
    const outcome = await startCheckout(user.id, v, { returnBase: await returnBase(), email: profile?.email ?? null });
    revalidatePath("/dashboard/billing");
    return { ok: true, outcome };
  } catch (err) {
    if (err instanceof RateLimitError) return { ok: false, error: `Too many attempts, retry in ${err.result.retryAfter}s` };
    if (err instanceof PaymentError || err instanceof PaymentProviderError) return { ok: false, error: err.message };
    if (err instanceof ZodError) return { ok: false, error: `${err.issues[0].path.join(".")}: ${err.issues[0].message}` };
    throw err;
  }
}

export async function cancelAction(): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  enforceRateLimit("write", `user:${user.id}`);
  try {
    await cancelSubscription(user.id);
  } catch (err) {
    if (err instanceof PaymentError) return { ok: false, error: err.message };
    throw err;
  }
  revalidatePath("/dashboard/billing");
  return { ok: true };
}

export async function resumeAction(): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  enforceRateLimit("write", `user:${user.id}`);
  try {
    await resumeSubscription(user.id);
  } catch (err) {
    if (err instanceof PaymentError) return { ok: false, error: err.message };
    throw err;
  }
  revalidatePath("/dashboard/billing");
  return { ok: true };
}

/** The mock checkout page's «Pay» / «Decline» buttons (development and demos only). */
export async function settleMockAction(paymentId: string, outcome: "succeeded" | "failed"): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  enforceRateLimit("write", `user:${user.id}`);
  try {
    await settleMockPayment(user.id, z.string().max(64).parse(paymentId), outcome);
  } catch (err) {
    if (err instanceof PaymentError) return { ok: false, error: err.message };
    throw err;
  }
  revalidatePath("/dashboard/billing");
  return { ok: true };
}
