"use client";

/**
 * API keys: issue (scopes, expiry, policy), show the secret once with ready
 * connect commands for synapth-mcp, revoke. Server actions live in
 * app/(site)/dashboard/developer/actions.ts.
 */

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2, Plus, ShieldOff, X } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { useToast } from "@/axon/toast";
import { connectSnippets, type InstallTarget } from "@/axon/install";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CopyButton } from "@/components/copy-button";
import { createApiKey, revokeApiKeyAction, type CreateKeyInput } from "@/app/(site)/dashboard/developer/actions";
import { API_KEY_SCOPES, API_KEY_TTL_CHOICES, API_KEY_TTL_DAYS, POLICY_PERMISSIONS, keyStatus, type ApiKeyInfo, type ApiKeyScope, type PolicyPermission } from "@/types/api-keys";
import { SKILL_CATEGORIES, type SkillCategory } from "@/types/skill";
import { cn, timeAgo } from "@/lib/utils";

const TRUST_CHOICES = ["Sandbox", "Community", "Verified", "Gov"] as const;
const CONNECT_TARGETS: InstallTarget[] = ["claude-code", "cursor", "claude-desktop", "curl"];

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function ApiKeysPanel({ keys, maxKeys, baseUrl }: { keys: ApiKeyInfo[]; maxKeys: number; baseUrl: string }) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const { toast } = useToast();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState<{ key: string; info: ApiKeyInfo } | null>(null);
  const [target, setTarget] = useState<InstallTarget>("claude-code");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [label, setLabel] = useState("");
  const [scopes, setScopes] = useState<ApiKeyScope[]>(["catalog:read", "skills:fetch"]);
  const [ttlDays, setTtlDays] = useState<number>(API_KEY_TTL_DAYS);
  const [minTrust, setMinTrust] = useState<CreateKeyInput["minTrust"]>("Community");
  const [denied, setDenied] = useState<PolicyPermission[]>([]);
  const [categories, setCategories] = useState<SkillCategory[]>([...SKILL_CATEGORIES]);
  const [perCall, setPerCall] = useState("");
  const [daily, setDaily] = useState("");

  const active = keys.filter((k) => keyStatus(k) === "active");
  const atLimit = active.length >= maxKeys;

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const cap = (v: string) => (v.trim() === "" ? null : Number(v));
    startTransition(async () => {
      const res = await createApiKey({ label, scopes, ttlDays, minTrust, deniedPermissions: denied, categories, maxPerCallUsd: cap(perCall), maxDailyUsd: cap(daily) });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setIssued({ key: res.key, info: res.info });
      setCreating(false);
      setLabel("");
      router.refresh();
    });
  }

  function revoke(key: ApiKeyInfo) {
    if (!window.confirm(t("keys.revokeConfirm", { label: key.label }))) return;
    startTransition(async () => {
      const res = await revokeApiKeyAction(key.id);
      toast({ tone: res.ok ? "success" : "danger", title: res.ok ? t("keys.revoked", { label: key.label }) : t("keys.revokeFailed") });
      router.refresh();
    });
  }

  const snippets = issued ? connectSnippets(issued.key, baseUrl) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <span className="label-mono-sm">{t("keys.count", { n: active.length, max: maxKeys })}</span>
        {!creating && (
          <Button size="sm" variant="mono" onClick={() => setCreating(true)} disabled={atLimit}>
            <Plus className="h-3.5 w-3.5" /> {t("keys.new")}
          </Button>
        )}
      </div>
      {atLimit && !creating && <p className="text-xs text-muted-foreground">{t("keys.limit")}</p>}

      {issued && snippets && (
        <div className="space-y-3 rounded-lg border border-synapse/40 bg-synapse/5 p-3.5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[13px] font-medium">{t("keys.issued", { label: issued.info.label })}</p>
            <button type="button" onClick={() => setIssued(null)} aria-label={t("keys.hide")} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-xs text-warn">{t("keys.once")}</p>
          <div className="flex items-center gap-2 rounded border border-border bg-background px-2 py-1.5">
            <code className="min-w-0 flex-1 truncate font-mono text-[11px]">{issued.key}</code>
            <CopyButton text={issued.key} compact />
          </div>
          <p className="label-mono-sm">{t("keys.connect")}</p>
          <div className="flex flex-wrap gap-1">
            {CONNECT_TARGETS.map((id) => (
              <button key={id} type="button" onClick={() => setTarget(id)} className={cn("rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wider", target === id ? "border-synapse/40 bg-synapse/10 text-synapse" : "border-border text-muted-foreground hover:text-foreground")}>
                {t(`keys.target.${id}`)}
              </button>
            ))}
          </div>
          <div className="relative">
            <pre className="max-h-48 overflow-auto rounded border border-border bg-background p-2.5 pr-10 font-mono text-[10.5px] leading-relaxed">{snippets[target].code}</pre>
            <CopyButton text={snippets[target].code} compact className="absolute right-1.5 top-1.5" />
          </div>
        </div>
      )}

      {creating && (
        <form onSubmit={submit} className="space-y-3 rounded-lg border border-border bg-muted p-3.5">
          <div className="space-y-1.5">
            <Label htmlFor="key-label">{t("keys.label")}</Label>
            <Input id="key-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="claude-code · laptop" maxLength={60} required />
          </div>

          <fieldset className="space-y-1.5">
            <legend className="label-mono-sm mb-1">{t("keys.scopes")}</legend>
            {API_KEY_SCOPES.map((s) => (
              <label key={s} className="flex items-start gap-2 text-xs">
                <input type="checkbox" checked={scopes.includes(s)} onChange={() => setScopes((cur) => toggle(cur, s))} className="mt-0.5 accent-[hsl(var(--synapse))]" />
                <span>
                  <code className="font-mono text-[11px]">{s}</code> <span className="text-muted-foreground">— {t(`keys.scope.${s}`)}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="key-ttl">{t("keys.ttl")}</Label>
              <select id="key-ttl" value={ttlDays} onChange={(e) => setTtlDays(Number(e.target.value))} className="h-9 w-full rounded-md border border-border bg-background px-2 text-xs">
                {API_KEY_TTL_CHOICES.map((d) => (
                  <option key={d} value={d}>
                    {t("keys.days", { n: d })}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="key-trust">{t("keys.minTrust")}</Label>
              <select id="key-trust" value={minTrust} onChange={(e) => setMinTrust(e.target.value as CreateKeyInput["minTrust"])} className="h-9 w-full rounded-md border border-border bg-background px-2 text-xs">
                {TRUST_CHOICES.map((l) => (
                  <option key={l} value={l}>
                    {t(`level.${l}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <fieldset>
            <legend className="label-mono-sm mb-1">{t("keys.deny")}</legend>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {POLICY_PERMISSIONS.map((p) => (
                <label key={p} className="flex items-center gap-1.5 font-mono text-[11px]">
                  <input type="checkbox" checked={denied.includes(p)} onChange={() => setDenied((cur) => toggle(cur, p))} className="accent-[hsl(var(--danger))]" />
                  {p}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="label-mono-sm mb-1">{t("keys.categories")}</legend>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {SKILL_CATEGORIES.map((c) => (
                <label key={c} className="flex items-center gap-1.5 font-mono text-[11px]">
                  <input type="checkbox" checked={categories.includes(c)} onChange={() => setCategories((cur) => toggle(cur, c))} />
                  {c}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="key-percall">{t("keys.perCall")}</Label>
              <Input id="key-percall" type="number" min="0" step="0.0001" inputMode="decimal" value={perCall} onChange={(e) => setPerCall(e.target.value)} placeholder={t("keys.noCap")} className="font-mono text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="key-daily">{t("keys.daily")}</Label>
              <Input id="key-daily" type="number" min="0" step="0.01" inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} placeholder={t("keys.noCap")} className="font-mono text-xs" />
            </div>
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>
              {t("keys.cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={pending || !scopes.length || !categories.length}>
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />} {t("keys.create")}
            </Button>
          </div>
        </form>
      )}

      <ul className="flex flex-col gap-2">
        {keys.length === 0 && <li className="text-xs text-muted-foreground">{t("keys.empty")}</li>}
        {keys.map((k) => {
          const status = keyStatus(k);
          return (
            <li key={k.id} className={cn("space-y-1.5 rounded-lg border border-border bg-muted p-3", status !== "active" && "opacity-60")}>
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-[13px] font-medium">{k.label}</span>
                <Badge variant={status === "active" ? "synapse" : status === "expired" ? "sandbox" : "danger"}>{t(`keys.status.${status}`)}</Badge>
              </div>
              <p className="font-mono text-[11px] text-synapse">{k.prefix}••••</p>
              <p className="flex flex-wrap gap-1">
                {k.scopes.map((s) => (
                  <span key={s} className="rounded bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {s}
                  </span>
                ))}
              </p>
              <div className="label-mono-sm flex flex-wrap items-center justify-between gap-2 border-t border-border pt-1.5 normal-case tracking-normal">
                <span>
                  {k.lastUsedAt ? t("keys.lastUsed", { when: timeAgo(k.lastUsedAt, i18n) }) : t("keys.neverUsed")}
                  {k.expiresAt && <> · {t("keys.expires", { date: new Date(k.expiresAt).toLocaleDateString(locale) })}</>}
                  {k.policy.minTrust && <> · ≥ {t(`level.${k.policy.minTrust}`)}</>}
                  {k.policy.deniedPermissions?.length ? <> · −{k.policy.deniedPermissions.join(", −")}</> : null}
                </span>
                {status === "active" && (
                  <Button size="sm" variant="destructive" className="h-7 px-2 text-[11px]" onClick={() => revoke(k)} disabled={pending}>
                    <ShieldOff className="h-3.5 w-3.5" /> {t("keys.revoke")}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
