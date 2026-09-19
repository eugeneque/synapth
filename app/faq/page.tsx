import type { Metadata } from "next";
import Link from "next/link";
import { Bot, Github, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import pkg from "@/package.json";

export const metadata: Metadata = { title: "Docs & FAQ" };

const Code = ({ children }: { children: string }) => (
  <pre className="well my-3 overflow-auto p-3 font-mono text-xs leading-relaxed text-foreground/90">{children}</pre>
);

const sections: Array<{ id: string; title: string; items: Array<{ q: string; a: React.ReactNode }> }> = [
  {
    id: "mcp",
    title: "Model Context Protocol",
    items: [
      {
        q: "What is MCP (Model Context Protocol)?",
        a: (
          <>
            <p>
              MCP is an open protocol that standardises how an AI application (the <em>host</em>: Claude Desktop, Cursor, Claude Code…) talks to external capability providers (<em>servers</em>). A server
              exposes three kinds of things: <strong>tools</strong> the model can call, <strong>resources</strong> it can read, and <strong>prompts</strong> it can reuse.
            </p>
            <p className="mt-2">
              The host launches the server (over stdio) or connects to it (over SSE/HTTP), asks <code className="font-mono">tools/list</code>, and from then on the model sees the server&apos;s tools exactly like
              built-in functions. Synapth indexes those servers, scans them, and generates the host-specific config so you never hand-edit JSON.
            </p>
          </>
        ),
      },
      {
        q: "MCP vs. Tool vs. Prompt — which category is my skill?",
        a: (
          <ul className="list-disc space-y-1 pl-5">
            <li><strong>MCP</strong> — a process or endpoint speaking the protocol; installs into the host&apos;s <code className="font-mono">mcpServers</code>.</li>
            <li><strong>Tool</strong> — a single HTTP function with a JSON-schema signature; called through the Synapth gateway, can be pay-per-call.</li>
            <li><strong>Prompt</strong> — only a system-prompt fragment; installs as a Cursor rule, a Claude Code skill or a project instruction.</li>
          </ul>
        ),
      },
    ],
  },
  {
    id: "install",
    title: "Installing safely",
    items: [
      {
        q: "How do I install a skill into Cursor?",
        a: (
          <>
            <p>Open the skill page, pick the <strong>Cursor</strong> tab and press <em>Copy &amp; install</em>. Merge the snippet into <code className="font-mono">~/.cursor/mcp.json</code> (global) or <code className="font-mono">.cursor/mcp.json</code> (project):</p>
            <Code>{`{
  "mcpServers": {
    "acme-postgres-mcp": {
      "command": "npx",
      "args": ["-y", "@acme/postgres-mcp"],
      "env": { "DATABASE_URL": "\${DATABASE_URL}" }
    }
  }
}`}</Code>
            <p>Prompt skills become a rule in <code className="font-mono">.cursor/rules/</code>. Restart Cursor or toggle the server in Settings → MCP.</p>
          </>
        ),
      },
      {
        q: "How do I install into Claude Desktop?",
        a: (
          <>
            <p>Same snippet, different file: <code className="font-mono">~/Library/Application Support/Claude/claude_desktop_config.json</code> on macOS, <code className="font-mono">%APPDATA%\Claude\claude_desktop_config.json</code> on Windows. Restart Claude Desktop; the hammer icon lists the new tools.</p>
          </>
        ),
      },
      {
        q: "How do I install into Claude Code?",
        a: (
          <>
            <p>The <strong>Claude Code</strong> tab gives a one-liner:</p>
            <Code>{`claude mcp add acme-postgres-mcp -- npx -y @acme/postgres-mcp`}</Code>
            <p>Prompt skills are written to <code className="font-mono">.claude/skills/&lt;name&gt;/SKILL.md</code> and picked up automatically.</p>
          </>
        ),
      },
      {
        q: "What do the security badges mean, and what should I avoid?",
        a: (
          <>
            <ul className="list-disc space-y-1 pl-5">
              <li><strong>Verified</strong> — clean automated scan <em>and</em> a human review; publisher identity confirmed.</li>
              <li><strong>Community</strong> — clean scan, not yet reviewed. Fine for local dev, read the manifest before giving it secrets.</li>
              <li><strong>Sandbox</strong> — the scanner found prompt-injection phrases, dangerous shell patterns, hard-coded secrets or exfiltration endpoints. Run only in an isolated environment; the gateway refuses to execute it.</li>
            </ul>
            <p className="mt-2">Regardless of badge: never paste real keys into a config — use <code className="font-mono">${"{VAR}"}</code> references; give a server the narrowest permission set; prefer stdio servers you can read the source of.</p>
          </>
        ),
      },
    ],
  },
  {
    id: "publish",
    title: "Publishing",
    items: [
      {
        q: "Step 1 — add a manifest to your repository",
        a: (
          <>
            <p>Synapth looks for, in order: <code className="font-mono">synapth.json</code>, <code className="font-mono">mcp-server.json</code>, <code className="font-mono">tool.json</code>, <code className="font-mono">SKILL.md</code>. The native format:</p>
            <Code>{`{
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
}`}</Code>
            <p>For a prompt-only skill a <code className="font-mono">SKILL.md</code> with frontmatter (<code className="font-mono">name</code>, <code className="font-mono">description</code>, <code className="font-mono">category</code>, <code className="font-mono">tags</code>) and the prompt as body is enough.</p>
          </>
        ),
      },
      {
        q: "Step 2 — import and scan",
        a: (
          <>
            <p>Sign in → Dashboard → paste the repository URL → <em>Preview</em>. Cortex fetches the manifest, maps it, and runs the sandbox scanner. Critical findings block publishing; high findings publish with a <strong>Sandbox</strong> badge.</p>
            <p className="mt-2">The same flow is available to scripts:</p>
            <Code>{`curl -X POST https://synapth.dev/api/v1/import/github \\
  -H 'Content-Type: application/json' -H 'X-Synapth-Key: syn_…' \\
  -d '{"url":"https://github.com/acme/postgres-mcp","dryRun":true}'`}</Code>
          </>
        ),
      },
      {
        q: "Step 3 — pricing and payouts",
        a: (
          <>
            <p>Tools with an <code className="font-mono">http</code> entrypoint can set <code className="font-mono">pricePerCall</code> (USD). Every execution through <code className="font-mono">/api/v1/skills/:id/execute</code> debits the caller&apos;s wallet, credits your wallet minus the platform fee, and is refunded automatically if your endpoint fails. Earnings and per-skill execution counts live on the dashboard.</p>
          </>
        ),
      },
      {
        q: "Step 4 — get Verified",
        a: <p>Verified is never granted by the scanner alone. Once the skill is published, request a review from the skill page; a moderator reads the manifest and confirms the publisher&apos;s GitHub identity. Verified skills are eligible for <em>Hidden Gems</em>.</p>,
      },
    ],
  },
  {
    id: "search",
    title: "Searching the catalogue",
    items: [
      {
        q: "How does search work, and what syntax can I use?",
        a: (
          <>
            <p>Cortex runs its own full-text engine over the catalogue (BM25F over name, tags, description, tools and README), with typo correction and prefix completion. Filters can be typed straight into the box:</p>
            <Code>{`category:MCP          MCP | Prompt | Tool
is:verified           Verified | Community | Sandbox
lang:python           repository language
author:anthropics     GitHub owner
tag:pdf               topic / tag
stars:>100            minimum GitHub stars
price:free            free | paid
"exact phrase"        must appear verbatim
-word                 exclude`}</Code>
            <p>The same engine backs <code className="font-mono">GET /api/v1/search?q=…</code> (facets, highlights, corrections) and <code className="font-mono">?suggest=1</code> for type-ahead.</p>
          </>
        ),
      },
      {
        q: "Where do the skills come from?",
        a: (
          <p>Most entries are imported by the Cortex crawler from GitHub: repositories found by topic (<code className="font-mono">claude-skills</code>, <code className="font-mono">agent-skills</code>, <code className="font-mono">mcp-server</code>), keyword search and code search for <code className="font-mono">SKILL.md</code>. Every manifest is scanned before it lands here; the badge tells you the result. Each skill page links to the exact file in the source repository.</p>
        ),
      },
    ],
  },
  {
    id: "agents",
    title: "For agents",
    items: [
      {
        q: "How does an agent use Synapth without a browser?",
        a: (
          <>
            <p>Add <code className="font-mono">X-Agent-Request: true</code> to any catalogue request. Instead of the web payload you get a minified context blob: merged system prompt, function-calling tool schemas, and an install hint per skill.</p>
            <Code>{`curl -s -H 'X-Agent-Request: true' \\
  'https://synapth.dev/api/v1/skills?q=postgres&limit=3'
# → {"v":1,"sys":"## Postgres MCP v1.4.2\\n…","tools":[{"type":"function","function":{…},"s":"skl_postgres"}],"skills":[…],"n":3}`}</Code>
            <p>The <code className="font-mono">tools</code> array is drop-in for OpenAI-style and Anthropic-style tool lists; <code className="font-mono">sys</code> is appended to the system prompt.</p>
          </>
        ),
      },
    ],
  },
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

export default function FaqPage() {
  return (
    <>
      {/* Docs engine strip. */}
      <div className="border-b border-border bg-surface-lowest/70">
        <div className="container flex h-10 items-center justify-between gap-4">
          <div className="label-mono-sm flex items-center gap-3">
            <span className="text-synapse">Docs engine</span>
            <span className="hidden text-foreground sm:inline">Runtime architecture & MCP {pkg.version}</span>
            <Badge variant="chip">Spec 1.0</Badge>
          </div>
          <div className="label-mono-sm flex items-center gap-4">
            <span className="hidden items-center gap-1.5 sm:flex">
              <span className="dot-live" /> Registry: online
            </span>
            <a href="https://github.com" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-foreground">
              <Github className="h-3.5 w-3.5" /> GitHub repo
            </a>
          </div>
        </div>
      </div>

      <div className="container grid gap-10 py-10 lg:grid-cols-[220px_minmax(0,1fr)_200px]">
        {/* Left: numbered navigation. */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Link href="/explore?focus=1" className="mb-6 flex h-9 items-center gap-2 rounded-md border border-border bg-surface-low px-3 text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground">
            <Search className="h-3.5 w-3.5" />
            <span className="font-mono text-xs">Filter topics…</span>
            <kbd className="label-mono-sm ml-auto rounded-md border border-border bg-surface-high px-1.5 normal-case">⌘K</kbd>
          </Link>
          <nav className="flex flex-col gap-6">
            {sections.map((s, i) => (
              <div key={s.id}>
                <a href={`#${s.id}`} className="label-mono-sm mb-2 block tracking-[0.2em] hover:text-foreground">
                  <span className="mr-2 text-synapse/70">{String(i + 1).padStart(2, "0")}</span>{"// "}{s.title}
                </a>
                <ul className="flex flex-col">
                  {s.items.map((it, j) => (
                    <li key={j}>
                      <a href={`#${s.id}-${slug(it.q)}`} className="flex items-center justify-between border-l border-border py-1.5 pl-3 text-[13px] text-muted-foreground transition-colors hover:border-synapse hover:text-foreground">
                        <span className="truncate">{it.q.replace(/\?$/, "")}</span>
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
            <p className="label-mono-sm mb-3 flex items-center gap-3 tracking-[0.2em]">
              <span>Docs</span>
              <span>Core architecture</span>
              <span className="text-synapse">The synapse protocol</span>
            </p>
            <div className="mb-3 flex flex-wrap gap-1.5">
              <Badge variant="synapse">MCP standard compatible</Badge>
              <Badge variant="chip">Scanner v1</Badge>
              <Badge variant="chip">Ledger: micro-USD</Badge>
            </div>
            <h1 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">The Synapth protocol &amp; registry</h1>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">MCP in two paragraphs, safe installation into your editor, the publishing manifest, search operators and the agent API — everything an operator or an autonomous agent needs to use the registry.</p>
            <p className="label-mono-sm mt-4 flex flex-wrap gap-x-4 gap-y-1">
              <span>Spec: manifest v1</span>
              <span>Compiled: {new Date().toISOString().slice(0, 10)}</span>
              <span>Audited by: sandbox scanner</span>
            </p>
          </header>

          {sections.map((s, i) => (
            <section key={s.id} id={s.id} className="mb-14 scroll-mt-24">
              <div className="mb-6 flex items-center justify-between gap-4">
                <h2 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
                  <span className="label-mono-sm text-synapse">{String(i + 1).padStart(2, "0")}</span>
                  {s.title}
                </h2>
                <span className="label-mono-sm hidden sm:inline">sec_{s.id}</span>
              </div>
              <div className="flex flex-col gap-4">
                {s.items.map((item, j) => (
                  <article key={j} id={`${s.id}-${slug(item.q)}`} className="scroll-mt-24 border border-border bg-card">
                    <h3 className="panel-head text-sm font-semibold tracking-tight text-foreground">
                      <span className="flex items-center gap-2.5">
                        <span className="h-2 w-2 shrink-0 bg-synapse" /> {item.q}
                      </span>
                    </h3>
                    <div className="p-5 text-sm leading-relaxed text-muted-foreground [&_strong]:text-foreground">{item.a}</div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* Right: on this page + actions. */}
        <aside className="hidden lg:sticky lg:top-24 lg:block lg:self-start">
          <p className="label-mono-sm mb-3 tracking-[0.2em]">On this page</p>
          <ul className="mb-8 flex flex-col">
            {sections.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className={`block border-l py-1.5 pl-3 text-xs transition-colors hover:text-foreground ${i === 0 ? "border-synapse text-foreground" : "border-border text-muted-foreground"}`}>
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
          <p className="label-mono-sm mb-3 tracking-[0.2em]">Actions</p>
          <ul className="mb-8 flex flex-col gap-2 text-xs">
            <li>
              <a href="https://github.com" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground">
                <Github className="h-3.5 w-3.5" /> Edit on GitHub
              </a>
            </li>
            <li>
              <Link href="/faq#agents" className="inline-flex h-8 w-full items-center gap-2 border border-border bg-surface px-3 text-foreground transition-colors hover:border-synapse/50">
                <Bot className="h-3.5 w-3.5 text-synapse" /> Agent API
              </Link>
            </li>
          </ul>
          <div className="well p-3">
            <p className="label-mono-sm mb-1">Release channel</p>
            <p className="font-mono text-xs text-foreground">v{pkg.version} · cortex/axon</p>
            <Link href="/explore" className="label-mono-sm mt-2 block text-synapse hover:underline">
              Browse registry ↗
            </Link>
          </div>
        </aside>
      </div>
    </>
  );
}
