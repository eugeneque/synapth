import { Braces } from "lucide-react";
import { Panel } from "@/components/panel";
import { CopyButton } from "@/components/copy-button";
import type { Skill } from "@/types/skill";

/** MCP tool specifications as the model sees them, with a copy-JSON action. */
export function ToolSpec({ skill }: { skill: Skill }) {
  const tools = skill.manifest.tools;
  if (!tools.length) return null;
  const json = JSON.stringify({ name: skill.slug, version: skill.version, tools }, null, 2);
  return (
    <Panel
      title={`Tool specifications (${skill.source?.manifestFile ?? "synapth.json"})`}
      icon={<Braces className="h-4 w-4 shrink-0 text-moss" />}
      actions={<CopyButton text={json} label="[Copy JSON]" />}
      corners
      footer={<><span>{tools.length} tool{tools.length === 1 ? "" : "s"} exposed to the model</span><span>schema: json-schema subset</span></>}
    >
      <ul className="divide-y divide-border">
        {tools.map((t) => (
          <li key={t.name} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <code className="font-mono text-sm text-synapse">{t.name}</code>
              {t.parameters.required?.length ? <span className="label-mono-sm normal-case tracking-normal">requires {t.parameters.required.join(", ")}</span> : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>
            {t.parameters.properties && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.entries(t.parameters.properties).map(([k, v]) => (
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
