"use client";

/**
 * AuthGate — the full-width split auth screen.
 *
 * Left half: fluted glass over a drifting light gradient (`AuthGlass`).
 * Right half: the credential form with a DEVELOPER / MACHINE TOKEN switcher,
 * OAuth row, entropy meter and the primary signal button.
 */

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { ArrowRight, AtSign, Check, Eye, EyeOff, Github, KeyRound, Loader2, ShieldCheck, X } from "lucide-react";
import { AuthGlass } from "@/components/auth-glass";
import { CopyButton } from "@/components/copy-button";
import { useI18n } from "@/axon/i18n";
import { cn } from "@/lib/utils";
import { safeCallbackPath } from "@/lib/url-safety";

export interface AuthGateProps {
  mode: "signin" | "signup";
  /** Which OAuth providers this node has credentials for. */
  providers: { github: boolean; google: boolean };
  /** Catalogue size for the "skills indexed" readout. */
  indexed: number;
}

const DEMO = { email: "demo@synapth.dev", password: "synapth-demo" };
/** `code` values of `RegistrationError` (cortex/registration.ts), each with an `auth.err.<code>` string. */
const REGISTRATION_CODES = ["email_taken", "handle_taken", "handle_reserved", "unavailable"] as const;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const CLI_AUTH = `curl -s ${APP_URL}/api/v1/account/me \\\n  -H 'X-Synapth-Key: syn_live_…'`;

const inputClass =
  "h-10 w-full rounded-lg border border-white/10 bg-black/40 px-3.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 transition-all focus:border-synapse focus:outline-none focus:ring-1 focus:ring-synapse/30";

/** Rough entropy in bits: length × log2(alphabet). Enough to drive a four-segment meter. */
function entropyBits(password: string): number {
  if (!password) return 0;
  let alphabet = 0;
  if (/[a-z]/.test(password)) alphabet += 26;
  if (/[A-Z]/.test(password)) alphabet += 26;
  if (/\d/.test(password)) alphabet += 10;
  if (/[^a-zA-Z0-9]/.test(password)) alphabet += 33;
  return Math.round(password.length * Math.log2(Math.max(alphabet, 2)));
}

function strengthTier(bits: number): 0 | 1 | 2 | 3 | 4 {
  if (bits === 0) return 0;
  if (bits < 28) return 1;
  if (bits < 40) return 2;
  if (bits < 64) return 3;
  return 4;
}

function Field({ id, label, side, children }: { id: string; label: string; side?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label htmlFor={id} className="label-mono-sm">
          {label}
        </label>
        {side}
      </div>
      <div className="relative">{children}</div>
    </div>
  );
}

