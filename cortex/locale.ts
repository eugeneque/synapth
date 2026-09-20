/**
 * Cortex · Locale resolution (server only)
 *
 * The UI language is a cookie set by the switcher; first-time visitors get
 * the best match from `Accept-Language`. Both readers are request-scoped, so
 * the result is memoised per request with React's `cache`.
 */

import { cache } from "react";
import { cookies, headers } from "next/headers";
import { fullTranslator, isLocale, negotiateLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n";

export const getLocale = cache(async (): Promise<Locale> => {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;
  return negotiateLocale((await headers()).get("accept-language"));
});

/** Translator over UI + docs strings for server components and metadata. */
export const getI18n = cache(async () => fullTranslator(await getLocale()));
