import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Bot, Github, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getI18n } from "@/cortex/locale";
import { skillRepository } from "@/cortex/repository";
import { formatCompact } from "@/lib/utils";
import { rich } from "@/lib/i18n/rich";
import type { FaqKey } from "@/lib/i18n";
import pkg from "@/package.json";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("meta.faq.title") };
}

const Code = ({ children }: { children: string }) => (
  <pre className="well my-3 overflow-auto p-3 font-mono text-xs leading-relaxed text-foreground/90">{children}</pre>
);

/** Rich-text paragraph from a dictionary key; inline code is not re-coloured because the article body already sets the palette. */
const P = ({ text, className }: { text: string; className?: string }) => <p className={className}>{rich(text, { codeClassName: "font-mono" })}</p>;

type Item = { id: string; q: FaqKey; a: (t: (key: FaqKey) => string) => React.ReactNode };
type Section = { id: string; title: FaqKey; items: Item[] };

const MANIFEST_EXAMPLE = `{
  "schemaVersion": 1,
  "name": "Postgres MCP",
  "description": "Read-only SQL access for agents.",
  "category": "MCP",
  "systemPrompt": "Call postgres_list_tables before writing SQL.",
  "tools": [
    {
      "name": "postgres_query",
      "description": "Run a read-only SQL statement.",
      "parameters": {
        "type": "object",
        "properties": { "sql": { "type": "string" } },
        "required": ["sql"]
      }
    }
  ],
  "entrypoint": { "type": "mcp-stdio", "command": "npx", "args": ["-y", "@acme/postgres-mcp"], "env": { "DATABASE_URL": "\${DATABASE_URL}" } },
  "permissions": ["network", "shell"],
  "requiredEnv": ["DATABASE_URL"],
  "flow": [
    { "id": "t", "label": "Data question", "kind": "trigger", "next": ["q"] },
    { "id": "q", "label": "postgres_query", "kind": "tool", "tool": "postgres_query", "next": ["o"] },
    { "id": "o", "label": "Answer", "kind": "output" }
  ]
}`;

