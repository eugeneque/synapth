/**
 * The CLI install script shown in the terminal block (hero, settings): one
 * tab per system or Linux family, each a few commented lines. Comments are
 * i18n keys, resolved by components/cli-install.tsx.
 */

import type { UiKey } from "@/lib/i18n";

export type CliInstallTabId = "macos" | "debian" | "fedora" | "arch" | "windows";

export interface CliInstallTab {
  id: CliInstallTabId;
  label: string;
  /** Shown in the block's footer. */
  shell: "zsh" | "bash" | "PowerShell";
  /** Shown, but the native installer is not there yet. */
  soon?: boolean;
}

export const CLI_INSTALL_TABS: readonly CliInstallTab[] = [
  { id: "macos", label: "macOS", shell: "zsh" },
  { id: "debian", label: "Ubuntu / Debian", shell: "bash" },
  { id: "fedora", label: "Fedora / RHEL", shell: "bash" },
  { id: "arch", label: "Arch Linux", shell: "bash" },
  { id: "windows", label: "Windows", shell: "PowerShell", soon: true },
];

export type CliScriptLine = { comment: UiKey } | { code: string } | { blank: true };

/** `curl … | sh` for macOS and Linux; with a link key it also links the machine. */
export function cliInstallCommand(origin: string, linkKey?: string): string {
  return `curl -fsSL ${origin.replace(/\/$/, "")}/cli/install | sh${linkKey ? ` -s -- ${linkKey}` : ""}`;
}

const NODE: Record<Exclude<CliInstallTabId, "windows">, { comment: UiKey; code: string }> = {
  macos: { comment: "cli.script.nodeBrew", code: "brew install node" },
  debian: { comment: "cli.script.nodeApt", code: "sudo apt-get update && sudo apt-get install -y nodejs curl" },
  fedora: { comment: "cli.script.nodeDnf", code: "sudo dnf install -y nodejs curl" },
  arch: { comment: "cli.script.nodePacman", code: "sudo pacman -S --needed nodejs curl" },
};

export function cliInstallScript(origin: string, tab: CliInstallTabId): CliScriptLine[] {
  const install = cliInstallCommand(origin);
  if (tab === "windows") {
    return [
      { comment: "cli.script.winSoon" },
      { comment: "cli.script.winWsl" },
      { code: "wsl --install" },
      { blank: true },
      { comment: "cli.script.winInside" },
      { code: install },
    ];
  }
  return [
    { comment: NODE[tab].comment },
    { code: NODE[tab].code },
    { blank: true },
    { comment: "cli.script.install" },
    { code: install },
    { blank: true },
    { comment: "cli.script.verify" },
    { code: "synapth status" },
  ];
}
