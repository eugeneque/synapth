/**
 * POST /api/v1/import/github  { url, dryRun?, mock? }
 * Parses a repo, scans the manifest and (unless dryRun) publishes it under the caller.
 */

import { z } from "zod";
import { importAllFromGithub, createGithubFetcher, createMockFetcher } from "@/lib/github-parser";
import { scanManifest, assertInstallable } from "@/lib/sandbox-scanner";
import { skillRepository } from "@/cortex/repository";
import { resolveCaller } from "@/cortex/api-keys";
import { UnauthorizedError } from "@/cortex/auth";
import { resolveGithubToken } from "@/cortex/github-token";
import { githubAuthorId } from "@/cortex/crawler";
import { json, withErrors } from "@/lib/api";
import { enforceRequestLimit } from "@/cortex/rate-limit";

export const runtime = "nodejs";

const bodySchema = z.object({
  url: z.string().trim().min(3).max(300),
  dryRun: z.boolean().default(false),
  /** Use canned repos (acme/postgres-mcp, acme/weather-tool, acme/code-review-skill, acme/skills-collection). */
  mock: z.boolean().default(false),
});

export const POST = withErrors(async (request: Request) => {
  // Authenticate first: a dry run still spends the server's GitHub token and
  // makes the server fetch a caller-chosen repository.
  const caller = await resolveCaller(request);
  if (!caller) throw new UnauthorizedError();
  enforceRequestLimit("import", request, caller.userId);

  const body = bodySchema.parse(await request.json());
  const fetcher = body.mock ? createMockFetcher() : createGithubFetcher({ token: resolveGithubToken() ?? undefined });

  const results = await importAllFromGithub(body.url, fetcher);
  const result = results[0];
  const scan = scanManifest(result.input.manifest);

  if (body.dryRun) return json({ import: result, scan, skill: null, found: results.length });

  assertInstallable(scan);

  // A collection publishes every skill it contains; the response carries the first one.
  const owner = result.ref.owner;
  const authorId = results.length > 1 || result.input.origin === "github" ? githubAuthorId(owner) : caller.userId;
  const counts = await skillRepository.upsertMany(
    results.map((r) => ({ input: r.input, authorId, authorName: owner, securityLevel: scanManifest(r.input.manifest).level })),
  );
  const skill = await skillRepository.bySlug(result.input.slug!);
  return json({ import: result, scan, skill, found: results.length, ...counts }, { status: 201 });
});
