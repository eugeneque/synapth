"use client";

import { ChevronDown, Globe } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { LOCALES, LOCALE_META, isLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface Props {
  className?: string;
  /** `select` is the compact header control (same mono select as SortControl); `segments` is the wide row for menus. */
  variant?: "select" | "segments";
}

/** UI language switcher: writes the locale cookie and refreshes the tree from the server. */
export function LocaleSwitcher({ className, variant = "select" }: Props) {
  const { locale, setLocale, t } = useI18n();

  if (variant === "segments") {
    return (
      <div role="group" aria-label={t("common.language")} className={cn("flex items-center gap-0.5 rounded-md border border-border bg-surface-low p-0.5", className)}>
        {LOCALES.map((l) => (
          <button
            key={l}
            type="button"
            lang={LOCALE_META[l].htmlLang}
            title={LOCALE_META[l].name}
            aria-pressed={l === locale}
            onClick={() => setLocale(l)}
            className={cn("h-7 rounded-md px-2 font-mono text-[11px] font-medium uppercase tracking-[0.1em] transition-colors", l === locale ? "bg-surface-high text-synapse" : "text-muted-foreground hover:text-foreground")}
          >
            {LOCALE_META[l].code}
          </button>
        ))}
      </div>
    );
  }

  return (
    <label className={cn("relative inline-flex h-9 shrink-0 items-center rounded-md border border-border bg-surface-low text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground", className)}>
      <Globe className="pointer-events-none absolute left-2.5 h-4 w-4" />
      <select
        aria-label={t("common.language")}
        value={locale}
        onChange={(e) => {
          if (isLocale(e.target.value)) setLocale(e.target.value);
        }}
        className="h-full appearance-none bg-transparent pl-8 pr-7 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-foreground focus:outline-none"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l} lang={LOCALE_META[l].htmlLang}>
            {LOCALE_META[l].code}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5" />
    </label>
  );
}
