import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Bolt, Calendar, Code2, Download, Github, Layers, Search, ShieldCheck, Star } from "lucide-react";
import { skillRepository } from "@/cortex/repository";
import { SkillCard } from "@/components/skill-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCompact, timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ owner: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { owner } = await params;
  return { title: `${decodeURIComponent(owner)} — skills` };
}

/** Author / GitHub-owner page: every skill Cortex knows from this publisher. */
export default async function AuthorPage({ params }: Params) {
  const owner = decodeURIComponent((await params).owner).toLowerCase();
  const skills = (await skillRepository.all()).filter((s) => s.source?.owner.toLowerCase() === owner || s.authorName.toLowerCase() === owner);
  if (!skills.length) notFound();

  const name = skills[0].source?.owner ?? skills[0].authorName;
  const avatar = skills.find((s) => s.source?.avatarUrl)?.source?.avatarUrl ?? null;
  const repos = [...new Set(skills.map((s) => s.source?.fullName).filter(Boolean))] as string[];
  const stars = Math.max(...skills.map((s) => s.githubStars));
  const installs = skills.reduce((n, s) => n + s.downloadsCount, 0);
  const verified = skills.filter((s) => s.securityLevel === "Verified").length;
  const executions = skills.reduce((n, s) => n + s.stats.executions, 0);
  const byCategory = skills.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.category]: (acc[s.category] ?? 0) + 1 }), {});
  const languages = [...new Set(skills.map((s) => s.source?.language).filter(Boolean))] as string[];
  const firstSeen = skills.map((s) => s.createdAt).sort()[0];
  const onGithub = repos.length > 0;
  const sorted = [...skills].sort((a, b) => b.githubStars - a.githubStars || a.name.localeCompare(b.name));

  return (
    <div className="container space-y-6 py-8">
      <p className="label-mono flex flex-wrap items-center gap-2">
        <span className="text-synapse">/</span>
        <Link href="/explore" className="hover:text-foreground">Catalogue</Link>
        <span className="text-border">/</span>
        <span>Publishers</span>
        <span className="text-border">/</span>
        <span className="font-medium text-synapse">{name}</span>
      </p>

      {/* Cover canvas + identity. */}
      <section className="relative overflow-hidden border border-border bg-card">
        <div className="relative h-44 w-full overflow-hidden bg-gradient-to-r from-surface-lowest via-surface-low to-surface-lowest sm:h-52">
          <div className="dot-matrix absolute inset-0 opacity-60" />
          <div className="absolute inset-0 bg-gradient-to-t from-card via-transparent to-transparent" />
          <div className="label-mono-sm absolute left-6 top-4 flex items-center gap-3 tracking-[0.2em]">
            <span>Publisher_ref: {name}</span>
            <span className="h-1 w-1 rounded-full bg-synapse" />
            <span className="text-synapse">Canvas_ready</span>
          </div>
          <div className="absolute right-4 top-4">
            <Badge variant="chip" className="h-7 gap-2 px-3 backdrop-blur">
              <Layers className="h-3.5 w-3.5 text-synapse" /> {repos.length} repositor{repos.length === 1 ? "y" : "ies"} indexed
            </Badge>
          </div>
        </div>

        <div className="relative z-10 -mt-14 px-6 pb-6 sm:-mt-16">
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-end">
              <div className="relative h-24 w-24 shrink-0 border-2 border-foreground/20 bg-surface-lowest p-1 sm:h-28 sm:w-28">
                {avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatar} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="font-display flex h-full w-full items-center justify-center bg-muted text-3xl font-medium">{name[0]?.toUpperCase()}</div>
                )}
                <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-surface-lowest">
                  <span className="h-2.5 w-2.5 rounded-full bg-synapse animate-pulse-dot" />
                </span>
              </div>
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">{name}</h1>
                  <span className="font-mono text-sm text-synapse">@{name.toLowerCase().replace(/\s+/g, "-")}</span>
                  {verified > 0 && (
                    <Badge variant="synapse">
                      <ShieldCheck className="h-3 w-3" /> Verified creator
                    </Badge>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {Object.entries(byCategory).map(([c, n]) => (
                    <Badge key={c} variant="chip">
                      {n} {c}
                    </Badge>
                  ))}
                  {languages.slice(0, 3).map((l) => (
                    <Badge key={l} variant="chip" className="text-moss">
                      {l}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              {onGithub && (
                <Button asChild variant="mono">
                  <a href={`https://github.com/${name}`} target="_blank" rel="noreferrer">
                    <Github className="text-synapse" /> GitHub profile
                  </a>
                </Button>
              )}
              <Button asChild className="font-mono text-[11px] uppercase tracking-[0.14em]">
                <Link href={`/explore?author=${encodeURIComponent(name)}`}>
                  <Search /> Search this publisher
                </Link>
              </Button>
            </div>
          </div>

          <div className="mt-6 grid gap-4 border-t border-border pt-6 lg:grid-cols-12">
            <p className="text-base leading-relaxed text-foreground/90 lg:col-span-8">
              {skills.length} skill{skills.length === 1 ? "" : "s"} indexed from {onGithub ? `${repos.length} GitHub repositor${repos.length === 1 ? "y" : "ies"}` : "manual publishing"}: {Object.entries(byCategory).map(([c, n]) => `${n} ${c}`).join(", ")}.
              {verified > 0 && ` ${verified} reviewed and verified by the Synapth sandbox scanner.`}
            </p>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-xs text-muted-foreground lg:col-span-4 lg:justify-end">
              {onGithub && (
                <a href={`https://github.com/${name}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-foreground">
                  <Code2 className="h-4 w-4" /> github/{name}
                </a>
              )}
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="h-4 w-4" /> First seen {timeAgo(firstSeen)}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Stat tiles. */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Published skills" icon={<Layers className="h-4 w-4 text-synapse" />} value={String(skills.length)} unit={`${verified} verified`} hint={`${skills.length - verified} community / sandbox`} />
        <Tile label="Installs" icon={<Download className="h-4 w-4 text-moss" />} value={formatCompact(installs)} unit="via Synapth" hint={`${formatCompact(executions)} gateway executions`} />
        <Tile label="Top repository stars" icon={<Star className="h-4 w-4 text-synapse" />} value={formatCompact(stars)} unit="GitHub" hint={repos[0] ?? "manual publisher"} accent />
        <Tile label="Verification rate" icon={<ShieldCheck className="h-4 w-4 text-synapse" />} value={`${Math.round((verified / skills.length) * 100)}%`} unit="reviewed" hint="scanner never grants Verified" />
      </section>

      {/* Tabs row + grid. */}
      <div className="flex items-center justify-between gap-4 overflow-x-auto border-b border-border">
        <nav className="flex shrink-0 items-center gap-6">
          <span className="tab-line" data-active="true">
            <Layers className="h-4 w-4" /> Published skills ({skills.length})
          </span>
          {repos.length > 1 && (
            <span className="tab-line">
              <Code2 className="h-4 w-4" /> Repositories ({repos.length})
            </span>
          )}
        </nav>
        <span className="label-mono-sm hidden shrink-0 items-center gap-2 pb-3 sm:flex">
          Sort: <span className="rounded-md border border-border bg-surface px-2 py-0.5 text-foreground">stars ↓</span>
        </span>
      </div>

      {repos.length > 1 && (
        <nav className="flex flex-wrap gap-2">
          {repos.map((r) => (
            <Link key={r} href={`/explore?author=${encodeURIComponent(name)}&q=${encodeURIComponent(r.split("/")[1])}`} className="label-mono-sm inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 normal-case tracking-normal text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground">
              <Bolt className="h-3 w-3 text-synapse" /> {r}
            </Link>
          ))}
        </nav>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {sorted.map((s) => (
          <SkillCard key={s.id} skill={s} />
        ))}
      </div>
    </div>
  );
}

function Tile({ label, icon, value, unit, hint, accent }: { label: string; icon: React.ReactNode; value: string; unit?: string; hint?: string; accent?: boolean }) {
  return (
    <div className="group relative border border-border bg-card p-4 transition-colors hover:border-foreground/25">
      <div className="mb-1 flex items-center justify-between">
        <span className="label-mono">{label}</span>
        {icon}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={`stat-value ${accent ? "text-synapse" : ""}`}>{value}</span>
        {unit && <span className="label-mono-sm text-synapse">{unit}</span>}
      </div>
      {hint && <span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}
