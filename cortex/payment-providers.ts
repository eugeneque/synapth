/**
 * Cortex · Payment providers (ТЗ §4.6, §5.4): ЮKassa, CloudPayments, mock.
 *
 * Every provider does the same three things:
 *   createPayment — open a hosted checkout and return the URL the browser is
 *                   redirected to (card or СБП); the provider sends the user
 *                   back to `returnUrl` afterwards;
 *   verifyWebhook — authenticate a notification and say which payment it is
 *                   about and in which state (never trust the body alone);
 *   chargeSaved   — renew with a saved payment method (optional).
 *
 * The status a webhook reports is applied by `cortex/payments.ts`, which is
 * idempotent: providers retry notifications.
 *
 * Credentials come from env and never reach the client:
 *   YOOKASSA_SHOP_ID + YOOKASSA_SECRET_KEY
 *   CLOUDPAYMENTS_PUBLIC_ID + CLOUDPAYMENTS_API_SECRET
 *   SYNAPTH_PAYMENTS_MOCK=1 — the mock checkout (always on without a real provider outside production)
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Payment, PaymentMethod, PaymentProviderId, PaymentStatus } from "@/types/billing";

export interface CheckoutRequest {
  payment: Pick<Payment, "id" | "amount" | "currency" | "description" | "method" | "userId" | "kind">;
  /** Absolute URL the provider sends the browser back to. */
  returnUrl: string;
  /** Ask the provider to keep the method for renewals (subscriptions). */
  savePaymentMethod: boolean;
  email?: string | null;
}

export interface CheckoutResult {
  providerPaymentId: string;
  confirmationUrl: string;
}

export interface WebhookEvent {
  providerPaymentId: string;
  /** Our payment id when the provider echoes it back (metadata / InvoiceId). */
  paymentId: string | null;
  status: PaymentStatus;
  paymentMethodId: string | null;
  failureReason: string | null;
}

export interface PaymentProvider {
  id: PaymentProviderId;
  /** Currencies the provider settles in. */
  currencies: ReadonlyArray<Payment["currency"]>;
  methods: ReadonlyArray<PaymentMethod>;
  configured(): boolean;
  createPayment(req: CheckoutRequest): Promise<CheckoutResult>;
  /** Authenticates the notification; null when it is not ours or not authentic. */
  verifyWebhook(request: Request, rawBody: string): Promise<WebhookEvent | null>;
  /** The provider's view of a payment (reconciliation, return-page refresh). */
  fetchStatus?(providerPaymentId: string): Promise<WebhookEvent | null>;
  chargeSaved?(req: Omit<CheckoutRequest, "returnUrl" | "savePaymentMethod"> & { paymentMethodId: string }): Promise<WebhookEvent>;
}

export class PaymentProviderError extends Error {
  status = 502 as const;
  constructor(message: string) {
    super(message);
    this.name = "PaymentProviderError";
  }
}

const minorToMajor = (amount: number) => (amount / 100).toFixed(2);

// ---------------------------------------------------------------------------
// ЮKassa — https://yookassa.ru/developer/api
// ---------------------------------------------------------------------------

const YOOKASSA_API = "https://api.yookassa.ru/v3";

type YooPayment = {
  id: string;
  status: "pending" | "waiting_for_capture" | "succeeded" | "canceled";
  confirmation?: { confirmation_url?: string };
  payment_method?: { id?: string; saved?: boolean };
  metadata?: { paymentId?: string };
  cancellation_details?: { reason?: string };
};

function yooStatus(p: YooPayment): PaymentStatus {
  if (p.status === "succeeded") return "succeeded";
  if (p.status === "canceled") return p.cancellation_details?.reason === "expired_on_confirmation" ? "canceled" : "failed";
  return "pending";
}

const yooEvent = (p: YooPayment): WebhookEvent => ({
  providerPaymentId: p.id,
  paymentId: p.metadata?.paymentId ?? null,
  status: yooStatus(p),
  paymentMethodId: p.payment_method?.saved ? (p.payment_method.id ?? null) : null,
  failureReason: p.cancellation_details?.reason ?? null,
});

