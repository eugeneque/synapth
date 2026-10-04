/**
 * Companies in the «Trusted by» strip on /pro (components/pricing/trusted-marquee.tsx).
 *
 * PLACEHOLDERS: these names are invented and stand in until real customers
 * agree to be listed. Replace them (and drop the `glyph`) with the real
 * roster before launch: `logo` is a monochrome SVG under `public/partners/`,
 * drawn in `currentColor` or white, about 32 px high.
 */

export type TrustedGlyph = "orbit" | "hex" | "wave" | "stack" | "spark" | "grid" | "prism" | "ring";

export interface TrustedCompany {
  name: string;
  /** `/partners/<file>.svg`; without it the strip draws `glyph` + the name as a wordmark. */
  logo?: string;
  glyph?: TrustedGlyph;
}

export const TRUSTED_BY: readonly TrustedCompany[] = [
  { name: "Northwind Labs", glyph: "orbit" },
  { name: "Kestrel Systems", glyph: "spark" },
  { name: "Orbita Cloud", glyph: "ring" },
  { name: "Vektor AI", glyph: "prism" },
  { name: "Polar Robotics", glyph: "hex" },
  { name: "Meridian Fintech", glyph: "wave" },
  { name: "Atlas Logistics", glyph: "stack" },
  { name: "Quanta Soft", glyph: "grid" },
];
