"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Hash, AtSign, Sparkles, Puzzle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { axon } from "@/axon/client";
import { cn } from "@/lib/utils";
import type { Suggestion } from "@/cortex/search";

interface Props {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}

const ICON: Record<Suggestion["type"], typeof Hash> = { skill: Puzzle, term: Sparkles, author: AtSign, tag: Hash };

/** Terminal-style search line: `>` prompt, `/` hotkey hint, type-ahead from Cortex (`/api/v1/search?suggest=1`). */
export function SearchBar({ value, onChange, autoFocus }: Props) {
  const router = useRouter();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const res = await axon.search.suggest(value);
        setSuggestions(res.suggestions);
        setActive(-1);
      } catch {
        setSuggestions([]);
      }
    }, 120);
    return () => clearTimeout(handle);
  }, [value]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const pick = (s: Suggestion) => {
    setOpen(false);
    if (s.type === "skill" && s.slug) router.push(`/skills/${s.slug}`);
    else onChange(s.text);
  };

  return (
    <div ref={box} className="group relative">
      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-mono text-sm font-semibold text-synapse">&gt;</span>
      <Input
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open || !suggestions.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => (a + 1) % suggestions.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a - 1 + suggestions.length) % suggestions.length);
          } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault();
            pick(suggestions[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="Search skills, e.g. 'postgres category:MCP is:verified stars:>100'…"
        className="h-12 border-border bg-surface-low pl-9 pr-32 font-mono text-[13px] placeholder:text-muted-foreground/60 focus-visible:bg-surface-high/60 focus-visible:ring-0"
        aria-label="Search skills"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && suggestions.length > 0}
        aria-controls="search-suggestions"
      />
      <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
        <span className="label-mono-sm hidden rounded-md bg-surface-highest px-1.5 py-0.5 normal-case sm:inline-flex">{value ? "live" : "press / to focus"}</span>
        {value && (
          <button type="button" onClick={() => onChange("")} aria-label="Clear search" className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {open && suggestions.length > 0 && (
        <ul id="search-suggestions" role="listbox" className="absolute z-30 mt-1 w-full border border-border bg-popover shadow-lg">
          {suggestions.map((s, i) => {
            const Icon = ICON[s.type];
            return (
              <li
                key={`${s.type}-${s.text}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s);
                }}
                className={cn("flex cursor-pointer items-center gap-2 px-4 py-2 font-mono text-xs", i === active ? "bg-accent text-accent-foreground" : "text-foreground")}
              >
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                <span>{s.text}</span>
                {typeof s.count === "number" && <span className="ml-auto text-muted-foreground">{s.count}</span>}
                {s.type === "skill" && <span className="ml-auto text-muted-foreground">open ↵</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
