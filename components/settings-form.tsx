"use client";

/**
 * SettingsForm — the "Account & Platform Settings" surface.
 *
 * Three numbered sections (identity with banner / avatar / occupation,
 * development environments, session) next to a config-sections rail, and a
 * sticky save bar that only appears when something differs from the
 * persisted profile. Images are prepared client-side (`axon/image.ts`) and
 * travel inside the same server action as the text fields.
 */

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, Briefcase, Check, ChevronDown, Globe, IdCard, Loader2, LogOut, MapPin, MonitorSmartphone, Save, ShieldCheck, Terminal, Undo2 } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { useToast } from "@/axon/toast";
import { INSTALL_TARGETS, TARGET_COOKIE, type InstallTarget } from "@/axon/install";
import { saveProfile } from "@/app/(site)/dashboard/settings/actions";
import type { AccountProfile, ProfileUpdate } from "@/cortex/account";
import type { ImageError } from "@/axon/image";
import { OCCUPATIONS } from "@/types/profile";
import { AvatarPicker, CoverPicker } from "@/components/image-picker";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { UiKey } from "@/lib/i18n";

interface Props {
  profile: AccountProfile;
  catalogue: { published: number; verified: number };
  signOutAction: () => Promise<void>;
}

const SECTIONS: Array<{ id: string; key: UiKey; icon: typeof IdCard }> = [
  { id: "identity", key: "settings.sec.identity", icon: IdCard },
  { id: "environments", key: "settings.sec.environments", icon: MonitorSmartphone },
  { id: "session", key: "settings.sec.session", icon: ShieldCheck },
];

const fieldClass = "h-9 w-full rounded-lg border border-border bg-muted px-3 font-mono text-[13px] text-foreground placeholder:text-muted-foreground/50 transition-colors focus:border-synapse/60 focus:outline-none focus:ring-1 focus:ring-synapse/25";

const IDENTITY_KEYS = ["name", "handle", "image", "coverImage", "occupation", "bio", "organization", "location", "website"] as const satisfies readonly (keyof ProfileUpdate)[];

function toUpdate(p: AccountProfile): ProfileUpdate {
  return { name: p.name, handle: p.handle, image: p.image, coverImage: p.coverImage, occupation: p.occupation, bio: p.bio, organization: p.organization, location: p.location, website: p.website, defaultTarget: p.defaultTarget };
}

/** Mirrors the server-side preference into a cookie so `defaultTarget()` can read it on the client. */
function writeTargetCookie(target: InstallTarget | null) {
  document.cookie = target ? `${TARGET_COOKIE}=${target}; path=/; max-age=31536000; samesite=lax` : `${TARGET_COOKIE}=; path=/; max-age=0`;
}

