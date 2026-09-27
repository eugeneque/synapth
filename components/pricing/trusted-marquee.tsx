/**
 * «Trusted by» strip: company marks slide by in an endless loop, pause on
 * hover and fade out at the edges. Two copies of the row move by half the
 * track width, so the loop has no seam. Pure CSS (`.marquee` in globals.css).
 */

import { TRUSTED_BY, type TrustedCompany, type TrustedGlyph } from "@/lib/trusted-by";

function Glyph({ kind }: { kind: TrustedGlyph }) {
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (kind) {
    case "orbit":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" fill="currentColor" />
          <ellipse cx="12" cy="12" rx="10" ry="4.5" transform="rotate(-25 12 12)" />
        </svg>
      );
    case "hex":
      return (
        <svg {...common}>
          <path d="M12 2.5 20.5 7.25v9.5L12 21.5 3.5 16.75v-9.5z" />
          <path d="M12 8v8M8.5 10l7 4" />
        </svg>
      );
    case "wave":
      return (
        <svg {...common}>
          <path d="M2 9c3-3 5-3 8 0s5 3 8 0 3-2 4-2M2 15c3-3 5-3 8 0s5 3 8 0 3-2 4-2" />
        </svg>
      );
    case "stack":
      return (
        <svg {...common}>
          <path d="m12 3 9 4.5-9 4.5-9-4.5z" />
          <path d="m3 12 9 4.5 9-4.5M3 16.5 12 21l9-4.5" />
        </svg>
      );
    case "spark":
      return (
        <svg {...common}>
          <path d="M12 2v6M12 16v6M2 12h6M16 12h6M5 5l3.5 3.5M15.5 15.5 19 19M19 5l-3.5 3.5M8.5 15.5 5 19" />
        </svg>
      );
    case "grid":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1.5" fill="currentColor" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" fill="currentColor" />
        </svg>
      );
    case "prism":
      return (
        <svg {...common}>
          <path d="M12 2.5 21.5 20h-19z" />
          <path d="M12 2.5V20M12 11l9.5 9" />
        </svg>
      );
    case "ring":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="4.5" fill="currentColor" />
        </svg>
      );
  }
}

function Mark({ company }: { company: TrustedCompany }) {
  if (company.logo) {
    // eslint-disable-next-line @next/next/no-img-element -- static monochrome SVGs from /public
    return <img src={company.logo} alt={company.name} className="h-7 w-auto opacity-60 grayscale transition-opacity duration-300 hover:opacity-100" />;
  }
  return (
    <span className="flex items-center gap-2.5 whitespace-nowrap text-muted-foreground/70 transition-colors duration-300 hover:text-foreground">
      {company.glyph && <Glyph kind={company.glyph} />}
      <span className="font-display text-lg font-medium tracking-tight">{company.name}</span>
    </span>
  );
}

export function TrustedMarquee({ companies = TRUSTED_BY, label }: { companies?: readonly TrustedCompany[]; label: string }) {
  if (!companies.length) return null;
  const row = (hidden: boolean) => (
    <ul className="flex shrink-0 items-center gap-14 pr-14" aria-hidden={hidden || undefined}>
      {companies.map((c) => (
        <li key={c.name}>
          <Mark company={c} />
        </li>
      ))}
    </ul>
  );
  return (
    <div className="marquee overflow-hidden py-2" role="region" aria-label={label}>
      <div className="marquee-track flex w-max" style={{ ["--marquee-duration" as string]: `${Math.max(24, companies.length * 5)}s` }}>
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}
