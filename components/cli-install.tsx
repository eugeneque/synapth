"use client";

/**
 * The CLI install terminal: system tabs on top (macOS, Linux families,
 * Windows soon), a numbered, commented script, the shell and a copy button
 * at the bottom. Picks the visitor's system after mount (SSR renders macOS).
 * Scripts live in lib/cli-install.ts; tokens reuse the `.code-tokens` palette.
 */

import { Fragment, useEffect, useState } from "react";
import { Check, Code2 } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { cue } from "@/axon/sound";
import { CLI_INSTALL_TABS, cliInstallScript, type CliInstallTabId } from "@/lib/cli-install";
import { cn } from "@/lib/utils";

function detectTab(): CliInstallTabId {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const hint = `${nav.userAgentData?.platform ?? ""} ${nav.platform ?? ""} ${nav.userAgent}`;
  if (/win/i.test(hint)) return "windows";
  if (/fedora|red hat/i.test(hint)) return "fedora";
  if (/linux|x11|cros/i.test(hint) && !/android/i.test(hint)) return "debian";
  return "macos";
}

const SEPARATORS = new Set(["|", "&&"]);

/** Shell one-liner → highlighted spans: commands, flags, URLs, pipes. */
function CodeLine({ code }: { code: string }) {
  let expectCommand = true;
  return (
    <>
      {code.split(" ").map((word, i) => {
        let cls: string | undefined;
        if (SEPARATORS.has(word)) {
          cls = "hljs-keyword";
          expectCommand = true;
        } else if (word === "sudo") {
          cls = "hljs-keyword";
        } else if (expectCommand) {
          cls = "hljs-built_in";
          expectCommand = false;
        } else if (word.startsWith("-")) {
          cls = "hljs-attr";
        } else if (/^https?:\/\//.test(word)) {
          cls = "hljs-string";
        }
        return (
          <Fragment key={i}>
            {i > 0 && " "}
            <span className={cls}>{word}</span>
          </Fragment>
        );
      })}
    </>
  );
}

export function CliInstall({ origin, variant = "hero", className }: { origin: string; variant?: "hero" | "panel"; className?: string }) {
  const { t } = useI18n();
  const [tabId, setTabId] = useState<CliInstallTabId>("macos");
  const [done, setDone] = useState(false);
  useEffect(() => setTabId(detectTab()), []);

  const tab = CLI_INSTALL_TABS.find((x) => x.id === tabId) ?? CLI_INSTALL_TABS[0];
  const lines = cliInstallScript(origin, tab.id);
  const text = lines.map((l) => ("comment" in l ? `# ${t(l.comment)}` : "code" in l ? l.code : "")).join("\n");
  const hero = variant === "hero";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      cue("success", { emphasis: "subtle" });
      setTimeout(() => setDone(false), 1600);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className={cn("w-full min-w-0 overflow-hidden rounded-xl border border-border text-left", hero ? "bg-surface-lowest/85 backdrop-blur-md" : "bg-background", className)}>
      <div role="tablist" aria-label={t("cli.os.label")} className="flex overflow-x-auto border-b border-border [scrollbar-width:none]">
        {CLI_INSTALL_TABS.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={x.id === tab.id}
            onClick={() => setTabId(x.id)}
            className={cn(
              "relative inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap px-4 font-mono text-[11.5px] transition-colors",
              x.id === tab.id ? "text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-px after:bg-synapse" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {x.label}
            {x.soon && <span className="rounded-sm bg-synapse/15 px-1 py-px text-[9px] uppercase tracking-wider text-synapse">{t("cli.os.soon")}</span>}
          </button>
        ))}
      </div>

      <pre role="tabpanel" className={cn("code-tokens overflow-x-auto py-4 font-mono", hero ? "text-[12.5px] leading-6" : "text-[11.5px] leading-[1.35rem]")}>
        {lines.map((line, i) => (
          <div key={`${tab.id}-${i}`} className="flex gap-4 pr-4">
            <span aria-hidden="true" className="w-8 shrink-0 select-none text-right text-muted-foreground/45">
              {i + 1}
            </span>
            {"comment" in line ? <span className="hljs-comment min-w-0 whitespace-pre-wrap"># {t(line.comment)}</span> : <span className="whitespace-pre">{"code" in line ? <CodeLine code={line.code} /> : " "}</span>}
          </div>
        ))}
      </pre>

      <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2">
        <span className="font-mono text-[11px] text-muted-foreground">{tab.shell}</span>
        <button type="button" onClick={copy} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface-high/60 px-3 font-mono text-[11px] text-foreground transition-colors hover:border-foreground/25">
          {done ? <Check className="h-3.5 w-3.5 text-synapse" /> : <Code2 className="h-3.5 w-3.5" />}
          {done ? t("common.copied") : t("common.copy")}
        </button>
      </div>
    </div>
  );
}
