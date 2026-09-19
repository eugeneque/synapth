import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Code2, Eye, ExternalLink, KeyRound, LockKeyhole, ShieldQuestion, Terminal, Wallet } from "lucide-react";
import { skillRepository, hydratePrompt } from "@/cortex/repository";
import { scanManifest } from "@/lib/sandbox-scanner";
import { formatCompact, formatUsd, timeAgo } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SecurityBadge } from "@/components/security-badge";
import { InstallButton } from "@/components/install-button";
import { InstallPanel } from "@/components/install-panel";
import { PromptVisualizer } from "@/components/prompt-visualizer";
import { ScanReportView } from "@/components/scan-report";
import { ToolSpec } from "@/components/tool-spec";
import { Markdown } from "@/components/markdown";
import { RepoCard } from "@/components/repo-card";
import { SkillCard } from "@/components/skill-card";
import { Panel } from "@/components/panel";
import { Corners } from "@/components/corners";
import { CopyButton } from "@/components/copy-button";

export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const skill = await skillRepository.bySlug(slug);
  return { title: skill?.name ?? "Skill", description: skill?.description };
}

export default async function SkillPage({ params }: Params) {
  const { slug } = await params;
  const skill = (await skillRepository.bySlug(slug)) ?? (await skillRepository.byId(slug));
  if (!skill) notFound();

  const scan = scanManifest(skill.manifest, { reviewed: skill.securityLevel === "Verified" });
  const ep = skill.manifest.entrypoint;
  const readme = await skillRepository.readme(skill.id);
  const full = await hydratePrompt(skill);
  const siblings = skill.source
    ? (await skillRepository.all()).filter((s) => s.id !== skill.id && s.source?.fullName === skill.source?.fullName).slice(0, 4)
    : [];
  const readmeBase = skill.source ? `https://github.com/${skill.source.fullName}/blob/${skill.source.defaultBranch}/${skill.source.manifestPath.split("/").slice(0, -1).join("/")}` : null;
  const owner = skill.source?.owner ?? skill.authorName;
  const microRate = Math.round(skill.pricePerCall * 1_000_000);
  const execCurl = `curl -X POST ${APP_URL}/api/v1/skills/${skill.id}/execute \\\n  -H 'Content-Type: application/json' -H 'X-Synapth-Key: syn_…' \\\n  -d '{"tool":"${skill.manifest.tools[0]?.name ?? "tool"}","input":{}}'`;

  return (
    <div className="container space-y-6 py-8">
      {/* Breadcrumb + context chips. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="label-mono flex flex-wrap items-center gap-2">
          <span className="text-synapse">/</span>
          <Link href="/explore" className="hover:text-foreground">Catalogue</Link>
          <span className="text-border">/</span>
          <Link href={`/explore?category=${skill.category}`} className="hover:text-foreground">{skill.category}</Link>
          <span className="text-border">/</span>
          <Link href={`/authors/${encodeURIComponent(owner)}`} className="hover:text-foreground">{owner}</Link>
          <span className="text-border">/</span>
          <span className="font-medium text-synapse">{skill.slug}</span>
        </p>
        <div className="flex items-center gap-2">
          <Badge variant="chip">Origin: {skill.origin}</Badge>
          <Badge variant="chip" className="text-synapse">Scanner: v{scan.scannerVersion}</Badge>
        </div>
      </div>

      {/* Hero card. */}
      <header className="group relative border border-border bg-card p-6">
        <Corners />
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <SecurityBadge level={skill.securityLevel} solid />
              <Badge variant="chip" className="text-moss">v{skill.version}</Badge>
              <Badge variant="chip">{skill.category}</Badge>
              {skill.source?.license && <Badge variant="chip">License: {skill.source.license}</Badge>}
              {skill.repoUrl && (
                <a href={skill.repoUrl} target="_blank" rel="noreferrer" className="label-mono-sm ml-1 inline-flex items-center gap-1 normal-case tracking-normal transition-colors hover:text-synapse">
                  <Code2 className="h-3.5 w-3.5" /> {skill.repoUrl.replace(/^https?:\/\//, "")}
                </a>
              )}
            </div>
            <h1 className="font-display mt-1 flex items-center gap-3 text-3xl font-medium tracking-tight sm:text-4xl">
              {skill.name}
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-synapse animate-pulse-dot" />
            </h1>
            <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">{skill.description}</p>
            <p className="label-mono-sm mt-1 normal-case tracking-normal">
              by{" "}
              <Link href={`/authors/${encodeURIComponent(owner)}`} className="text-foreground hover:text-synapse">
                {skill.authorName}
              </Link>{" "}
              · updated {timeAgo(skill.source?.pushedAt ?? skill.updatedAt)}
              {skill.origin === "github" && " · imported from GitHub"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 self-start lg:self-center">
            <InstallButton skill={full} size="lg" label="Install to agent" className="h-11 px-6 text-base font-semibold normal-case tracking-tight" />
            <Button asChild variant="mono" className="h-11">
              <a href="#gateway">
                <Terminal /> Gateway exec ({formatUsd(skill.pricePerCall)})
              </a>
            </Button>
            <Button asChild variant="mono" size="icon" className="h-11 w-11" aria-label="View prompt diff">
              <a href="#pipeline">
                <Eye />
              </a>
            </Button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 bg-surface-low/60 p-4 sm:grid-cols-4">
          <Stat label="Installs" value={formatCompact(skill.downloadsCount)} unit={`+${formatCompact(skill.stats.installVelocity7d)}/7d`} />
          <Stat label="Sandbox score" value={String(scan.score)} unit="/100" muted />
          <Stat label="Retention 14d" value={String(Math.round(skill.stats.retentionRate * 100))} unit="%" />
          <Stat label="Micro-rate" value={microRate ? microRate.toLocaleString("en") : "0"} unit={<span className="normal-case">µUSD</span>} muted />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Main column. */}
        <div className="flex flex-col gap-6 lg:col-span-8">
          <div id="pipeline" className="scroll-mt-20">
            <PromptVisualizer skill={full} />
          </div>

          <ToolSpec skill={skill} />

          {readme && (
            <Panel title={skill.source?.manifestFile === "SKILL.md" ? "SKILL.md" : "README"} icon={<Code2 className="h-4 w-4 shrink-0 text-moss" />} actions={readmeBase ? <a href={readmeBase} target="_blank" rel="noreferrer" className="label-mono-sm hover:text-foreground">View on GitHub ↗</a> : undefined} corners>
              <Markdown source={readme.slice(0, 60_000)} baseUrl={readmeBase} className="px-5 py-4 text-sm text-foreground/90" />
            </Panel>
          )}

          {siblings.length > 0 && (
            <section className="space-y-3">
              <h3 className="label-mono">
                <span className="mr-1.5 text-synapse/70">/</span>More from {skill.source?.fullName}
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                {siblings.map((s) => (
                  <SkillCard key={s.id} skill={s} />
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Side column. */}
        <aside className="flex flex-col gap-6 lg:col-span-4">
          <ScanReportView report={scan} />

          <Panel id="gateway" title="Pay-per-task telemetry" icon={<Wallet className="h-4 w-4 shrink-0 text-synapse" />} actions={<Badge variant="chip" className="text-moss">{skill.pricePerCall ? "Escrow active" : "Free tier"}</Badge>} corners className="scroll-mt-20">
            <div className="flex flex-col gap-4 p-4">
              <div className="flex flex-col gap-1">
                <span className="label-mono-sm">Cost per runtime invocation</span>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="stat-value">{skill.pricePerCall ? `$${skill.pricePerCall.toFixed(6)}` : "$0"}</span>
                  <span className="label-mono text-synapse">USD</span>
                  <span className="label-mono-sm">({microRate.toLocaleString("en")} µUSD)</span>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 bg-surface-low/60 p-3">
                <span className="label-mono-sm inline-flex items-center gap-1.5 text-foreground">
                  <LockKeyhole className="h-3.5 w-3.5 text-synapse" /> Escrow guarantee protocol
                </span>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  The fee is escrowed on the ledger when the call opens and settled when it returns. Timeouts and upstream errors refund automatically; the creator receives the settled amount minus the platform fee.
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-px bg-border">
                {[
                  { label: "Executions", value: formatCompact(skill.stats.executions) },
                  { label: "GitHub stars", value: formatCompact(skill.githubStars) },
                  { label: "Rating", value: skill.stats.rating ? `${skill.stats.rating.toFixed(1)} / 5` : "—" },
                  { label: "Velocity 7d", value: formatCompact(skill.stats.installVelocity7d) },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-card px-3 py-2">
                    <dt className="label-mono-sm">{label}</dt>
                    <dd className="mt-0.5 font-mono text-sm">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="well p-3">
                <div className="label-mono-sm mb-2 flex items-center justify-between">
                  <span>Gateway call</span>
                  <CopyButton text={execCurl} label="Copy" />
                </div>
                <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed text-muted-foreground">{execCurl}</pre>
              </div>
            </div>
          </Panel>

          <InstallPanel skill={full} />

          <Panel title="Entry point" icon={<Terminal className="h-4 w-4 shrink-0 text-synapse" />} corners bodyClassName="p-4 text-sm">
            <code className="well block break-all p-2 font-mono text-xs">
              {ep.type === "mcp-stdio" ? `${ep.command} ${(ep.args ?? []).join(" ")}` : ep.type === "prompt" ? "system prompt only" : ep.url}
            </code>
            <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
              <p className="flex items-center gap-1.5"><ShieldQuestion className="h-3.5 w-3.5" /> Permissions: {skill.manifest.permissions?.length ? skill.manifest.permissions.join(", ") : "none"}</p>
              {skill.manifest.requiredEnv?.length ? (
                <p className="flex items-center gap-1.5"><KeyRound className="h-3.5 w-3.5" /> Env: {skill.manifest.requiredEnv.join(", ")}</p>
              ) : null}
            </div>
            {skill.repoUrl && (
              <a href={skill.repoUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-synapse hover:underline">
                <ExternalLink className="h-3.5 w-3.5" /> Source repository
              </a>
            )}
          </Panel>

          {skill.source && <RepoCard source={skill.source} />}
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, unit, muted }: { label: string; value: string; unit?: React.ReactNode; muted?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="label-mono-sm">{label}</span>
      <span className="stat-value mt-0.5">
        {value}
        {unit && <span className={`label-mono ml-1 ${muted ? "text-muted-foreground" : "text-synapse"}`}>{unit}</span>}
      </span>
    </div>
  );
}
