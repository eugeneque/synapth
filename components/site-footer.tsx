import Link from "next/link";
import { ArrowUp } from "lucide-react";
import { Logo } from "@/components/logo";
import { getI18n } from "@/cortex/locale";
import type { UiKey } from "@/lib/i18n";
import pkg from "@/package.json";

const GROUPS: { title: UiKey; links: { key: UiKey; href: string }[] }[] = [
  {
    title: "footer.group.catalog",
    links: [
      { key: "footer.skills", href: "/search?tab=skills" },
      { key: "footer.mcp", href: "/search?tab=skills&category=MCP" },
      { key: "footer.skillsets", href: "/search?tab=skillsets" },
      { key: "footer.people", href: "/search?tab=people" },
    ],
  },
  {
    title: "footer.group.developers",
    links: [
      { key: "footer.publish", href: "/dashboard/developer#publish" },
      { key: "footer.keys", href: "/dashboard/developer#keys" },
      { key: "footer.api", href: "/faq#agents" },
      { key: "footer.manifest", href: "/faq#publish-manifest" },
    ],
  },
  {
    title: "footer.group.platform",
    links: [
      { key: "footer.overview", href: "/" },
      { key: "footer.faq", href: "/faq" },
      { key: "footer.security", href: "/faq#install" },
      { key: "footer.badges", href: "/faq#install-badges" },
    ],
  },
];

/** A faceted dark shard drifting over the wordmark — the footer's stand-in for debris in orbit. */
function Shard({ className, points, id }: { className: string; points: string; id: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" className={`pointer-events-none absolute drop-shadow-[0_12px_24px_rgba(0,0,0,0.6)] ${className}`}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="hsl(var(--surface-highest))" />
          <stop offset="55%" stopColor="hsl(var(--surface-low))" />
          <stop offset="100%" stopColor="hsl(var(--background))" />
        </linearGradient>
      </defs>
      <polygon points={points} fill={`url(#${id})`} stroke="hsl(var(--synapse) / 0.25)" strokeWidth="0.6" />
    </svg>
  );
}

/**
 * Site footer: mono link columns and system readouts over a lime glow,
 * closed by an oversized wordmark that bleeds off the bottom edge with a few drifting shards.
 */
export async function SiteFooter() {
  const { t } = await getI18n();
  const year = new Date().getFullYear();
  return (
    <footer className="relative mt-24 overflow-hidden border-t border-border bg-background">
      {/* Graphite fading into the synapse glow, brightest right behind the wordmark. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,hsl(var(--background))_0%,hsl(var(--background))_30%,hsl(var(--secondary-tone)/0.35)_72%,hsl(var(--synapse)/0.55)_100%)]" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-1/3 left-1/2 h-[80%] w-[120%] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(closest-side,hsl(var(--synapse)/0.45),hsl(var(--synapse)/0))] blur-2xl" />

      <div className="container relative pt-16">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-4">
          {GROUPS.map((g) => (
            <nav key={g.title} aria-label={t(g.title)} className="flex flex-col gap-2.5">
              <span className="label-mono-sm text-muted-foreground/70">{t(g.title)}</span>
              {g.links.map((l) => (
                <Link key={l.href} href={l.href} className="w-fit font-mono text-[12px] uppercase tracking-[0.08em] text-foreground/85 transition-colors hover:text-synapse">
                  {t(l.key)}
                </Link>
              ))}
            </nav>
          ))}
          <div className="flex flex-col gap-2.5">
            <span className="label-mono-sm text-muted-foreground/70">{t("footer.group.system")}</span>
            <span className="inline-flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.08em] text-foreground/85">
              <span className="dot-live animate-pulse-dot" /> {t("footer.status")}
            </span>
            <span className="font-mono text-[12px] uppercase tracking-[0.08em] text-foreground/60">{t("footer.protocol", { version: pkg.version })}</span>
            <span className="font-mono text-[12px] uppercase tracking-[0.08em] text-foreground/60">
              {t("footer.cortexApi")} <span className="text-foreground">v1</span>
            </span>
            <span className="font-mono text-[12px] uppercase tracking-[0.08em] text-foreground/60">
              {t("footer.scanner")} <span className="text-synapse">v1</span>
            </span>
          </div>
        </div>

        <div className="mt-20 flex flex-wrap items-center justify-between gap-4 md:mt-28">
          <span className="label-mono-sm text-foreground/70">{t("footer.copyright", { year })}</span>
          <a href="#" className="label-mono-sm inline-flex items-center gap-1.5 text-foreground/80 transition-colors hover:text-foreground">
            {t("footer.toTop")} <ArrowUp className="h-3 w-3" />
          </a>
        </div>
      </div>

      {/* The wordmark is decoration — the brand name is already announced by the header logo. */}
      <div aria-hidden="true" className="container relative mt-4 select-none">
        <div className="relative h-[clamp(3.6rem,16vw,14.5rem)] overflow-hidden">
          <span className="absolute inset-x-0 top-0 block text-center font-display text-[clamp(4.5rem,20.5vw,18.5rem)] font-medium uppercase leading-[0.78] tracking-[-0.06em] text-background">
            Synapth
          </span>
        </div>

        <div className="pointer-events-none absolute left-[38%] top-[-18%] w-[clamp(3.5rem,10vw,8rem)] animate-float-slow drop-shadow-[0_0_24px_hsl(var(--synapse)/0.55)]">
          <Logo className="h-full w-full" />
        </div>
        <Shard id="shard-a" points="18,8 70,2 96,40 78,92 26,86 4,48" className="right-[22%] top-[-62%] hidden sm:block w-[clamp(1.75rem,4vw,3.25rem)] animate-float-reverse" />
        <Shard id="shard-b" points="10,20 58,4 92,30 86,78 40,98 6,70" className="bottom-[-18%] left-[-2%] w-[clamp(3.5rem,9vw,7.5rem)] animate-float-slow" />
        <Shard id="shard-c" points="22,14 64,0 98,26 94,84 50,100 2,62" className="bottom-[-28%] right-[-3%] w-[clamp(4.5rem,12vw,10rem)] animate-float-reverse" />
        <Shard id="shard-d" points="14,24 60,6 90,38 70,90 20,80" className="bottom-[8%] left-[17%] w-[clamp(1.75rem,5vw,4rem)] animate-float-reverse" />
      </div>
    </footer>
  );
}
