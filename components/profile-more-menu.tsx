"use client";

/**
 * ProfileMoreMenu — the "More" button next to the profile's primary action:
 * secondary links (GitHub, catalogue search, editing) plus copying the
 * profile link. Icons are named, not passed as elements, so the server page
 * hands over plain data.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Github, Link2, MoreHorizontal, Pencil, Search } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { cn } from "@/lib/utils";

const ICONS = { edit: Pencil, github: Github, search: Search } as const;

export interface ProfileMoreItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  external?: boolean;
}

export function ProfileMoreMenu({ items, profilePath, className }: { items: ProfileMoreItem[]; profilePath: string; className?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(new URL(profilePath, window.location.origin).toString());
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        setOpen(false);
      }, 1200);
    } catch {
      // Clipboard can be blocked (insecure context, permissions); the menu simply stays open.
    }
  }

  const row = "flex w-full items-center gap-2.5 whitespace-nowrap rounded-md px-2.5 py-2 text-left text-sm text-foreground/90 transition-colors hover:bg-surface-lowest hover:text-foreground [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground";

  return (
    <div ref={root} className={cn("relative", className)}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className={cn("inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-all duration-200 hover:-translate-y-px active:scale-[0.97]", open ? "border-synapse/60 text-synapse" : "border-border bg-surface-lowest/80 text-foreground hover:border-foreground/30")}>
        <MoreHorizontal className="h-4 w-4" /> {t("profile.more")}
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-12 z-30 min-w-56 animate-pop-in rounded-xl border border-border bg-card p-1.5 shadow-2xl">
          {items.map((item) => {
            const Icon = ICONS[item.icon];
            return item.external ? (
              <a key={item.href} role="menuitem" href={item.href} target="_blank" rel="noreferrer" className={row} onClick={() => setOpen(false)}>
                <Icon /> {item.label}
              </a>
            ) : (
              <Link key={item.href} role="menuitem" href={item.href} className={row} onClick={() => setOpen(false)}>
                <Icon /> {item.label}
              </Link>
            );
          })}
          <button type="button" role="menuitem" onClick={copy} className={row}>
            {copied ? <Check className="!text-synapse" /> : <Link2 />} {copied ? t("profile.linkCopied") : t("profile.copyLink")}
          </button>
        </div>
      )}
    </div>
  );
}
