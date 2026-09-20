import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Brackets } from "@/components/corners";
import { getI18n } from "@/cortex/locale";

export default async function NotFound() {
  const { t } = await getI18n();
  return (
    <div className="container flex flex-col items-center py-32 text-center">
      <div className="relative flex w-full max-w-md flex-col items-center gap-5 rounded-xl border border-border bg-card px-8 py-12">
        <Brackets />
        <p className="label-mono tracking-[0.2em] text-synapse">{t("nf.label")}</p>
        <p className="cursor font-display text-7xl font-medium tracking-tight text-foreground">404</p>
        <p className="max-w-sm text-sm text-muted-foreground">{t("nf.body")}</p>
        <div className="flex gap-2">
          <Button asChild>
            <Link href="/explore">{t("common.exploreRegistry")}</Link>
          </Button>
          <Button asChild variant="mono">
            <Link href="/">{t("common.overview")}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
