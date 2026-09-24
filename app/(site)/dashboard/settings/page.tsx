import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Eye } from "lucide-react";
import { auth } from "@/cortex/auth";
import { getProfile } from "@/cortex/account";
import { hasDatabase } from "@/cortex/db";
import { skillRepository } from "@/cortex/repository";
import { getI18n } from "@/cortex/locale";
import { SettingsForm } from "@/components/settings-form";
import { VerificationPanel } from "@/components/verification-panel";
import { verificationState } from "@/cortex/verification";
import { Button } from "@/components/ui/button";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("settings.meta") };
}
export const dynamic = "force-dynamic";

/** Account & platform settings: identity, default install target, session. */
export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/dashboard/settings");
  const [profile, all, { t }, verification] = await Promise.all([getProfile(session.user.id), skillRepository.all(), getI18n(), verificationState(session.user.id)]);
  if (!profile) redirect("/signin");
  const published = all.filter((s) => s.authorId === profile.id);
  const verified = published.filter((s) => s.securityLevel === "Verified").length;

  return (
    <div className="space-y-8">
      <header className="flex flex-col justify-between gap-4 border-b border-border pb-6 md:flex-row md:items-end">
        <div className="space-y-2">
          <p className="label-mono-sm flex items-center gap-2 tracking-[0.2em]">
            <span className="text-synapse">{t("settings.crumb.config")}</span>
            <span className="text-border">/</span>
            <span>{t("settings.crumb.node", { id: profile.id })}</span>
          </p>
          <h1 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">{t("settings.title")}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">{t("settings.lead")}</p>
        </div>
        <div className="flex items-center gap-2 self-start md:self-auto">
          <span className="pill h-8">
            <span className="dot-live animate-pulse-dot" /> {t("settings.storePill", { store: hasDatabase ? "postgres" : "in-memory" })}
          </span>
          <Button asChild variant="mono" size="sm" className="h-8">
            <Link href={`/u/${profile.handle}`}>
              <Eye className="text-synapse" /> {t("settings.viewProfile")}
            </Link>
          </Button>
        </div>
      </header>

      <SettingsForm
        profile={profile}
        catalogue={{ published: published.length, verified }}
        verification={<VerificationPanel initial={verification} />}
        verified={Boolean(profile.verified)}
      />
    </div>
  );
}
