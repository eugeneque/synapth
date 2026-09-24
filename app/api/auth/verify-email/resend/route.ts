import { z } from "zod";
import { json, withErrors } from "@/lib/api";
import { clientIp, enforceRateLimit } from "@/cortex/rate-limit";
import { issueEmailCode } from "@/cortex/email-verification";
import { MailDeliveryError } from "@/cortex/mailer";
import { getLocale } from "@/cortex/locale";

const bodySchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) });

/** Mails a new code. Same `ok` for unknown or confirmed addresses: the endpoint does not enumerate accounts. */
export const POST = withErrors(async (request: Request) => {
  const { email } = bodySchema.parse(await request.json());
  enforceRateLimit("emailCode", `ip:${clientIp(request)}`);
  enforceRateLimit("emailCode", `email:${email}`);
  try {
    await issueEmailCode(email, await getLocale());
  } catch (err) {
    if (err instanceof MailDeliveryError) return json({ error: err.message, code: "delivery_failed" }, { status: 502 });
    throw err;
  }
  return json({ ok: true });
});
