"use client";

/**
 * ProfileDetails — the tabbed strip at the bottom of the profile header
 * (about / focus areas / achievements). Panels are rendered on the server and
 * passed in; this only switches between them. A `#<tab id>` hash (e.g. the
 * `#badges` link from a badge notification) opens that tab and scrolls to it.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface ProfileDetailsTab {
  id: string;
  label: string;
  icon: ReactNode;
  count?: number;
  content: ReactNode;
}

export function ProfileDetails({ tabs, className }: { tabs: ProfileDetailsTab[]; className?: string }) {
  const [active, setActive] = useState(tabs[0]?.id);
  const root = useRef<HTMLDivElement>(null);
  const ids = tabs.map((t) => t.id).join(" ");

  useEffect(() => {
    const sync = () => {
      const id = window.location.hash.slice(1);
      if (!id || !ids.split(" ").includes(id)) return;
      setActive(id);
      root.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [ids]);

  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  return (
    <div ref={root} className={cn("min-w-0 scroll-mt-24", className)}>
      <div role="tablist" className="no-scrollbar -mb-px flex items-center gap-5 overflow-x-auto border-b border-border">
        {tabs.map((t) => (
          <button key={t.id} id={t.id} type="button" role="tab" aria-selected={t.id === current?.id} data-active={t.id === current?.id} onClick={() => setActive(t.id)} className="tab-line h-9 shrink-0 scroll-mt-24 [&>svg]:transition-transform [&>svg]:duration-300 hover:[&>svg]:rotate-[-8deg] hover:[&>svg]:scale-110">
            {t.icon}
            {t.label}
            {t.count !== undefined && <span className={cn("rounded-md px-1.5 py-px text-[10px] tabular-nums transition-colors", t.id === current?.id ? "bg-synapse/15 text-synapse" : "bg-surface text-muted-foreground")}>{t.count}</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" key={current?.id} className="animate-rise pt-4">
        {current?.content}
      </div>
    </div>
  );
}
