"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

/** Header search affordance: focuses the registry search line, or jumps to /explore. ⌘K / Ctrl+K does the same. */
export function SearchTrigger() {
  const router = useRouter();

  const open = () => {
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search skills"]');
    if (input) {
      input.focus();
      input.scrollIntoView({ block: "center", behavior: "smooth" });
    } else {
      router.push("/explore?focus=1");
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <button
      type="button"
      onClick={open}
      aria-label="Search the registry"
      className="flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-border bg-surface-low px-2.5 text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
    >
      <Search className="h-4 w-4" />
      <span className="hidden font-mono text-xs 2xl:inline">Search registry…</span>
      <kbd className="label-mono-sm rounded-md border border-border bg-surface-high px-1.5 py-0.5 normal-case text-muted-foreground">⌘K</kbd>
    </button>
  );
}
