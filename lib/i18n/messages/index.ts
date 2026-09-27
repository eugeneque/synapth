import type { Locale } from "../locales";
import { ui as en, faq as enFaq, about as enAbout } from "./en";
import { ui as ru, faq as ruFaq, about as ruAbout } from "./ru";
import { ui as uk, faq as ukFaq, about as ukAbout } from "./uk";
import { ui as zh, faq as zhFaq, about as zhAbout } from "./zh";

export type UiKey = keyof typeof en;
export type FaqKey = keyof typeof enFaq;
export type AboutKey = keyof typeof enAbout;
export type UiMessages = Record<UiKey, string>;
export type FaqMessages = Record<FaqKey, string>;
export type AboutMessages = Record<AboutKey, string>;

export const UI: Record<Locale, UiMessages> = { en, ru, uk, zh };
export const FAQ: Record<Locale, FaqMessages> = { en: enFaq, ru: ruFaq, uk: ukFaq, zh: zhFaq };
export const ABOUT: Record<Locale, AboutMessages> = { en: enAbout, ru: ruAbout, uk: ukAbout, zh: zhAbout };
