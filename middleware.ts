export { auth as middleware } from "@/cortex/auth";

export const config = {
  // Skip static assets and the agent API (agents authenticate with X-Synapth-Key, not cookies).
  matcher: ["/((?!api/v1|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
