"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BadgeCheck, Gauge, Radar, Users } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import type { UiKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const TABS: Array<{ key: UiKey; href: string; icon: typeof Gauge; exact?: boolean }> = [
  { key: "admin.tab.overview", href: "/dashboard/admin", icon: Gauge, exact: true },
  { key: "admin.tab.users", href: "/dashboard/admin/users", icon: Users },
  { key: "admin.tab.verification", href: "/dashboard/admin/verification", icon: BadgeCheck },
  { key: "admin.tab.crawler", href: "/dashboard/admin/crawler", icon: Radar },
];

/** Section switcher inside the admin panel. */
export function AdminTabs() {
  const pathname = usePathname() ?? "/dashboard/admin";
  const { t } = useI18n();
  return (
    <nav aria-label={t("admin.title")} className="flex flex-wrap gap-1 border-b border-border">
      {TABS.map((tab) => {
        const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn("-mb-px inline-flex h-10 items-center gap-2 border-b-2 px-3 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors", active ? "border-synapse text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            <Icon className="h-3.5 w-3.5" />
            {t(tab.key)}
          </Link>
        );
      })}
    </nav>
  );
}