export function AuthGate({ mode, providers, indexed }: AuthGateProps) {
  const router = useRouter();
  const params = useSearchParams();
  // Anyone can craft the query string, so the redirect target stays inside the app.
  const callbackUrl = safeCallbackPath(params.get("callbackUrl"));
  const { t, n } = useI18n();

  const [tab, setTab] = useState<"dev" | "machine">("dev");
  const [error, setError] = useState<string | null>(params.get("error") ? t("auth.err.signinFailed") : null);
  const [busy, setBusy] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [token, setToken] = useState("");
  const [tokenState, setTokenState] = useState<{
    status: "idle" | "checking" | "ok" | "bad";
    handle?: string;
  }>({ status: "idle" });

  const bits = useMemo(() => entropyBits(password), [password]);
  const tier = strengthTier(bits);

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
          body: JSON.stringify({
            name: form.get("name"),
            handle: form.get("handle"),
            email,
            password,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
            code?: (typeof REGISTRATION_CODES)[number];
            issues?: Array<{ message: string; path: (string | number)[] }>;
          };
          if (body.code && REGISTRATION_CODES.includes(body.code)) setError(t(`auth.err.${body.code}`));
          else if (res.status === 429) setError(t("auth.err.rateLimited"));
          else setError(body.issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") ?? body.error ?? t("auth.err.registration"));
          return;
        }
      }
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (result?.error) {
        setError(t("auth.err.invalid"));
        return;
      }
      router.push(callbackUrl);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function verifyToken() {
    if (!token.trim()) return;
    setTokenState({ status: "checking" });
    try {
      const res = await fetch("/api/v1/account/me", {
        headers: { "X-Synapth-Key": token.trim() },
      });
      if (!res.ok) {
        setTokenState({ status: "bad" });
        return;
      }
      const body = (await res.json()) as {
        handle: string | null;
        userId: string;
      };
      setTokenState({ status: "ok", handle: body.handle ?? body.userId });
    } catch {
      setTokenState({ status: "bad" });
    }
  }

  const oauth = (provider: "github" | "google", label: string, icon: ReactNode) => {
    const enabled = providers[provider];
    return (
      <button
        type="button"
        disabled={!enabled || busy}
        title={enabled ? undefined : t("auth.oauth.unavailable")}
        onClick={() => signIn(provider, { callbackUrl })}
        className="group flex items-center justify-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.02] px-4 py-2.5 text-xs font-medium text-foreground transition-all hover:border-white/20 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-white/10 disabled:hover:bg-white/[0.02]"
      >
        {icon}
        <span>{label}</span>
      </button>
    );
  };

  return (
    <div className="grid w-full flex-1 grid-cols-1 lg:grid-cols-2">
      {/* Left: fluted glass over the moving light field. */}
      <AuthGlass className="min-h-[220px] sm:min-h-[300px] lg:min-h-0" />

      {/* Right: form. */}
      <div className="flex flex-col justify-center bg-[#121212] px-6 py-10 sm:px-10 lg:px-16 xl:px-24">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-6 flex flex-col justify-between gap-4 border-b border-white/5 pb-6 sm:flex-row sm:items-center">
            <div>
              <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">{mode === "signup" ? t("auth.title.signup") : t("auth.title.signin")}</h1>
              <p className="mt-1 text-xs text-muted-foreground">{mode === "signup" ? t("auth.lead.signup") : t("auth.lead.signin")}</p>
            </div>
            <div role="tablist" className="flex items-center gap-1 self-start rounded-lg border border-white/10 bg-white/[0.03] p-1 font-mono text-[11px] uppercase tracking-[0.08em] sm:self-auto">
              {(["dev", "machine"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={tab === m}
                  onClick={() => setTab(m)}
                  className={cn("whitespace-nowrap rounded-md px-3 py-1.5 transition-all", tab === m ? "bg-synapse font-semibold text-synapse-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                >
                  {m === "dev" ? t("auth.mode.dev") : t("auth.mode.machine")}
                </button>
              ))}
            </div>
          </div>

          {tab === "dev" ? (
            <>
              <div className="mb-6 grid grid-cols-2 gap-3">
                {oauth("github", t("auth.oauth.github"), <Github className="h-4 w-4 text-foreground/80 transition-colors group-hover:text-foreground" />)}
                {oauth(
                  "google",
                  t("auth.oauth.google"),
                  <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z" fill="#EA4335" />
                    <path d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z" fill="#4285F4" />
                    <path d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12 0 14.5s.7 4.8 1.9 7.2l3.7-2.9z" fill="#FBBC05" />
                    <path d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2-6.4-4.8L1.9 16.4C3.7 20.1 7.5 23 12 23z" fill="#34A853" />
                  </svg>,
                )}
              </div>

              <div className="relative my-6 flex items-center justify-center">
                <div className="w-full border-t border-white/5" />
                <span className="label-mono-sm absolute rounded-full border border-white/10 bg-[#0b0d0a] px-3 tracking-[0.2em]">{t("auth.divider")}</span>
              </div>

              <form onSubmit={onSubmit} className="space-y-4">
                {mode === "signup" && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="name" label={t("auth.field.name")}>
                      <input id="name" name="name" required minLength={2} autoComplete="name" placeholder="Ada Lovelace" className={inputClass} />
                    </Field>
                    <Field id="handle" label={t("auth.field.handle")} side={<span className="label-mono-sm text-muted-foreground/70">{t("auth.hint.unique")}</span>}>
                      <span className="pointer-events-none absolute left-3 top-2.5 font-mono text-xs text-muted-foreground">@</span>
                      <input
                        id="handle"
                        name="handle"
                        required
                        minLength={3}
                        maxLength={32}
                        pattern="[a-z0-9]([a-z0-9\-]*[a-z0-9])?"
                        placeholder="ada"
                        autoComplete="username"
                        autoCapitalize="none"
                        spellCheck={false}
                        onChange={(e) => (e.currentTarget.value = e.currentTarget.value.toLowerCase())}
                        className={cn(inputClass, "pl-8")}
                      />
                    </Field>
                  </div>
                )}

                <Field id="email" label={t("auth.field.email")}>
                  <AtSign className="pointer-events-none absolute left-3 top-2.5 h-[18px] w-[18px] text-muted-foreground" />
                  <input id="email" name="email" type="email" required autoComplete="email" placeholder="name@organization.com" value={email} onChange={(e) => setEmail(e.target.value)} className={cn(inputClass, "pl-9")} />
                </Field>

                <Field
                  id="password"
                  label={t("auth.field.password")}
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
                        {t("auth.useDemo")}
                      </button>
                    ) : (
                      <span className={cn("label-mono-sm", tier >= 3 ? "text-synapse" : tier === 2 ? "text-warn" : "text-muted-foreground/70")}>{t(`auth.strength.${tier}`, { bits })}</span>
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
                  <button type="button" onClick={() => setShowPwd((s) => !s)} aria-label={showPwd ? t("auth.hidePwd") : t("auth.showPwd")} className="absolute right-3 top-2.5 text-muted-foreground transition-colors hover:text-foreground">
                    {showPwd ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                  </button>
                </Field>
                <div className="grid grid-cols-4 gap-1.5" aria-hidden="true">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className={cn("h-1 rounded-full transition-colors", i <= tier ? (tier <= 1 ? "bg-danger/80" : tier === 2 ? "bg-warn/80" : "bg-synapse") : "bg-white/10")} />
                  ))}
                </div>

                {error && (
                  <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 font-mono text-xs text-danger">
                    {error}
                  </p>
                )}

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={busy}
                    className="flex h-11 items-center justify-center gap-3 rounded-lg bg-synapse px-7 text-base font-semibold tracking-tight text-synapse-foreground shadow-[0_0_20px_rgba(198,255,51,0.25)] transition-all hover:shadow-[0_0_28px_rgba(198,255,51,0.45)] active:scale-[0.99] disabled:opacity-60"
                  >
                    <span>{busy ? t("auth.submitting") : mode === "signup" ? t("auth.submit.signup") : t("auth.submit.signin")}</span>
                    {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowRight className="h-5 w-5" />}
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="space-y-4">
              <p className="text-xs leading-relaxed text-muted-foreground">{t("auth.machine.lead")}</p>
              <Field id="token" label={t("auth.machine.label")}>
                <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-[18px] w-[18px] text-synapse" />
                <input
                  id="token"
                  value={token}
                  onChange={(e) => {
                    setToken(e.target.value);
                    setTokenState({ status: "idle" });
                  }}
                  onKeyDown={(e) => e.key === "Enter" && verifyToken()}
                  placeholder="syn_live_9f82ca918e…"
                  spellCheck={false}
                  autoComplete="off"
                  className={cn(inputClass, "pl-9 pr-24")}
                />
                <button
                  type="button"
                  onClick={verifyToken}
                  disabled={!token.trim() || tokenState.status === "checking"}
                  className="label-mono-sm absolute right-2 top-2 h-6 rounded-md border border-white/10 bg-white/[0.04] px-2 text-foreground transition-colors hover:border-synapse/50 disabled:opacity-40"
                >
                  {tokenState.status === "checking" ? <Loader2 className="h-3 w-3 animate-spin" /> : t("auth.machine.verify")}
                </button>
              </Field>
              {tokenState.status === "ok" && (
                <p className="flex items-center gap-2 rounded-lg border border-synapse/30 bg-synapse/10 px-3 py-2 font-mono text-xs text-synapse">
                  <Check className="h-3.5 w-3.5" /> {t("auth.machine.valid", { handle: tokenState.handle ?? "" })}
                </p>
              )}
              {tokenState.status === "bad" && (
                <p className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 font-mono text-xs text-danger">
                  <X className="h-3.5 w-3.5" /> {t("auth.machine.invalid")}
                </p>
              )}
              <div className="space-y-1.5 rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-xs text-muted-foreground">
                <div className="label-mono-sm flex items-center justify-between text-synapse">
                  <span className="text-synapse">{t("auth.machine.cli")}</span>
                  <CopyButton text={CLI_AUTH} />
                </div>
                <pre className="overflow-x-auto py-1 text-[11px] leading-relaxed text-foreground/80">{CLI_AUTH}</pre>
              </div>
              <p className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-synapse" />
                <span>
                  {t("auth.machine.issue")}{" "}
                  <Link href="/dashboard" className="text-foreground underline-offset-2 hover:text-synapse hover:underline">
                    {t("nav.console")} →
                  </Link>
                </span>
              </p>
            </div>
          )}

          <div className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-4 font-mono text-xs text-muted-foreground">
            <span>
              {mode === "signup" ? t("auth.haveAccount") : t("auth.noAccount")}{" "}
              <Link href={mode === "signup" ? "/signin" : "/signup"} className="ml-1 text-foreground transition-colors hover:text-synapse hover:underline">
                {mode === "signup" ? t("auth.signInLink") : t("auth.createOne")}
              </Link>
            </span>
            <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em]">
              <span className="dot-live" /> {n("auth.indexed", indexed, { n: indexed.toLocaleString("en") })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
