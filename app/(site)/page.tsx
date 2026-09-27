import Link from "next/link";
import { Playfair_Display } from "next/font/google";
import { ArrowRight } from "lucide-react";
import { AsciiHands } from "@/components/ascii-hands";
import { SkillCard } from "@/components/skill-card";
import { StatTile } from "@/components/panel";
import { CommandChip } from "@/components/copy-button";
import { Ribbons } from "@/components/about/ribbons";
import { GhostText } from "@/components/about/ghost-text";
import { Scramble } from "@/components/about/scramble";
import { SynapseGraph, type GraphEntry, type GraphIcon } from "@/components/about/synapse-graph";
import { FlashQuote } from "@/components/about/flash-quote";
import { Manifesto, Reveal, type Principle } from "@/components/about/manifesto";
import { AboutCta } from "@/components/about/about-cta";
import { skillRepository } from "@/cortex/repository";
import { INSTALL_TARGETS } from "@/axon/install";
import { getI18n, getLocale } from "@/cortex/locale";
import { aboutTranslator, LOCALE_META } from "@/lib/i18n";
import { formatCompact, slugify } from "@/lib/utils";
import { isListed } from "@/types/trust";
import type { Skill } from "@/types/skill";
import "./home.css";

export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

// The serif accent word of every title; Inter and JetBrains Mono come from the root layout. Italic only, Latin + Cyrillic.
const serif = Playfair_Display({ subsets: ["latin", "cyrillic"], weight: "400", style: "italic", variable: "--font-serif", display: "swap" });

const WEEK_MS = 7 * 86_400_000;
const WEEKS = 12;
/** Longest node label in the synapse graph before it is cut. */
const NODE_LABEL = 16;

function graphIcon(s: Skill): GraphIcon {
  const text = `${s.slug} ${s.tags.join(" ")}`.toLowerCase();
  if (/github|\bgit\b/.test(text)) return "github";
  if (/postgres|sql|mongo|redis|database|\bdb\b/.test(text)) return "database";
  if (/browser|playwright|puppeteer|\bweb\b|http/.test(text)) return "browser";
  if (/slack|discord|telegram|chat|mail/.test(text)) return "chat";
  return "server";
}

function nodeLabel(name: string) {
  const label = slugify(name) || "skill";
  return label.length > NODE_LABEL ? `${label.slice(0, NODE_LABEL - 1)}…` : label;
}

/** The synapse graph shows real catalogue entries: most installed first, then most starred; nothing held in the sandbox. */
function graphEntries(all: Skill[]): GraphEntry[] {
  const ranked = all.filter((s) => s.securityLevel !== "Sandbox").sort((x, y) => y.downloadsCount - x.downloadsCount || y.githubStars - x.githubStars);
  const pick = (mcp: boolean, n: number) =>
    ranked
      .filter((s) => (s.category === "MCP") === mcp)
      .slice(0, n)
      .map<GraphEntry>((s) => ({ name: nodeLabel(s.name), version: s.version, kind: mcp ? "mcp" : "skill", icon: mcp ? graphIcon(s) : undefined, href: `/skills/${s.slug}` }));
  return [...pick(false, 4), ...pick(true, 3)];
}

/**
 * The home page: the hands hero, then the manifesto (formerly /about) —
 * how it works with the live synapse graph, the lime flash quote, the
 * principles bento — and the catalogue's trending row before the CTA.
 */
