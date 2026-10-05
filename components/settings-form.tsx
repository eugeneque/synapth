"use client";

/**
 * SettingsForm — the account hub.
 *
 * A profile header (banner, avatar, counters), "what do you want to do?"
 * shortcuts and five tabs: Profile · CLI & keys · Install client ·
 * Verification · Account. Tabs are addressable by hash (`#cli`, `#identity`…,
 * the old section anchors still work) and every panel stays mounted, so a
 * half-edited profile survives a trip to another tab. The sticky save bar
 * only appears when something differs from the persisted profile. Images are
 * prepared client-side (`axon/image.ts`) and travel inside the same server
 * action as the text fields.
 */

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, BadgeCheck, Briefcase, Check, ChevronDown, Eye, Globe, KeyRound, LogOut, MapPin, MonitorSmartphone, Pencil, Save, ShieldCheck, Terminal, Undo2, UserRound } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { useToast } from "@/axon/toast";
import { INSTALL_TARGETS, TARGET_COOKIE, type InstallTarget } from "@/axon/install";
import { saveProfile } from "@/app/(site)/dashboard/settings/actions";
import type { AccountProfile, ProfileUpdate } from "@/cortex/account";
import type { ImageError } from "@/axon/image";
import { OCCUPATIONS } from "@/types/profile";
import { AvatarPicker, CoverPicker } from "@/components/image-picker";
import { SignOutButton } from "@/components/sign-out-button";
import { VerifiedMark } from "@/components/verified-mark";
import { Button } from "@/components/ui/button";
import { safeImageSrc } from "@/lib/url-safety";
import { DitherAvatar } from "@/components/dither-kit/avatar";
import { PALETTE } from "@/components/dither-kit/palette";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { UiKey } from "@/lib/i18n";
import { Spinner } from "@/components/ui/spinner";

interface Props {
  profile: AccountProfile;
  catalogue: { published: number; verified: number };
  /** The verification section body (`VerificationPanel`), rendered by the page with its server state. */
  verification: React.ReactNode;
  verified: boolean;
  /** The Synapth CLI section body (`CliPanel`) and its badge: linked machines / plan cap. */
  cli: React.ReactNode;
  cliBadge: string;
  machines: number;
  apiKeys: { active: number; max: number };
}

type TabId = "profile" | "access" | "env" | "verification" | "account";

const TABS: Array<{ id: TabId; key: UiKey; icon: typeof UserRound }> = [
  { id: "profile", key: "settings.tab.profile", icon: UserRound },
  { id: "access", key: "settings.tab.access", icon: KeyRound },
  { id: "env", key: "settings.tab.env", icon: MonitorSmartphone },
  { id: "verification", key: "settings.tab.verification", icon: BadgeCheck },
  { id: "account", key: "settings.tab.account", icon: ShieldCheck },
];

/** Hash → tab; keeps the pre-redesign section anchors (`#cli`, `#identity`, …) working. */
const HASH_TAB: Record<string, TabId> = { profile: "profile", identity: "profile", access: "access", cli: "access", keys: "access", env: "env", environments: "env", verification: "verification", account: "account", session: "account" };

const fieldClass = "h-9 w-full rounded-lg border border-border bg-muted px-3 font-mono text-[13px] text-foreground placeholder:text-muted-foreground/50 transition-colors focus:border-synapse/60 focus:outline-none focus:ring-1 focus:ring-synapse/25";

const IDENTITY_KEYS = ["name", "handle", "image", "coverImage", "occupation", "bio", "organization", "location", "website"] as const satisfies readonly (keyof ProfileUpdate)[];

function toUpdate(p: AccountProfile): ProfileUpdate {
  return { name: p.name, handle: p.handle, image: p.image, coverImage: p.coverImage, occupation: p.occupation, bio: p.bio, organization: p.organization, location: p.location, website: p.website, defaultTarget: p.defaultTarget };
}

