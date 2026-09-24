import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Search, Users } from "lucide-react";
import { auth } from "@/cortex/auth";
import { getRole, listUsers } from "@/cortex/roles";
import { getI18n } from "@/cortex/locale";
import { can, isUserRole, USER_ROLES } from "@/types/auth";
import { Panel } from "@/components/panel";
import { RoleSelect } from "@/components/role-select";
import { CheckMarkToggle } from "@/components/check-mark-toggle";
import { DeveloperToggle } from "@/components/developer-toggle";
import { VerifiedMark } from "@/components/verified-mark";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("users.meta") };
}
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ q?: string; role?: string }> };

/** `role=developer` filters by the flag rather than by a stored role. */
const DEVELOPER_FILTER = "developer";

/** Admin panel · directory: find an account, change its role and the platform-developer flag. */
export default async function UsersPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/dashboard/admin/users");
  const viewerRole = await getRole(session.user.id);
  if (!can(viewerRole, "users.manageRoles")) notFound();
  const canVerify = can(viewerRole, "users.verify");
  const { q = "", role } = await searchParams;
  const [users, { t }] = await Promise.all([listUsers({ q: q.slice(0, 100), role: isUserRole(role) ? role : undefined, developer: role === DEVELOPER_FILTER, limit: 100 }), getI18n()]);

  return (
    <div className="space-y-6">
      <p className="max-w-2xl text-sm text-muted-foreground">{t("users.lead")}</p>

      <form className="flex flex-col gap-2 sm:flex-row" action="/dashboard/admin/users">
        <label className="relative flex-1">
          <span className="sr-only">{t("users.search")}</span>
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input name="q" defaultValue={q} placeholder={t("users.search")} className="h-9 w-full rounded-lg border border-border bg-muted pl-9 pr-3 font-mono text-xs focus:border-synapse focus:outline-none" />
        </label>
        <select name="role" defaultValue={isUserRole(role) || role === DEVELOPER_FILTER ? role : ""} aria-label={t("users.filterRole")} className="h-9 rounded-lg border border-border bg-muted px-3 font-mono text-xs">
          <option value="">{t("users.allRoles")}</option>
          {USER_ROLES.map((r) => (
            <option key={r} value={r}>
              {t(`settings.role.${r}`)}
            </option>
          ))}
          <option value={DEVELOPER_FILTER}>{t("settings.role.developer")}</option>
        </select>
        <button type="submit" className="h-9 rounded-lg border border-border bg-muted px-4 font-mono text-[11px] uppercase tracking-[0.14em] hover:border-synapse/40 hover:text-synapse">
          {t("users.apply")}
        </button>
      </form>

      <Panel title={t("users.title")} meta={String(users.length)} icon={<Users className="h-4 w-4 shrink-0 text-synapse" />} corners>
        {users.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">{t("users.empty")}</p>
        ) : (
          <ul className="stagger divide-y divide-border">
            {users.map((u) => (
              <li key={u.id} className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <a href={`/u/${u.handle}`} className="flex items-center gap-1.5 truncate font-medium hover:text-synapse">
                    {u.name || u.handle}
                    {u.verified && <VerifiedMark size="sm" />}
                    <span className="font-mono text-xs text-muted-foreground">@{u.handle}</span>
                  </a>
                  <p className="label-mono-sm truncate normal-case tracking-normal">{u.email ?? "—"}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {canVerify && <CheckMarkToggle userId={u.id} handle={u.handle} initial={u.verified} self={u.id === session.user.id} />}
                  <DeveloperToggle userId={u.id} handle={u.handle} initial={u.developer} />
                  <RoleSelect userId={u.id} handle={u.handle} initial={u.role} self={u.id === session.user.id} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
