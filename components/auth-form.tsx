"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Bot, Eye, EyeOff, Github, Loader2, Terminal, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Brackets } from "@/components/corners";
import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";

interface Props {
  mode: "signin" | "signup";
}

const DEMO = { email: "demo@synapth.dev", password: "synapth-demo" };
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const PROVISION = `$ curl -s -H 'X-Agent-Request: true' \\\n    '${APP_URL}/api/v1/skills?q=postgres&limit=3'\n# → {"v":1,"sys":"…","tools":[…],"n":3}`;

/** Terminal-style field: `/ LABEL` above, `>` prompt inside. */
function Field({ id, label, side, children }: { id: string; label: string; side?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="label-mono-sm tracking-[0.2em]">
          / {label}
        </label>
        {side}
      </div>
      <div className="relative flex items-center">
        <span className="pointer-events-none absolute left-3 font-mono text-xs font-semibold text-synapse">&gt;</span>
        {children}
      </div>
    </div>
  );
}

const inputClass = "h-10 w-full rounded-md border border-border bg-muted pl-7 pr-3 font-mono text-[13px] text-foreground placeholder:text-muted-foreground/40 transition-colors focus:border-synapse/60 focus:outline-none focus:ring-1 focus:ring-synapse/25";

export function AuthForm({ mode }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") ?? "/dashboard";
  const [error, setError] = useState<string | null>(params.get("error") ? "Sign-in failed. Check your credentials." : null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"dev" | "github">("dev");
  const [showPwd, setShowPwd] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);

    try {
      if (mode === "signup") {
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: form.get("name"), handle: form.get("handle"), email, password }),
        });
        if (!res.ok) {
          const body = (await res.json()) as { error?: string; issues?: Array<{ message: string; path: (string | number)[] }> };
          setError(body.issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") ?? body.error ?? "Registration failed");
          return;
        }
      }
      const result = await signIn("credentials", { email, password, redirect: false });
      if (result?.error) {
        setError("Invalid email or password");
        return;
      }
      router.push(callbackUrl);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex flex-col gap-6 border border-border bg-card p-6 sm:p-8">
      <Brackets />

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="label-mono flex items-center gap-2 tracking-[0.2em] text-synapse">
            <span className="h-2.5 w-2.5 animate-pulse-dot bg-synapse shadow-glow" /> Synapth // Cortex core
          </span>
          <span className="label-mono-sm rounded-md border border-synapse/30 bg-synapse/10 px-2 py-0.5 text-synapse">{mode === "signup" ? "Register_v1" : "Auth_gate_v1"}</span>
        </div>
        <h1 className="mt-1 flex items-baseline gap-2 text-2xl font-semibold uppercase tracking-tight">
          {mode === "signup" ? "Register developer" : "Authenticate system"}
          <span className="inline-block h-5 w-2.5 animate-pulse-dot bg-synapse align-middle" />
        </h1>
        <p className="text-sm text-muted-foreground">
          {mode === "signup" ? "Create a developer identity to publish skills, hold a wallet and issue agent keys." : "Enter your developer credentials to open the console: wallet, ledger, crawler and publishing."}
        </p>
      </div>

      <div className="grid grid-cols-2 border-b border-border">
        <button type="button" onClick={() => setTab("dev")} className={cn("tab-line h-11 justify-center", tab === "dev" && "text-foreground after:bg-synapse")}>
          <Terminal className={cn("h-3.5 w-3.5", tab === "dev" && "text-synapse")} /> Developer login
        </button>
        <button type="button" onClick={() => setTab("github")} className={cn("tab-line h-11 justify-center", tab === "github" && "text-foreground after:bg-synapse")}>
          <Github className={cn("h-3.5 w-3.5", tab === "github" && "text-synapse")} /> GitHub identity
        </button>
      </div>

      {tab === "dev" ? (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {mode === "signup" && (
            <>
              <Field id="name" label="Display name">
                <input id="name" name="name" required minLength={2} autoComplete="name" placeholder="Ada Lovelace" className={inputClass} />
              </Field>
              <Field id="handle" label="Handle" side={<span className="label-mono-sm text-muted-foreground/70">Unique</span>}>
                <input id="handle" name="handle" required minLength={3} pattern="[a-z0-9-]+" placeholder="ada" autoComplete="username" className={inputClass} />
              </Field>
            </>
          )}
          <Field id="email" label="Identifier (email)" side={<span className="label-mono-sm text-muted-foreground/70">Secure_channel</span>}>
            <input id="email" name="email" type="email" required autoComplete="email" placeholder={DEMO.email} value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
          </Field>
          <Field
            id="password"
            label="Passphrase"
            side={
              mode === "signin" ? (
                <button
                  type="button"
                  className="label-mono-sm text-synapse hover:underline"
                  onClick={() => {
                    setEmail(DEMO.email);
                    setPassword(DEMO.password);
                  }}
                >
                  [Use demo credentials]
                </button>
              ) : (
                <span className="label-mono-sm text-muted-foreground/70">min 8 chars</span>
              )
            }
          >
            <input
              id="password"
              name="password"
              type={showPwd ? "text" : "password"}
              required
              minLength={8}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={cn(inputClass, "pr-10")}
            />
            <button type="button" onClick={() => setShowPwd((s) => !s)} aria-label={showPwd ? "Hide passphrase" : "Show passphrase"} className="absolute right-3 text-muted-foreground hover:text-foreground">
              {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </Field>

          {error && (
            <p role="alert" className="border border-danger/30 bg-danger/10 px-3 py-2 font-mono text-xs text-danger">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" className="mt-1 w-full text-sm font-semibold" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Zap />}
            {mode === "signup" ? "Create developer account" : "Sign in to Synapth"}
          </Button>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="well flex items-start gap-2.5 p-3">
            <Bot className="mt-0.5 h-4 w-4 shrink-0 text-synapse" />
            <div className="flex flex-col gap-1 font-mono text-[12px] leading-relaxed text-muted-foreground">
              <span>Sign in with your GitHub identity. Skills you publish are linked to your GitHub handle, so crawled repositories resolve to your profile.</span>
              <span className="w-fit rounded-md border border-border bg-surface px-1.5 py-0.5 text-foreground">scope: read:user user:email</span>
            </div>
          </div>
          <Button type="button" size="lg" className="w-full text-sm font-semibold" onClick={() => signIn("github", { callbackUrl })}>
            <Github /> Continue with GitHub
          </Button>
        </div>
      )}

      <div className="well relative flex flex-col gap-2 p-3">
        <div className="label-mono-sm flex items-center justify-between border-b border-border/80 pb-1.5">
          <span className="flex items-center gap-1.5 tracking-[0.2em]">
            <span className="dot-live" /> Quick terminal provision
          </span>
          <CopyButton text={PROVISION} label="Copy" />
        </div>
        <pre className="overflow-x-auto whitespace-pre font-mono text-[12px] leading-relaxed text-foreground">{PROVISION}</pre>
        <p className="label-mono-sm normal-case tracking-normal">Agents do not need an account to read the registry — only paid executions require a key from the console.</p>
      </div>

      <div className="label-mono-sm flex flex-wrap items-center justify-between gap-y-2 border-t border-border pt-3 tracking-[0.1em]">
        {mode === "signup" ? (
          <Link href="/signin" className="transition-colors hover:text-synapse">/ Already registered · Sign in</Link>
        ) : (
          <Link href="/signup" className="transition-colors hover:text-synapse">/ Create developer account</Link>
        )}
        <span className="text-border">·</span>
        <Link href="/faq#agents" className="transition-colors hover:text-synapse">/ Agent API</Link>
        <span className="text-border">·</span>
        <Link href="/faq#install" className="transition-colors hover:text-synapse">/ Security spec</Link>
      </div>
    </div>
  );
}
