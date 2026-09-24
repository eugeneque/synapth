import { notFound, redirect } from "next/navigation";
import { auth } from "@/cortex/auth";
import { hasPermission } from "@/cortex/roles";
import { getI18n } from "@/cortex/locale";
import { AdminTabs } from "@/components/admin-tabs";

/**
 * Admin panel shell: its own item in the console rail (ConsoleNav),
 * admins only. Checked against the stored role; 404 rather than 403 so the
 * panel is not advertised. Every page and action below re-checks its own permission.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/dashboard/admin");
  if (!(await hasPermission(session.user.id, "admin.access"))) notFound();
  const { t } = await getI18n();

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="label-mono-sm flex items-center gap-2 tracking-[0.2em]">
          <span className="text-synapse">{t("admin.crumb")}</span>
          <span className="text-border">/</span>
          <span>@{session.user.handle ?? "admin"}</span>
        </p>
        <h1 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">{t("admin.title")}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{t("admin.lead")}</p>
      </header>
      <AdminTabs />
      {children}
    </div>
  );
}
