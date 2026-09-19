"use client";

/**
 * Prompt & Logic Visualizer
 *
 * Shows what installing a skill does to an agent:
 *   1. a node graph of the execution flow (trigger → tools → decisions → output),
 *      laid out in layers from the manifest's `flow` (or derived from `tools`);
 *   2. the exact system-prompt diff (baseline vs. baseline + skill).
 * Clicking a node reveals its tool schema; clicking a tool schema highlights
 * every flow step that invokes it.
 */

import { useMemo, useState } from "react";
import { Bolt, GitBranch, PlayCircle, Terminal, Wrench } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Corners } from "@/components/corners";
import { diffLines, diffSummary } from "@/lib/diff";
import type { FlowStep, Skill, ToolDefinition } from "@/types/skill";

const DEFAULT_BASELINE = "You are a helpful assistant.\nAnswer concisely and ask for clarification when the request is ambiguous.";

interface Props {
  skill: Skill;
  /** The agent's system prompt before the skill is installed. */
  baseSystemPrompt?: string;
  className?: string;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

interface LaidOutNode extends FlowStep {
  x: number;
  y: number;
  layer: number;
}

const NODE_W = 168;
const NODE_H = 44;
const GAP_X = 72;
const GAP_Y = 24;

/** If the manifest has no explicit flow, derive trigger → each tool → output. */
function deriveFlow(skill: Skill): FlowStep[] {
  if (skill.manifest.flow?.length) return skill.manifest.flow;
  const tools = skill.manifest.tools;
  if (!tools.length) {
    return [
      { id: "t", label: "User message", kind: "trigger", next: ["p"] },
      { id: "p", label: "Prompt rewrites behaviour", kind: "decision", next: ["o"] },
      { id: "o", label: "Response", kind: "output" },
    ];
  }
  return [
    { id: "t", label: "Agent decides to call", kind: "trigger", next: tools.map((t) => `tool:${t.name}`) },
    ...tools.map<FlowStep>((t) => ({ id: `tool:${t.name}`, label: t.name, kind: "tool", tool: t.name, next: ["o"] })),
    { id: "o", label: "Result in context", kind: "output" },
  ];
}

function layout(steps: FlowStep[]): { nodes: LaidOutNode[]; edges: Array<[LaidOutNode, LaidOutNode]>; width: number; height: number } {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const incoming = new Map<string, number>(steps.map((s) => [s.id, 0]));
  for (const s of steps) for (const n of s.next ?? []) if (incoming.has(n)) incoming.set(n, (incoming.get(n) ?? 0) + 1);

  // Longest-path layering so branches that rejoin end up in the same column.
  const layerOf = new Map<string, number>();
  const visit = (id: string, depth: number, seen: Set<string>) => {
    if (seen.has(id)) return; // cycle guard
    layerOf.set(id, Math.max(layerOf.get(id) ?? 0, depth));
    const node = byId.get(id);
    for (const n of node?.next ?? []) if (byId.has(n)) visit(n, depth + 1, new Set(seen).add(id));
  };
  for (const s of steps) if ((incoming.get(s.id) ?? 0) === 0) visit(s.id, 0, new Set());
  for (const s of steps) if (!layerOf.has(s.id)) layerOf.set(s.id, 0);

  const columns = new Map<number, FlowStep[]>();
  for (const s of steps) {
    const l = layerOf.get(s.id)!;
    columns.set(l, [...(columns.get(l) ?? []), s]);
  }
  const layerCount = Math.max(...columns.keys()) + 1;
  const tallest = Math.max(...[...columns.values()].map((c) => c.length));
  const height = tallest * NODE_H + (tallest - 1) * GAP_Y + 32;

  const nodes: LaidOutNode[] = [];
  for (const [layer, col] of columns) {
    const colHeight = col.length * NODE_H + (col.length - 1) * GAP_Y;
    const top = (height - colHeight) / 2;
    col.forEach((s, i) => nodes.push({ ...s, layer, x: 16 + layer * (NODE_W + GAP_X), y: top + i * (NODE_H + GAP_Y) }));
  }
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const edges: Array<[LaidOutNode, LaidOutNode]> = [];
  for (const n of nodes) for (const t of n.next ?? []) if (nodeById.has(t)) edges.push([n, nodeById.get(t)!]);

  return { nodes, edges, width: 32 + layerCount * NODE_W + (layerCount - 1) * GAP_X, height };
}

const KIND_STYLE: Record<FlowStep["kind"], { icon: typeof Bolt; stroke: string; fill: string }> = {
  trigger: { icon: PlayCircle, stroke: "stroke-info/60", fill: "fill-muted" },
  tool: { icon: Wrench, stroke: "stroke-synapse", fill: "fill-synapse/10" },
  decision: { icon: GitBranch, stroke: "stroke-warn/70", fill: "fill-warn/5" },
  output: { icon: Terminal, stroke: "stroke-foreground/50", fill: "fill-muted" },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PromptVisualizer({ skill, baseSystemPrompt = DEFAULT_BASELINE, className }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const steps = useMemo(() => deriveFlow(skill), [skill]);
  const graph = useMemo(() => layout(steps), [steps]);

  const after = skill.manifest.systemPrompt ? `${baseSystemPrompt}\n\n# Skill: ${skill.name}\n${skill.manifest.systemPrompt}` : baseSystemPrompt;
  const diff = useMemo(() => diffLines(baseSystemPrompt, after), [baseSystemPrompt, after]);
  const summary = diffSummary(diff);

  const selectedNode = graph.nodes.find((n) => n.id === selected) ?? null;
  const selectedTool: ToolDefinition | null = selectedNode?.tool ? (skill.manifest.tools.find((t) => t.name === selectedNode.tool) ?? null) : null;
  const highlightedTool = selectedTool?.name ?? null;

  return (
    <div className={cn("group relative border border-border bg-card", className)}>
      <Corners hover />
      <Tabs defaultValue="flow">
        <div className="panel-head">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="h-2 w-2 shrink-0 bg-synapse" />
            <h3 className="label-mono text-foreground">Prompt & runtime logic pipeline</h3>
            <span className="label-mono-sm hidden items-center gap-1.5 sm:inline-flex">
              <span className="dot-live animate-pulse-dot" /> {skill.manifest.tools.length} tool{skill.manifest.tools.length === 1 ? "" : "s"} · +{summary.added} prompt line{summary.added === 1 ? "" : "s"} · {steps.length} steps
            </span>
          </div>
          <TabsList className="h-8">
            <TabsTrigger value="flow" className="h-8">Execution flow</TabsTrigger>
            <TabsTrigger value="diff" className="h-8" id="prompt-diff">System prompt diff</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="flow" className="mt-0 grid gap-0 md:grid-cols-[1fr_280px]">
          <div className="overflow-x-auto p-4">
            <div className="label-mono-sm mb-3 flex items-center justify-between">
              <span>{"// Cortex execution graph (topology: layered-dag)"}</span>
              <span>Synapth-engine: v1</span>
            </div>
            <svg viewBox={`0 0 ${graph.width} ${graph.height}`} width={graph.width} height={graph.height} style={{ minWidth: graph.width }} className="font-sans text-foreground">
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 0 L10 5 L0 10 z" className="fill-muted-foreground" />
                </marker>
              </defs>

              {graph.edges.map(([a, b]) => {
                const x1 = a.x + NODE_W;
                const y1 = a.y + NODE_H / 2;
                const x2 = b.x;
                const y2 = b.y + NODE_H / 2;
                const c = (x2 - x1) / 2;
                const active = selected === a.id || selected === b.id;
                return (
                  <path
                    key={`${a.id}->${b.id}`}
                    d={`M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`}
                    fill="none"
                    markerEnd="url(#arrow)"
                    className={cn("stroke-[1.5] transition-colors", active ? "stroke-synapse" : "stroke-muted-foreground/50")}
                  />
                );
              })}

              {graph.nodes.map((n) => {
                const style = KIND_STYLE[n.kind];
                const Icon = style.icon;
                const isSelected = selected === n.id;
                const usesHighlighted = highlightedTool && n.tool === highlightedTool;
                return (
                  <g
                    key={n.id}
                    transform={`translate(${n.x},${n.y})`}
                    className="cursor-pointer"
                    onClick={() => setSelected(isSelected ? null : n.id)}
                    role="button"
                    aria-pressed={isSelected}
                    aria-label={`${n.kind}: ${n.label}`}
                  >
                    <rect
                      width={NODE_W}
                      height={NODE_H}
                      rx={2}
                      className={cn("fill-background transition-all", style.stroke, style.fill, isSelected || usesHighlighted ? "stroke-[2]" : "stroke-[1]")}
                    />
                    <foreignObject x={0} y={0} width={NODE_W} height={NODE_H}>
                      <div className="flex h-full items-center gap-2 px-3 text-xs">
                        <Icon className={cn("h-3.5 w-3.5 shrink-0", n.kind === "tool" ? "text-synapse" : "text-muted-foreground")} />
                        <span className={cn("truncate", n.kind === "tool" && "font-mono")}>{n.label}</span>
                      </div>
                    </foreignObject>
                  </g>
                );
              })}
            </svg>
          </div>

          <aside className="border-t border-border bg-surface-lowest/60 p-4 text-sm md:border-l md:border-t-0">
            {selectedNode ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{selectedNode.kind}</Badge>
                  <span className="font-medium">{selectedNode.label}</span>
                </div>
                {selectedTool ? (
                  <>
                    <p className="text-muted-foreground">{selectedTool.description || "No description."}</p>
                    <pre className="max-h-64 overflow-auto border border-border bg-background p-3 font-mono text-[11px] leading-relaxed">
                      {JSON.stringify(selectedTool.parameters, null, 2)}
                    </pre>
                  </>
                ) : selectedNode.kind === "decision" ? (
                  <p className="text-muted-foreground">The model branches here based on context; the next step is chosen at runtime.</p>
                ) : selectedNode.kind === "trigger" ? (
                  <p className="text-muted-foreground">Entry point: what has to happen in the conversation for this skill to activate.</p>
                ) : (
                  <p className="text-muted-foreground">Final effect of the flow on the conversation.</p>
                )}
                {selectedNode.next?.length ? <p className="text-xs text-muted-foreground">→ {selectedNode.next.join(", ")}</p> : null}
              </div>
            ) : (
              <div className="space-y-2 text-muted-foreground">
                <p>Click a node to inspect it.</p>
                <ul className="space-y-1 text-xs">
                  {(Object.keys(KIND_STYLE) as FlowStep["kind"][]).map((k) => {
                    const Icon = KIND_STYLE[k].icon;
                    return (
                      <li key={k} className="flex items-center gap-2">
                        <Icon className="h-3.5 w-3.5" /> {k}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </aside>
        </TabsContent>

        <TabsContent value="diff" className="mt-0">
          <div className="label-mono-sm flex items-center justify-between gap-2 px-4 py-2">
            <span>Source: lib/diff.ts · baseline vs. baseline + skill</span>
            <span className="flex items-center gap-1">
              <Bolt className="h-3 w-3 text-synapse" /> injected verbatim into the agent&apos;s system prompt
            </span>
          </div>
          <pre className="max-h-[480px] overflow-auto bg-surface-lowest px-2 py-3 font-mono text-xs leading-relaxed">
            {diff.map((line, i) => (
              <div
                key={i}
                className={cn(
                  "flex gap-2 rounded-md px-2 py-0.5",
                  line.op === "add" && "bg-synapse/10 text-synapse",
                  line.op === "remove" && "bg-danger/10 text-danger line-through",
                  line.op === "equal" && "text-muted-foreground/70",
                )}
              >
                <span className="label-mono-sm w-8 shrink-0 select-none text-right normal-case tracking-normal opacity-70">{i + 1}</span>
                <span className="w-3 shrink-0 select-none text-center font-bold">{line.op === "add" ? "+" : line.op === "remove" ? "−" : " "}</span>
                <span className="whitespace-pre-wrap">{line.text || " "}</span>
              </div>
            ))}
          </pre>
          <div className="label-mono-sm flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-low/60 px-4 py-2">
            <span>
              Delta: <span className="text-synapse">+{summary.added}</span> injections, <span className="text-danger">−{summary.removed}</span> overrides, {summary.unchanged} unchanged
            </span>
            <span className="text-moss">Baseline: {baseSystemPrompt.split("\n").length} lines</span>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
