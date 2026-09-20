"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Panel } from "@/components/panel";
import { CopyButton } from "@/components/copy-button";
import { useInstall } from "@/axon/hooks";
import { useI18n } from "@/axon/i18n";
import { INSTALL_TARGETS, installSnippet, defaultTarget, type InstallTarget } from "@/axon/install";
import { formatCompact } from "@/lib/utils";
import type { Skill } from "@/types/skill";

/** Per-client install instructions with one-click copy (records the install). */
export function InstallPanel({ skill }: { skill: Skill }) {
  const { install, status, downloads } = useInstall(skill);
  const { t } = useI18n();
  const [target, setTarget] = useState<InstallTarget>(defaultTarget(skill));
  const snippet = installSnippet(skill, target);
  const cli = `synapth install ${skill.slug} --target=${target}`;

  return (
    <Panel id="install" title={t("install.panel.title")} corners footer={<><span>{t("install.panel.recorded", { n: formatCompact(downloads) })}</span><span>{skill.category === "MCP" ? "mcpServers" : skill.category === "Prompt" ? t("install.panel.rules") : t("install.panel.toolSchema")}</span></>}>
      <div className="flex flex-col gap-4 p-4">
        <div className="well flex items-center justify-between gap-2 p-2.5">
          <div className="flex min-w-0 items-center gap-2 font-mono text-xs">
            <span className="select-none font-bold text-synapse">&gt;</span>
            <span className="truncate select-all text-foreground">{cli}</span>
          </div>
          <CopyButton text={cli} compact className="shrink-0 text-muted-foreground hover:text-synapse" />
        </div>

        <Tabs value={target} onValueChange={(v) => setTarget(v as InstallTarget)}>
          <div className="label-mono-sm flex items-center justify-between">
            <span>{t("install.panel.orAdd", { file: INSTALL_TARGETS.find((it) => it.id === target)?.file ?? "" })}</span>
          </div>
          <TabsList className="h-auto min-h-9 flex-wrap gap-x-4">
            {INSTALL_TARGETS.map((it) => (
              <TabsTrigger key={it.id} value={it.id}>
                {t(`install.target.${it.id}`)}
              </TabsTrigger>
            ))}
          </TabsList>
          {INSTALL_TARGETS.map((it) => (
            <TabsContent key={it.id} value={it.id} className="mt-2 space-y-3">
              <pre className="well overflow-auto p-3 font-mono text-[12px] leading-relaxed text-muted-foreground [&_.k]:text-foreground">{snippet.code}</pre>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">{t(snippet.noteKey, snippet.noteParams)}</p>
                <Button size="sm" onClick={() => install(target)} disabled={status === "busy"} className="shrink-0 font-mono text-[11px] uppercase tracking-[0.1em]">
                  {status === "done" ? <Check /> : <Copy />}
                  {status === "done" ? t("common.copied") : t("install.panel.copyInstall")}
                </Button>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </Panel>
  );
}
