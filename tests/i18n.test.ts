import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidElement } from "react";
import { LOCALES, DEFAULT_LOCALE, negotiateLocale, interpolate, pluralForm, uiTranslator, fullTranslator } from "@/lib/i18n";
import { UI, FAQ } from "@/lib/i18n/messages";
import { rich } from "@/lib/i18n/rich";
import { timeAgo } from "@/lib/utils";

const placeholders = (s: string) => new Set(s.match(/\{\w+\}/g) ?? []);

test("every locale carries every key with a non-empty value", () => {
  for (const locale of LOCALES) {
    for (const [key, value] of Object.entries({ ...UI[locale], ...FAQ[locale] })) {
      assert.ok(typeof value === "string" && value.trim().length > 0, `${locale}:${key} is empty`);
    }
  }
});

test("translations keep the placeholders of the English source", () => {
  for (const locale of LOCALES) {
    if (locale === DEFAULT_LOCALE) continue;
    for (const dict of ["ui", "faq"] as const) {
      const en = dict === "ui" ? UI[DEFAULT_LOCALE] : FAQ[DEFAULT_LOCALE];
      const other = dict === "ui" ? UI[locale] : FAQ[locale];
      for (const key of Object.keys(en) as Array<keyof typeof en>) {
        const expected = placeholders(en[key]);
        const actual = placeholders(other[key]);
        assert.deepEqual(actual, expected, `${locale}:${key} placeholders differ`);
      }
    }
  }
});

test("plural forms are 1, 2 or 4 per template", () => {
  for (const locale of LOCALES) {
    for (const [key, value] of Object.entries(UI[locale])) {
      const forms = value.split("|").length;
      assert.ok([1, 2, 4].includes(forms), `${locale}:${key} has ${forms} plural forms`);
    }
  }
});

test("pluralForm picks the right category per locale", () => {
  assert.equal(pluralForm("en", "{n} skill|{n} skills", 1), "{n} skill");
  assert.equal(pluralForm("en", "{n} skill|{n} skills", 2), "{n} skills");
  const ru = "{n} навык|{n} навыка|{n} навыков|{n} навыков";
  assert.equal(pluralForm("ru", ru, 1), "{n} навык");
  assert.equal(pluralForm("ru", ru, 3), "{n} навыка");
  assert.equal(pluralForm("ru", ru, 5), "{n} навыков");
  assert.equal(pluralForm("ru", ru, 21), "{n} навык");
  assert.equal(pluralForm("uk", ru, 22), "{n} навыка");
  assert.equal(pluralForm("zh", "{n} 个技能", 7), "{n} 个技能");
});

test("translator interpolates and pluralises", () => {
  const { t, n } = uiTranslator("ru");
  assert.equal(t("footer.protocol", { version: "0.1.0" }), "Версия 0.1.0");
  assert.equal(n("pv.tools", 5), "5 инструментов");
  assert.equal(interpolate("{a} + {b} = {missing}", { a: 1, b: 2 }), "1 + 2 = {missing}");
  assert.equal(fullTranslator("uk").t("faq.sec.agents"), "Для агентів");
});

test("negotiateLocale honours quality and falls back to English", () => {
  assert.equal(negotiateLocale("uk-UA,uk;q=0.9,ru;q=0.8,en;q=0.7"), "uk");
  assert.equal(negotiateLocale("zh-CN,zh;q=0.9"), "zh");
  assert.equal(negotiateLocale("fr-FR,de;q=0.5"), "en");
  assert.equal(negotiateLocale("de;q=0.4, ru;q=0.9"), "ru");
  assert.equal(negotiateLocale(null), "en");
});

test("rich renders inline markup and leaves plain text alone", () => {
  assert.equal(rich("plain"), "plain");
  const nodes = rich("a **b** `c` *d*") as React.ReactNode[];
  assert.ok(Array.isArray(nodes));
  const tags = nodes.filter(isValidElement).map((el) => (el as React.ReactElement).type);
  assert.deepEqual(tags.filter((tag) => typeof tag === "string"), ["strong", "code", "em"]);
});

test("timeAgo follows the translator it is given", () => {
  const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();
  assert.equal(timeAgo(threeDaysAgo), "3d ago");
  assert.equal(timeAgo(threeDaysAgo, uiTranslator("ru")), "3 дн назад");
  assert.equal(timeAgo(new Date().toISOString(), uiTranslator("zh")), "刚刚");
});
