import { test } from "node:test";
import assert from "node:assert/strict";
import { activeProviders, chat, LlmUnavailableError, parseJsonObject, resetLlmCooldownForTests, type FetchLike } from "@/cortex/llm";

const answer = (text: string): Response => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });

test("only keyed providers are active, in chain order", () => {
  assert.deepEqual(activeProviders({}), []);
  assert.deepEqual(activeProviders({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q" }).map((p) => p.id), ["groq", "gemini"]);
  assert.deepEqual(activeProviders({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q", SYNAPTH_LLM_CHAIN: "gemini, openrouter" }).map((p) => p.id), ["gemini"]);
  assert.deepEqual(activeProviders({ GROQ_API_KEY: "q", SYNAPTH_LLM: "0" }), []);
});

test("falls through a rate-limited provider and parks it", async () => {
  resetLlmCooldownForTests();
  const env = { GROQ_API_KEY: "q", GEMINI_API_KEY: "g", SYNAPTH_LLM_MODEL_GEMINI: "custom-flash" };
  const hits: string[] = [];
  const fetch: FetchLike = async (url, init) => {
    hits.push(url);
    if (url.includes("groq")) return new Response("slow down", { status: 429, headers: { "retry-after": "30" } });
    assert.equal(JSON.parse(String(init.body)).model, "custom-flash");
    return answer("hello");
  };
  const first = await chat([{ role: "user", content: "hi" }], {}, { env, fetch, now: () => 1_000 });
  assert.deepEqual([first.provider, first.text], ["gemini", "hello"]);

  // Groq is skipped while cooling down…
  hits.length = 0;
  await chat([{ role: "user", content: "hi" }], {}, { env, fetch, now: () => 20_000 });
  assert.equal(hits.length, 1);
  // …and retried after `retry-after`.
  hits.length = 0;
  await chat([{ role: "user", content: "hi" }], {}, { env, fetch, now: () => 40_000 });
  assert.equal(hits.length, 2);
});

test("throws with every attempt when nobody answers", async () => {
  resetLlmCooldownForTests();
  const fetch: FetchLike = async () => new Response("down", { status: 503 });
  await assert.rejects(
    chat([{ role: "user", content: "hi" }], {}, { env: { GROQ_API_KEY: "q" }, fetch }),
    (err: unknown) => err instanceof LlmUnavailableError && err.attempts[0] === "groq: HTTP 503",
  );
  await assert.rejects(chat([{ role: "user", content: "hi" }], {}, { env: {}, fetch }), LlmUnavailableError);
});

test("parseJsonObject tolerates fences and prose", () => {
  assert.deepEqual(parseJsonObject('Sure!\n```json\n{"intents":["pdf parsing"]}\n```'), { intents: ["pdf parsing"] });
  assert.equal(parseJsonObject("no json here"), null);
  assert.equal(parseJsonObject("{broken"), null);
});