export const yookassa: PaymentProvider = {
  id: "yookassa",
  currencies: ["RUB"],
  methods: ["card", "sbp"],
  configured: () => Boolean(process.env.YOOKASSA_SHOP_ID && process.env.YOOKASSA_SECRET_KEY),
  async createPayment(req) {
    const p = await yooRequest<YooPayment>("/payments", {
      method: "POST",
      idempotenceKey: req.payment.id,
      body: {
        amount: { value: minorToMajor(req.payment.amount), currency: req.payment.currency },
        capture: true,
        description: req.payment.description.slice(0, 128),
        confirmation: { type: "redirect", return_url: req.returnUrl },
        payment_method_data: { type: req.payment.method === "sbp" ? "sbp" : "bank_card" },
        save_payment_method: req.savePaymentMethod && req.payment.method === "card",
        metadata: { paymentId: req.payment.id, userId: req.payment.userId, kind: req.payment.kind },
        ...(req.email ? { receipt: { customer: { email: req.email }, items: [{ description: req.payment.description.slice(0, 128), quantity: "1.00", amount: { value: minorToMajor(req.payment.amount), currency: req.payment.currency }, vat_code: 1 }] } } : {}),
      },
    });
    if (!p.confirmation?.confirmation_url) throw new PaymentProviderError("ЮKassa did not return a confirmation URL");
    return { providerPaymentId: p.id, confirmationUrl: p.confirmation.confirmation_url };
  },
  /**
   * ЮKassa does not sign notifications: the body only names a payment, and the
   * authoritative state is fetched back from the API with our credentials.
   */
  async verifyWebhook(_request, rawBody) {
    let body: { object?: { id?: string } };
    try {
      body = JSON.parse(rawBody);
    } catch {
      return null;
    }
    const id = body.object?.id;
    if (!id || !/^[\w-]{10,64}$/.test(id)) return null;
    return this.fetchStatus!(id);
  },
  async fetchStatus(providerPaymentId) {
    const p = await yooRequest<YooPayment>(`/payments/${encodeURIComponent(providerPaymentId)}`, { method: "GET" }).catch(() => null);
    return p ? yooEvent(p) : null;
  },
  async chargeSaved(req) {
    const p = await yooRequest<YooPayment>("/payments", {
      method: "POST",
      idempotenceKey: req.payment.id,
      body: {
        amount: { value: minorToMajor(req.payment.amount), currency: req.payment.currency },
        capture: true,
        description: req.payment.description.slice(0, 128),
        payment_method_id: req.paymentMethodId,
        metadata: { paymentId: req.payment.id, userId: req.payment.userId, kind: req.payment.kind },
      },
    });
    return yooEvent(p);
  },
};

