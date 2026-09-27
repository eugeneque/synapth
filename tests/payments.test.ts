import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { addPeriod, applyPaymentEvent, cancelSubscription, currentPlanId, effectiveStatus, getSubscriptionRow, listPayments, quotePlanChange, resetPaymentsForTests, settleMockPayment, startCheckout } from "@/cortex/payments";
import { cloudpayments } from "@/cortex/payment-providers";
import { billing } from "@/cortex/billing";
import { enforceAgentQuota, QuotaExceededError, resetUsageForTests } from "@/cortex/plans";
import { PLANS, planPrice, DUNNING } from "@/types/billing";

const base = { returnBase: "https://synapth.test" };

test("subscription checkout via the mock provider: redirect → pay → Pro is live", async () => {
  resetPaymentsForTests();
  const out = await startCheckout("usr_pay1", { kind: "subscription", plan: "pro", period: "month", method: "card" }, base);
  assert.equal(out.kind, "redirect");
  if (out.kind !== "redirect") return;
  assert.match(out.url, /\/dashboard\/billing\/checkout\//);
  assert.equal(await currentPlanId("usr_pay1"), "free", "nothing changes before payment");
  const [pending] = await listPayments("usr_pay1");
  assert.equal(pending.status, "pending");
  assert.equal(pending.amount, PLANS.pro.price.month);

  await settleMockPayment("usr_pay1", out.paymentId, "succeeded");
  assert.equal(await currentPlanId("usr_pay1"), "pro");
  const sub = (await getSubscriptionRow("usr_pay1"))!;
  assert.equal(sub.currentPeriodEnd, addPeriod(sub.currentPeriodStart, "month"));
  assert.ok(sub.paymentMethodId, "method saved for renewals");
  await assert.rejects(settleMockPayment("usr_other", out.paymentId, "succeeded"), "only the owner");
});

test("upgrade is prorated and immediate; downgrade waits for the period end; cancel keeps the plan", async () => {
  resetPaymentsForTests();
  const first = await startCheckout("usr_pay2", { kind: "subscription", plan: "pro", period: "month", method: "card" }, base);
  if (first.kind === "redirect") await settleMockPayment("usr_pay2", first.paymentId, "succeeded");

  const quote = await quotePlanChange("usr_pay2", "team", "month", 3);
  assert.equal(quote.change, "upgrade");
  const full = planPrice(PLANS.team, "month", 3)! - PLANS.pro.price.month!;
  assert.ok(quote.amount > 0 && quote.amount <= full, "prorated difference");

  const up = await startCheckout("usr_pay2", { kind: "subscription", plan: "team", period: "month", seats: 3, method: "card" }, base);
  if (up.kind === "redirect") await settleMockPayment("usr_pay2", up.paymentId, "succeeded");
  assert.equal(await currentPlanId("usr_pay2"), "team");
  assert.equal((await getSubscriptionRow("usr_pay2"))!.seats, 3);

  const down = await startCheckout("usr_pay2", { kind: "subscription", plan: "pro", period: "month", method: "card" }, base);
  assert.equal(down.kind, "scheduled");
  assert.equal(await currentPlanId("usr_pay2"), "team", "still Team until the period ends");
  assert.equal((await getSubscriptionRow("usr_pay2"))!.pendingPlan, "pro");

  const canceled = await cancelSubscription("usr_pay2");
  assert.equal(canceled.cancelAtPeriodEnd, true);
  assert.equal(await currentPlanId("usr_pay2"), "team");
  assert.equal(effectiveStatus(canceled, Date.parse(canceled.currentPeriodEnd) + 1000), "canceled");
});

test("a failed renewal keeps the plan through the grace window", () => {
  const now = Date.now();
  const sub = { id: "s", userId: "u", plan: "pro" as const, period: "month" as const, seats: 1, status: "past_due" as const, currentPeriodStart: new Date(now - 40 * 86_400_000).toISOString(), currentPeriodEnd: new Date(now - 86_400_000).toISOString(), cancelAtPeriodEnd: false, pendingPlan: null, provider: "mock" as const, paymentMethodId: null, createdAt: "", updatedAt: "" };
  assert.equal(effectiveStatus(sub, now), "grace");
  assert.equal(effectiveStatus(sub, now + DUNNING.graceDays * 86_400_000), "canceled");
});

test("top-ups credit the wallet exactly once, however often the provider retries", async () => {
  resetPaymentsForTests();
  const before = (await billing.getWallet("usr_pay3")).balanceMicros;
  const out = await startCheckout("usr_pay3", { kind: "topup", amountUsd: 20, method: "card" }, base);
  assert.equal(out.kind, "redirect");
  if (out.kind !== "redirect") return;
  const event = { providerPaymentId: `mock_${out.paymentId}`, paymentId: out.paymentId, status: "succeeded" as const, paymentMethodId: null, failureReason: null };
  await applyPaymentEvent("mock", event);
  await applyPaymentEvent("mock", event);
  assert.equal((await billing.getWallet("usr_pay3")).balanceMicros - before, 20_000_000);
  // A notification naming another provider's payment is ignored.
  assert.equal(await applyPaymentEvent("yookassa", event), null);
  await assert.rejects(startCheckout("usr_pay3", { kind: "topup", amountUsd: 0.5, method: "card" }, base));
});

test("CloudPayments webhooks are accepted only with a valid Content-HMAC", async () => {
  process.env.CLOUDPAYMENTS_API_SECRET = "cp_secret";
  try {
    const body = "InvoiceId=pay_1&TransactionId=777&Status=Completed&Token=tk_1";
    const sign = (b: string) => createHmac("sha256", "cp_secret").update(b).digest("base64");
    const req = (hmac: string) => new Request("https://synapth.test/api/v1/billing/webhook/cloudpayments", { method: "POST", headers: { "Content-HMAC": hmac } });
    const ok = await cloudpayments.verifyWebhook(req(sign(body)), body);
    assert.deepEqual(ok, { providerPaymentId: "777", paymentId: "pay_1", status: "succeeded", paymentMethodId: "tk_1", failureReason: null });
    assert.equal(await cloudpayments.verifyWebhook(req(sign(body + "x")), body), null);
    assert.equal(await cloudpayments.verifyWebhook(req("bogus"), body), null);
  } finally {
    delete process.env.CLOUDPAYMENTS_API_SECRET;
  }
});

test("daily agent quotas follow the plan", async () => {
  resetUsageForTests();
  const now = Date.UTC(2026, 8, 25, 12);
  for (let i = 0; i < PLANS.free.limits.resolvePerDay; i++) await enforceAgentQuota("usr_quota", "resolve", now, "free");
  await assert.rejects(enforceAgentQuota("usr_quota", "resolve", now, "free"), (e: unknown) => e instanceof QuotaExceededError && e.quota === "resolvePerDay" && e.retryAfter === 12 * 3600);
  await enforceAgentQuota("usr_quota", "request", now, "free");
  await enforceAgentQuota("usr_quota", "resolve", now, "pro");
  await enforceAgentQuota("usr_quota", "resolve", now + 86_400_000, "free");
});