/** Mirrors the server-side preference into a cookie so `defaultTarget()` can read it on the client. */
function writeTargetCookie(target: InstallTarget | null) {
  const secure = location.protocol === "https:" ? "; secure" : "";
  document.cookie = target ? `${TARGET_COOKIE}=${target}; path=/; max-age=31536000; samesite=lax${secure}` : `${TARGET_COOKIE}=; path=/; max-age=0`;
}

export function SettingsForm({ profile, catalogue, verification, verified, cli, cliBadge, machines, apiKeys }: Props) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [saved, setSaved] = useState<ProfileUpdate>(() => toUpdate(profile));
  const [draft, setDraft] = useState<ProfileUpdate>(() => toUpdate(profile));
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [flash, setFlash] = useState(false);
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<TabId>("profile");

  // Follow the URL hash: deep links (`#cli`) and the browser's back button.
  useEffect(() => {
    const sync = () => {
      const next = HASH_TAB[location.hash.slice(1)];
      if (next) setTab(next);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const go = useCallback((id: TabId) => {
    setTab(id);
    history.replaceState(null, "", `#${id}`);
    document.getElementById("settings-tabs")?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  const dirtySections = useMemo(() => {
    const out: string[] = [];
    if (IDENTITY_KEYS.some((k) => draft[k] !== saved[k])) out.push(t("settings.sec.identity"));
    if (draft.defaultTarget !== saved.defaultTarget) out.push(t("settings.sec.environments"));
    return out;
  }, [draft, saved, t]);
  const dirty = dirtySections.length > 0;

  const set = <K extends keyof ProfileUpdate>(key: K, value: ProfileUpdate[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setError(null);
  };
  const imageError = (field: "image" | "coverImage") => (code: ImageError["code"]) => setError({ message: t(`settings.image.error.${code}`), field });

  function save() {
    startTransition(async () => {
      const res = await saveProfile(draft);
      if (!res.ok) {
        setError({ message: res.error, field: res.field });
        return;
      }
      const next = toUpdate(res.profile);
      setSaved(next);
      setDraft(next);
      writeTargetCookie(next.defaultTarget);
      toast({ tone: "success", title: t("settings.toast.saved"), tag: "LIVE", body: t("settings.toast.savedBody"), action: { label: t("settings.viewProfile"), href: `/u/${next.handle}` } });
      setFlash(true);
      setTimeout(() => setFlash(false), 2000);
    });
  }


  const dirtyTabs = new Set<TabId>();
  if (IDENTITY_KEYS.some((k) => draft[k] !== saved[k])) dirtyTabs.add("profile");
  if (draft.defaultTarget !== saved.defaultTarget) dirtyTabs.add("env");
  const cover = safeImageSrc(saved.coverImage);
  const avatar = safeImageSrc(saved.image);

  const shortcuts: Array<{ key: string; icon: typeof UserRound; title: string; body: string; onClick?: () => void; href?: string }> = [
    { key: "profile", icon: Pencil, title: t("settings.go.profile.t"), body: t("settings.go.profile.d"), onClick: () => go("profile") },
    { key: "cli", icon: Terminal, title: t("settings.go.cli.t"), body: t("settings.go.cli.d"), onClick: () => go("access") },
    { key: "api", icon: KeyRound, title: t("settings.go.api.t"), body: t("settings.go.api.d"), href: "/dashboard/developer#keys" },
    { key: "verify", icon: BadgeCheck, title: t("settings.go.verify.t"), body: t("settings.go.verify.d"), onClick: () => go("verification") },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Profile header: who you are right now + the counters that matter. */}
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="relative h-24 bg-surface-lowest sm:h-32">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full bg-[radial-gradient(circle_at_20%_20%,hsl(var(--synapse)/0.16),transparent_60%)]" />
          )}
        </div>
        <div className="flex flex-col gap-4 px-5 pb-5 sm:flex-row sm:items-end">
          <span className="relative -mt-10 flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-card bg-surface-lowest sm:-mt-12 sm:h-24 sm:w-24">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} alt="" className="h-full w-full object-cover" />
            ) : (
              <DitherAvatar name={saved.handle} fill={PALETTE.moss.line} animate={false} className="h-[78%] w-[78%]" />
            )}
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <h2 className="flex flex-wrap items-center gap-2 font-display text-xl font-medium tracking-tight sm:text-2xl">
              <span className="truncate">{saved.name}</span>
              {verified && <VerifiedMark />}
              <Badge variant={profile.role === "user" ? "chip" : "synapse"}>{t(`settings.role.${profile.role}`)}</Badge>
            </h2>
            <p className="truncate font-mono text-xs text-muted-foreground">@{saved.handle}{profile.email ? ` · ${profile.email}` : ""}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="mono" size="sm" className="h-9" onClick={() => go("profile")}>
              <Pencil className="text-synapse" /> {t("settings.hero.edit")}
            </Button>
            <Button asChild variant="mono" size="sm" className="h-9">
              <Link href={`/u/${saved.handle}`}>
                <Eye className="text-synapse" /> {t("settings.viewProfile")}
              </Link>
            </Button>
          </div>
        </div>
        <dl className="grid grid-cols-2 divide-x divide-y divide-border border-t border-border sm:grid-cols-4 sm:divide-y-0">
          {[
            { k: t("settings.hero.skills"), v: catalogue.published },
            { k: t("settings.hero.verifiedCount"), v: catalogue.verified },
            { k: t("settings.hero.keys"), v: apiKeys.active },
            { k: t("settings.hero.machines"), v: machines },
          ].map((x) => (
            <div key={x.k} className="px-4 py-3">
              <dt className="label-mono-sm">{x.k}</dt>
              <dd className="mt-0.5 font-mono text-lg text-foreground">{String(x.v).padStart(2, "0")}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Shortcuts: answer "where do I…?" before the user has to look. */}
      <section aria-label={t("settings.go.title")} className="space-y-2.5">
        <p className="label-mono-sm tracking-[0.2em]">{t("settings.go.title")}</p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {shortcuts.map((c) => {
            const Icon = c.icon;
            const body = (
              <>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-synapse transition-colors group-hover:border-synapse/40">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold tracking-tight">{c.title}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{c.body}</span>
                </span>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-synapse" />
              </>
            );
            const cls = "group flex w-full items-start gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-synapse/40 hover:bg-surface-low";
            return c.href ? (
              <Link key={c.key} href={c.href} className={cls}>
                {body}
              </Link>
            ) : (
              <button key={c.key} type="button" onClick={c.onClick} className={cls}>
                {body}
              </button>
            );
          })}
        </div>
      </section>

      {/* Tabs. */}
      <div id="settings-tabs" className="scroll-mt-20 border-b border-border">
        <div role="tablist" aria-label={t("settings.tabs.label")} className="-mb-px flex gap-1 overflow-x-auto">
          {TABS.map((x) => {
            const Icon = x.icon;
            const active = tab === x.id;
            return (
              <button
                key={x.id}
                type="button"
                role="tab"
                id={`tab-${x.id}`}
                aria-selected={active}
                aria-controls={`panel-${x.id}`}
                onClick={() => go(x.id)}
                className={cn("relative flex h-11 shrink-0 items-center gap-2 border-b-2 px-4 font-mono text-[12px] transition-colors", active ? "border-synapse text-synapse" : "border-transparent text-muted-foreground hover:text-foreground")}
              >
                <Icon className="h-4 w-4" />
                {t(x.key)}
                {dirtyTabs.has(x.id) && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-warn" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-w-0 pb-24">
        {/* Profile. */}
        <div role="tabpanel" id="panel-profile" aria-labelledby="tab-profile" className={cn(tab === "profile" ? "flex" : "hidden", "flex-col gap-6")}>
          <p className="text-sm text-muted-foreground">{t("settings.profile.lead")}</p>

          <Group title={t("settings.profile.visual")}>
            <div>
              <div className="label-mono-sm mb-2 flex items-center justify-between">
                <span>{t("settings.identity.cover")}</span>
                <span>{t("settings.identity.coverHint")}</span>
              </div>
              <CoverPicker value={draft.coverImage} onChange={(v) => set("coverImage", v)} onError={imageError("coverImage")} fallbackLabel={t("settings.identity.coverLabel", { handle: draft.handle || profile.handle })} />
              {error?.field === "coverImage" && <p className="label-mono-sm mt-1.5 normal-case tracking-normal text-danger">{error.message}</p>}
            </div>
            <div>
              <p className="label-mono-sm mb-2">{t("settings.identity.avatar")}</p>
              <AvatarPicker value={draft.image} onChange={(v) => set("image", v)} onError={imageError("image")} seed={profile.handle} />
              <p className={cn("label-mono-sm mt-2 normal-case tracking-normal", error?.field === "image" && "text-danger")}>
                {error?.field === "image" ? error.message : draft.image ? (draft.image.startsWith("data:") ? t("settings.identity.avatarUploaded") : t("settings.identity.avatarOauth")) : t("settings.identity.avatarHint")}
              </p>
            </div>
          </Group>

          <Group title={t("settings.profile.about")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("settings.field.name")} hint={t("settings.hint.required")} error={error?.field === "name" ? error.message : undefined}>
                <input value={draft.name} onChange={(e) => set("name", e.target.value)} required minLength={2} maxLength={64} className={fieldClass} />
              </Field>
              <Field label={t("settings.field.handle")} hint={t("settings.hint.unique")} error={error?.field === "handle" ? error.message : undefined}>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-2 font-mono text-[13px] text-muted-foreground">@</span>
                  <input value={draft.handle} onChange={(e) => set("handle", e.target.value.toLowerCase())} required pattern="[a-z0-9-]+" minLength={3} maxLength={32} className={cn(fieldClass, "pl-7")} />
                </div>
              </Field>
              <Field className="sm:col-span-2" label={t("settings.field.bio")} hint={`${draft.bio.length} / 280`} error={error?.field === "bio" ? error.message : undefined}>
                <textarea value={draft.bio} onChange={(e) => set("bio", e.target.value.slice(0, 280))} rows={3} maxLength={280} placeholder={t("settings.field.bioPlaceholder")} className={cn(fieldClass, "h-auto resize-none py-2 leading-relaxed")} />
              </Field>
            </div>
          </Group>

          <Group title={t("settings.profile.links")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field className="sm:col-span-2" label={t("settings.field.occupation")} hint={t("settings.hint.occupationBadge")} error={error?.field === "occupation" ? error.message : undefined}>
                <div className="relative">
                  <Briefcase className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <select value={draft.occupation ?? ""} onChange={(e) => set("occupation", e.target.value ? (e.target.value as ProfileUpdate["occupation"]) : null)} className={cn(fieldClass, "appearance-none pl-9 pr-9")}>
                    <option value="">{t("settings.field.occupationNone")}</option>
                    {OCCUPATIONS.map((o) => (
                      <option key={o} value={o}>
                        {t(`occupation.${o}`)}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
                </div>
                <span className="label-mono-sm mt-1.5 block normal-case tracking-normal">{t("settings.field.occupationHint")}</span>
              </Field>
              <Field label={t("settings.field.organization")} hint={t("settings.hint.optional")}>
                <input value={draft.organization} onChange={(e) => set("organization", e.target.value)} maxLength={80} placeholder="Acme Labs" className={fieldClass} />
              </Field>
              <Field label={t("settings.field.location")} hint={t("settings.hint.location")}>
                <div className="relative">
                  <MapPin className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <input value={draft.location} onChange={(e) => set("location", e.target.value)} maxLength={80} placeholder={t("settings.field.locationPlaceholder")} className={cn(fieldClass, "pl-9")} />
                </div>
              </Field>
              <Field className="sm:col-span-2" label={t("settings.field.website")} hint={t("settings.hint.optional")} error={error?.field === "website" ? error.message : undefined}>
                <div className="relative">
                  <Globe className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <input value={draft.website} onChange={(e) => set("website", e.target.value)} type="url" placeholder="https://" maxLength={200} className={cn(fieldClass, "pl-9")} />
                </div>
              </Field>
            </div>
          </Group>
        </div>

        {/* CLI & keys. */}
        <div role="tabpanel" id="panel-access" aria-labelledby="tab-access" className={cn(tab === "access" ? "flex" : "hidden", "flex-col gap-6")}>
          <section aria-label={t("settings.keys.title")} className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold tracking-tight">{t("settings.keys.title")}</h2>
              <p className="text-sm text-muted-foreground">{t("settings.keys.lead")}</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-2 rounded-xl border border-synapse/40 bg-synapse/5 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-semibold"><Terminal className="h-4 w-4 text-synapse" /> {t("settings.keys.cli.t")}</span>
                  <Badge variant="synapse">{t("settings.keys.cli.here")}</Badge>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{t("settings.keys.cli.d")}</p>
                <Badge variant="chip" className="self-start">{cliBadge}</Badge>
              </div>
              <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
                <span className="flex items-center gap-2 text-sm font-semibold"><KeyRound className="h-4 w-4 text-synapse" /> {t("settings.keys.api.t")}</span>
                <p className="text-xs leading-relaxed text-muted-foreground">{t("settings.keys.api.d")}</p>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
                  <Badge variant="chip">{t("settings.keys.api.count", { n: apiKeys.active, max: apiKeys.max })}</Badge>
                  <Link href="/dashboard/developer#keys" className="label-mono-sm inline-flex items-center gap-1 text-synapse hover:underline">
                    {t("settings.keys.api.manage")} <ArrowUpRight className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            </div>
          </section>
          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <header className="panel-head">
              <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
                <Terminal className="h-4 w-4 text-synapse" /> {t("cli.title")}
              </h2>
              <Badge variant="chip">{cliBadge}</Badge>
            </header>
            <div className="p-5">{cli}</div>
          </section>
        </div>

        {/* Install client. */}
        <div role="tabpanel" id="panel-env" aria-labelledby="tab-env" className={cn(tab === "env" ? "flex" : "hidden", "flex-col gap-4")}>
          <p className="text-sm text-muted-foreground">{t("settings.env.lead2")}</p>
          <div role="radiogroup" aria-label={t("settings.env.title")} className="grid gap-3">
            <EnvRow
              active={draft.defaultTarget === null}
              onSelect={() => set("defaultTarget", null)}
              icon={<Terminal className="h-4 w-4" />}
              title={t("settings.env.autoTitle")}
              meta={t("settings.env.autoMeta")}
              badge={draft.defaultTarget === null ? t("settings.env.default") : t("settings.env.use")}
            />
            {INSTALL_TARGETS.map((target) => (
              <EnvRow
                key={target.id}
                active={draft.defaultTarget === target.id}
                onSelect={() => set("defaultTarget", target.id)}
                icon={<MonitorSmartphone className="h-4 w-4" />}
                title={t(`install.target.${target.id}`)}
                meta={target.file}
                badge={draft.defaultTarget === target.id ? t("settings.env.default") : t("settings.env.use")}
              />
            ))}
          </div>
        </div>

        {/* Verification. */}
        <div role="tabpanel" id="panel-verification" aria-labelledby="tab-verification" className={tab === "verification" ? undefined : "hidden"}>
          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <header className="panel-head">
              <h2 className="text-sm font-semibold tracking-tight">{t("verify.title")}</h2>
              <Badge variant={verified ? "synapse" : "chip"}>{t(verified ? "verify.badge.on" : "verify.badge.off")}</Badge>
            </header>
            <div className="p-5">{verification}</div>
          </section>
        </div>

        {/* Account. */}
        <div role="tabpanel" id="panel-account" aria-labelledby="tab-account" className={cn(tab === "account" ? "flex" : "hidden", "flex-col gap-4")}>
          <p className="text-sm text-muted-foreground">{t("settings.account.lead")}</p>
          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <header className="panel-head">
              <h2 className="text-sm font-semibold tracking-tight">{t("settings.session.title")}</h2>
              <Badge variant="synapse">
                <span className="dot-live" /> {t("settings.session.active")}
              </Badge>
            </header>
            <div className="grid gap-4 p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
              <dl className="grid gap-x-6 gap-y-2 font-mono text-xs sm:grid-cols-2">
                <Row k={t("settings.session.email")} v={profile.email ?? "—"} />
                <Row k={t("settings.session.id")} v={profile.id} />
                <Row k={t("settings.session.strategy")} v="jwt · 30d" />
                <Row k={t("settings.session.keys")} v={t("settings.session.keysValue")} link="/dashboard/developer#keys" />
              </dl>
              <SignOutButton label={t("settings.session.signOut")} className="inline-flex h-9 items-center gap-2 rounded-lg border border-danger/30 px-4 font-mono text-[11px] uppercase tracking-[0.14em] text-danger transition-colors hover:bg-danger/10 disabled:opacity-60">
                <LogOut className="h-4 w-4" /> {t("settings.session.signOut")}
              </SignOutButton>
            </div>
          </section>
        </div>
      </div>

      {/* Sticky save bar. */}
      <div className={cn("pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-4 transition-all duration-200 ", dirty || flash ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0")} aria-hidden={!(dirty || flash)}>
        <div className="pointer-events-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/95 px-4 py-3 shadow-2xl backdrop-blur-md">
          <p className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
            {flash ? (
              <>
                <Check className="h-4 w-4 text-synapse" /> <span className="text-synapse">{t("settings.bar.saved")}</span>
              </>
            ) : error ? (
              <>
                <AlertTriangle className="h-4 w-4 text-danger" /> <span className="text-danger">{error.message}</span>
              </>
            ) : (
              <>
                <AlertTriangle className="h-4 w-4 text-warn" />
                <span>
                  {t("settings.bar.unsaved")} <strong className="font-medium text-foreground">{dirtySections.join(" · ")}</strong>
                </span>
              </>
            )}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!dirty || pending}
              onClick={() => {
                setDraft(saved);
                setError(null);
              }}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            >
              <Undo2 className="h-3.5 w-3.5" /> {t("settings.bar.reset")}
            </button>
            <button type="button" disabled={!dirty || pending} onClick={save} className="inline-flex h-9 items-center gap-2 rounded-lg bg-synapse px-4 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-synapse-foreground shadow-glow transition-all hover:shadow-glow-lg disabled:opacity-50 disabled:shadow-none">
              {pending ? <Spinner size={14} /> : <Save className="h-3.5 w-3.5" />} {t("settings.bar.save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="panel-head">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
      </header>
      <div className="space-y-5 p-5">{children}</div>
    </section>
  );
}

function Field({ label, hint, error, className, children }: { label: string; hint?: string; error?: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn("block", className)}>
      <span className="label-mono-sm mb-1.5 flex items-center justify-between">
        <span className="text-foreground/80">{label}</span>
        <span className={cn(error ? "text-danger" : "text-muted-foreground/70")}>{error ?? hint}</span>
      </span>
      {children}
    </label>
  );
}

function EnvRow({ active, onSelect, icon, title, meta, badge }: { active: boolean; onSelect: () => void; icon: React.ReactNode; title: string; meta: string; badge: string }) {
  return (
    <button type="button" role="radio" aria-checked={active} onClick={onSelect} className={cn("flex w-full items-center gap-4 rounded-lg border p-3 text-left transition-colors", active ? "border-synapse/40 bg-synapse/5" : "border-border bg-surface-lowest hover:border-foreground/25")}>
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-surface", active ? "border-synapse/40 text-synapse" : "border-border text-muted-foreground")}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold tracking-tight text-foreground">{title}</span>
        <span className="block truncate font-mono text-[11px] text-muted-foreground">{meta}</span>
      </span>
      <Badge variant={active ? "synapse" : "chip"}>{badge}</Badge>
    </button>
  );
}

function Row({ k, v, link }: { k: string; v: string; link?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="truncate text-foreground">{link ? <Link href={link} className="text-synapse hover:underline">{v}</Link> : v}</dd>
    </div>
  );
}
