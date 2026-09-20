import { cn } from "@/lib/utils";

/**
 * ActivityHeatmap — 52 weeks of publisher activity, GitHub-contribution style.
 * Pure: the caller passes ISO timestamps (skill creation, updates, repo pushes)
 * and the grid buckets them per day. No synthetic filler.
 */

const WEEKS = 52;
const DAY = 86_400_000;

export interface HeatmapStats {
  total: number;
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
}

export function bucketActivity(timestamps: string[], now = Date.now()): { cells: number[]; months: Array<{ index: number; label: string }>; stats: HeatmapStats } {
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  // Start on the Sunday WEEKS-1 weeks back so columns are whole weeks.
  const start = new Date(end.getTime() - (WEEKS * 7 - 1) * DAY);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const days = Math.round((end.getTime() - start.getTime()) / DAY) + 1;
  const cells = new Array<number>(days).fill(0);
  let total = 0;
  for (const iso of timestamps) {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) continue;
    const idx = Math.floor((t - start.getTime()) / DAY);
    if (idx >= 0 && idx < days) {
      cells[idx] += 1;
      total += 1;
    }
  }
  const months: Array<{ index: number; label: string }> = [];
  let lastMonth = -1;
  for (let i = 0; i < days; i += 7) {
    const d = new Date(start.getTime() + i * DAY);
    if (d.getUTCMonth() !== lastMonth) {
      lastMonth = d.getUTCMonth();
      months.push({ index: i / 7, label: d.toLocaleString("en", { month: "short", timeZone: "UTC" }) });
    }
  }
  let current = 0;
  for (let i = days - 1; i >= 0 && cells[i] > 0; i--) current++;
  let longest = 0;
  let run = 0;
  for (const c of cells) {
    run = c > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return { cells, months, stats: { total, activeDays: cells.filter((c) => c > 0).length, currentStreak: current, longestStreak: longest } };
}

function level(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0) return 0;
  const r = count / Math.max(max, 1);
  if (r > 0.75) return 4;
  if (r > 0.5) return 3;
  if (r > 0.25) return 2;
  return 1;
}

const LEVEL_CLASS = ["bg-surface-high/70", "bg-synapse/25", "bg-synapse/45", "bg-synapse/70", "bg-synapse shadow-[0_0_6px_hsl(var(--synapse)/0.5)]"] as const;

export function ActivityHeatmap({ cells, months, className }: { cells: number[]; months: Array<{ index: number; label: string }>; className?: string }) {
  const max = Math.max(...cells, 1);
  const weeks = Math.ceil(cells.length / 7);
  return (
    <div className={cn("overflow-x-auto", className)}>
      <div className="min-w-[720px]">
        <div className="label-mono-sm relative mb-1.5 h-3">
          {months.map((m) => (
            <span key={`${m.label}-${m.index}`} className="absolute" style={{ left: `${(m.index / weeks) * 100}%` }}>
              {m.label}
            </span>
          ))}
        </div>
        <div className="grid grid-flow-col gap-[3px]" style={{ gridTemplateRows: "repeat(7, minmax(0, 1fr))", gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }}>
          {cells.map((count, i) => (
            <span key={i} title={count ? `${count}` : undefined} className={cn("aspect-square w-full rounded-[2px] transition-colors", LEVEL_CLASS[level(count, max)])} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function HeatmapLegend({ less, more }: { less: string; more: string }) {
  return (
    <span className="label-mono-sm inline-flex items-center gap-1.5">
      {less}
      {LEVEL_CLASS.map((c, i) => (
        <span key={i} className={cn("inline-block h-2.5 w-2.5 rounded-[2px]", c)} />
      ))}
      {more}
    </span>
  );
}
