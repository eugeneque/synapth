import { cn } from "@/lib/utils";
import type { DiffLine } from "@/lib/diff";

/** Unchanged lines kept around each change; longer unchanged runs fold into one row. */
const CONTEXT = 3;

type Row = { kind: "line"; line: DiffLine; before: number | null; after: number | null } | { kind: "fold"; count: number };

/** Line numbers on both sides, with long unchanged stretches folded. */
export function foldDiff(lines: DiffLine[], context = CONTEXT): Row[] {
  const numbered: Array<Extract<Row, { kind: "line" }>> = [];
  let a = 0;
  let b = 0;
  for (const line of lines) {
    numbered.push({ kind: "line", line, before: line.op === "add" ? null : ++a, after: line.op === "remove" ? null : ++b });
  }
  const near = numbered.map(() => false);
  numbered.forEach((r, i) => {
    if (r.line.op === "equal") return;
    for (let j = Math.max(0, i - context); j <= Math.min(numbered.length - 1, i + context); j++) near[j] = true;
  });
  const rows: Row[] = [];
  let folded = 0;
  numbered.forEach((r, i) => {
    if (r.line.op !== "equal" || near[i]) {
      if (folded) rows.push({ kind: "fold", count: folded });
      folded = 0;
      rows.push(r);
    } else folded++;
  });
  if (folded) rows.push({ kind: "fold", count: folded });
  return rows;
}

export function VersionDiff({ lines, foldLabel }: { lines: DiffLine[]; foldLabel: (n: number) => string }) {
  const rows = foldDiff(lines);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse font-mono text-[12px] leading-5">
        <tbody>
          {rows.map((r, i) =>
            r.kind === "fold" ? (
              <tr key={`f${i}`} className="bg-surface-low/60">
                <td colSpan={4} className="label-mono-sm px-4 py-1.5 normal-case tracking-normal">
                  ⋯ {foldLabel(r.count)}
                </td>
              </tr>
            ) : (
              <tr key={i} className={cn(r.line.op === "add" && "bg-synapse/10", r.line.op === "remove" && "bg-danger/10")}>
                <td className="w-10 select-none border-r border-border px-2 text-right text-muted-foreground/60">{r.before ?? ""}</td>
                <td className="w-10 select-none border-r border-border px-2 text-right text-muted-foreground/60">{r.after ?? ""}</td>
                <td className={cn("w-6 select-none text-center", r.line.op === "add" ? "text-synapse" : r.line.op === "remove" ? "text-danger" : "text-muted-foreground/50")}>
                  {r.line.op === "add" ? "+" : r.line.op === "remove" ? "−" : ""}
                </td>
                <td className={cn("whitespace-pre-wrap break-words pr-4", r.line.op === "equal" ? "text-muted-foreground" : "text-foreground")}>{r.line.text || " "}</td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
