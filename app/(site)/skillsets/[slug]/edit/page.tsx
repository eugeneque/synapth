import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/cortex/auth";
import { getI18n } from "@/cortex/locale";
import { getSkillset } from "@/cortex/skillsets";
import { SkillsetEditor } from "@/components/skillset-editor";
import type { SkillsetSkillRef } from "@/types/skillset";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("skillset.editor.editTitle") };
}
export const dynamic = "force-dynamic";

/** Author-only editor; everyone else gets the 404 the page would give for a missing set. */
export default async function EditSkillsetPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/signin?callbackUrl=${encodeURIComponent(`/skillsets/${slug}/edit`)}`);
  const set = await getSkillset(slug);
  if (!set || set.author.id !== session.user.id) notFound();
  const { t } = await getI18n();
  const items = set.items.map((i) => i.skill).filter((s): s is SkillsetSkillRef => Boolean(s));

  return (
    <div className="container space-y-6 py-8">
      <header className="space-y-2 border-b border-border pb-6">
        <p className="label-mono flex flex-wrap items-center gap-2">
          <span className="text-synapse">/</span>
          <Link href="/skillsets" className="hover:text-foreground">
            {t("skillsets.crumb")}
          </Link>
          <span className="text-border">/</span>
          <Link href={`/skillsets/${set.slug}`} className="hover:text-foreground">
            {set.slug}
          </Link>
          <span className="text-border">/</span>
          <span className="text-synapse">{t("skillset.editor.editCrumb")}</span>
        </p>
        <h1 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">{t("skillset.editor.editTitle")}</h1>
      </header>
      <SkillsetEditor initial={{ id: set.id, slug: set.slug, name: set.name, summary: set.summary, description: set.description, avatar: set.avatar, items }} canDelete />
    </div>
  );
}
