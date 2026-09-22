/**
 * Cortex · SSRF guard for outbound fetches.
 *
 * The gateway forwards executions to URLs that any publisher can put in a
 * manifest, so every hop has to be proven public: scheme, hostname, *and* the
 * addresses DNS actually resolves to (a public name can point at 127.0.0.1 or
 * at 169.254.169.254). Redirects are followed manually so each new location
 * goes through the same check, and the response body is capped.
 */

import { lookup } from "node:dns/promises";
import { isBlockedHostname, isPrivateAddress, parseHttpUrl } from "@/lib/url-safety";

export class BlockedUrlError extends Error {
  status = 400 as const;
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

/** Opt-out for local development against a skill running on localhost. Never set in production. */
const allowPrivate = process.env.SYNAPTH_ALLOW_PRIVATE_FETCH === "1" && process.env.NODE_ENV !== "production";

/**
 * Resolves `rawUrl` and throws unless every address behind it is publicly routable.
 * Returns the parsed URL so callers fetch exactly what was validated.
 */
export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  const url = parseHttpUrl(rawUrl);
  if (!url) throw new BlockedUrlError("Only http(s) URLs without embedded credentials can be called");
  if (allowPrivate) return url;

  if (isBlockedHostname(url.hostname)) {
    throw new BlockedUrlError(`Host "${url.hostname}" is not publicly routable`);
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ""), { all: true });
  } catch {
    throw new BlockedUrlError(`Host "${url.hostname}" could not be resolved`);
  }
  if (!addresses.length) throw new BlockedUrlError(`Host "${url.hostname}" resolved to no address`);
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new BlockedUrlError(`Host "${url.hostname}" resolves to a private address (${address})`);
    }
  }
  return url;
}

export interface SafeFetchOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  /** Redirect hops to follow, each re-validated. */
  maxRedirects?: number;
  /** Hard cap on the response body we read into memory. */
  maxBytes?: number;
}

export interface SafeFetchResult {
  ok: boolean;
  status: number;
  /** Body text, truncated at `maxBytes`. */
  text: string;
  truncated: boolean;
  url: string;
}

/** `fetch()` that can only ever reach public hosts, including across redirects. */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const { method = "GET", headers = {}, body, signal, maxRedirects = 3, maxBytes = 512 * 1024 } = options;

  let target = await assertPublicUrl(rawUrl);
  for (let hop = 0; ; hop++) {
    const res = await fetch(target, {
      method,
      headers,
      body: method === "POST" ? body : undefined,
      signal,
      redirect: "manual",
      cache: "no-store",
    });

    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      if (hop >= maxRedirects) throw new BlockedUrlError("Too many redirects");
      target = await assertPublicUrl(new URL(location, target).toString());
      continue;
    }

    const { text, truncated } = await readCapped(res, maxBytes);
    return { ok: res.ok, status: res.status, text, truncated, url: target.toString() };
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const declared = Number(res.headers.get("content-length") ?? NaN);
  if (!Number.isNaN(declared) && declared > maxBytes) {
    await res.body?.cancel();
    return { text: "", truncated: true };
  }
  if (!res.body) return { text: await res.text(), truncated: false };

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.byteLength;
    if (size > maxBytes) {
      chunks.push(value.slice(0, value.byteLength - (size - maxBytes)));
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(merged), truncated };
}
