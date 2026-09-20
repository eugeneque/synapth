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
  return { title: t("meta.signin.title") };
}
export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");
  const indexed = (await skillRepository.all()).length;
  return (
    <Suspense>
      <AuthGate mode="signin" providers={oauthProviders()} indexed={indexed} />
    </Suspense>
  );
}
