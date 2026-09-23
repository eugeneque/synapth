/** Remounts on every navigation inside the site group, so each page rises in instead of snapping. */
export default function SiteTemplate({ children }: { children: React.ReactNode }) {
  return <div className="animate-rise">{children}</div>;
}
