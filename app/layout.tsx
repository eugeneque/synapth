import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { PixelField } from "@/components/pixel-field";
import { cn } from "@/lib/utils";
import "./globals.css";

const inter = Inter({ subsets: ["latin", "cyrillic"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });
const display = Space_Grotesk({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-display", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Synapth — the Modrinth for AI", template: "%s · Synapth" },
  description: "Discover, verify and install skills, tools and MCP servers for AI agents.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  openGraph: { title: "Synapth", description: "Marketplace for AI agent skills, tools and MCP servers.", type: "website" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("dark", inter.variable, mono.variable, display.variable)} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col font-sans">
        <PixelField />
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
