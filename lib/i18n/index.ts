/**
 * Synapth · i18n core (isomorphic)
 *
 * Dictionaries are flat `key → string` maps. A value may contain `{name}`
 * placeholders and, for plural keys, `|`-separated forms:
 *   "{n} skill|{n} skills"                      → one | other
 *   "{n} навык|{n} навыка|{n} навыков|{n} навыков" → one | few | many | other
 * Inline markup (`**strong**`, `*em*`, `` `code` ``) is rendered by `rich()`
 * in `lib/i18n/rich.tsx`, so the dictionaries stay plain strings.
 */

import { DEFAULT_LOCALE, type Locale } from "./locales";
import { UI, FAQ, type UiKey, type FaqKey } from "./messages";

export * from "./locales";
export type { UiKey, FaqKey };

export type Params = Record<string, string | number>;

export interface Translator<K extends string = UiKey> {
  locale: Locale;
  /** Plain lookup with `{placeholder}` interpolation. */
  t: (key: K, params?: Params) => string;
  /** Plural lookup: picks the form for `count` and interpolates it as `{n}`. */
  n: (key: K, count: number, params?: Params) => string;
}

export function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

const pluralRules = new Map<Locale, Intl.PluralRules>();

function rulesFor(locale: Locale) {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules;
}

/** Chooses the plural form of a `|`-separated template (1, 2 or 4 forms). */
export function pluralForm(locale: Locale, template: string, count: number): string {
  const forms = template.split("|");
  if (forms.length === 1) return forms[0];
  const category = rulesFor(locale).select(count);
  if (forms.length === 2) return category === "one" ? forms[0] : forms[1];
  const index = { zero: 3, one: 0, two: 1, few: 1, many: 2, other: 3 }[category];
  return forms[index] ?? forms[forms.length - 1];
}

export function createTranslator<K extends string>(locale: Locale, dictionary: Record<K, string>, fallback?: Record<K, string>): Translator<K> {
  const lookup = (key: K) => dictionary[key] ?? fallback?.[key] ?? key;
  return {
    locale,
    t: (key, params) => interpolate(lookup(key), params),
    n: (key, count, params) => interpolate(pluralForm(locale, lookup(key), count), { n: count, ...params }),
  };
}

/** UI strings only — what the client bundle receives. */
export function uiTranslator(locale: Locale): Translator<UiKey> {
  return createTranslator(locale, UI[locale], UI[DEFAULT_LOCALE]);
}

/** UI + docs strings, for server components that render the FAQ. */
export function fullTranslator(locale: Locale): Translator<UiKey | FaqKey> {
  return createTranslator<UiKey | FaqKey>(locale, { ...UI[locale], ...FAQ[locale] }, { ...UI[DEFAULT_LOCALE], ...FAQ[DEFAULT_LOCALE] });
}

export function uiMessages(locale: Locale): Record<UiKey, string> {
  return UI[locale];
}
