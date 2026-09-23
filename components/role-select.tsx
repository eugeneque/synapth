"use client";

/** RoleSelect — the admin's per-row role switch in /dashboard/admin/users. */

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { useToast } from "@/axon/toast";
import { changeUserRole } from "@/app/(site)/moderation-actions";
import { USER_ROLES, type UserRole } from "@/types/auth";

export function RoleSelect({ userId, handle, initial, self }: { userId: string; handle: string; initial: UserRole; self: boolean }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [role, setRole] = useState(initial);
  const [pending, start] = useTransition();

  function change(next: UserRole) {
    const previous = role;
    setRole(next);
    start(async () => {
      const res = await changeUserRole(userId, next);
      if (!res.ok) {
        setRole(previous);
        toast({ tone: "danger", title: t("users.failed"), body: res.error });
        return;
      }
      toast({ tone: "success", title: t("users.changed", { handle, role: t(`settings.role.${res.data.role}`) }) });
    });
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      <select
        value={role}
        disabled={pending || self}
        title={self ? t("users.selfLocked") : undefined}
        aria-label={t("users.roleFor", { handle })}
        onChange={(e) => change(e.target.value as UserRole)}
        className="h-8 rounded-lg border border-border bg-muted px-2.5 font-mono text-xs disabled:opacity-60"
      >
        {USER_ROLES.map((r) => (
          <option key={r} value={r}>
            {t(`settings.role.${r}`)}
          </option>
        ))}
      </select>
    </div>
  );
}