/** Section and item ids are stable across locales so `#install-cursor` style anchors keep working. */
const sections: Section[] = [
  {
    id: "mcp",
    title: "faq.sec.mcp",
    items: [
      {
        id: "what",
        q: "faq.mcp.what.q",
        a: (t) => (
          <>
            <P text={t("faq.mcp.what.p1")} />
            <P text={t("faq.mcp.what.p2")} className="mt-2" />
          </>
        ),
      },
      {
        id: "category",
        q: "faq.mcp.cat.q",
        a: (t) => (
          <ul className="list-disc space-y-1 pl-5">
            <li>{rich(t("faq.mcp.cat.mcp"), { codeClassName: "font-mono" })}</li>
            <li>{rich(t("faq.mcp.cat.tool"), { codeClassName: "font-mono" })}</li>
            <li>{rich(t("faq.mcp.cat.prompt"), { codeClassName: "font-mono" })}</li>
          </ul>
        ),
      },
    ],
  },
  {
    id: "install",
    title: "faq.sec.install",
    items: [
      {
        id: "cursor",
        q: "faq.install.cursor.q",
        a: (t) => (
          <>
            <P text={t("faq.install.cursor.p1")} />
            <Code>{`{
  "mcpServers": {
    "acme-postgres-mcp": {
      "command": "npx",
      "args": ["-y", "@acme/postgres-mcp"],
      "env": { "DATABASE_URL": "\${DATABASE_URL}" }
    }
  }
}`}</Code>
            <P text={t("faq.install.cursor.p2")} />
          </>
        ),
      },
      {
        id: "claude-desktop",
        q: "faq.install.desktop.q",
        a: (t) => <P text={t("faq.install.desktop.p1")} />,
      },
      {
        id: "claude-code",
        q: "faq.install.code.q",
        a: (t) => (
          <>
            <P text={t("faq.install.code.p1")} />
            <Code>{`claude mcp add acme-postgres-mcp -- npx -y @acme/postgres-mcp`}</Code>
            <P text={t("faq.install.code.p2")} />
          </>
        ),
      },
      {
        id: "badges",
        q: "faq.install.badges.q",
        a: (t) => (
          <>
            <ul className="list-disc space-y-1 pl-5">
              <li>{rich(t("faq.install.badges.verified"), { codeClassName: "font-mono" })}</li>
              <li>{rich(t("faq.install.badges.community"), { codeClassName: "font-mono" })}</li>
              <li>{rich(t("faq.install.badges.sandbox"), { codeClassName: "font-mono" })}</li>
            </ul>
            <P text={t("faq.install.badges.note")} className="mt-2" />
          </>
        ),
      },
    ],
  },
  {
    id: "publish",
    title: "faq.sec.publish",
    items: [
      {
        id: "manifest",
        q: "faq.publish.s1.q",
        a: (t) => (
          <>
            <P text={t("faq.publish.s1.p1")} />
            <Code>{MANIFEST_EXAMPLE}</Code>
            <P text={t("faq.publish.s1.p2")} />
          </>
        ),
      },
      {
        id: "import",
        q: "faq.publish.s2.q",
        a: (t) => (
          <>
            <P text={t("faq.publish.s2.p1")} />
            <P text={t("faq.publish.s2.p2")} className="mt-2" />
            <Code>{`curl -X POST https://synapth.dev/api/v1/import/github \\
  -H 'Content-Type: application/json' -H 'X-Synapth-Key: syn_…' \\
  -d '{"url":"https://github.com/acme/postgres-mcp","dryRun":true}'`}</Code>
          </>
        ),
      },
      {
        id: "verified",
        q: "faq.publish.s4.q",
        a: (t) => <P text={t("faq.publish.s4.p1")} />,
      },
    ],
  },
  {
    id: "search",
    title: "faq.sec.search",
    items: [
      {
        id: "syntax",
        q: "faq.search.how.q",
        a: (t) => (
          <>
            <P text={t("faq.search.how.p1")} />
            <Code>{t("faq.search.how.ops")}</Code>
            <P text={t("faq.search.how.p2")} />
          </>
        ),
      },
      {
        id: "sources",
        q: "faq.search.where.q",
        a: (t) => <P text={t("faq.search.where.p1")} />,
      },
    ],
  },
  {
    id: "agents",
    title: "faq.sec.agents",
    items: [
      {
        id: "headless",
        q: "faq.agents.how.q",
        a: (t) => (
          <>
            <P text={t("faq.agents.how.p1")} />
            <Code>{`curl -s -H 'X-Agent-Request: true' \\
  'https://synapth.dev/api/v1/skills?q=postgres&limit=3'
# → {"v":1,"sys":"## Postgres MCP v1.4.2\\n…","tools":[{"type":"function","function":{…},"s":"skl_postgres"}],"skills":[…],"n":3}`}</Code>
            <P text={t("faq.agents.how.p2")} />
          </>
        ),
      },
    ],
  },
];

export const dynamic = "force-dynamic";

