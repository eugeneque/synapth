import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Brackets } from "@/components/corners";
import FaultyTerminal from "@/components/faulty-terminal";
import { getI18n } from "@/cortex/locale";

export default async function NotFound() {
  const { t } = await getI18n();
  return (
    <div className="relative isolate flex flex-1 flex-col items-center overflow-hidden py-32 text-center">
      {/* Live zone: the faulty terminal, faded out at the edges into the page. */}
      <FaultyTerminal className="absolute inset-0 -z-10 opacity-70 [mask-image:radial-gradient(70%_70%_at_50%_45%,black,transparent)]" />
      <div className="container relative flex flex-col items-center">
        <div className="relative flex w-full max-w-md flex-col items-center gap-5 rounded-xl border border-border bg-card/90 px-8 py-12 backdrop-blur-sm">
          <Brackets />
          <p className="label-mono tracking-[0.2em] text-synapse">{t("nf.label")}</p>
          <p className="cursor font-display text-7xl font-medium tracking-tight text-foreground">404</p>
          <p className="max-w-sm text-sm text-muted-foreground">{t("nf.body")}</p>
          <div className="flex gap-2">
            <Button asChild>
              <Link href="/search?tab=skills">{t("common.exploreRegistry")}</Link>
            </Button>
            <Button asChild variant="mono">
              <Link href="/">{t("common.overview")}</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
