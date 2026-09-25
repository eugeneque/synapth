import Link from "next/link";
import { LogoWordmark } from "@/components/logo";
import { getI18n } from "@/cortex/locale";
import pkg from "@/package.json";

const LINKS = [
  { key: "footer.api", href: "/faq#agents" },
  { key: "footer.registry", href: "/search?tab=skills" },
  { key: "footer.security", href: "/faq#install" },
  { key: "footer.publish", href: "/dashboard/developer#publish" },
  { key: "footer.pricing", href: "/pro" },
] as const;

/** Compact footer: version, API and scanner versions, mono link row. */
export async function SiteFooter() {
  const { t } = await getI18n();
  return (
    <footer className="mt-24 border-t border-border bg-surface-lowest/80 backdrop-blur-sm">
      <div className="container flex flex-col gap-4 py-6 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link href="/" aria-label="Synapth" className="inline-flex items-center">
            <LogoWordmark className="h-5" />
          </Link>
          <span className="hidden h-3 w-px bg-border sm:block" />
          <span className="label-mono-sm inline-flex items-center gap-2 text-foreground">
            <span className="dot-live" /> {t("footer.protocol", { version: pkg.version })}
          </span>
          <span className="hidden h-3 w-px bg-border sm:block" />
          <span className="label-mono-sm">
            {t("footer.cortexApi")} <span className="text-foreground">v1</span>
          </span>
          <span className="hidden h-3 w-px bg-border sm:block" />
          <span className="label-mono-sm">
            {t("footer.scanner")} <span className="text-synapse">v1</span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="label-mono transition-colors hover:text-foreground">
              {t(l.key)}
            </Link>
          ))}
          <span className="label-mono-sm">{t("footer.copyright", { year: new Date().getFullYear() })}</span>
        </div>
      </div>
    </footer>
  );
}
