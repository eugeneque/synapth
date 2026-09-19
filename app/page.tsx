import Link from "next/link";
import { ArrowRight, Bolt, Database, Lock, Radar, ShieldCheck, Terminal, Wallet } from "lucide-react";
import { AsciiHands } from "@/components/ascii-hands";
import { SkillCard } from "@/components/skill-card";
import { StatTile } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CommandChip } from "@/components/copy-button";
import { TerminalCard } from "@/components/terminal-card";
import { skillRepository } from "@/cortex/repository";
import { INSTALL_TARGETS } from "@/axon/install";
import { formatCompact } from "@/lib/utils";
import pkg from "@/package.json";

export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export default async function HomePage() {
  const [all, trending] = await Promise.all([skillRepository.all(), skillRepository.search("", { sort: "trending", limit: 6 })]);

  const installs = all.reduce((n, s) => n + s.downloadsCount, 0);
  const verified = all.filter((s) => s.securityLevel === "Verified").length;
  const sandboxed = all.filter((s) => s.securityLevel === "Sandbox").length;
  const languages = new Set(all.map((s) => s.source?.language).filter(Boolean)).size;
  const authors = new Set(all.map((s) => s.source?.owner ?? s.authorName)).size;
  const paid = all.filter((s) => s.pricePerCall > 0);
  const avgPrice = paid.length ? paid.reduce((n, s) => n + s.pricePerCall, 0) / paid.length : 0;
  const weekAgo = Date.now() - 7 * 86_400_000;
  const freshCount = all.filter((s) => new Date(s.createdAt).getTime() > weekAgo).length;
  // A freshly crawled catalogue is "all new"; only show the delta once it is a real weekly increment.
  const fresh = freshCount < all.length / 2 ? freshCount : 0;
  const byCategory = { MCP: 0, Prompt: 0, Tool: 0 } as Record<string, number>;
  for (const s of all) byCategory[s.category] = (byCategory[s.category] ?? 0) + 1;

  return (
    <>
      {/* Hero — the dot-matrix hands are the background; content floats on top. */}
      <section className="relative overflow-hidden border-b border-border">
        <AsciiHands className="absolute inset-0 h-full w-full" />

        <div className="container relative flex min-h-[780px] flex-col items-center justify-start pt-12 text-center md:min-h-[840px] md:pt-24">
          <div className="pointer-events-none absolute inset-x-6 top-5 hidden items-center justify-between md:flex">
            <span className="pill pointer-events-auto">
              <span className="dot-live" /> Substrate bridge // interface engaged
            </span>
            <span className="pill pointer-events-auto text-synapse">
              <Bolt className="h-3 w-3" /> {formatCompact(all.length)} skills indexed
            </span>
          </div>

          <div className="pill mb-6 h-8 gap-3 px-4">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-synapse opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-synapse" />
            </span>
            <span>Protocol status: catalogue online (v{pkg.version})</span>
            <span className="hidden text-border sm:inline">|</span>
            <span className="hidden text-synapse sm:inline">Scanner: v1</span>
          </div>

          <h1 className="font-display max-w-4xl text-balance text-[2.75rem] font-medium leading-[0.98] tracking-[-0.03em] sm:text-6xl md:text-7xl">
            <span className="text-muted-foreground">New connections</span>
            <br />
            for your agents.
          </h1>
          <p className="mt-6 max-w-2xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
            Skills, tools and MCP servers — indexed from GitHub, sandbox-scanned and installable in one click into Cursor, Claude Desktop, Claude Code or any agent over HTTP.
          </p>
          <div className="mt-8 flex w-full flex-wrap items-center justify-center gap-3">
            <Button asChild size="hero">
              <Link href="/explore">
                Explore registry <ArrowRight />
              </Link>
            </Button>
            <CommandChip command={`curl -H 'X-Agent-Request: true' ${APP_URL}/api/v1/skills?q=postgres`} />
          </div>

          <div className="pointer-events-none absolute inset-x-6 bottom-5 hidden items-center justify-between md:flex">
            <span className="label-mono-sm tracking-[0.2em]">[ reticle_axis: cursor // synapse ]</span>
            <span className="label-mono-sm tracking-[0.2em]">move the cursor between the hands</span>
          </div>
        </div>
      </section>

      {/* Telemetry strip. */}
      <section className="border-b border-border bg-surface-lowest/80 backdrop-blur-sm">
        <div className="container grid grid-cols-2 divide-y divide-border sm:divide-y-0 md:grid-cols-4 md:divide-x">
          <StatTile label="Indexed skills" value={formatCompact(all.length)} unit={fresh ? `+${fresh} this week` : undefined} hint={`${authors} publishers · ${languages} languages`} />
          <StatTile label="Verified" value={String(verified)} unit="reviewed" hint={`${sandboxed} sandboxed`} />
          <StatTile label="Installs" value={formatCompact(installs)} hint="via generated client config" />
          <StatTile label="Install targets" value={String(INSTALL_TARGETS.length)} hint={INSTALL_TARGETS.map((t) => t.label).join(" · ")} />
        </div>
      </section>

      {/* Mechanics — how a skill travels from a repository into an agent. */}
      <section className="container py-20">
        <div className="mb-12 flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <p className="label-mono mb-2 flex items-center gap-2 text-synapse">
              <span className="inline-block h-2 w-2 bg-synapse" /> Metaphor & mechanics
            </p>
            <h2 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">The microsecond spark.</h2>
          </div>
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            A synapse carries a signal across a gap it never lets the two cells cross. Synapth does the same for agents: a repository never touches your runtime until it has been parsed, scanned and re-emitted as
            a config your client understands.
          </p>
        </div>

        <div className="border border-border bg-card p-6 md:p-8">
          <div className="mb-8 flex items-center justify-between border-b border-border pb-4">
            <span className="label-mono-sm">Schematic: cortex_pipeline_v1</span>
            <span className="label-mono-sm flex items-center gap-2">
              <span className="dot-live" /> Live on every crawl
            </span>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            <Step tag="Pre-synaptic terminal" icon={<Radar className="h-5 w-5" />} title="1. Crawl & parse" code="> crawl(topic: 'mcp-server')">
              GitHub repositories with <code className="font-mono text-foreground">synapth.json</code>, <code className="font-mono text-foreground">mcp-server.json</code> or a <code className="font-mono text-foreground">SKILL.md</code> are discovered by topic and filename, then normalised into one manifest.
            </Step>
            <Step tag="Synaptic cleft" icon={<ShieldCheck className="h-5 w-5" />} title="2. Sandbox scan" code="[scan] prompt-injection · shell · secrets" highlight>
              Every surface — prompt, tool schemas, README, entrypoint — runs through the static scanner. Risky patterns mean <em>Sandbox</em>; a clean pass means <em>Community</em>. <em>Verified</em> only comes from a human review.
            </Step>
            <Step tag="Post-synaptic receptor" icon={<Terminal className="h-5 w-5" />} title="3. Emit client config" code="mcpServers.<slug> = { command, args } ✓">
              The manifest becomes the exact JSON for Cursor or Claude Desktop, a <code className="font-mono text-foreground">claude mcp add</code> one-liner, or a minified context blob for agents calling the API.
            </Step>
          </div>
        </div>
      </section>

      {/* Trending row. */}
      <section className="border-y border-border bg-surface-lowest/60 py-16">
        <div className="container">
          <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="label-mono mb-2 text-synapse">Active matches</p>
              <h2 className="text-2xl font-semibold tracking-tight">Trending in the registry</h2>
            </div>
            <Link href="/explore" className="label-mono inline-flex items-center gap-1.5 text-foreground hover:text-synapse">
              Browse all {formatCompact(all.length)} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {trending.hits.map((h) => (
              <SkillCard key={h.skill.id} skill={h.skill} />
            ))}
          </div>
        </div>
      </section>

      {/* Pillars. */}
      <section className="container py-20">
        <div className="mb-12 max-w-2xl">
          <p className="label-mono mb-2 text-synapse">Foundational guarantees</p>
          <h2 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">Three pillars of the registry.</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Built for agent stacks where a stray prompt injection or an unmetered tool loop is not an acceptable failure mode.</p>
        </div>

        <div className="grid gap-6 md:grid-cols-12">
          <Pillar span="md:col-span-7" tag="Pillar I // Registry" icon={<Database className="h-5 w-5" />} title="Sovereign catalogue" foot={<><span>Cortex index v1</span><Link href="/explore" className="label-mono-sm text-synapse hover:underline">Browse packages →</Link></>}>
            <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
              One index for MCP servers, prompts and HTTP tools. Full-text search with operators (<code className="font-mono text-foreground">category:MCP lang:python stars:&gt;100</code>), facets over language, author and tags, and a ranking that mixes install velocity, stars and retention.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Mini label="MCP servers" value={String(byCategory.MCP)} />
              <Mini label="Prompts" value={String(byCategory.Prompt)} />
              <Mini label="Tools" value={String(byCategory.Tool)} />
            </div>
          </Pillar>

          <Pillar span="md:col-span-5" tag="Pillar II // Security" icon={<Lock className="h-5 w-5" />} title="Sandbox scanner" foot={<><span>Static analysis</span><span className="text-synapse">Verified = human review</span></>}>
            <p className="mb-4 text-sm leading-relaxed text-muted-foreground">Every manifest is scanned before it can be installed. The scanner never grants Verified on its own.</p>
            <dl className="well space-y-1.5 p-4 font-mono text-xs">
              <Row k="Rules" v="prompt-injection · shell · secrets" />
              <Row k="Surfaces" v="prompt · tools · readme · entrypoint" />
              <Row k="Sandbox" v={`${sandboxed} flagged`} accent />
              <Row k="Verified" v={`${verified} reviewed`} accent />
            </dl>
          </Pillar>

          <Pillar
            span="md:col-span-12"
            tag="Pillar III // Commerce"
            icon={<Wallet className="h-5 w-5" />}
            title="Micro-metering & escrow"
            aside={
              <div className="flex shrink-0 flex-wrap gap-4">
                <Mini label="Average price" value={avgPrice ? `$${avgPrice.toFixed(4)}` : "Free"} hint="per invocation" accent big />
                <Mini label="Free skills" value={`${Math.round(((all.length - paid.length) / Math.max(all.length, 1)) * 100)}%`} hint="of the catalogue" big />
              </div>
            }
          >
            <p className="text-sm leading-relaxed text-muted-foreground">
              Paid tools run through the gateway on a micro-dollar ledger: the call is escrowed when it starts and settled — or refunded on timeout — when it ends. Publishers earn per execution; agents authenticate with a single <code className="font-mono text-foreground">X-Synapth-Key</code>.
            </p>
          </Pillar>
        </div>
      </section>

      {/* CTA. */}
      <section className="border-t border-border bg-surface-lowest/60 py-20">
        <div className="container">
          <div className="dot-matrix relative overflow-hidden border border-border bg-surface-low/70 p-8 md:p-14">
            <div className="relative z-10 flex flex-col items-center justify-between gap-10 lg:flex-row">
              <div className="max-w-xl text-center lg:text-left">
                <p className="label-mono mb-2 text-synapse">Deploy instantly</p>
                <h2 className="font-display mb-4 text-3xl font-medium tracking-tight sm:text-4xl">Join the synapse mesh.</h2>
                <p className="mb-6 text-sm leading-relaxed text-muted-foreground">Point your agent at the catalogue, or publish your own skill from a GitHub repository — parsed, scanned and listed in under a minute.</p>
                <div className="flex flex-wrap items-center justify-center gap-3 lg:justify-start">
                  <Button asChild size="hero">
                    <Link href="/explore">Explore registry</Link>
                  </Button>
                  <Button asChild size="hero" variant="outline">
                    <Link href="/faq">Read the docs</Link>
                  </Button>
                </div>
                <div className="mt-6 flex flex-wrap justify-center gap-1.5 lg:justify-start">
                  {INSTALL_TARGETS.map((t) => (
                    <Badge key={t.id} variant="chip">
                      {t.label}
                    </Badge>
                  ))}
                </div>
              </div>
              <TerminalCard
                className="w-full lg:w-[400px]"
                title="synapth-cli ~ bash"
                lines={[
                  { text: "# Search the registry as an agent", tone: "comment" },
                  { text: `$ curl -H 'X-Agent-Request: true' \\`, tone: "accent" },
                  { text: `    '${APP_URL}/api/v1/skills?q=postgres'`, tone: "accent" },
                  { text: "" },
                  { text: "# Execute a paid tool through the gateway", tone: "comment" },
                  { text: "$ curl -X POST -H 'X-Synapth-Key: syn_…' \\", tone: "command" },
                  { text: `    ${APP_URL}/api/v1/skills/skl_weather/execute`, tone: "command" },
                  { text: "> 200 OK · 0.0002 USD escrowed · settled", tone: "output" },
                ]}
                copy={`curl -H 'X-Agent-Request: true' '${APP_URL}/api/v1/skills?q=postgres'`}
              />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function Step({ tag, icon, title, code, highlight, children }: { tag: string; icon: React.ReactNode; title: string; code: string; highlight?: boolean; children: React.ReactNode }) {
  return (
    <div className={highlight ? "group relative flex flex-col justify-between border border-synapse/30 bg-surface-high/40 p-5 shadow-[0_0_20px_hsl(var(--synapse)/0.06)]" : "group flex flex-col justify-between border border-border bg-surface-low/60 p-5 transition-colors hover:border-synapse/40"}>
      <div>
        <div className="mb-4 flex items-center justify-between">
          <Badge variant={highlight ? "synapse" : "chip"}>{tag}</Badge>
          <span className={highlight ? "text-synapse" : "text-muted-foreground transition-colors group-hover:text-synapse"}>{icon}</span>
        </div>
        <h3 className="mb-2 text-lg font-semibold tracking-tight">{title}</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>
      </div>
      <code className={`mt-6 block border-t pt-4 font-mono text-xs ${highlight ? "border-synapse/20 text-synapse" : "border-border text-muted-foreground"}`}>{code}</code>
    </div>
  );
}

function Pillar({ span, tag, icon, title, foot, aside, children }: { span: string; tag: string; icon: React.ReactNode; title: string; foot?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={`${span} flex flex-col justify-between border border-border bg-card p-6 transition-colors hover:border-foreground/25 md:p-8`}>
      <div className={aside ? "flex flex-col items-start justify-between gap-8 md:flex-row md:items-center" : undefined}>
        <div className={aside ? "max-w-2xl" : undefined}>
          <div className="mb-6 flex items-center justify-between gap-3">
            <Badge variant="synapse">{tag}</Badge>
            <span className="text-muted-foreground">{icon}</span>
          </div>
          <h3 className="mb-3 text-2xl font-semibold tracking-tight">{title}</h3>
          {children}
        </div>
        {aside}
      </div>
      {foot && <div className="label-mono-sm mt-6 flex items-center justify-between border-t border-border pt-4">{foot}</div>}
    </div>
  );
}

function Mini({ label, value, hint, accent, big }: { label: string; value: string; hint?: string; accent?: boolean; big?: boolean }) {
  return (
    <div className={`border border-border bg-surface/60 ${big ? "min-w-[150px] px-5 py-4 text-center" : "p-3"}`}>
      <span className="label-mono-sm mb-1 block">{label}</span>
      <span className={`${big ? "stat-value" : "text-lg font-semibold tracking-tight"} ${accent ? "text-synapse" : ""}`}>{value}</span>
      {hint && <span className="label-mono-sm mt-1 block">{hint}</span>}
    </div>
  );
}

function Row({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{k}:</dt>
      <dd className={accent ? "text-synapse" : "text-foreground"}>{v}</dd>
    </div>
  );
}
