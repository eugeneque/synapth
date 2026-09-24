import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/cortex/auth";
import { getI18n } from "@/cortex/locale";
import { skillRepository } from "@/cortex/repository";
import { oauthProviders } from "@/cortex/auth";
import { AuthGate } from "@/components/auth-gate";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("meta.signup.title") };
}
export const dynamic = "force-dynamic";

export default async function SignUpPage() {
  const session = await auth();
  if (session?.user) redirect("/dashboard/settings");
  const indexed = (await skillRepository.all()).length;
  return (
    <Suspense>
      <AuthGate mode="signup" providers={oauthProviders()} indexed={indexed} />
    </Suspense>
  );
}
