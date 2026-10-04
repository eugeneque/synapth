import { Blocks } from "loading-dev";
import { cn } from "@/lib/utils";

/**
 * The one loader of the platform: loading.dev `Blocks`, a 3×3 pixel sweep in
 * `currentColor` (design.md §5 — pixels are the only thing that "lives").
 * Pure CSS, so it works in server and client components alike; reduced
 * motion freezes it. Pass `label` when the spinner is the only signal.
 */
export function Spinner({ size = 16, className, label }: { size?: number; className?: string; label?: string }) {
  return (
    <span role={label ? "status" : undefined} className={cn("inline-flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }}>
      <Blocks size={size} duration={900} />
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}
