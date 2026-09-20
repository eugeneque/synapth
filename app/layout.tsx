import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { PixelField } from "@/components/pixel-field";
import { I18nProvider } from "@/axon/i18n";
import { ToastProvider } from "@/axon/toast";
import { ToastStack } from "@/components/toast-stack";
import { getI18n, getLocale } from "@/cortex/locale";
import { LOCALE_META, uiMessages } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import "./globals.css";

const inter = Inter({ subsets: ["latin", "cyrillic"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin", "cyrillic"], variable: "--font-mono", display: "swap" });
const display = Space_Grotesk({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-display", display: "swap" });

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: { default: t("meta.title"), template: "%s · Synapth" },
    description: t("meta.description"),
    metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
    openGraph: { title: "Synapth", description: t("meta.ogDescription"), type: "website" },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={LOCALE_META[locale].htmlLang} className={cn("dark", inter.variable, mono.variable, display.variable)} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col font-sans">
        <I18nProvider locale={locale} messages={uiMessages(locale)}>
          <ToastProvider>
            <PixelField />
            {children}
            <ToastStack />
          </ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
