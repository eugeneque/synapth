"use client";

/**
 * Axon · i18n for client components
 *
 * The root layout hands the active locale and its UI dictionary to this
 * provider; `useI18n()` exposes the same `t` / `n` API server components get
 * from `cortex/locale.ts`.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createTranslator, DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, type Locale, type Translator, type UiKey } from "@/lib/i18n";

interface I18nContextValue extends Translator<UiKey> {
  /** Persists the choice and re-renders the tree from the server. */
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ locale, messages, children }: { locale: Locale; messages: Record<UiKey, string>; children: ReactNode }) {
  const router = useRouter();
  const value = useMemo<I18nContextValue>(
    () => ({
      ...createTranslator(locale, messages),
      setLocale: (next) => {
        if (next === locale) return;
        document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
        router.refresh();
      },
    }),
    [locale, messages, router],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (ctx) return ctx;
  // Outside the provider (tests, isolated renders): English, no-op switch.
  return { ...createTranslator(DEFAULT_LOCALE, {} as Record<UiKey, string>), setLocale: () => {} };
}