export function SettingsForm({ profile, catalogue, signOutAction }: Props) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [saved, setSaved] = useState<ProfileUpdate>(() => toUpdate(profile));
  const [draft, setDraft] = useState<ProfileUpdate>(() => toUpdate(profile));
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [flash, setFlash] = useState(false);
  const [pending, startTransition] = useTransition();

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

  const initial = (draft.name || profile.handle || "?").trim()[0]?.toUpperCase() ?? "?";

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      {/* Config sections rail. */}
      <aside className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="label-mono-sm mb-2 px-1 tracking-[0.2em]">{t("settings.rail.sections")}</p>
          <ul className="flex flex-col gap-1">
            {SECTIONS.map((s, i) => {
              const Icon = s.icon;
              return (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="flex h-9 items-center gap-2.5 rounded-lg px-2 font-mono text-[12px] text-muted-foreground transition-colors hover:bg-surface-low hover:text-foreground">
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1 truncate">{t(s.key)}</span>
                    <span className="label-mono-sm">{String(i + 1).padStart(2, "0")}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="label-mono-sm mb-2 flex items-center justify-between">
            <span>{t("settings.rail.catalogue")}</span>
            <span className="text-synapse">{t("settings.rail.verified", { n: catalogue.verified })}</span>
          </p>
          <p className="stat-value cursor">{catalogue.published}</p>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{t("settings.rail.catalogueHint")}</p>
          <Link href="/dashboard#publish" className="label-mono-sm mt-3 inline-block text-synapse hover:underline">
            {t("settings.rail.publish")} →
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col gap-6">
        {/* 01 Identity. */}
        <section id="identity" className="scroll-mt-24 overflow-hidden rounded-xl border border-border bg-card">
          <header className="panel-head">
            <div className="flex items-center gap-3">
              <span className="label-mono-sm text-synapse">{t("settings.section", { n: "01" })}</span>
              <h2 className="text-sm font-semibold tracking-tight text-foreground">{t("settings.identity.title")}</h2>
            </div>
            <Badge variant={profile.role === "user" ? "chip" : "synapse"}>{t(`settings.role.${profile.role}`)}</Badge>
          </header>
          <div className="space-y-5 p-5">
            <div>
              <div className="label-mono-sm mb-2 flex items-center justify-between">
                <span>{t("settings.identity.cover")}</span>
                <span>{t("settings.identity.coverHint")}</span>
              </div>
              <CoverPicker value={draft.coverImage} onChange={(v) => set("coverImage", v)} onError={imageError("coverImage")} fallbackLabel={t("settings.identity.coverLabel", { handle: draft.handle || profile.handle })} />
              {error?.field === "coverImage" && <p className="label-mono-sm mt-1.5 normal-case tracking-normal text-danger">{error.message}</p>}
            </div>

            <div className="grid gap-5 sm:grid-cols-[96px_minmax(0,1fr)]">
              <div>
                <p className="label-mono-sm mb-2">{t("settings.identity.avatar")}</p>
                <AvatarPicker value={draft.image} onChange={(v) => set("image", v)} onError={imageError("image")} initial={initial} />
                <p className={cn("label-mono-sm mt-2 normal-case tracking-normal", error?.field === "image" && "text-danger")}>
                  {error?.field === "image" ? error.message : draft.image ? (draft.image.startsWith("data:") ? t("settings.identity.avatarUploaded") : t("settings.identity.avatarOauth")) : t("settings.identity.avatarHint")}
                </p>
              </div>
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
                <Field label={t("settings.field.website")} hint={t("settings.hint.optional")} error={error?.field === "website" ? error.message : undefined}>
                  <div className="relative">
                    <Globe className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <input value={draft.website} onChange={(e) => set("website", e.target.value)} type="url" placeholder="https://" maxLength={200} className={cn(fieldClass, "pl-9")} />
                  </div>
                </Field>
                <Field className="sm:col-span-2" label={t("settings.field.bio")} hint={`${draft.bio.length} / 280`} error={error?.field === "bio" ? error.message : undefined}>
                  <textarea value={draft.bio} onChange={(e) => set("bio", e.target.value.slice(0, 280))} rows={3} maxLength={280} placeholder={t("settings.field.bioPlaceholder")} className={cn(fieldClass, "h-auto resize-none py-2 leading-relaxed")} />
                </Field>
              </div>
            </div>
          </div>
        </section>

        {/* 02 Development environments. */}
        <section id="environments" className="scroll-mt-24 overflow-hidden rounded-xl border border-border bg-card">
          <header className="panel-head">
            <div className="flex items-center gap-3">
              <span className="label-mono-sm text-synapse">{t("settings.section", { n: "02" })}</span>
              <h2 className="text-sm font-semibold tracking-tight text-foreground">{t("settings.env.title")}</h2>
            </div>
            <span className="label-mono-sm">{draft.defaultTarget ? t("settings.env.custom") : t("settings.env.auto")}</span>
          </header>
          <div className="space-y-3 p-5">
            <p className="text-sm text-muted-foreground">{t("settings.env.lead")}</p>
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
        </section>

        {/* 03 Session & access. */}
        <section id="session" className="scroll-mt-24 overflow-hidden rounded-xl border border-border bg-card">
          <header className="panel-head">
            <div className="flex items-center gap-3">
              <span className="label-mono-sm text-synapse">{t("settings.section", { n: "03" })}</span>
              <h2 className="text-sm font-semibold tracking-tight text-foreground">{t("settings.session.title")}</h2>
            </div>
            <Badge variant="synapse">
              <span className="dot-live" /> {t("settings.session.active")}
            </Badge>
          </header>
          <div className="grid gap-4 p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <dl className="grid gap-x-6 gap-y-2 font-mono text-xs sm:grid-cols-2">
              <Row k={t("settings.session.email")} v={profile.email ?? "—"} />
              <Row k={t("settings.session.id")} v={profile.id} />
              <Row k={t("settings.session.strategy")} v="jwt · 30d" />
              <Row k={t("settings.session.keys")} v={t("settings.session.keysValue")} link="/dashboard#keys" />
            </dl>
            <form action={signOutAction}>
              <button type="submit" className="inline-flex h-9 items-center gap-2 rounded-lg border border-danger/30 px-4 font-mono text-[11px] uppercase tracking-[0.14em] text-danger transition-colors hover:bg-danger/10">
                <LogOut className="h-4 w-4" /> {t("settings.session.signOut")}
              </button>
            </form>
          </div>
        </section>
      </div>

      {/* Sticky save bar. */}
      <div className={cn("pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-4 transition-all duration-200 lg:col-span-2", dirty || flash ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0")} aria-hidden={!(dirty || flash)}>
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
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} {t("settings.bar.save")}
            </button>
          </div>
        </div>
      </div>
    </div>
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
