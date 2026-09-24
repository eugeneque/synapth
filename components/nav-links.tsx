"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/axon/i18n";
import { cn } from "@/lib/utils";

export const NAV = [
  { key: "nav.overview", href: "/", match: (p: string) => p === "/" },
  { key: "nav.explore", href: "/explore", match: (p: string) => p.startsWith("/explore") || p.startsWith("/skills/") || p.startsWith("/skillsets") || p.startsWith("/authors") },
  { key: "nav.people", href: "/people", match: (p: string) => p.startsWith("/people") || p.startsWith("/u/") },
  { key: "nav.docs", href: "/faq", match: (p: string) => p.startsWith("/faq") },
] as const;

/** Header navigation: mono uppercase labels, a 2px synapse rule under the active section. */
export function NavLinks({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const pathname = usePathname() ?? "/";
  const { t } = useI18n();
  return (
    <nav className={className} aria-label={t("nav.primary")}>
      {NAV.map((n) => {
        const active = n.match(pathname);
        return (
          <Link key={n.href} href={n.href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={cn("tab-line h-16", active && "text-foreground after:bg-synapse")}>
            {t(n.key)}
          </Link>
        );
      })}
    </nav>
  );
}
