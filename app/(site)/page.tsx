import Link from "next/link";
import { ArrowRight, Database, Lock, Radar, ShieldCheck, Terminal } from "lucide-react";
import { AsciiHands } from "@/components/ascii-hands";
import { SkillCard } from "@/components/skill-card";
import { StatTile } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CommandChip } from "@/components/copy-button";
import { TerminalCard } from "@/components/terminal-card";
import { SynapsePulse } from "@/components/synapse-pulse";
import { skillRepository } from "@/cortex/repository";
import { INSTALL_TARGETS } from "@/axon/install";
import { getI18n } from "@/cortex/locale";
import { rich } from "@/lib/i18n/rich";
import { formatCompact } from "@/lib/utils";

export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export default async function HomePage() {
  const [all, trending, { t }] = await Promise.all([skillRepository.all(), skillRepository.search("", { sort: "trending", limit: 6 }), getI18n()]);
  const targets = INSTALL_TARGETS.map((target) => t(`install.target.${target.id}`));

  const installs = all.reduce((n, s) => n + s.downloadsCount, 0);
  const verified = all.filter((s) => s.securityLevel === "Verified").length;
  const sandboxed = all.filter((s) => s.securityLevel === "Sandbox").length;
  const languages = new Set(all.map((s) => s.source?.language).filter(Boolean)).size;
  const authors = new Set(all.map((s) => s.source?.owner ?? s.authorName)).size;
  const weekAgo = Date.now() - 7 * 86_400_000;
  const freshCount = all.filter((s) => new Date(s.createdAt).getTime() > weekAgo).length;
  // A freshly crawled catalogue is "all new"; only show the delta once it is a real weekly increment.
  const fresh = freshCount < all.length / 2 ? freshCount : 0;
  const byCategory = { MCP: 0, Prompt: 0, Tool: 0 } as Record<string, number>;
  for (const s of all) byCategory[s.category] = (byCategory[s.category] ?? 0) + 1;

  return (
    <>
      {/* Hero — the dot-matrix hands are the background; content floats on top. */}
      {/* `data-pixel-glow`: the only zone where the global PixelField follows the pointer. */}
      <section data-pixel-glow className="relative overflow-hidden border-b border-border">
        <AsciiHands className="absolute inset-0 h-full w-full" />

        <div className="container relative flex min-h-[780px] flex-col items-center justify-start pt-12 text-center md:min-h-[max(840px,calc(360px_+_34vw))] md:pt-24">
          <div className="pill mb-6 h-8 gap-3 px-4">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-synapse opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-synapse" />
            </span>
            <span>{t("home.hero.indexed", { n: formatCompact(all.length) })}</span>
          </div>

          <h1 className="font-display max-w-4xl text-balance text-[2.75rem] font-medium leading-[0.98] tracking-[-0.03em] sm:text-6xl md:text-7xl">
            <span className="text-muted-foreground">{t("home.hero.title1")}</span>
            <br />
            {t("home.hero.title2")}
          </h1>
          <p className="mt-6 max-w-2xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
            {t("home.hero.lead")}
          </p>
          <div className="mt-8 flex w-full flex-wrap items-center justify-center gap-3">
            <Button asChild size="hero">
              <Link href="/search?tab=skills">
                {t("common.exploreRegistry")} <ArrowRight />
              </Link>
            </Button>
            <CommandChip command={`curl -H 'X-Agent-Request: true' ${APP_URL}/api/v1/skills?q=postgres`} />
          </div>

          <div className="pointer-events-none absolute inset-x-6 bottom-5 hidden justify-center md:flex">
            <span className="label-mono-sm tracking-[0.2em]">{t("home.hero.hint")}</span>
          </div>
        </div>
      </section>

      {/* Telemetry strip. */}
      <section className="border-b border-border bg-surface-lowest/80 backdrop-blur-sm">
        <div className="container grid grid-cols-2 divide-y divide-border sm:divide-y-0 md:grid-cols-4 md:divide-x">
          <StatTile label={t("home.stats.indexed")} value={formatCompact(all.length)} unit={fresh ? t("home.stats.thisWeek", { n: fresh }) : undefined} hint={t("home.stats.publishers", { authors, languages })} />
          <StatTile label={t("home.stats.verified")} value={String(verified)} unit={t("home.stats.reviewed")} hint={t("home.stats.sandboxed", { n: sandboxed })} />
          <StatTile label={t("home.stats.installs")} value={formatCompact(installs)} hint={t("home.stats.installsHint")} />
          <StatTile label={t("home.stats.targets")} value={String(INSTALL_TARGETS.length)} hint={targets.join(" · ")} />
        </div>
      </section>

      {/* Mechanics — how a skill travels from a repository into an agent. */}
      <section className="container py-20">
        <div className="mb-12 flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <p className="label-mono mb-2 flex items-center gap-2 text-synapse">
              <span className="inline-block h-2 w-2 bg-synapse" /> {t("home.mech.label")}
            </p>
            <h2 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">{t("home.mech.title")}</h2>
          </div>
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            {t("home.mech.lead")}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 md:p-8">
          <div className="grid gap-6 md:grid-cols-3">
            <Step tag={t("home.step1.tag")} icon={<Radar className="h-5 w-5" />} title={t("home.step1.title")} code="> crawl(topic: 'mcp-server')">
              {rich(t("home.step1.body"))}
            </Step>
            <Step tag={t("home.step2.tag")} icon={<ShieldCheck className="h-5 w-5" />} title={t("home.step2.title")} code="[scan] prompt-injection · shell · secrets" highlight>
              {rich(t("home.step2.body"))}
            </Step>
            <Step tag={t("home.step3.tag")} icon={<Terminal className="h-5 w-5" />} title={t("home.step3.title")} code="mcpServers.<slug> = { command, args } ✓">
              {rich(t("home.step3.body"))}
            </Step>
          </div>
        </div>
      </section>

      {/* Live pipeline: a real agent request, node by node. */}
      <section className="border-y border-border bg-surface-lowest/60 py-16">
        <div className="container">
          <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <p className="label-mono mb-2 text-synapse">{t("home.pulse.label")}</p>
              <h2 className="text-2xl font-semibold tracking-tight">{t("home.pulse.title")}</h2>
            </div>
            <p className="max-w-md text-sm leading-relaxed text-muted-foreground">{t("home.pulse.lead")}</p>
          </div>
          <SynapsePulse />
        </div>
      </section>

      {/* Trending row. */}
      <section className="border-b border-border py-16">
        <div className="container">
          <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <h2 className="text-2xl font-semibold tracking-tight">{t("home.trending.title")}</h2>
            <Link href="/search?tab=skills" className="label-mono inline-flex items-center gap-1.5 text-foreground hover:text-synapse">
              {t("home.trending.browseAll", { n: formatCompact(all.length) })} <ArrowRight className="h-3.5 w-3.5" />
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
          <p className="label-mono mb-2 text-synapse">{t("home.pillars.label")}</p>
          <h2 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">{t("home.pillars.title")}</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t("home.pillars.lead")}</p>
        </div>

        <div className="grid gap-6 md:grid-cols-12">
          <Pillar span="md:col-span-7" tag={t("home.pillar1.tag")} icon={<Database className="h-5 w-5" />} title={t("home.pillar1.title")} foot={<><span>{t("home.pillar1.mcp")} · {t("home.pillar1.prompts")} · {t("home.pillar1.tools")}</span><Link href="/search?tab=skills" className="label-mono-sm text-synapse hover:underline">{t("home.pillar1.browse")}</Link></>}>
            <p className="mb-6 text-sm leading-relaxed text-muted-foreground">{rich(t("home.pillar1.body"))}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Mini label={t("home.pillar1.mcp")} value={String(byCategory.MCP)} />
              <Mini label={t("home.pillar1.prompts")} value={String(byCategory.Prompt)} />
              <Mini label={t("home.pillar1.tools")} value={String(byCategory.Tool)} />
            </div>
          </Pillar>

          <Pillar span="md:col-span-5" tag={t("home.pillar2.tag")} icon={<Lock className="h-5 w-5" />} title={t("home.pillar2.title")} foot={<><span>{t("home.pillar2.foot1")}</span><span className="text-synapse">{t("home.pillar2.foot2")}</span></>}>
            <p className="mb-4 text-sm leading-relaxed text-muted-foreground">{t("home.pillar2.body")}</p>
            <dl className="well space-y-1.5 p-4 font-mono text-xs">
              <Row k={t("home.pillar2.rules")} v="prompt-injection · shell · secrets" />
              <Row k={t("home.pillar2.surfaces")} v="prompt · tools · readme · entrypoint" />
              <Row k={t("home.pillar2.sandbox")} v={t("home.pillar2.flagged", { n: sandboxed })} accent />
              <Row k={t("home.pillar2.verified")} v={t("home.pillar2.reviewed", { n: verified })} accent />
            </dl>
          </Pillar>

        </div>
      </section>

      {/* CTA. */}
      <section className="border-t border-border bg-surface-lowest/60 py-20">
        <div className="container">
          <div className="dot-matrix relative overflow-hidden rounded-2xl border border-border bg-surface-low/70 p-8 md:p-14">
            <div className="relative z-10 flex flex-col items-center justify-between gap-10 lg:flex-row">
              <div className="max-w-xl text-center lg:text-left">
                <p className="label-mono mb-2 text-synapse">{t("home.cta.label")}</p>
                <h2 className="font-display mb-4 text-3xl font-medium tracking-tight sm:text-4xl">{t("home.cta.title")}</h2>
                <p className="mb-6 text-sm leading-relaxed text-muted-foreground">{t("home.cta.lead")}</p>
                <div className="flex flex-wrap items-center justify-center gap-3 lg:justify-start">
                  <Button asChild size="hero">
                    <Link href="/search?tab=skills">{t("common.exploreRegistry")}</Link>
                  </Button>
                  <Button asChild size="hero" variant="outline">
                    <Link href="/faq">{t("common.readDocs")}</Link>
                  </Button>
                </div>
                <div className="mt-6 flex flex-wrap justify-center gap-1.5 lg:justify-start">
                  {INSTALL_TARGETS.map((target, i) => (
                    <Badge key={target.id} variant="chip">
                      {targets[i]}
                    </Badge>
                  ))}
                </div>
              </div>
              <TerminalCard
                className="w-full lg:w-[400px]"
                title={t("home.cta.terminal")}
                copyLabel={t("terminal.copyInstall")}
                lines={[
                  { text: t("home.cta.c1"), tone: "comment" },
                  { text: `$ curl -H 'X-Agent-Request: true' \\`, tone: "accent" },
                  { text: `    '${APP_URL}/api/v1/skills?q=postgres'`, tone: "accent" },
                  { text: "" },
                  { text: t("home.cta.c2"), tone: "comment" },
                  { text: `$ curl ${APP_URL}/api/v1/skills/postgres-mcp`, tone: "command" },
                  { text: t("home.cta.c3"), tone: "output" },
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
    <div className={highlight ? "group relative flex flex-col justify-between rounded-lg border border-synapse/30 bg-surface-high/40 p-5 shadow-[0_0_20px_hsl(var(--synapse)/0.06)]" : "group flex flex-col justify-between rounded-lg border border-border bg-surface-low/60 p-5 transition-colors hover:border-synapse/40"}>
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

function Pillar({ span, tag, icon, title, foot, children }: { span: string; tag: string; icon: React.ReactNode; title: string; foot?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={`${span} flex flex-col justify-between rounded-xl border border-border bg-card p-6 transition-colors hover:border-foreground/25 md:p-8`}>
      <div>
        <div className="mb-6 flex items-center justify-between gap-3">
          <Badge variant="synapse">{tag}</Badge>
          <span className="text-muted-foreground">{icon}</span>
        </div>
        <h3 className="mb-3 text-2xl font-semibold tracking-tight">{title}</h3>
        {children}
      </div>
      {foot && <div className="label-mono-sm mt-6 flex items-center justify-between border-t border-border pt-4">{foot}</div>}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface/60 p-3">
      <span className="label-mono-sm mb-1 block">{label}</span>
      <span className="text-lg font-semibold tracking-tight">{value}</span>
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
