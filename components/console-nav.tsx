"use client";

/**
 * ConsoleNav — the "control plane" rail beside every /dashboard page.
 * Mono labels, one active row lit in synapse, a store chip pinned at the bottom.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Bell, KeyRound, Radar, Rocket, ShieldCheck, SlidersHorizontal, UserRound, Users } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { cn } from "@/lib/utils";
import type { UiKey } from "@/lib/i18n";
import { can, type Permission, type UserRole } from "@/types/auth";

const ITEMS: Array<{ key: UiKey; href: string | ((handle: string) => string); icon: typeof Activity; match: (p: string) => boolean; requires?: Permission }> = [
  { key: "console.nav.overview", href: "/dashboard", icon: Activity, match: (p) => p === "/dashboard" },
  { key: "console.nav.publish", href: "/dashboard#publish", icon: Rocket, match: () => false },
  // The crawler panel only renders for its permission holders; the rail must not link to a missing anchor.
  { key: "console.nav.crawler", href: "/dashboard#crawl", icon: Radar, match: () => false, requires: "crawler.run" },
  { key: "console.nav.keys", href: "/dashboard#keys", icon: KeyRound, match: () => false },
  { key: "console.nav.moderation", href: "/dashboard/moderation", icon: ShieldCheck, match: (p) => p.startsWith("/dashboard/moderation"), requires: "catalog.moderate" },
  { key: "console.nav.users", href: "/dashboard/users", icon: Users, match: (p) => p.startsWith("/dashboard/users"), requires: "users.manageRoles" },
  { key: "console.nav.notifications", href: "/dashboard/notifications", icon: Bell, match: (p) => p.startsWith("/dashboard/notifications") },
  { key: "console.nav.settings", href: "/dashboard/settings", icon: SlidersHorizontal, match: (p) => p.startsWith("/dashboard/settings") },
  { key: "console.nav.profile", href: (handle) => `/u/${handle}`, icon: UserRound, match: () => false },
];

export function ConsoleNav({ store, handle, role, className }: { store: string; handle: string; role: UserRole; className?: string }) {
  const pathname = usePathname() ?? "/dashboard";
  const { t } = useI18n();
  return (
    <aside className={cn("flex flex-col justify-between gap-6", className)}>
      <nav aria-label={t("console.nav.label")} className="flex flex-col gap-1">
        <p className="label-mono-sm mb-2 tracking-[0.2em]">{t("console.nav.label")}</p>
        {ITEMS.filter((item) => !item.requires || can(role, item.requires)).map((item) => {
          const href = typeof item.href === "function" ? item.href(handle) : item.href;
          const active = item.match(pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.key}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-9 items-center gap-2.5 rounded-lg border px-3 font-mono text-[12px] transition-colors",
                active ? "border-synapse/30 bg-synapse/10 text-synapse" : "border-transparent text-muted-foreground hover:border-border hover:bg-surface-low hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{t(item.key)}</span>
            </Link>
          );
        })}
      </nav>
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="label-mono-sm mb-1.5 flex items-center justify-between">
          <span>{t("console.nav.store")}</span>
          <span className="dot-live" />
        </div>
        <p className="font-mono text-xs text-foreground">{store}</p>
        <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
          @{handle}
          {role !== "user" && <span className="ml-1.5 text-synapse">· {t(`settings.role.${role}`)}</span>}
        </p>
      </div>
    </aside>
  );
}
