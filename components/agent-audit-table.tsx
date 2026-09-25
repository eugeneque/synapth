"use client";

import { useI18n } from "@/axon/i18n";
import { Badge } from "@/components/ui/badge";
import type { AgentAuditEntry } from "@/cortex/agent-audit";
import { timeAgo } from "@/lib/utils";

/** The owner's view of FR-AI-62: every agent call with its policy decision. */
export function AgentAuditTable({ entries }: { entries: AgentAuditEntry[] }) {
  const i18n = useI18n();
  const { t } = i18n;
  if (!entries.length) return <p className="p-5 text-sm text-muted-foreground">{t("audit.empty")}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-xs">
        <thead className="label-mono-sm border-b border-border bg-surface-low/60">
          <tr>
            <th className="px-4 py-2 font-normal">{t("audit.col.when")}</th>
            <th className="px-4 py-2 font-normal">{t("audit.col.action")}</th>
            <th className="px-4 py-2 font-normal">{t("audit.col.object")}</th>
            <th className="px-4 py-2 font-normal">{t("audit.col.decision")}</th>
            <th className="px-4 py-2 font-normal">{t("audit.col.result")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {entries.map((e) => (
            <tr key={e.id} className="align-top">
              <td className="whitespace-nowrap px-4 py-2 text-muted-foreground" title={e.createdAt}>
                {timeAgo(e.createdAt, i18n)}
                {e.agentName && <div className="font-mono text-[10px]">{e.agentName}</div>}
              </td>
              <td className="px-4 py-2 font-mono">{e.action}</td>
              <td className="max-w-[240px] px-4 py-2 font-mono text-[11px] text-muted-foreground">
                <span className="block truncate">
                  {e.objectId ?? "—"}
                  {e.objectVersion && `@${e.objectVersion}`}
                </span>
                {e.objectHash && <span className="block truncate text-[10px]">{e.objectHash.slice(0, 16)}…</span>}
              </td>
              <td className="px-4 py-2">
                <Badge variant={e.decision === "allow" ? "community" : "danger"}>{t(e.decision === "allow" ? "audit.allow" : "audit.deny")}</Badge>
                {e.rule && <div className="mt-1 font-mono text-[10px] text-muted-foreground">{e.rule}</div>}
              </td>
              <td className="px-4 py-2 font-mono text-[11px]">{e.result}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