export default async function FaqPage() {
  const [{ t }, all] = await Promise.all([getI18n(), skillRepository.all()]);
  const verified = all.filter((s) => s.securityLevel === "Verified").length;
  const sandbox = all.filter((s) => s.securityLevel === "Sandbox").length;
  const topology = [
    { tag: t("faq.topo.n1.tag"), title: t("faq.topo.n1.title"), meta: t("faq.topo.n1.meta") },
    { tag: t("faq.topo.n2.tag"), title: t("faq.topo.n2.title"), meta: t("faq.topo.n2.meta") },
    { tag: t("faq.topo.n3.tag"), title: t("faq.topo.n3.title"), meta: t("faq.topo.n3.meta"), scan: true },
    { tag: t("faq.topo.n4.tag"), title: t("faq.topo.n4.title"), meta: t("faq.topo.n4.meta") },
  ];
  const edges = [t("faq.topo.edge1"), t("faq.topo.edge2"), t("faq.topo.edge3")];
  return (
    <>
      {/* Docs engine strip. */}
      <div className="border-b border-border bg-surface-lowest/70">
        <div className="container flex h-10 items-center justify-between gap-4">
          <div className="label-mono-sm flex items-center gap-3">
            <span className="text-synapse">{t("faq.strip.engine")}</span>
            <span className="hidden text-foreground sm:inline">{t("faq.strip.runtime", { version: pkg.version })}</span>
            <Badge variant="chip">{t("faq.strip.spec")}</Badge>
          </div>
          <div className="label-mono-sm flex items-center gap-4">
            <a href="https://github.com" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-foreground">
              <Github className="h-3.5 w-3.5" /> {t("faq.strip.repo")}
            </a>
          </div>
        </div>
      </div>

      <div className="container grid gap-10 py-10 lg:grid-cols-[220px_minmax(0,1fr)_200px]">
        {/* Left: numbered navigation. */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Link href="/search" className="mb-6 flex h-9 items-center gap-2 rounded-md border border-border bg-surface-low px-3 text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground">
            <Search className="h-3.5 w-3.5" />
            <span className="font-mono text-xs">{t("faq.filter")}</span>
            <kbd className="label-mono-sm ml-auto rounded-md border border-border bg-surface-high px-1.5 normal-case">⌘K</kbd>
          </Link>
          <nav className="flex flex-col gap-6">
            {sections.map((s, i) => (
              <div key={s.id}>
                <a href={`#${s.id}`} className="label-mono-sm mb-2 block tracking-[0.2em] hover:text-foreground">
                  <span className="mr-2 text-synapse/70">{String(i + 1).padStart(2, "0")}</span>{t(s.title)}
                </a>
                <ul className="flex flex-col">
                  {s.items.map((it) => (
                    <li key={it.id}>
                      <a href={`#${s.id}-${it.id}`} className="flex items-center justify-between border-l border-border py-1.5 pl-3 text-[13px] text-muted-foreground transition-colors hover:border-synapse hover:text-foreground">
                        <span className="truncate">{t(it.q).replace(/[?？]$/, "")}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        {/* Centre: content. */}
        <div className="min-w-0">
          <header className="mb-10 border-b border-border pb-8">
            <p className="label-mono-sm mb-3 tracking-[0.2em]">{t("faq.head.docs")}</p>
            <div className="mb-3 flex flex-wrap gap-1.5">
              <Badge variant="synapse">{t("faq.badge.mcp")}</Badge>
              <Badge variant="chip">{t("faq.badge.scanner")}</Badge>
            </div>
            <h1 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">{t("faq.title")}</h1>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">{t("faq.lead")}</p>
            <p className="label-mono-sm mt-4 flex flex-wrap gap-x-4 gap-y-1">
              <span>{t("faq.spec")}</span>
              <span>{t("faq.compiled", { date: new Date().toISOString().slice(0, 10) })}</span>
            </p>
          </header>

          {/* Topology: the four real hops between an agent and an installed skill. */}
          <div className="mb-10 overflow-hidden rounded-xl border border-border bg-card">
            <div className="panel-head">
              <span className="label-mono-sm">{t("faq.topo.label")}</span>
              <span className="label-mono-sm hidden text-synapse sm:inline">{t("faq.topo.right")}</span>
            </div>
            <div className="p-5">
              <ol className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center">
                {topology.map((node, i) => (
                  <li key={node.title} className="contents">
                    <div className={`rounded-lg border p-3 ${node.scan ? "border-synapse/40 bg-synapse/5" : "border-border bg-surface-lowest"}`}>
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className={`label-mono-sm ${node.scan ? "text-synapse" : ""}`}>{node.tag}</span>
                        <span className={`h-1.5 w-1.5 rounded-full ${node.scan ? "bg-synapse" : "bg-muted-foreground/60"}`} />
                      </div>
                      <p className="text-sm font-semibold tracking-tight text-foreground">{node.title}</p>
                      <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground" title={node.meta}>{node.meta}</p>
                    </div>
                    {i < edges.length && (
                      <div className="label-mono-sm flex items-center justify-center gap-1 px-1 text-muted-foreground md:flex-col">
                        <span className="hidden h-px w-6 bg-synapse/60 md:block" />
                        <span>{edges[i]}</span>
                        <ArrowRight className="h-3 w-3 md:hidden" />
                      </div>
                    )}
                  </li>
                ))}
              </ol>
              <div className="label-mono-sm mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-4">
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 bg-synapse" /> {t("faq.topo.legend.live")}</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 border border-synapse/60 bg-synapse/10" /> {t("faq.topo.legend.scan")}</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 bg-danger/80" /> {t("faq.topo.legend.blocked")}</span>
              </div>
            </div>
          </div>

          <div className="mb-14 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="mb-3 flex items-center justify-between">
                <span className="label-mono">{t("faq.stat.indexed")}</span>
                <Badge variant="chip">GitHub</Badge>
              </div>
              <p className="stat-value cursor">{formatCompact(all.length)}</p>
              <p className="label-mono-sm mt-3 border-t border-border pt-3">{t("faq.stat.indexedHint")}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="mb-3 flex items-center justify-between">
                <span className="label-mono">{t("faq.stat.verified")}</span>
                <Badge variant="synapse">{t("faq.stat.verifiedUnit")}</Badge>
              </div>
              <p className="stat-value cursor text-synapse">{verified}</p>
              <p className="label-mono-sm mt-3 border-t border-border pt-3">{t("faq.stat.verifiedHint", { sandbox })}</p>
            </div>
          </div>

          {sections.map((s, i) => (
            <section key={s.id} id={s.id} className="mb-14 scroll-mt-24">
              <div className="mb-6 flex items-center justify-between gap-4">
                <h2 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
                  <span className="label-mono-sm text-synapse">{String(i + 1).padStart(2, "0")}</span>
                  {t(s.title)}
                </h2>
              </div>
              <div className="flex flex-col gap-4">
                {s.items.map((item) => (
                  <article key={item.id} id={`${s.id}-${item.id}`} className="scroll-mt-24 overflow-hidden rounded-xl border border-border bg-card">
                    <h3 className="panel-head text-sm font-semibold tracking-tight text-foreground">
                      <span className="flex items-center gap-2.5">
                        <span className="h-2 w-2 shrink-0 bg-synapse" /> {t(item.q)}
                      </span>
                    </h3>
                    <div className="p-5 text-sm leading-relaxed text-muted-foreground [&_strong]:text-foreground">{item.a(t)}</div>
                  </article>
                ))}
              </div>
            </section>
          ))}

          <p className="label-mono-sm mb-4 tracking-[0.2em]">{t("faq.next.label")}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              { href: "/search?tab=skills", tag: t("faq.next.explore.tag"), title: t("faq.next.explore.title"), body: t("faq.next.explore.body") },
              { href: "/dashboard#publish", tag: t("faq.next.publish.tag"), title: t("faq.next.publish.title"), body: t("faq.next.publish.body") },
            ].map((card) => (
              <Link key={card.href} href={card.href} className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-synapse/50">
                <div className="mb-3 flex items-center justify-between">
                  <span className="label-mono-sm">{card.tag}</span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-synapse" />
                </div>
                <p className="text-lg font-semibold tracking-tight">{card.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{card.body}</p>
              </Link>
            ))}
          </div>
        </div>

        {/* Right: on this page + actions. */}
        <aside className="hidden lg:sticky lg:top-24 lg:block lg:self-start">
          <p className="label-mono-sm mb-3 tracking-[0.2em]">{t("faq.onThisPage")}</p>
          <ul className="mb-8 flex flex-col">
            {sections.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className={`block border-l py-1.5 pl-3 text-xs transition-colors hover:text-foreground ${i === 0 ? "border-synapse text-foreground" : "border-border text-muted-foreground"}`}>
                  {t(s.title)}
                </a>
              </li>
            ))}
          </ul>
          <p className="label-mono-sm mb-3 tracking-[0.2em]">{t("faq.actions")}</p>
          <ul className="mb-8 flex flex-col gap-2 text-xs">
            <li>
              <a href="https://github.com" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground">
                <Github className="h-3.5 w-3.5" /> {t("faq.editGithub")}
              </a>
            </li>
            <li>
              <Link href="/faq#agents" className="inline-flex h-8 w-full items-center gap-2 rounded-lg border border-border bg-surface px-3 text-foreground transition-colors hover:border-synapse/50">
                <Bot className="h-3.5 w-3.5 text-synapse" /> {t("faq.agentApi")}
              </Link>
            </li>
          </ul>
          <div className="well p-3">
            <p className="label-mono-sm mb-1">{t("faq.release")}</p>
            <p className="font-mono text-xs text-foreground">v{pkg.version}</p>
            <Link href="/search?tab=skills" className="label-mono-sm mt-2 block text-synapse hover:underline">
              {t("faq.browse")}
            </Link>
          </div>
        </aside>
      </div>
    </>
  );
}
