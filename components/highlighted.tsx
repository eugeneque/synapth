import type { Highlight } from "@/cortex/search";

/** Renders search highlight segments without dangerouslySetInnerHTML. */
export function Highlighted({ segments, className }: { segments: Highlight["segments"]; className?: string }) {
  return (
    <span className={className}>
      {segments.map((s, i) =>
        s.match ? (
          <mark key={i} className="bg-synapse/20 text-foreground">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </span>
  );
}
