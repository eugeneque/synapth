import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/cortex/auth";
import { getI18n } from "@/cortex/locale";
import { skillRepository } from "@/cortex/repository";
import { SkillsetEditor } from "@/components/skillset-editor";
import type { SkillsetSkillRef } from "@/types/skillset";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("skillset.editor.newTitle") };
}
export const dynamic = "force-dynamic";

/** `/skillsets/new?skill=<slug>` pre-fills the composition from a skill page's "Add to skillset". */
export default async function NewSkillsetPage({ searchParams }: { searchParams: Promise<{ skill?: string }> }) {
  const session = await auth();
  const { skill: seed } = await searchParams;
  if (!session?.user) redirect(`/signin?callbackUrl=${encodeURIComponent(`/skillsets/new${seed ? `?skill=${seed}` : ""}`)}`);
  const { t } = await getI18n();
  const first = seed ? ((await skillRepository.bySlug(seed)) ?? (await skillRepository.byId(seed))) : null;
  const items: SkillsetSkillRef[] = first ? [{ id: first.id, slug: first.slug, name: first.name, description: first.description, category: first.category, securityLevel: first.securityLevel, version: first.version, authorName: first.authorName }] : [];

  return (
    <div className="container space-y-6 py-8">
      <header className="space-y-2 border-b border-border pb-6">
        <p className="label-mono flex items-center gap-2">
          <span className="text-synapse">/</span>
          <Link href="/search?tab=skillsets" className="hover:text-foreground">
            {t("skillsets.crumb")}
          </Link>
          <span className="text-border">/</span>
          <span className="text-synapse">{t("skillset.editor.newCrumb")}</span>
        </p>
        <h1 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">{t("skillset.editor.newTitle")}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{t("skillset.editor.newLead")}</p>
      </header>
      <SkillsetEditor initial={null} seed={items} />
    </div>
  );
}
