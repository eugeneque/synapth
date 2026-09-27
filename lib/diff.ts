/**
 * Line-level diff (LCS). Small enough to run in the browser for the
 * Prompt Visualizer, deterministic enough to be tested.
 */

export type DiffOp = "equal" | "add" | "remove";

export interface DiffLine {
  op: DiffOp;
  text: string;
}

/** Above this many LCS cells the middle is shown as a plain replacement instead of an optimal diff. */
const MAX_CELLS = 4_000_000;

export function diffLines(before: string, after: string): DiffLine[] {
  const all = { a: before.length ? before.split("\n") : [], b: after.length ? after.split("\n") : [] };
  // Unchanged head and tail are common (a prompt edited in one place): keep them out of the O(n·m) table.
  let head = 0;
  while (head < all.a.length && head < all.b.length && all.a[head] === all.b[head]) head++;
  let tail = 0;
  while (tail < all.a.length - head && tail < all.b.length - head && all.a[all.a.length - 1 - tail] === all.b[all.b.length - 1 - tail]) tail++;
  const prefix = all.a.slice(0, head).map((text): DiffLine => ({ op: "equal", text }));
  const suffix = all.a.slice(all.a.length - tail).map((text): DiffLine => ({ op: "equal", text }));
  const a = all.a.slice(head, all.a.length - tail);
  const b = all.b.slice(head, all.b.length - tail);
  if ((a.length + 1) * (b.length + 1) > MAX_CELLS) {
    return [...prefix, ...a.map((text): DiffLine => ({ op: "remove", text })), ...b.map((text): DiffLine => ({ op: "add", text })), ...suffix];
  }
  return [...prefix, ...lcsDiff(a, b), ...suffix];
}

function lcsDiff(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;

  // lcs[i][j] = LCS length of a[i..] and b[j..]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: "equal", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ op: "remove", text: a[i] });
      i++;
    } else {
      out.push({ op: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ op: "remove", text: a[i++] });
  while (j < m) out.push({ op: "add", text: b[j++] });
  return out;
}

export function diffSummary(lines: DiffLine[]) {
  return {
    added: lines.filter((l) => l.op === "add").length,
    removed: lines.filter((l) => l.op === "remove").length,
    unchanged: lines.filter((l) => l.op === "equal").length,
  };
}
