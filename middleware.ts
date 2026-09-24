export { auth as middleware } from "@/cortex/auth";

/**
 * The Auth.js middleware re-issues the session cookie on every response it touches (sliding
 * expiry). Run it only for real console navigations: on a server action or a prefetch that is
 * in flight during sign-out it would write the just-deleted cookie back and resurrect the session.
 * Pages outside the console read the session themselves, and the console layout re-checks it.
 * `config` must stay literal: Next parses it statically.
 */
export const config = {
  matcher: [
    { source: "/dashboard/:path*", missing: [{ type: "header", key: "next-action" }, { type: "header", key: "next-router-prefetch" }] },
    { source: "/publish/:path*", missing: [{ type: "header", key: "next-action" }, { type: "header", key: "next-router-prefetch" }] },
  ],
};
