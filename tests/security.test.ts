import test from "node:test";
import assert from "node:assert/strict";
import { isPubliclyRoutableUrl, isBlockedHostname, isHttpUrl, parseHttpUrl, safeCallbackPath, safeExternalHref, safeImageSrc } from "@/lib/url-safety";
import { assertPublicUrl, BlockedUrlError } from "@/cortex/ssrf";
import { enforceRateLimit, hit, RateLimitError, resetRateLimits } from "@/cortex/rate-limit";
import { parseRepoUrl } from "@/lib/github-parser";

test("only http(s) URLs survive validation", () => {
  for (const ok of ["https://example.com/x", "http://example.com", "https://example.com:8443/a?b=c"]) {
    assert.ok(isHttpUrl(ok), ok);
  }
  for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>", "file:///etc/passwd", "vbscript:x", "gopher://x", "", "   ", "https://user:pw@example.com"]) {
    assert.ok(!isHttpUrl(bad), bad);
  }
});

test("safeExternalHref strips anything that is not a link", () => {
  assert.equal(safeExternalHref("https://example.com/"), "https://example.com/");
  assert.equal(safeExternalHref("javascript:alert(1)"), undefined);
  assert.equal(safeExternalHref(null), undefined);
});

test("safeImageSrc accepts uploads and https, nothing else", () => {
  assert.ok(safeImageSrc("data:image/png;base64,iVBORw0KGgo="));
  assert.ok(safeImageSrc("https://avatars.githubusercontent.com/u/1"));
  assert.equal(safeImageSrc("data:image/png;base64,<script>"), undefined);
  assert.equal(safeImageSrc("data:text/html;base64,PHN2Zz4="), undefined);
  assert.equal(safeImageSrc("http://insecure.example/a.png"), undefined);
});

test("private, loopback, link-local and metadata hosts are blocked", () => {
  const blocked = [
    "127.0.0.1",
    "127.1.2.3",
    "0.0.0.0",
    "localhost",
    "LOCALHOST",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // AWS/Azure IMDS
    "metadata.google.internal",
    "redis.internal",
    "printer.local",
    "db", // single-label internal DNS name
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "100.64.0.1",
  ];
  for (const host of blocked) assert.ok(isBlockedHostname(host), host);
  for (const host of ["example.com", "api.github.com", "8.8.8.8", "203.0.113.10"]) assert.ok(!isBlockedHostname(host), host);
});

test("isPubliclyRoutableUrl rejects the SSRF classics", () => {
  for (const bad of ["http://169.254.169.254/latest/meta-data/", "http://127.0.0.1:6379/", "http://localhost/admin", "file:///etc/passwd", "http://[::1]:8080/"]) {
    assert.ok(!isPubliclyRoutableUrl(bad), bad);
  }
  assert.ok(isPubliclyRoutableUrl("https://tools.acme.dev/weather"));
});

test("assertPublicUrl refuses internal targets before any request is made", async () => {
  await assert.rejects(assertPublicUrl("http://169.254.169.254/latest/meta-data/"), BlockedUrlError);
  await assert.rejects(assertPublicUrl("file:///etc/passwd"), BlockedUrlError);
  await assert.rejects(assertPublicUrl("http://127.0.0.1:5432/"), BlockedUrlError);
  // A name that cannot resolve must fail closed rather than reach the network.
  await assert.rejects(assertPublicUrl("https://synapth-does-not-exist.invalid/"), BlockedUrlError);
});

test("parseRepoUrl stays inside github.com and rejects traversal", () => {
  assert.deepEqual(parseRepoUrl("https://github.com/acme/weather-tool"), { owner: "acme", repo: "weather-tool", ref: "HEAD", path: "" });
  assert.deepEqual(parseRepoUrl("acme/weather-tool"), { owner: "acme", repo: "weather-tool", ref: "HEAD", path: "" });
  for (const bad of ["https://evil.example/acme/repo", "https://github.com/%2e%2e/%2e%2e", "https://github.com/acme/repo/tree/%2e%2e%2f%2e%2e/x"]) {
    assert.throws(() => parseRepoUrl(bad));
  }
});

test("rate limiter closes the window and reopens it", () => {
  resetRateLimits();
  const rule = { limit: 3, windowMs: 60_000 };
  for (let i = 0; i < 3; i++) assert.ok(hit("write", "user:a", rule).ok);
  const blocked = hit("write", "user:a", rule);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfter > 0);
  // Buckets are per key.
  assert.ok(hit("write", "user:b", rule).ok);
  resetRateLimits();
  assert.ok(hit("write", "user:a", rule).ok);
});

test("enforceRateLimit throws a 429-shaped error", () => {
  resetRateLimits();
  assert.throws(
    () => {
      for (let i = 0; i < 200; i++) enforceRateLimit("register", "ip:1.2.3.4");
    },
    (err: unknown) => err instanceof RateLimitError && err.status === 429,
  );
  resetRateLimits();
});

test("parseHttpUrl normalises what it returns", () => {
  assert.equal(parseHttpUrl(" https://example.com ")?.toString(), "https://example.com/");
  assert.equal(parseHttpUrl(123), null);
});

test("safeCallbackPath keeps the post-login redirect on this origin", () => {
  assert.equal(safeCallbackPath("/dashboard/settings"), "/dashboard/settings");
  assert.equal(safeCallbackPath("https://evil.example/"), "/dashboard");
  assert.equal(safeCallbackPath("//evil.example/"), "/dashboard");
  assert.equal(safeCallbackPath("/\\evil.example"), "/dashboard");
  assert.equal(safeCallbackPath(null), "/dashboard");
});
