import { ShieldQuestion } from "lucide-react";
import { Panel } from "@/components/panel";
import { getI18n } from "@/cortex/locale";
import { cn } from "@/lib/utils";
import type { UiKey } from "@/lib/i18n";
import { SKILL_PERMISSIONS, type Skill, type SkillPermission } from "@/types/skill";

const LABEL: Record<SkillPermission, UiKey> = {
  "filesystem:read": "perm.fsRead",
  "filesystem:write": "perm.fsWrite",
  shell: "perm.shell",
  network: "perm.network",
  env: "perm.env",
  clipboard: "perm.clipboard",
};

/**
 * What an entry can do on the user's machine, before install: every
 * permission with its state and the evidence behind it (`lib/permissions.ts`),
 * plus where the list came from — the author, the code, or a labelled guess.
 */
export async function PermissionsPanel({ skill }: { skill: Skill }) {
  const { t } = await getI18n();
  const m = skill.manifest;
  const granted = new Set(m.permissions ?? []);
  const evidence = m.permissionEvidence ?? [];
  const source = m.permissionSource;
  const local = m.entrypoint.type === "mcp-stdio";
  // Unrequested rows only matter when something was actually looked at; a guess lists just the guess.
  const rows = SKILL_PERMISSIONS.filter((p) => granted.has(p) || (source && source !== "assumed"));

  return (
    <Panel
      title={t("perm.title")}
      meta={t(source ? `perm.source.${source}` : "perm.source.legacy")}
      icon={<ShieldQuestion className="h-4 w-4 shrink-0 text-synapse" />}
      corners
      footer={local ? <span className="normal-case tracking-normal">{t("perm.localNote")}</span> : undefined}
    >
      {!granted.size && source !== "assumed" ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">{t("perm.none")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((p) => {
            const on = granted.has(p);
            const why = evidence.filter((e) => e.permission === p);
            return (
              <li key={p} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className={cn("flex items-center gap-2.5 text-sm", on ? "text-foreground" : "text-muted-foreground")}>
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", on ? "bg-synapse shadow-glow" : "bg-border")} />
                    {t(LABEL[p])}
                    <code className="font-mono text-[10px] text-muted-foreground">{p}</code>
                  </span>
                  <span className={cn("label-mono-sm", on && "text-foreground")}>{on ? (source === "assumed" && !why.length ? t("perm.assumed") : t("perm.requested")) : t("perm.notFound")}</span>
                </div>
                {why.length > 0 && (
                  <ul className="mt-1.5 space-y-1 pl-[18px]">
                    {why.map((e) => (
                      <li key={`${e.via}|${e.detail}`} className="flex min-w-0 items-baseline gap-2 text-xs text-muted-foreground">
                        <span className="label-mono-sm shrink-0 text-moss">{t(`perm.via.${e.via}`)}</span>
                        <code className="min-w-0 truncate font-mono text-[11px]" title={e.detail}>
                          {e.detail}
                        </code>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
