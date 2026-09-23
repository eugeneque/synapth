"use client";

/**
 * SkillsetInstallPanel — the one command that installs a whole skillset, per
 * client. Plans are built on the server (`skillsetInstall` in axon/install.ts)
 * and handed down; this component only switches targets and copies.
 */

import { useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, KeyRound } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { rich } from "@/lib/i18n/rich";
import { INSTALL_TARGETS, TARGET_COOKIE, type InstallTarget, type SkillsetInstallPlan } from "@/axon/install";
import { Panel } from "@/components/panel";
import { CopyButton } from "@/components/copy-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function preferred(): InstallTarget | null {
  if (typeof document === "undefined") return null;
  const value = document.cookie.match(new RegExp(`(?:^|; )${TARGET_COOKIE}=([a-z-]+)`))?.[1];
  return INSTALL_TARGETS.some((t) => t.id === value) ? (value as InstallTarget) : null;
}

export function SkillsetInstallPanel({ plans }: { plans: Record<InstallTarget, SkillsetInstallPlan> }) {
  const { t, n } = useI18n();
  const [target, setTarget] = useState<InstallTarget>("claude-code");
  const [expanded, setExpanded] = useState(false);
  // The account preference lives in a cookie; read it after hydration so server and client render the same tab first.
  useEffect(() => {
    const value = preferred();
    if (value) setTarget(value);
  }, []);

  return (
    <Panel id="install" title={t("skillset.install.title")} corners>
      <Tabs value={target} onValueChange={(v) => setTarget(v as InstallTarget)} className="p-4">
        <TabsList className="h-auto min-h-9 flex-wrap gap-x-4">
          {INSTALL_TARGETS.map((it) => (
            <TabsTrigger key={it.id} value={it.id}>
              {t(`install.target.${it.id}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {INSTALL_TARGETS.map((it) => {
          const plan = plans[it.id];
          const oneLiner = plan.commandLanguage === "bash";
          return (
            <TabsContent key={it.id} value={it.id} className="mt-3 space-y-3">
              <p className="text-xs text-muted-foreground">{rich(t(`skillset.install.note.${it.id}`))}</p>
              {plan.included.length ? (
                <div className="well flex items-start justify-between gap-2 p-2.5">
                  <pre className={oneLiner ? "min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-xs text-foreground" : "max-h-72 min-w-0 flex-1 overflow-auto whitespace-pre font-mono text-[12px] leading-relaxed text-muted-foreground"}>
                    {oneLiner && <span className="select-none font-bold text-synapse">$ </span>}
                    {plan.command}
                  </pre>
                  <CopyButton text={plan.command} compact className="shrink-0 text-muted-foreground hover:text-synapse" />
                </div>
              ) : (
                <p className="rounded-lg border border-border p-3 text-xs text-muted-foreground">{t("skillset.install.nothing")}</p>
              )}

              {plan.body && plan.included.length > 0 && (
                <div>
                  <button type="button" onClick={() => setExpanded((v) => !v)} className="label-mono-sm inline-flex items-center gap-1 hover:text-foreground" aria-expanded={expanded}>
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
                    {t(it.id === "claude-desktop" ? "skillset.install.showInstructions" : "skillset.install.showScript")}
                  </button>
                  {expanded && (
                    <div className="relative mt-2">
                      <pre className="well max-h-96 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">{plan.body}</pre>
                      <CopyButton text={plan.body} compact className="absolute right-2 top-2 text-muted-foreground hover:text-synapse" />
                    </div>
                  )}
                </div>
              )}

              <p className="label-mono-sm normal-case tracking-normal">{n("skillset.install.included", plan.included.length)}</p>
              {plan.env.length > 0 && (
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {t("skillset.install.env", { list: plan.env.join(", ") })}
                </p>
              )}
              {plan.skipped.length > 0 && (
                <ul className="space-y-1 rounded-lg border border-warn/30 bg-warn/5 p-3 text-xs text-warn">
                  {plan.skipped.map((s) => (
                    <li key={s.slug} className="flex items-start gap-1.5">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {t(`skillset.install.skipped.${s.reason}`, { name: s.name })}
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </Panel>
  );
}
