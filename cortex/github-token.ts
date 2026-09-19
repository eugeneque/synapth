import { execSync } from "node:child_process";

let cached: string | null | undefined;

/**
 * GITHUB_TOKEN from the environment, falling back to the logged-in `gh` CLI
 * on the developer machine. Never persisted anywhere.
 */
export function resolveGithubToken(): string | null {
  if (cached !== undefined) return cached;
  const env = process.env.GITHUB_TOKEN?.trim();
  if (env) return (cached = env);
  try {
    const out = execSync("gh auth token", { stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 }).toString().trim();
    cached = out || null;
  } catch {
    cached = null;
  }
  return cached;
}
