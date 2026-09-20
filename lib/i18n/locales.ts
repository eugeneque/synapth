/**
 * Locales the UI ships in. The locale is a per-browser preference stored in a
 * cookie (no URL prefix): the server reads it to render, the client reads it
 * to switch.
 */

export const LOCALES = ["en", "ru", "uk", "zh"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "synapth_locale";
/** One year; the preference is not sensitive. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const LOCALE_META: Record<Locale, { /** Short code shown in the switcher. */ code: string; /** Native name for the accessible label. */ name: string; /** Value for `<html lang>`. */ htmlLang: string }> = {
  en: { code: "EN", name: "English", htmlLang: "en" },
  ru: { code: "RU", name: "Русский", htmlLang: "ru" },
  uk: { code: "UK", name: "Українська", htmlLang: "uk" },
  zh: { code: "ZH", name: "中文", htmlLang: "zh-CN" },
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Picks the best supported locale from an `Accept-Language` header. */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const ranked = acceptLanguage
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { tag: tag.toLowerCase(), q: q ? Number(q.slice(2)) || 0 : 1, index };
    })
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const { tag } of ranked) {
    const base = tag.split("-")[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}
