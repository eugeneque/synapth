import { ShieldCheck, ShieldAlert, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { SecurityLevel } from "@/types/skill";

const META: Record<SecurityLevel, { variant: "verified" | "community" | "sandbox"; icon: typeof ShieldCheck; title: string }> = {
  Verified: { variant: "verified", icon: ShieldCheck, title: "Clean scan, reviewed by a moderator, publisher identity confirmed" },
  Community: { variant: "community", icon: Users, title: "Clean automated scan, not yet reviewed by a human" },
  Sandbox: { variant: "sandbox", icon: ShieldAlert, title: "Scanner found risky patterns — runs only in an isolated sandbox" },
};

export function SecurityBadge({ level, className, solid }: { level: SecurityLevel; className?: string; solid?: boolean }) {
  const { variant, icon: Icon, title } = META[level];
  return (
    <Badge variant={solid && level === "Verified" ? "solid" : variant} title={title} className={className}>
      <Icon className="h-3 w-3" />
      {level}
    </Badge>
  );
}
