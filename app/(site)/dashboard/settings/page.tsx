import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/cortex/auth";
import { getProfile } from "@/cortex/account";
import { hasDatabase } from "@/cortex/db";
import { skillRepository } from "@/cortex/repository";
import { getI18n } from "@/cortex/locale";
import { SettingsForm } from "@/components/settings-form";
import { VerificationPanel } from "@/components/verification-panel";
import { verificationState } from "@/cortex/verification";
import { CliPanel } from "@/components/cli-panel";
import { getLinkKey, installsToday, listDevices } from "@/cortex/cli";
import { currentPlanId } from "@/cortex/payments";
import { listApiKeys } from "@/cortex/api-keys";
import { API_KEYS_MAX, keyStatus } from "@/types/api-keys";
import { isUnlimited, PLANS } from "@/types/billing";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("settings.meta") };
}
export const dynamic = "force-dynamic";

/** Account & platform settings: identity, default install target, session. */
export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/dashboard/settings");
  const userId = session.user.id;
  const [profile, all, { t }, verification, linkKey, devices, planId, installs, keys] = await Promise.all([
    getProfile(userId),
    skillRepository.all(),
    getI18n(),
    verificationState(userId),
    getLinkKey(userId),
    listDevices(userId),
    currentPlanId(userId),
    installsToday(userId),
    listApiKeys(userId),
  ]);
  if (!profile) redirect("/signin");
  const published = all.filter((s) => s.authorId === profile.id);
  const verified = published.filter((s) => s.securityLevel === "Verified").length;
  const limits = PLANS[planId].limits;
  const cliLimits = { devices: limits.cliDevices, installsPerDay: limits.cliInstallsPerDay, bulk: limits.cliBulk };
  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

  return (
    <div className="space-y-8">
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div className="space-y-2">
          <p className="label-mono-sm flex items-center gap-2 tracking-[0.2em]">
            <span className="text-synapse">{t("settings.crumb.config")}</span>
            <span className="text-border">/</span>
            <span>{t("settings.crumb.node", { id: profile.id })}</span>
          </p>
          <h1 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">{t("settings.title")}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">{t("settings.lead")}</p>
        </div>
        <span className="pill h-8 self-start sm:self-auto">
          <span className="dot-live animate-pulse-dot" /> {t("settings.storePill", { store: hasDatabase ? "postgres" : "in-memory" })}
        </span>
      </header>

      <SettingsForm
        profile={profile}
        catalogue={{ published: published.length, verified }}
        verification={<VerificationPanel initial={verification} />}
        verified={Boolean(profile.verified)}
        cli={<CliPanel initial={{ linkKey, devices, plan: planId, limits: cliLimits, installsToday: installs }} origin={origin} />}
        machines={devices.length}
        apiKeys={{ active: keys.filter((k) => keyStatus(k) === "active").length, max: Math.min(limits.keys, API_KEYS_MAX) }}
        cliBadge={t("cli.badge", { n: devices.length, max: isUnlimited(limits.cliDevices) ? "∞" : String(limits.cliDevices) })}
      />
    </div>
  );
}
