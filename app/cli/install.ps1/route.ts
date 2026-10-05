/**
 * GET /cli/install.ps1 — the Windows one-liner (`irm <origin>/cli/install.ps1 | iex`).
 *
 * The native installer is not ready yet: this only explains that and points
 * to WSL. No `exit` — under `iex` it would close the user's PowerShell window.
 */

import { enforceRequestLimit } from "@/cortex/rate-limit";
import { withErrors } from "@/lib/api";
import { cliInstallCommand } from "@/lib/cli-install";

export const runtime = "nodejs";

function origin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  return (configured || new URL(request.url).origin).replace(/\/$/, "");
}

/** PowerShell single-quoted literal. */
const psQuote = (value: string) => `'${value.replace(/'/g, "''")}'`;

function windowsScript(base: string): string {
  return [
    "# Synapth CLI installer for Windows — coming soon.",
    "& {",
    "  Write-Host ''",
    "  Write-Host '  SYNAPTH' -ForegroundColor Green",
    "  Write-Host '  The Windows installer is coming soon.' -ForegroundColor Yellow",
    "  Write-Host '  For now, install the CLI inside WSL (Ubuntu):' ",
    `  Write-Host ('    ' + ${psQuote(cliInstallCommand(base))}) -ForegroundColor Green`,
    "  Write-Host '  No WSL yet? Run: wsl --install' -ForegroundColor DarkGray",
    "  Write-Host ''",
    "}",
    "",
  ].join("\r\n");
}

export const GET = withErrors(async (request: Request) => {
  enforceRequestLimit("install", request);
  return new Response(windowsScript(origin(request)), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
});
