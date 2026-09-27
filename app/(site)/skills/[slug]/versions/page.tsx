import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, GitCommitVertical } from "lucide-react";
import { skillRepository } from "@/cortex/repository";
import { auth } from "@/cortex/auth";
import { getRole } from "@/cortex/roles";
import { getI18n } from "@/cortex/locale";
import { diffLines, diffSummary } from "@/lib/diff";
import { manifestText } from "@/lib/skill-versions";
import { rich } from "@/lib/i18n/rich";
import { cn, timeAgo } from "@/lib/utils";
import { can } from "@/types/auth";
import { Panel } from "@/components/panel";
import { VersionDiff } from "@/components/version-diff";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ v?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const [skill, { t }] = await Promise.all([skillRepository.bySlug(slug), getI18n()]);
  return { title: skill ? t("versions.meta", { name: skill.name }) : t("meta.skill.fallback") };
}

/** Version history of one entry: the list on the left, the selected version diffed against the one before it. */
export default async function SkillVersionsPage({ params, searchParams }: Props) {
  const [{ slug }, { v }] = await Promise.all([params, searchParams]);
  const skill = (await skillRepository.bySlug(slug)) ?? (await skillRepository.byId(slug));
  if (!skill) notFound();
  const [i18n, session] = await Promise.all([getI18n(), auth()]);
  const { t, n } = i18n;
  if (skill.securityLevel === "Quarantine") {
    const role = session?.user?.id ? await getRole(session.user.id) : null;
    if (!(role && can(role, "catalog.moderate"))) notFound();
  }

  const versions = await skillRepository.versions(skill.id);
  const index = Math.max(0, versions.findIndex((x) => x.version === v));
  const selected = versions[index];
  const previous = versions[index + 1] ?? null;
  const diff = selected ? diffLines(previous ? manifestText(previous.manifest) : "", manifestText(selected.manifest)) : [];
  const summary = diffSummary(diff);
  const href = (label: string) => `/skills/${skill.slug}/versions?v=${encodeURIComponent(label)}`;

  return (
    <div className="container space-y-6 py-8">
      <div className="space-y-3">
        <Link href={`/skills/${skill.slug}`} className="label-mono inline-flex items-center gap-1.5 hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> {t("versions.back", { name: skill.name })}
        </Link>
        <h1 className="font-display text-3xl font-medium tracking-tight">{t("versions.title")}</h1>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{rich(t("versions.lead"))}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        <Panel title={t("versions.list")} meta={String(versions.length)} icon={<GitCommitVertical className="h-4 w-4 shrink-0 text-synapse" />} corners className="lg:col-span-4 lg:self-start">
          <ol className="divide-y divide-border">
            {versions.map((entry, i) => (
              <li key={entry.version}>
                <Link
                  href={href(entry.version)}
                  aria-current={i === index ? "page" : undefined}
                  className={cn("flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-accent/40", i === index && "bg-synapse/10")}
                >
                  <span className="min-w-0">
                    <code className={cn("block truncate font-mono text-sm", i === index ? "text-synapse" : "text-foreground")}>v{entry.version}</code>
                    <span className="label-mono-sm normal-case tracking-normal">{timeAgo(entry.createdAt, i18n)}</span>
                  </span>
                  {i === 0 && <span className="label-mono-sm text-synapse">{t("versions.current")}</span>}
                </Link>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel
          title={selected ? (previous ? `v${previous.version} → v${selected.version}` : `v${selected.version}`) : t("versions.title")}
          meta={previous ? t("versions.summary", { added: summary.added, removed: summary.removed }) : t("versions.first")}
          icon={<span className="dot-live shrink-0" />}
          corners
          className="lg:col-span-8"
          footer={versions.length === 1 ? <span className="normal-case tracking-normal">{t("versions.single")}</span> : undefined}
        >
          {previous && !summary.added && !summary.removed ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">{t("versions.same")}</p>
          ) : (
            <VersionDiff lines={diff} foldLabel={(count) => n("versions.unchanged", count)} />
          )}
        </Panel>
      </div>
    </div>
  );
}
