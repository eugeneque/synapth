import Link from "next/link";
import { BadgeCheck, Boxes, PlusCircle, Search } from "lucide-react";
import { listSkillsets } from "@/cortex/skillsets";
import { getI18n } from "@/cortex/locale";
import { SkillsetCard } from "@/components/skillset-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SkillsetSort } from "@/types/skillset";

export const SKILLSET_SORTS: SkillsetSort[] = ["recent", "popular", "updated"];

/** The "Skillsets" tab of the catalogue: search, verified toggle, sort — all plain links / a GET form. */
export async function SkillsetBrowser({ q, verifiedOnly, sort, createHref }: { q: string; verifiedOnly: boolean; sort: SkillsetSort; createHref: string }) {
  const [sets, { t }] = await Promise.all([listSkillsets({ q, verified: verifiedOnly || undefined, sort, limit: 120 }), getI18n()]);

  const href = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams({ tab: "skillsets" });
    const next = { q: q || null, verified: verifiedOnly ? "1" : null, sort: sort === "recent" ? null : sort, ...patch };
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    return `/explore?${p.toString()}`;
  };
  const pill = (active: boolean) => cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium transition-colors", active ? "border-foreground/25 bg-surface-high/60 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground");

  return (
    <div className="space-y-6">
      <form action="/explore" className="group flex h-14 w-full items-center gap-3 rounded-2xl border border-border bg-card px-5 transition-colors focus-within:border-synapse/60">
        <input type="hidden" name="tab" value="skillsets" />
        <Search className="h-5 w-5 shrink-0 text-muted-foreground group-focus-within:text-synapse" />
        <input name="q" defaultValue={q} placeholder={t("skillsets.search")} aria-label={t("skillsets.search")} className="h-full w-full bg-transparent text-base outline-none placeholder:text-muted-foreground/70" />
        {verifiedOnly && <input type="hidden" name="verified" value="1" />}
        {sort !== "recent" && <input type="hidden" name="sort" value={sort} />}
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1">
          {SKILLSET_SORTS.map((s) => (
            <Link key={s} href={href({ sort: s === "recent" ? null : s })} aria-current={sort === s ? "true" : undefined} className={pill(sort === s)}>
              {t(`skillsets.sort.${s}`)}
            </Link>
          ))}
        </div>
        <Link href={href({ verified: verifiedOnly ? null : "1" })} aria-pressed={verifiedOnly} className={cn(pill(verifiedOnly), verifiedOnly && "border-synapse/40 bg-synapse/10 text-synapse")}>
          <BadgeCheck className="h-3.5 w-3.5" /> {t("skillsets.verifiedOnly")}
        </Link>
      </div>

      {sets.length ? (
        <div className="stagger grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {sets.map((set) => (
            <SkillsetCard key={set.id} set={set} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-16 text-center">
          <Boxes className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{q || verifiedOnly ? t("skillsets.noMatch") : t("skillsets.none")}</p>
          <Button asChild variant="outline" size="sm" className="rounded-full">
            <Link href={createHref}>
              <PlusCircle className="text-synapse" /> {t("skillsets.createFirst")}
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
