import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Translator, UiKey } from "@/lib/i18n";

/** Minimal `t` for callers without a locale (scripts, tests): English, `{n}` only. */
const englishTime: Pick<Translator<UiKey>, "t"> = {
  t: (key, params) => {
    const table: Partial<Record<UiKey, string>> = { "time.now": "just now", "time.m": "{n}m ago", "time.h": "{n}h ago", "time.d": "{n}d ago", "time.mo": "{n}mo ago", "time.y": "{n}y ago" };
    return (table[key] ?? key).replace("{n}", String(params?.n ?? ""));
  },
};

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 12_400 → "12.4k", 2_100_000 → "2.1M" */
export function formatCompact(n: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function formatUsd(usd: number, free = "Free"): string {
  if (usd === 0) return free;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Compact relative time ("3d ago"); pass a translator for the active locale. */
export function timeAgo(iso: string, { t }: Pick<Translator<UiKey>, "t"> = englishTime): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return t("time.now");
  if (minutes < 60) return t("time.m", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("time.h", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t("time.d", { n: days });
  const months = Math.floor(days / 30);
  if (months < 12) return t("time.mo", { n: months });
  return t("time.y", { n: Math.floor(months / 12) });
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
