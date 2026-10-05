/**
 * The CLI's look: interface languages (en/ru/zh), the ASCII hands of the home
 * page, and the `lang` command. The CLI is plain JS without types, so it is
 * exercised through child processes.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CLI = path.resolve("public/cli/synapth.mjs");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "synapth-ui-"));
after(() => fs.rmSync(home, { recursive: true, force: true }));

/** Evaluates `expr` inside one of the CLI's ES modules and returns it as JSON. */
function fromModule(file: string, expr: string) {
  const code = `import * as m from ${JSON.stringify(path.resolve(file))}; process.stdout.write(JSON.stringify(${expr}));`;
  const res = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout);
}

function cli(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...process.env, SYNAPTH_HOME: home, SYNAPTH_NO_ANIM: "1", NO_COLOR: "1", LANG: "en_US.UTF-8", LC_ALL: "", ...env } });
}

const savedLang = () => JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8")).lang;
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

test("every language has every string, with the same placeholders as English", () => {
  const dict = fromModule("cli/i18n.mjs", "m.DICT") as Record<string, Record<string, string>>;
  assert.deepEqual(Object.keys(dict), ["en", "ru", "zh"]);
  for (const lang of ["ru", "zh"]) {
    const missing = Object.keys(dict.en).filter((k) => !(k in dict[lang]));
    assert.deepEqual(missing, [], `${lang} lacks keys`);
    const extra = Object.keys(dict[lang]).filter((k) => !(k in dict.en));
    assert.deepEqual(extra, [], `${lang} has keys English does not`);
    for (const [key, text] of Object.entries(dict.en)) assert.equal(placeholders(dict[lang][key]), placeholders(text), `${lang}/${key} placeholders`);
  }
});

test("hands art: rectangular density grids in both sizes, with ink", () => {
  const hands = fromModule("cli/hands-art.mjs", "m.HANDS") as Record<string, string[]>;
  for (const [name, rows] of Object.entries(hands)) {
    assert.ok(rows.length >= 6, `${name} has height`);
    assert.ok(rows.every((r) => r.length === rows[0].length && /^[0-9]+$/.test(r)), `${name} is a rectangle of digits`);
    assert.ok(rows.join("").replace(/0/g, "").length > rows.length * 4, `${name} has ink`);
  }
  assert.ok(hands.wide[0].length > hands.narrow[0].length);
});

test("detectLang follows the OS locale and falls back to English", () => {
  const detect = (env: Record<string, string>) => fromModule("cli/i18n.mjs", `m.detectLang(${JSON.stringify(env)})`);
  assert.equal(detect({ LANG: "ru_RU.UTF-8" }), "ru");
  assert.equal(detect({ LC_ALL: "zh_CN.UTF-8", LANG: "en_US.UTF-8" }), "zh");
  assert.equal(detect({ LANG: "de_DE.UTF-8" }), "en");
  assert.equal(detect({}), "en");
});

test("`synapth lang` saves the choice and the help follows it", () => {
  assert.match(cli(["help"]).stdout, /GET STARTED/);

  const ru = cli(["lang", "ru"]);
  assert.equal(ru.status, 0, ru.stderr);
  assert.match(ru.stdout, /Язык: Русский/);
  assert.equal(savedLang(), "ru");
  assert.match(cli(["help"]).stdout, /НАЧАЛО/);

  cli(["lang", "zh"]);
  assert.match(cli(["help"]).stdout, /开始/);

  const bad = cli(["lang", "klingon"]);
  assert.notEqual(bad.status, 0);
  assert.equal(savedLang(), "zh", "an unknown code changes nothing");

  cli(["lang", "en"]);
  assert.match(cli(["help"]).stdout, /GET STARTED/);
});

test("without a saved choice the OS locale picks the language", () => {
  fs.rmSync(path.join(home, "config.json"), { force: true });
  assert.match(cli(["help"], { LANG: "ru_RU.UTF-8" }).stdout, /НАЧАЛО/);
  assert.match(cli(["help"], { LANG: "zh_CN.UTF-8" }).stdout, /开始/);
  assert.match(cli(["lang"], { LANG: "ru_RU.UTF-8" }).stdout, /Русский \(ru\)/, "non-interactive `lang` reports the current language");
});
