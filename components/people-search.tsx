"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import { useI18n } from "@/axon/i18n";

/** Live people search: debounced, mirrored into `?q=` so the server page re-renders the results. */
export function PeopleSearch({ initial }: { initial: string }) {
  const router = useRouter();
  const { t } = useI18n();
  const [q, setQ] = useState(initial);
  const [pending, start] = useTransition();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const handle = setTimeout(() => {
      const v = q.trim();
      start(() => router.replace(v ? `/people?q=${encodeURIComponent(v)}` : "/people", { scroll: false }));
    }, 250);
    return () => clearTimeout(handle);
  }, [q, router]);

  return (
    <form role="search" onSubmit={(e) => e.preventDefault()} className="group flex h-14 w-full items-center gap-3 rounded-2xl border border-border bg-card px-5 transition-colors focus-within:border-synapse/60">
      {pending ? <Loader2 className="h-5 w-5 shrink-0 animate-spin text-synapse" /> : <Search className="h-5 w-5 shrink-0 text-muted-foreground group-focus-within:text-synapse" />}
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("people.search")} aria-label={t("people.search")} className="h-full w-full bg-transparent text-base outline-none placeholder:text-muted-foreground/70" />
      {q && (
        <button type="button" onClick={() => setQ("")} aria-label={t("people.clear")} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      )}
    </form>
  );
}