async function yooRequest<T>(path: string, { method, body, idempotenceKey }: { method: "GET" | "POST"; body?: unknown; idempotenceKey?: string }): Promise<T> {
  const auth = Buffer.from(`${process.env.YOOKASSA_SHOP_ID}:${process.env.YOOKASSA_SECRET_KEY}`).toString("base64");
  const res = await fetch(`${YOOKASSA_API}${path}`, {
    method,
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json", ...(idempotenceKey ? { "Idempotence-Key": idempotenceKey } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) throw new PaymentProviderError(`ЮKassa responded ${res.status}`);
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// CloudPayments — https://developers.cloudpayments.ru
// ---------------------------------------------------------------------------

const CP_API = "https://api.cloudpayments.ru";

export const cloudpayments: PaymentProvider = {
  id: "cloudpayments",
  currencies: ["RUB", "USD"],
  methods: ["card", "sbp"],
  configured: () => Boolean(process.env.CLOUDPAYMENTS_PUBLIC_ID && process.env.CLOUDPAYMENTS_API_SECRET),
  /** A hosted order page (`orders/create`) — the redirect flow without the JS widget. */
  async createPayment(req) {
    const auth = Buffer.from(`${process.env.CLOUDPAYMENTS_PUBLIC_ID}:${process.env.CLOUDPAYMENTS_API_SECRET}`).toString("base64");
    const res = await fetch(`${CP_API}/orders/create`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json", "X-Request-ID": req.payment.id },
      body: JSON.stringify({
        Amount: Number(minorToMajor(req.payment.amount)),
        Currency: req.payment.currency,
        Description: req.payment.description.slice(0, 128),
        InvoiceId: req.payment.id,
        AccountId: req.payment.userId,
        Email: req.email ?? undefined,
        RequireConfirmation: false,
        SendEmail: false,
        SuccessRedirectUrl: req.returnUrl,
        FailRedirectUrl: req.returnUrl,
        JsonData: { paymentId: req.payment.id, kind: req.payment.kind, saveMethod: req.savePaymentMethod },
      }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as { Success?: boolean; Message?: string; Model?: { Id?: string; Url?: string } } | null;
    if (!res.ok || !body?.Success || !body.Model?.Url || !body.Model.Id) throw new PaymentProviderError(`CloudPayments refused the order${body?.Message ? `: ${body.Message}` : ""}`);
    return { providerPaymentId: body.Model.Id, confirmationUrl: body.Model.Url };
  },
  /** Pay / Fail notifications carry `Content-HMAC` = base64(HMAC-SHA256(body, ApiSecret)). */
  async verifyWebhook(request, rawBody) {
    const secret = process.env.CLOUDPAYMENTS_API_SECRET;
    const sent = request.headers.get("content-hmac") ?? request.headers.get("x-content-hmac");
    if (!secret || !sent) return null;
    const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
    const given = Buffer.from(sent, "base64");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

    const params = new URLSearchParams(rawBody);
    const get = (k: string) => params.get(k) ?? (safeJson(rawBody) as Record<string, string> | null)?.[k] ?? null;
    const invoiceId = get("InvoiceId");
    const transactionId = get("TransactionId");
    const status = get("Status");
    if (!invoiceId || !transactionId) return null;
    const paid = status === "Completed" || status === "Authorized";
    const failed = !paid && (request.url.includes("/fail") || get("Reason") !== null);
    return {
      providerPaymentId: transactionId,
      paymentId: invoiceId,
      status: paid ? "succeeded" : failed ? "failed" : "pending",
      paymentMethodId: get("Token"),
      failureReason: get("Reason"),
    };
  },
};

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Mock — a local checkout page for development and demos
// ---------------------------------------------------------------------------

export const mockProvider: PaymentProvider = {
  id: "mock",
  currencies: ["RUB", "USD"],
  methods: ["card", "sbp", "invoice"],
  configured: () => process.env.SYNAPTH_PAYMENTS_MOCK === "1" || (process.env.NODE_ENV !== "production" && !yookassa.configured() && !cloudpayments.configured()),
  async createPayment(req) {
    // Same origin as the return URL, so the test checkout works on any host.
    return { providerPaymentId: `mock_${req.payment.id}`, confirmationUrl: new URL(`/dashboard/billing/checkout/${encodeURIComponent(req.payment.id)}`, req.returnUrl).toString() };
  },
  /** The mock page calls `settleMockPayment` directly; there are no mock webhooks. */
  async verifyWebhook() {
    return null;
  },
  async chargeSaved(req) {
    return { providerPaymentId: `mock_${req.payment.id}`, paymentId: req.payment.id, status: "succeeded", paymentMethodId: req.paymentMethodId, failureReason: null };
  },
};

export const PROVIDERS: Record<PaymentProviderId, PaymentProvider> = { yookassa, cloudpayments, mock: mockProvider };

/** Providers the checkout can offer for a currency, real ones first. */
export function availableProviders(currency: Payment["currency"]): PaymentProvider[] {
  return [yookassa, cloudpayments, mockProvider].filter((p) => p.configured() && p.currencies.includes(currency));
}
