import type { Metadata } from "next";
import Link from "next/link";
import { Playfair_Display } from "next/font/google";
import { Play } from "lucide-react";
import { skillRepository } from "@/cortex/repository";
import { getLocale } from "@/cortex/locale";
import { INSTALL_TARGETS } from "@/axon/install";
import { aboutTranslator, LOCALE_META } from "@/lib/i18n";
import { Ribbons } from "@/components/about/ribbons";
import { GhostText } from "@/components/about/ghost-text";
import { Scramble } from "@/components/about/scramble";
import { SynapseGraph } from "@/components/about/synapse-graph";
import { FlashQuote } from "@/components/about/flash-quote";
import { Manifesto, Reveal, type Principle } from "@/components/about/manifesto";
import { AboutCta } from "@/components/about/about-cta";
import "./about.css";

export const dynamic = "force-dynamic";

// The serif accent word; Inter and JetBrains Mono come from the root layout. Italic only, Latin + Cyrillic.
const serif = Playfair_Display({ subsets: ["latin", "cyrillic"], weight: "400", style: "italic", variable: "--font-serif", display: "swap" });

const WEEK_MS = 7 * 86_400_000;
const WEEKS = 12;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = aboutTranslator(await getLocale());
  return { title: t("about.meta.title"), description: t("about.meta.description"), alternates: { canonical: "/about" } };
}

export default async function AboutPage() {
  const locale = await getLocale();
  const { t, n } = aboutTranslator(locale);
  const all = await skillRepository.all();

  const mcp = all.filter((s) => s.category === "MCP").length;
  const skills = all.length - mcp;
  const installs = all.reduce((sum, s) => sum + s.downloadsCount, 0);
  // Author activity: repositories whose last push falls into each of the last twelve weeks (current week last).
  const bars = Array<number>(WEEKS).fill(0);
  const now = Date.now();
  for (const s of all) {
    const at = new Date(s.source?.pushedAt ?? s.updatedAt).getTime();
    const week = Math.floor((now - at) / WEEK_MS);
    if (week >= 0 && week < WEEKS) bars[WEEKS - 1 - week]++;
  }

  const numberLocale = LOCALE_META[locale].htmlLang;
  const num = (v: number) => new Intl.NumberFormat(numberLocale).format(v);
  const counts = `${n("about.hero.skills", skills, { n: num(skills) })} · ${t("about.hero.mcp", { n: num(mcp) })}`;

  const principles: Principle[] = [
    { title: t("about.p1.title"), body: t("about.p1.body"), visual: "hub" },
    { title: t("about.p2.title"), body: t("about.p2.body"), visual: "diff" },
    { title: t("about.p3.title"), body: t("about.p3.body"), visual: "permissions" },
    { title: t("about.p4.title"), body: t("about.p4.body"), visual: "bars" },
    { title: t("about.p5.title"), body: t("about.p5.body"), visual: "count" },
  ];

  return (
    <div className={`about ${serif.variable}`}>
      {/* Without JS the entrance states would keep the text hidden. */}
      <noscript>
        <style>{".ghost .gl,.scr,.about-rise,.about-fade,.about-cta-panel{opacity:1!important;transform:none!important}"}</style>
      </noscript>
      <Ribbons />

      {/* 3.1 — first screen: text left (5), the synapse graph right (7). */}
      <section className="container grid min-h-[calc(100svh-4rem)] items-center gap-12 py-16 xl:grid-cols-12 xl:gap-6 xl:py-10">
        <div className="xl:col-span-5">
          <p className="about-mono about-chip mb-8 h-auto flex-wrap gap-x-3 gap-y-1 py-1.5">
            <span className="flex items-center gap-2 text-[var(--text)]">
              <span aria-hidden="true" className="h-1.5 w-1.5 bg-[var(--accent)]" />
              <Scramble text={t("about.hero.beta")} />
            </span>
            <span aria-hidden="true" className="text-[var(--line-hi)]">/</span>
            <Scramble text={counts} delay={150} />
          </p>
          <GhostText as="h1" text={t("about.hero.title")} className="about-h1" />
          <Reveal className="mt-6 max-w-[40ch]">
            <p className="about-body">{t("about.hero.lead")}</p>
          </Reveal>
          <Reveal className="mt-10">
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/search?tab=skills" className="about-btn about-btn-primary">
                {t("about.hero.primary")}
              </Link>
              <Link href="/faq" className="about-btn about-btn-secondary">
                <Play aria-hidden="true" className="h-3.5 w-3.5 fill-current" />
                {t("about.hero.secondary")}
                <span className="about-mono text-[var(--text-2)]">{t("about.hero.secondaryMeta")}</span>
              </Link>
            </div>
            <p className="about-mono mt-5 text-[var(--text-2)]">
              <Scramble text={t("about.hero.fineprint")} delay={300} />
            </p>
          </Reveal>
        </div>
        <div className="xl:col-span-7">
          <SynapseGraph
            agentName="research-bot"
            copy={{
              agent: t("about.graph.agent"),
              summary: t("about.graph.summary"),
              status: t("about.graph.status"),
              skill: t("about.graph.skill"),
              mcp: t("about.graph.mcp"),
              event: t("about.graph.event"),
              ms: t("about.graph.ms"),
              describe: t("about.graph.describe"),
            }}
          />
        </div>
      </section>

      {/* 3.2 — the lime flash and the quote. */}
      <FlashQuote quote={t("about.quote.text")} eyebrow={t("about.quote.eyebrow")} />

      {/* 3.3 — manifesto. */}
      <section className="about-section container">
        <div className="mb-12 grid gap-6 xl:mb-16 xl:grid-cols-12 xl:items-end">
          <div className="xl:col-span-7">
            <p className="about-mono about-eyebrow mb-5">
              <Scramble text={t("about.manifest.eyebrow")} />
            </p>
            <GhostText as="h2" text={t("about.manifest.title")} className="about-h2" />
          </div>
          <Reveal className="xl:col-span-5">
            <p className="about-body">{t("about.manifest.lead")}</p>
          </Reveal>
        </div>
        <Manifesto
          principles={principles}
          data={{
            // Real install targets; `curl` is the plain-HTTP path any agent can use.
            targets: INSTALL_TARGETS.map((target) => (target.id === "curl" ? "any-agent/http" : target.id)),
            requested: t("about.p3.requested"),
            denied: t("about.p3.denied"),
            bars,
            barsCaption: t("about.p4.caption"),
            installs,
            installsLabel: t("about.p5.label"),
            installsNote: t("about.p5.note"),
            numberLocale,
          }}
        />
      </section>

      {/* 3.4 — final CTA; the standard footer follows from the layout. */}
      <section className="container pb-8">
        <AboutCta title={t("about.cta.title")} primary={t("about.cta.primary")} secondary={t("about.cta.secondary")} />
      </section>
    </div>
  );
}
