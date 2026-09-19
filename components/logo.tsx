/** Two neurons, one synapse — the Synapth mark, on the pixel grid. */
export function Logo({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true" shapeRendering="crispEdges">
      <rect x="4" y="6" width="8" height="8" className="fill-synapse" />
      <rect x="20" y="18" width="8" height="8" className="fill-synapse" />
      <rect x="12" y="12" width="2" height="2" fill="currentColor" />
      <rect x="14" y="14" width="2" height="2" fill="currentColor" />
      <rect x="16" y="16" width="2" height="2" fill="currentColor" />
      <rect x="18" y="16" width="2" height="2" fill="currentColor" fillOpacity="0.5" />
      <rect x="4" y="18" width="2" height="8" fill="currentColor" fillOpacity="0.3" />
      <rect x="26" y="6" width="2" height="8" fill="currentColor" fillOpacity="0.3" />
    </svg>
  );
}
