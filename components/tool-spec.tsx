import { Braces } from "lucide-react";
import { Panel } from "@/components/panel";
import { CopyButton } from "@/components/copy-button";
import { getI18n } from "@/cortex/locale";
import type { Skill } from "@/types/skill";

/** MCP tool specifications as the model sees them, with a copy-JSON action. */
export async function ToolSpec({ skill }: { skill: Skill }) {
  const tools = skill.manifest.tools;
  if (!tools.length) return null;
  const { t, n } = await getI18n();
  const json = JSON.stringify({ name: skill.slug, version: skill.version, tools }, null, 2);
  return (
    <Panel
      title={t("toolspec.title", { file: skill.source?.manifestFile ?? "synapth.json" })}
      icon={<Braces className="h-4 w-4 shrink-0 text-moss" />}
      actions={<CopyButton text={json} label={t("toolspec.copyJson")} />}
      corners
      footer={<><span>{n("toolspec.exposed", tools.length)}</span><span>{t("toolspec.schema")}</span></>}
    >
      <ul className="divide-y divide-border">
        {tools.map((tool) => (
          <li key={tool.name} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <code className="font-mono text-sm text-synapse">{tool.name}</code>
              {tool.parameters.required?.length ? <span className="label-mono-sm normal-case tracking-normal">{t("toolspec.requires", { list: tool.parameters.required.join(", ") })}</span> : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{tool.description}</p>
            {tool.parameters.properties && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.entries(tool.parameters.properties).map(([k, v]) => (
                  <span key={k} className="label-mono-sm rounded-md bg-surface px-1.5 py-0.5 normal-case tracking-normal">
                    <span className="text-foreground">{k}</span>
                    <span className="text-muted-foreground">: {v.type ?? "any"}</span>
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
