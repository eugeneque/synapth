import { z } from "zod";
import { json, withErrors } from "@/lib/api";
import { clientIp, enforceRateLimit } from "@/cortex/rate-limit";
import { EmailVerificationError, confirmEmailCode } from "@/cortex/email-verification";

const bodySchema = z.object({ email: z.string().trim().toLowerCase().email().max(254), code: z.string().max(32) });

/** Confirms a signup address with the mailed code; the client then signs in with the password it still holds. */
export const POST = withErrors(async (request: Request) => {
  enforceRateLimit("emailVerify", `ip:${clientIp(request)}`);
  const { email, code } = bodySchema.parse(await request.json());
  try {
    await confirmEmailCode(email, code);
    return json({ ok: true });
  } catch (err) {
    if (err instanceof EmailVerificationError) return json({ error: err.message, code: err.code }, { status: err.status });
    throw err;
  }
});
