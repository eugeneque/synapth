"use client";

import { Landmark, ShieldCheck, ShieldAlert, ShieldX, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/axon/i18n";
import type { SecurityLevel } from "@/types/skill";

const META: Record<SecurityLevel, { variant: "verified" | "community" | "sandbox" | "danger"; icon: typeof ShieldCheck }> = {
  Gov: { variant: "verified", icon: Landmark },
  Verified: { variant: "verified", icon: ShieldCheck },
  Community: { variant: "community", icon: Users },
  Sandbox: { variant: "sandbox", icon: ShieldAlert },
  Quarantine: { variant: "danger", icon: ShieldX },
};

export function SecurityBadge({ level, className, solid }: { level: SecurityLevel; className?: string; solid?: boolean }) {
  const { t } = useI18n();
  const { variant, icon: Icon } = META[level];
  return (
    <Badge variant={solid && (level === "Verified" || level === "Gov") ? "solid" : variant} title={t(`level.${level}.title`)} className={className}>
      <Icon className="h-3 w-3" />
      {t(`level.${level}`)}
    </Badge>
  );
}
