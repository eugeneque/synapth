import Link from "next/link";
import { LogoWordmark } from "@/components/logo";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { getI18n } from "@/cortex/locale";
import { hasDatabase } from "@/cortex/db";
import pkg from "@/package.json";

/** Auth gate chrome: a minimal top bar, the full-width split screen, a status strip. */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getI18n();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border/70 bg-background/80 px-4 py-3.5 backdrop-blur-md sm:px-6">
        <Link href="/" className="flex items-center gap-3">
          <LogoWordmark className="h-7" />
          <span className="flex items-center">
            <span className="label-mono-sm rounded-md border border-synapse/30 bg-synapse/10 px-1.5 py-0.5 text-synapse">{t("auth.gate")}</span>
          </span>
        </Link>
        <div className="flex items-center gap-4 font-mono text-xs text-muted-foreground">
          <span className="hidden items-center gap-1.5 uppercase tracking-[0.08em] sm:flex">
            <span className="dot-live animate-pulse-dot" /> {t("auth.protocol", { version: pkg.version })}
          </span>
          <Link href="/faq" className="hidden transition-colors hover:text-synapse sm:inline">
            {t("auth.docs")}
          </Link>
          <Link href="/faq#install" className="hidden transition-colors hover:text-synapse md:inline">
            {t("auth.securitySpec")}
          </Link>
          <LocaleSwitcher />
        </div>
      </header>

      <main className="flex w-full flex-1 flex-col">{children}</main>

      <footer className="label-mono-sm z-20 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-border/70 bg-background px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-4">
          <span>{t("auth.foot.protocol", { version: pkg.version })}</span>
          <span className="text-foreground">
            {t("auth.foot.latency")}{" "}
            <strong className="font-medium text-synapse">
              {t("auth.foot.latencyValue", {
                store: hasDatabase ? "postgres" : "in-memory",
              })}
            </strong>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <span>
            {t("auth.foot.scanner")} <strong className="font-medium text-synapse">{t("auth.foot.scannerValue")}</strong>
          </span>
          <span>{t("auth.foot.copyright", { year: new Date().getFullYear() })}</span>
        </div>
      </footer>
    </div>
  );
}
