import { json, withErrors } from "@/lib/api";
import { clientIp, enforceRateLimit } from "@/cortex/rate-limit";
import { RegistrationError, registerWithPassword } from "@/cortex/registration";
import { getLocale } from "@/cortex/locale";

export const POST = withErrors(async (request: Request) => {
  enforceRateLimit("register", `ip:${clientIp(request)}`);
  try {
    // The locale picks the language of the confirmation email.
    const user = await registerWithPassword(await request.json(), { locale: await getLocale() });
    return json(user, { status: 201 });
  } catch (err) {
    // The machine-readable code lets the form show a localized message.
    if (err instanceof RegistrationError) return json({ error: err.message, code: err.code }, { status: err.status });
    throw err;
  }
});
