import Link from "next/link";
import { Logo } from "@/components/logo";
import pkg from "@/package.json";

const LINKS = [
  { label: "API reference", href: "/faq#agents" },
  { label: "Registry", href: "/explore" },
  { label: "Security", href: "/faq#install" },
  { label: "Publish", href: "/dashboard#publish" },
];

/** Compact status footer: protocol version, telemetry, mono link row. */
export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border bg-surface-lowest/80 backdrop-blur-sm">
      <div className="container flex flex-col gap-4 py-6 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link href="/" className="inline-flex items-center gap-2 font-semibold tracking-tight">
            <Logo className="h-4 w-4" /> Synapth
          </Link>
          <span className="hidden h-3 w-px bg-border sm:block" />
          <span className="label-mono-sm inline-flex items-center gap-2 text-foreground">
            <span className="dot-live" /> Protocol v{pkg.version}
          </span>
          <span className="hidden h-3 w-px bg-border sm:block" />
          <span className="label-mono-sm">
            Cortex API <span className="text-foreground">v1</span>
          </span>
          <span className="hidden h-3 w-px bg-border sm:block" />
          <span className="label-mono-sm">
            Scanner <span className="text-synapse">v1</span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="label-mono transition-colors hover:text-foreground">
              {l.label}
            </Link>
          ))}
          <span className="label-mono-sm">© {new Date().getFullYear()} Synapth. Lab runtime active.</span>
        </div>
      </div>
    </footer>
  );
}
