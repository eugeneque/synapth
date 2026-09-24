import { notFound, redirect } from "next/navigation";
import { auth } from "@/cortex/auth";
import { getRole } from "@/cortex/roles";
import { getI18n } from "@/cortex/locale";
import { can } from "@/types/auth";
import { StaffTabs } from "@/components/staff-tabs";

/**
 * Staff section ("Administration"): catalogue moderation and account verification.
 * Moderators and admins only (stored role); 404 rather than 403 so the section is not
 * advertised. Each page below re-checks its own permission (verification needs `users.verify`).
 */
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/dashboard/moderation");
  const role = await getRole(session.user.id);
  if (!can(role, "catalog.moderate")) notFound();
  const { t } = await getI18n();

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="label-mono-sm flex items-center gap-2 tracking-[0.2em]">
          <span className="text-synapse">{t("moderation.crumb")}</span>
          <span className="text-border">/</span>
          <span>@{session.user.handle ?? "staff"}</span>
        </p>
        <h1 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">{t("staff.title")}</h1>
      </header>
      <StaffTabs verification={can(role, "users.verify")} />
      {children}
    </div>
  );
}
