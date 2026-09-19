"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export const NAV = [
  { label: "Overview", href: "/", match: (p: string) => p === "/" },
  { label: "Explore registry", href: "/explore", match: (p: string) => p.startsWith("/explore") || p.startsWith("/skills") || p.startsWith("/authors") },
  { label: "Docs", href: "/faq", match: (p: string) => p.startsWith("/faq") },
  { label: "Developer console", href: "/dashboard", match: (p: string) => p.startsWith("/dashboard") },
] as const;

/** Header navigation: mono uppercase labels, a 2px synapse rule under the active section. */
export function NavLinks({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const pathname = usePathname() ?? "/";
  return (
    <nav className={className} aria-label="Primary">
      {NAV.map((n) => {
        const active = n.match(pathname);
        return (
          <Link key={n.href} href={n.href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={cn("tab-line h-16", active && "text-foreground after:bg-synapse")}>
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
