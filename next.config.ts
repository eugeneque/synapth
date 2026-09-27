import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

/**
 * Content-Security-Policy.
 *
 * Next's inline bootstrap and React's inline styles mean `unsafe-inline` stays
 * for now; everything else is locked to this origin. `connect-src` is `self`
 * because the browser client only ever talks to `/api/v1`. Images allow
 * `data:` (profile uploads) and GitHub's avatar/raw hosts (README content).
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://avatars.githubusercontent.com https://raw.githubusercontent.com https://camo.githubusercontent.com https://img.shields.io",
  "media-src 'self'",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "worker-src 'self' blob:",
  ...(isProd ? ["upgrade-insecure-requests"] : []),
].join("; ");

/** Applied to every response; the API adds its own CORS rules on top. */
const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
];

/**
 * Public, unauthenticated catalogue reads — safe to call from any origin.
 * Everything else under `/api/v1` (account, wallet, notifications, crawl,
 * import, execute) is same-origin only: those answer to a session cookie or an
 * API key and must not be reachable from a third-party page.
 */
const PUBLIC_API_PATHS = ["/api/v1/skills", "/api/v1/skills/:path*", "/api/v1/skillsets", "/api/v1/skillsets/:path*", "/api/v1/search"];

const corsHeaders = [
  { key: "Access-Control-Allow-Origin", value: "*" },
  { key: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" },
  { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization, X-Agent-Request, X-Synapth-Key" },
  { key: "Access-Control-Max-Age", value: "600" },
  { key: "Vary", value: "Origin" },
  // Catalogue data is meant to be embedded by agents and IDEs.
  { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Docker copies the traced standalone server into a small runtime image.
  // Netlify keeps its normal OpenNext output unless explicitly requested.
  ...(process.env.SYNAPTH_STANDALONE === "1" ? { output: "standalone" } : {}),
  // Lets a second dev server / build run beside the default one without sharing `.next`.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  poweredByHeader: false,
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "raw.githubusercontent.com" },
    ],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      ...PUBLIC_API_PATHS.map((source) => ({ source, headers: corsHeaders })),
    ];
  },
};

export default nextConfig;
