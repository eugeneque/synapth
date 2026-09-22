/**
 * Isomorphic URL hardening.
 *
 * `z.string().url()` happily accepts `javascript:`, `data:` and `file:` — every
 * user-supplied URL that ends up in an `href` or in a server-side `fetch()` has
 * to go through here first. The literal-IP checks below are the cheap half of
 * SSRF defence; the DNS half lives in `cortex/ssrf.ts` (server only).
 */

import { z } from "zod";

export const ALLOWED_URL_PROTOCOLS = ["http:", "https:"] as const;

/** Parsed URL when `value` is a syntactically valid http(s) URL with a host, otherwise null. */
export function parseHttpUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!(ALLOWED_URL_PROTOCOLS as readonly string[]).includes(url.protocol)) return null;
  if (!url.hostname) return null;
  // Credentials in the URL are a redirect/confusion vector and never legitimate here.
  if (url.username || url.password) return null;
  return url;
}

export function isHttpUrl(value: unknown): boolean {
  return parseHttpUrl(value) !== null;
}

/** Zod field for any user-supplied URL: http(s) only, length-capped, normalised. */
export function httpUrlSchema({ max = 500 }: { max?: number } = {}) {
  return z
    .string()
    .trim()
    .max(max)
    .refine(isHttpUrl, { message: "only http(s) URLs are allowed" });
}

/**
 * Safe value for an `href` rendered from user content: anything that is not a
 * plain http(s) URL collapses to `undefined` so React renders no link target.
 */
export function safeExternalHref(value: unknown): string | undefined {
  return parseHttpUrl(value)?.toString();
}

/**
 * Post-login redirect target. Only a path inside this app is accepted:
 * `?callbackUrl=https://evil.example` would otherwise bounce a freshly
 * authenticated user off-site (open redirect / credential phishing).
 */
export function safeCallbackPath(value: unknown, fallback = "/dashboard"): string {
  if (typeof value !== "string" || !value.startsWith("/")) return fallback;
  // `//evil.example` and `/\evil.example` are protocol-relative URLs, not paths.
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}

/** Image MIME types accepted in a stored `data:` URL; mirrors `types/profile.ts`. */
const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * Safe value for an `<img src>` built from stored profile data: an uploaded
 * base64 image or an https URL. Rows written before validation landed (and any
 * future writer) cannot smuggle another scheme into the markup.
 */
export function safeImageSrc(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  if (value.startsWith("data:")) return IMAGE_DATA_URL.test(value) ? value : undefined;
  const url = parseHttpUrl(value);
  return url?.protocol === "https:" ? url.toString() : undefined;
}

// ---------------------------------------------------------------------------
// Literal-IP / private-range detection
// ---------------------------------------------------------------------------

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Hostnames that must never be reachable from a server-side fetch. */
const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback", "metadata", "metadata.google.internal", "metadata.goog"]);

/** `.local`/`.internal`-style suffixes used by mDNS and cloud private zones. */
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home.arpa"];

export function isPrivateIpv4(ip: string): boolean {
  const m = ip.match(IPV4);
  if (!m) return false;
  const [a, b] = m.slice(1).map(Number);
  if (m.slice(1).some((p) => Number(p) > 255)) return true; // malformed → treat as unsafe
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254 cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 + 192.0.2.0/24 (TEST-NET-1)
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

export function isPrivateIpv6(ip: string): boolean {
  const addr = ip.replace(/^\[|\]$/g, "").toLowerCase();
  if (addr === "::" || addr === "::1") return true;
  if (addr.startsWith("fe80") || addr.startsWith("fec0")) return true; // link-local / site-local
  if (/^f[cd]/.test(addr)) return true; // unique local fc00::/7
  // IPv4-mapped / NAT64 forms carry the v4 address at the tail.
  const tail = addr.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (tail && isPrivateIpv4(tail[1])) return true;
  if (addr.startsWith("::ffff:") || addr.startsWith("64:ff9b:")) return true;
  return false;
}

export function isPrivateAddress(value: string): boolean {
  return isPrivateIpv4(value) || isPrivateIpv6(value);
}

/** True when the hostname is obviously not routable on the public internet. */
export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!host) return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  if (!host.includes(".") && !host.includes(":")) return true; // bare single-label host → internal DNS
  return isPrivateAddress(host);
}

/** Cheap pre-flight for stored URLs (publish time); `assertPublicUrl()` re-checks with DNS at fetch time. */
export function isPubliclyRoutableUrl(value: unknown): boolean {
  const url = parseHttpUrl(value);
  return url !== null && !isBlockedHostname(url.hostname);
}