export default async function HomePage() {
  const [all, trending, { t }, locale] = await Promise.all([
    skillRepository.all().then((all) => all.filter((s) => isListed(s.securityLevel))),
    skillRepository.search("", { sort: "trending", limit: 6 }),
    getI18n(),
    getLocale(),
  ]);
  const a = aboutTranslator(locale);
  const targets = INSTALL_TARGETS.map((target) => t(`install.target.${target.id}`));

  const installs = all.reduce((n, s) => n + s.downloadsCount, 0);
  const verified = all.filter((s) => s.securityLevel === "Verified").length;
  const sandboxed = all.filter((s) => s.securityLevel === "Sandbox").length;
  const languages = new Set(all.map((s) => s.source?.language).filter(Boolean)).size;
  const authors = new Set(all.map((s) => s.source?.owner ?? s.authorName)).size;
  const now = Date.now();
  const freshCount = all.filter((s) => new Date(s.createdAt).getTime() > now - WEEK_MS).length;
  // A freshly crawled catalogue is "all new"; only show the delta once it is a real weekly increment.
  const fresh = freshCount < all.length / 2 ? freshCount : 0;

  // Author activity: repositories whose last push falls into each of the last twelve weeks (current week last).
  const bars = Array<number>(WEEKS).fill(0);
  for (const s of all) {
    const week = Math.floor((now - new Date(s.source?.pushedAt ?? s.updatedAt).getTime()) / WEEK_MS);
    if (week >= 0 && week < WEEKS) bars[WEEKS - 1 - week]++;
  }

  const principles: Principle[] = [
    { title: a.t("about.p1.title"), body: a.t("about.p1.body"), visual: "hub" },
    { title: a.t("about.p2.title"), body: a.t("about.p2.body"), visual: "diff" },
    { title: a.t("about.p3.title"), body: a.t("about.p3.body"), visual: "permissions" },
    { title: a.t("about.p4.title"), body: a.t("about.p4.body"), visual: "bars" },
    { title: a.t("about.p5.title"), body: a.t("about.p5.body"), visual: "count" },
  ];
  const steps = [
    { title: t("home.step1.title"), code: "crawl(topic: 'mcp-server')" },
    { title: t("home.step2.title"), code: "scan: prompt-injection · shell · secrets" },
    { title: t("home.step3.title"), code: "mcpServers.<slug> = { command, args }" },
  ];

  return (
    <div className={`about ${serif.variable}`}>
      {/* Without JS the entrance states would keep the text hidden. */}
      <noscript>
        <style>{".ghost .gl,.scr,.about-rise,.about-fade,.about-cta-panel{opacity:1!important;transform:none!important}"}</style>
      </noscript>
      {/* The ribbons fade in once the hands have scrolled away; inside the hero the PixelField stays live. */}
      <Ribbons after="hero" />

      {/* 1 — Hero: the dot-matrix hands are the background; content floats on top. */}
      {/* `data-pixel-glow`: the only zone where the global PixelField follows the pointer. */}
      <section id="hero" data-pixel-glow className="relative overflow-hidden border-b border-[var(--line)]">
        <AsciiHands className="absolute inset-0 h-full w-full" />

        <div className="container relative flex min-h-[780px] flex-col items-center justify-start pt-12 text-center md:min-h-[max(840px,calc(360px_+_34vw))] md:pt-24">
          <div className="about-chip about-mono mb-8 h-8 gap-3 px-3.5">
            <span className="about-pulse" />
            <Scramble text={t("home.hero.indexed", { n: formatCompact(all.length) })} />
          </div>

          <h1 className="home-h1 max-w-5xl">
            <GhostText as="span" text={t("home.hero.title1")} className="block text-[var(--text-2)]" />
            <GhostText as="span" text={t("home.hero.title2")} className="block" delay={240} />
          </h1>
          <Reveal className="mt-7 max-w-2xl">
            <p className="about-body text-balance">{t("home.hero.lead")}</p>
          </Reveal>
          <Reveal className="mt-9 flex w-full flex-wrap items-center justify-center gap-3">
            <Link href="/search?tab=skills" className="about-btn about-btn-primary h-12 px-7 text-base">
              {t("common.exploreRegistry")} <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
            <CommandChip command={`curl -H 'X-Agent-Request: true' ${APP_URL}/api/v1/skills?q=postgres`} />
          </Reveal>

          <div className="pointer-events-none absolute inset-x-6 bottom-5 hidden justify-center md:flex">
            <span className="label-mono-sm tracking-[0.2em]">{t("home.hero.hint")}</span>
          </div>
        </div>
      </section>

      {/* 2 — Telemetry strip: frosted, so the ribbons show through once they fade in. */}
      <section className="border-b border-[var(--line)] bg-[hsl(var(--background)/0.55)] backdrop-blur-md">
        <div className="container grid grid-cols-2 divide-y divide-[var(--line)] sm:divide-y-0 md:grid-cols-4 md:divide-x">
          <StatTile label={t("home.stats.indexed")} value={formatCompact(all.length)} unit={fresh ? t("home.stats.thisWeek", { n: fresh }) : undefined} hint={t("home.stats.publishers", { authors, languages })} />
          <StatTile label={t("home.stats.verified")} value={String(verified)} unit={t("home.stats.reviewed")} hint={t("home.stats.sandboxed", { n: sandboxed })} />
          <StatTile label={t("home.stats.installs")} value={formatCompact(installs)} hint={t("home.stats.installsHint")} />
          <StatTile label={t("home.stats.targets")} value={String(INSTALL_TARGETS.length)} hint={targets.join(" · ")} />
        </div>
      </section>

      {/* 3 — How it works: text and the three steps on the left, the synapse graph of real entries on the right. */}
      <section className="about-section container grid items-center gap-12 xl:grid-cols-12 xl:gap-6">
        <div className="xl:col-span-5">
          <p className="about-mono about-eyebrow mb-5">
            <Scramble text={t("home.mech.label")} />
          </p>
          <GhostText as="h2" text={a.t("about.hero.title")} className="about-h2" />
          <Reveal className="mt-6 max-w-[42ch]">
            <p className="about-body">{a.t("about.hero.lead")}</p>
          </Reveal>
          <Reveal className="mt-8">
            <ol className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
              {steps.map((s, i) => (
                <li key={s.code} className="grid grid-cols-[2.25rem_1fr] gap-x-2 py-3.5">
                  <span className="about-mono pt-0.5 text-[var(--accent)]">{String(i + 1).padStart(2, "0")}</span>
                  <span>
                    <span className="block text-[15px] font-medium text-[var(--text)]">{s.title}</span>
                    <code className="about-mono mt-1 block normal-case text-[var(--text-2)]">{s.code}</code>
                  </span>
                </li>
              ))}
            </ol>
            <p className="about-mono mt-5 text-[var(--text-2)]">
              <Scramble text={a.t("about.hero.fineprint")} delay={300} />
            </p>
          </Reveal>
        </div>
        <div className="xl:col-span-7">
          <SynapseGraph
            agentName="research-bot"
            entries={graphEntries(all)}
            copy={{
              agent: a.t("about.graph.agent"),
              summary: a.t("about.graph.summary"),
              status: a.t("about.graph.status"),
              skill: a.t("about.graph.skill"),
              mcp: a.t("about.graph.mcp"),
              event: a.t("about.graph.event"),
              ms: a.t("about.graph.ms"),
              describe: a.t("about.graph.describe"),
            }}
          />
        </div>
      </section>

      {/* 4 — The lime flash: why Synapth exists, answered with the quote and the migration CLI. */}
      <FlashQuote
        eyebrow={a.t("about.quote.eyebrow")}
        reasons={[a.t("about.quote.r1"), a.t("about.quote.r2"), a.t("about.quote.r3")]}
        quote={a.t("about.quote.text")}
        lead={a.t("about.quote.lead")}
        command="synapth migrate --from codex"
      />

      {/* 5 — Manifesto (`/about` redirects here). */}
      <section id="manifesto" className="about-section container scroll-mt-16">
        <div className="mb-12 grid gap-6 xl:mb-16 xl:grid-cols-12 xl:items-end">
          <div className="xl:col-span-7">
            <p className="about-mono about-eyebrow mb-5">
              <Scramble text={a.t("about.manifest.eyebrow")} />
            </p>
            <GhostText as="h2" text={a.t("about.manifest.title")} className="about-h2" />
          </div>
          <Reveal className="xl:col-span-5">
            <p className="about-body">{a.t("about.manifest.lead")}</p>
          </Reveal>
        </div>
        <Manifesto
          principles={principles}
          data={{
            // Real install targets; `curl` is the plain-HTTP path any agent can use.
            targets: INSTALL_TARGETS.map((target) => (target.id === "curl" ? "any-agent/http" : target.id)),
            requested: a.t("about.p3.requested"),
            denied: a.t("about.p3.denied"),
            bars,
            barsCaption: a.t("about.p4.caption"),
            installs,
            installsLabel: a.t("about.p5.label"),
            installsNote: a.t("about.p5.note"),
            numberLocale: LOCALE_META[locale].htmlLang,
          }}
        />
      </section>

      {/* 6 — Trending: the catalogue itself. */}
      <section className="container pb-24 xl:pb-40">
        <div className="mb-10 flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
          <div>
            <p className="about-mono about-eyebrow mb-5">
              <Scramble text={a.t("about.trending.eyebrow")} />
            </p>
            <GhostText as="h2" text={t("home.trending.title")} className="about-h2" />
          </div>
          <Link href="/search?tab=skills" className="about-btn about-btn-secondary shrink-0 self-start sm:self-auto">
            {t("home.trending.browseAll", { n: formatCompact(all.length) })} <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </div>
        <div className="stagger grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {trending.hits.map((h) => (
            <SkillCard key={h.skill.id} skill={h.skill} />
          ))}
        </div>
      </section>

      {/* 7 — Final CTA; the standard footer follows from the layout. */}
      <section className="container pb-8">
        <AboutCta title={a.t("about.cta.title")} primary={a.t("about.cta.primary")} secondary={a.t("about.cta.secondary")} />
      </section>
    </div>
  );
}
