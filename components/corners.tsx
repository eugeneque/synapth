import { cn } from "@/lib/utils";

/**
 * Blueprint crosshair ticks on the four corners of a positioned parent.
 * Pass `hover` to only reveal them when the parent (`group`) is hovered.
 */
export function Corners({ className, hover = false }: { className?: string; hover?: boolean }) {
  const tick = "pointer-events-none absolute h-2.5 w-2.5 before:absolute before:left-1/2 before:top-0 before:h-full before:w-px before:-translate-x-1/2 before:bg-current after:absolute after:left-0 after:top-1/2 after:h-px after:w-full after:-translate-y-1/2 after:bg-current";
  return (
    <span aria-hidden="true" className={cn("text-foreground/60 transition-opacity duration-150", hover && "opacity-0 group-hover:opacity-100", className)}>
      <span className={cn(tick, "-left-[5px] -top-[5px]")} />
      <span className={cn(tick, "-right-[5px] -top-[5px]")} />
      <span className={cn(tick, "-bottom-[5px] -left-[5px]")} />
      <span className={cn(tick, "-bottom-[5px] -right-[5px]")} />
    </span>
  );
}

/** Solid L-shaped brackets in the accent colour — the auth-gate frame. */
export function Brackets({ className }: { className?: string }) {
  const b = "pointer-events-none absolute h-2.5 w-2.5 border-synapse";
  return (
    <span aria-hidden="true" className={className}>
      <span className={cn(b, "-left-px -top-px border-l-2 border-t-2")} />
      <span className={cn(b, "-right-px -top-px border-r-2 border-t-2")} />
      <span className={cn(b, "-bottom-px -left-px border-b-2 border-l-2")} />
      <span className={cn(b, "-bottom-px -right-px border-b-2 border-r-2")} />
    </span>
  );
}
