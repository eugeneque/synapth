import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, PlusCircle, Search } from "lucide-react";
import { listSkillsets } from "@/cortex/skillsets";
import { getI18n } from "@/cortex/locale";
import { auth } from "@/cortex/auth";
import { SkillsetCard } from "@/components/skillset-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SkillsetSort } from "@/types/skillset";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("skillsets.meta"), description: t("skillsets.lead") };
}
export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const SORTS: SkillsetSort[] = ["recent", "popular", "updated"];

/** Catalogue of skillsets: hand-made bundles, filterable by verification and sortable. */
export default async function SkillsetsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const q = (pick(sp.q) ?? "").slice(0, 200);
  const verifiedOnly = pick(sp.verified) === "1";
  const rawSort = pick(sp.sort) as SkillsetSort | undefined;
  const sort: SkillsetSort = rawSort && SORTS.includes(rawSort) ? rawSort : "recent";
  const [sets, { t }, session] = await Promise.all([listSkillsets({ q, verified: verifiedOnly || undefined, sort, limit: 120 }), getI18n(), auth()]);

  const href = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const next = { q: q || null, verified: verifiedOnly ? "1" : null, sort: sort === "recent" ? null : sort, ...patch };
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/skillsets?${s}` : "/skillsets";
  };

  return (
    <>
      <div className="border-b border-border bg-surface-lowest/70">
        <div className="container flex flex-col justify-between gap-4 py-8 md:flex-row md:items-end md:py-12">
          <div className="flex flex-col gap-2">
            <span className="label-mono text-synapse">{t("skillsets.index", { n: sets.length })}</span>
            <h1 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">{t("skillsets.title")}</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">{t("skillsets.lead")}</p>
          </div>
          <Button asChild className="self-start font-mono text-[11px] uppercase tracking-[0.14em] md:self-auto">
            <Link href={session?.user ? "/skillsets/new" : "/signin?callbackUrl=/skillsets/new"}>
              <PlusCircle /> {t("skillsets.create")}
            </Link>
          </Button>
        </div>
      </div>

      <section className="container space-y-6 py-8">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <form action="/skillsets" className="flex h-10 w-full max-w-md items-center gap-2 rounded-lg border border-border bg-muted px-3 focus-within:border-synapse/60">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input name="q" defaultValue={q} placeholder={t("skillsets.search")} aria-label={t("skillsets.search")} className="h-full w-full bg-transparent font-mono text-sm outline-none placeholder:text-muted-foreground/70" />
            {verifiedOnly && <input type="hidden" name="verified" value="1" />}
            {sort !== "recent" && <input type="hidden" name="sort" value={sort} />}
          </form>
          <div className="flex flex-wrap items-center gap-1.5">
            <Link href={href({ verified: verifiedOnly ? null : "1" })} aria-pressed={verifiedOnly} className={cn("inline-flex h-8 items-center gap-1.5 rounded-md border px-3 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors", verifiedOnly ? "border-synapse/40 bg-synapse/10 text-synapse" : "border-border text-muted-foreground hover:text-foreground")}>
              <BadgeCheck className="h-3.5 w-3.5" /> {t("skillsets.verifiedOnly")}
            </Link>
            <span className="mx-1 h-5 w-px bg-border" />
            {SORTS.map((s) => (
              <Link key={s} href={href({ sort: s === "recent" ? null : s })} aria-current={sort === s ? "true" : undefined} className={cn("inline-flex h-8 items-center rounded-md border px-3 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors", sort === s ? "border-foreground/30 bg-surface-high/60 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                {t(`skillsets.sort.${s}`)}
              </Link>
            ))}
          </div>
        </div>

        {sets.length ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {sets.map((set) => (
              <SkillsetCard key={set.id} set={set} />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <p className="text-sm text-muted-foreground">{q || verifiedOnly ? t("skillsets.noMatch") : t("skillsets.none")}</p>
            <Button asChild variant="mono" className="mt-4">
              <Link href={session?.user ? "/skillsets/new" : "/signin?callbackUrl=/skillsets/new"}>
                <PlusCircle className="text-synapse" /> {t("skillsets.createFirst")}
              </Link>
            </Button>
          </div>
        )}
      </section>
    </>
  );
}
