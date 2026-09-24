import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Eye, Heart, PlusCircle } from "lucide-react";
import { auth } from "@/cortex/auth";
import { getI18n } from "@/cortex/locale";
import { listFavoriteSkillsets, listSkillsets } from "@/cortex/skillsets";
import { listWatched } from "@/cortex/social";
import { skillRepository } from "@/cortex/repository";
import { SkillCard } from "@/components/skill-card";
import { SkillsetCard } from "@/components/skillset-card";
import { Button } from "@/components/ui/button";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("favorites.meta") };
}
export const dynamic = "force-dynamic";

/** Everything the viewer keeps (header heart): their own skillsets, favorited skillsets and watched entries. */
export default async function FavoritesPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/favorites");
  const [{ t, n }, mine, favorites, watches, all] = await Promise.all([getI18n(), listSkillsets({ authorId: session.user.id, sort: "updated", limit: 200 }), listFavoriteSkillsets(session.user.id), listWatched(session.user.id), skillRepository.all()]);
  const byId = new Map(all.map((s) => [s.id, s]));
  const watched = watches.flatMap((w) => byId.get(w.skillId) ?? []);

  return (
    <div className="container space-y-10 py-8 md:py-12">
      <header className="flex flex-col justify-between gap-4 border-b border-border pb-6 md:flex-row md:items-end">
        <div className="space-y-2">
          <p className="label-mono-sm flex items-center gap-2 tracking-[0.2em]">
            <span className="text-synapse">{t("header.favorites")}</span>
            <span className="text-border">/</span>
            <span>{n("skillset.entries", mine.length)}</span>
          </p>
          <h1 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">{t("favorites.title")}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">{t("favorites.lead")}</p>
        </div>
        <Button asChild className="self-start font-mono text-[11px] uppercase tracking-[0.14em] md:self-auto">
          <Link href="/skillsets/new">
            <PlusCircle /> {t("skillsets.create")}
          </Link>
        </Button>
      </header>

      <section className="space-y-3">
        <h2 className="label-mono">
          <span className="mr-1.5 text-synapse/70">/</span>
          {t("console.skillsets.mine")}
        </h2>
        {mine.length ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {mine.map((set) => (
              <SkillsetCard key={set.id} set={set} />
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">{t("console.skillsets.mineEmpty")}</p>
        )}
      </section>

      <section id="favorites" className="scroll-mt-24 space-y-3">
        <h2 className="label-mono flex items-center gap-1.5">
          <Heart className="h-3.5 w-3.5 text-synapse" />
          {t("console.skillsets.favorites")}
        </h2>
        {favorites.length ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {favorites.map((set) => (
              <SkillsetCard key={set.id} set={set} />
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
            {t("console.skillsets.favoritesEmpty")}{" "}
            <Link href="/search?tab=skillsets" className="text-synapse hover:underline">
              {t("console.skillsets.browse")}
            </Link>
          </p>
        )}
      </section>

      <section id="watching" className="scroll-mt-24 space-y-3">
        <h2 className="label-mono flex items-center gap-1.5">
          <Eye className="h-3.5 w-3.5 text-synapse" />
          {t("favorites.watched")}
        </h2>
        {watched.length ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {watched.map((skill) => (
              <SkillCard key={skill.id} skill={skill} />
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">{t("favorites.watchedEmpty")}</p>
        )}
      </section>
    </div>
  );
}
