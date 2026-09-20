import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { UnauthorizedError } from "@/cortex/auth";
import { InsufficientFundsError } from "@/cortex/billing";
import { HandleTakenError } from "@/cortex/account";
import { SandboxViolationError } from "@/lib/sandbox-scanner";
import { GithubParseError } from "@/lib/github-parser";

export function json<T>(data: T, init: ResponseInit = {}) {
  return NextResponse.json(data, init);
}

/** Minified JSON for agents: no whitespace, explicit format header. */
export function agentJson<T>(data: T, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("X-Synapth-Format", "agent-context/1");
  headers.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  return new NextResponse(JSON.stringify(data), { ...init, headers });
}

export function errorResponse(err: unknown) {
  if (err instanceof ZodError) return json({ error: "Validation failed", issues: err.issues }, { status: 400 });
  if (err instanceof UnauthorizedError) return json({ error: err.message }, { status: 401 });
  if (err instanceof HandleTakenError) return json({ error: err.message }, { status: 409 });
  if (err instanceof InsufficientFundsError) return json({ error: err.message, requiredUsd: err.requiredUsd, balanceUsd: err.balanceUsd }, { status: 402 });
  if (err instanceof SandboxViolationError) return json({ error: err.message, scan: err.report }, { status: 422 });
  if (err instanceof GithubParseError) return json({ error: err.message, code: err.code }, { status: err.code === "not_found" ? 404 : 400 });
  // Social / badge errors (cortex/social.ts, cortex/badges.ts) carry their HTTP status.
  if (err instanceof Error && "status" in err && typeof err.status === "number" && err.status >= 400 && err.status < 500) return json({ error: err.message }, { status: err.status });
  console.error(err);
  return json({ error: "Internal error" }, { status: 500 });
}

/** Wraps a route handler so thrown domain errors become proper HTTP responses. */
export function withErrors<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
