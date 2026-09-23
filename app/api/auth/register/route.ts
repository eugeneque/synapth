import { json, withErrors } from "@/lib/api";
import { clientIp, enforceRateLimit } from "@/cortex/rate-limit";
import { RegistrationError, registerWithPassword } from "@/cortex/registration";

export const POST = withErrors(async (request: Request) => {
  enforceRateLimit("register", `ip:${clientIp(request)}`);
  try {
    const user = await registerWithPassword(await request.json());
    return json(user, { status: 201 });
  } catch (err) {
    // The machine-readable code lets the form show a localized message.
    if (err instanceof RegistrationError) return json({ error: err.message, code: err.code }, { status: err.status });
    throw err;
  }
});
