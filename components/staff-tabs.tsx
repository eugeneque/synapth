"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BadgeCheck, ShieldCheck } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import type { UiKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const TABS: Array<{ key: UiKey; href: string; icon: typeof ShieldCheck; verification?: boolean }> = [
  { key: "console.nav.moderation", href: "/dashboard/moderation", icon: ShieldCheck },
  { key: "admin.tab.verification", href: "/dashboard/verification", icon: BadgeCheck, verification: true },
];

/** Section switcher inside the staff section; the verification tab needs `users.verify`. */
export function StaffTabs({ verification }: { verification: boolean }) {
  const pathname = usePathname() ?? "/dashboard/moderation";
  const { t } = useI18n();
  return (
    <nav aria-label={t("staff.title")} className="flex flex-wrap gap-1 border-b border-border">
      {TABS.filter((tab) => verification || !tab.verification).map((tab) => {
        const active = pathname.startsWith(tab.href);
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
