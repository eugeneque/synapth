"use client";

import { useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
import { NavLinks } from "@/components/nav-links";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { useI18n } from "@/axon/i18n";

/** Collapsible navigation for narrow viewports; `children` carries the auth actions. */
export function MobileNav({ children }: { children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
  return (
    <div className="lg:hidden">
      <button type="button" aria-expanded={open} aria-label={open ? t("nav.closeMenu") : t("nav.openMenu")} onClick={() => setOpen((o) => !o)} className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface-low text-muted-foreground hover:text-foreground">
        {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </button>
      {open && (
        <div className="absolute inset-x-0 top-16 border-b border-border bg-background/95 backdrop-blur">
          <NavLinks className="container flex flex-col items-start gap-1 py-2 md:hidden [&>a]:h-10" onNavigate={() => setOpen(false)} />
          <div className="container flex flex-wrap items-center gap-2 border-t border-border py-3">
            <LocaleSwitcher variant="segments" />
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
