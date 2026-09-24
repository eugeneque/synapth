/**
 * Cortex · Outgoing mail.
 *
 * One transport: the Resend HTTP API (`RESEND_API_KEY`), called with plain
 * `fetch` so there is no SDK to keep up to date. Without a key the message is
 * printed to the server console instead — enough for local development, where
 * the sign-up code is read from the terminal.
 *
 * The endpoint is a fixed constant, never user data, so this is not a
 * `safeFetch()` case.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "Synapth <noreply@synapth.dev>";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** True when messages actually leave the server. */
export function mailerConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/** Test hook: the last messages "sent" through the console transport. */
const g = globalThis as unknown as { __synapthOutbox_v1?: MailMessage[] };
export const consoleOutbox: MailMessage[] = g.__synapthOutbox_v1 ?? (g.__synapthOutbox_v1 = []);

export class MailDeliveryError extends Error {
  status = 502 as const;
  constructor(detail: string) {
    super(`Email delivery failed: ${detail}`);
    this.name = "MailDeliveryError";
  }
}

export async function sendMail(message: MailMessage): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    consoleOutbox.push(message);
    if (consoleOutbox.length > 50) consoleOutbox.shift();
    if (process.env.NODE_ENV !== "test") console.info(`[mailer] (console transport) to=${message.to} subject="${message.subject}"\n${message.text}`);
    return;
  }

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM || DEFAULT_FROM, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    // Resend's body names the problem (unverified domain, bad key); keep it in server logs only.
    console.error(`[mailer] Resend ${res.status}: ${(await res.text().catch(() => "")).slice(0, 500)}`);
    throw new MailDeliveryError(`provider answered ${res.status}`);
  }
}
