export { auth as middleware } from "@/cortex/auth";

export const config = {
  // Skip static assets and the agent API (agents authenticate with X-Synapth-Key, not cookies) and the cron hook (bearer secret).
  matcher: ["/((?!api/v1|api/cron|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
