"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import { useI18n } from "@/axon/i18n";

/**
 * The query line of `/search`: debounced, mirrored into `?q=` (other params —
 * tab, source, catalogue filters — are kept) so the server page re-renders.
 * Follows `?q=` when something else changes it (a tag chip in the storefront).
 */
export function SearchPageInput({ placeholder }: { placeholder: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { t } = useI18n();
  const urlQ = params.get("q") ?? "";
  const [q, setQ] = useState(urlQ);
  const [synced, setSynced] = useState(urlQ);
  const [pending, start] = useTransition();
  const typed = useRef(false);

  if (urlQ !== synced) {
    setSynced(urlQ);
    if (urlQ !== q.trim()) setQ(urlQ);
  }

  useEffect(() => {
    if (!typed.current) return;
    const handle = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      const v = q.trim();
      if (v === (next.get("q") ?? "")) return;
      if (v) next.set("q", v);
      else next.delete("q");
      const s = next.toString();
      start(() => router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false }));
    }, 280);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <form role="search" onSubmit={(e) => e.preventDefault()} className="group flex h-14 w-full items-center gap-3 rounded-2xl border border-border bg-card px-5 transition-colors focus-within:border-synapse/60">
      {pending ? <Loader2 className="h-5 w-5 shrink-0 animate-spin text-synapse" /> : <Search className="h-5 w-5 shrink-0 text-muted-foreground group-focus-within:text-synapse" />}
      <input
        id="registry-search"
        autoFocus
        value={q}
        onChange={(e) => {
          typed.current = true;
          setQ(e.target.value);
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-full w-full bg-transparent text-base outline-none placeholder:text-muted-foreground/70"
      />
      {q && (
        <button
          type="button"
          onClick={() => {
            typed.current = true;
            setQ("");
          }}
          aria-label={t("people.clear")}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </form>
  );
}
