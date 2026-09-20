import type { Locale } from "../locales";
import { ui as en, faq as enFaq } from "./en";
import { ui as ru, faq as ruFaq } from "./ru";
import { ui as uk, faq as ukFaq } from "./uk";
import { ui as zh, faq as zhFaq } from "./zh";

export type UiKey = keyof typeof en;
export type FaqKey = keyof typeof enFaq;
export type UiMessages = Record<UiKey, string>;
export type FaqMessages = Record<FaqKey, string>;

export const UI: Record<Locale, UiMessages> = { en, ru, uk, zh };
export const FAQ: Record<Locale, FaqMessages> = { en: enFaq, ru: ruFaq, uk: ukFaq, zh: zhFaq };
