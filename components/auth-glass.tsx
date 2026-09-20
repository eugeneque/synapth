/**
 * AuthGlass — the left half of the auth screen.
 *
 * A live light gradient in the system palette (synapse lime → moss) drifts across the
 * whole area; on top sits a row of narrow vertical glass ribs. Each rib
 * blurs and brightens whatever passes behind it and carries its own edge
 * shading, so the light reads as refracted through fluted glass rather than
 * painted on. Pure CSS: the blobs animate with transforms, the ribs use
 * backdrop-filter. `prefers-reduced-motion` freezes the blobs in place.
 */

import { cn } from "@/lib/utils";

const RIBS = 22;

export function AuthGlass({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("relative overflow-hidden bg-[#070a03]", className)}>
      {/* Light field: three soft blobs on different paths, over a dim base wash. */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_25%_55%,hsl(var(--synapse-dim)/0.35)_0%,#0f1a05_55%,transparent_80%)]" />
      <div className="auth-blob auth-blob-cyan" />
      <div className="auth-blob auth-blob-green" />
      <div className="auth-blob auth-blob-blue" />

      {/* Fluted glass: narrow ribs that refract the light behind them. */}
      <div className="absolute inset-0 flex">
        {Array.from({ length: RIBS }, (_, i) => (
          <div key={i} className="auth-rib" />
        ))}
      </div>

      {/* Soft vignette so the panel edge meets the dark form side cleanly. */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-[#070a03]/40" />
    </div>
  );
}
