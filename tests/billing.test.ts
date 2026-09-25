import { test } from "node:test";
import assert from "node:assert/strict";
import { billing, InsufficientFundsError, splitPrice } from "@/cortex/billing";
import { seedSkills } from "@/cortex/seed";

const weather = seedSkills.find((s) => s.slug === "acme-weather-now")!;

test("splitPrice honours the platform fee", () => {
  const { platformFeeMicros, creatorShareMicros } = splitPrice(1_000_000);
  assert.equal(platformFeeMicros + creatorShareMicros, 1_000_000);
  assert.ok(platformFeeMicros > 0);
});

test("successful execution moves money caller → creator + platform", async () => {
  const before = await billing.getWallet("usr_demo");
  const event = await billing.openExecution({ skill: weather, callerId: "usr_demo", toolName: "weather_now", input: { city: "Berlin" } });
  const receipt = await billing.closeExecution(event.id, { status: "succeeded", latencyMs: 12 });
  const after = await billing.getWallet("usr_demo");
  const creator = await billing.getWallet(weather.authorId);

  assert.equal(receipt.status, "succeeded");
  assert.equal(before.balanceMicros - after.balanceMicros, event.priceMicros);
  assert.equal(creator.lifetimeEarningsMicros, event.creatorShareMicros);
  assert.equal(receipt.chargedUsd, weather.pricePerCall);
});

test("failed execution is refunded", async () => {
  const before = await billing.getWallet("usr_demo");
  const event = await billing.openExecution({ skill: weather, callerId: "usr_demo", toolName: "weather_now", input: {} });
  await billing.closeExecution(event.id, { status: "failed", latencyMs: 5 });
  const after = await billing.getWallet("usr_demo");
  assert.equal(after.balanceMicros, before.balanceMicros);
});

test("empty wallet → 402", async () => {
  await assert.rejects(billing.openExecution({ skill: weather, callerId: "usr_broke", toolName: null, input: {} }), InsufficientFundsError);
});

test("a hold reserves the price; settle posts release + charge + earning + fee that sum to zero", async () => {
  await billing.topUp("usr_hold", 1);
  const before = await billing.getWallet("usr_hold");
  const event = await billing.openExecution({ skill: weather, callerId: "usr_hold", toolName: null, input: {} });
  assert.equal((await billing.getWallet("usr_hold")).balanceMicros, before.balanceMicros - event.priceMicros, "held at once");
  await billing.closeExecution(event.id, { status: "succeeded", latencyMs: 3, httpStatus: 200, responseBytes: 42 });
  const entries = [...(await billing.ledger("usr_hold")), ...(await billing.ledger(weather.authorId, 500)), ...(await billing.ledger("usr_platform", 500))].filter((e) => e.executionId === event.id);
  assert.deepEqual(entries.map((e) => e.type).sort(), ["charge", "earning", "hold", "platform_fee", "release"]);
  const ops = entries.filter((e) => e.type !== "hold" && e.type !== "release");
  assert.equal(ops.reduce((s, e) => s + e.amountMicros, 0), 0, "charge + earning + fee = 0");
  assert.equal(entries.filter((e) => e.type === "hold" || e.type === "release").reduce((s, e) => s + e.amountMicros, 0), 0, "hold + release = 0");
  await assert.rejects(billing.closeExecution(event.id, { status: "failed", latencyMs: 1 }), "closing twice throws");
});

test("a wallet balance always equals the sum of its entries", async () => {
  const wallet = await billing.getWallet("usr_hold");
  const entries = await billing.ledger("usr_hold", 10_000);
  assert.equal(entries.reduce((s, e) => s + e.amountMicros, 0), wallet.balanceMicros);
});

test("spentToday counts held and settled calls per key", async () => {
  await billing.topUp("usr_caps", 1);
  const a = await billing.openExecution({ skill: weather, callerId: "usr_caps", apiKeyId: "key_a", toolName: null, input: {} });
  await billing.openExecution({ skill: weather, callerId: "usr_caps", apiKeyId: "key_b", toolName: null, input: {} });
  assert.equal(await billing.spentToday("usr_caps", "key_a"), a.priceMicros);
  await billing.closeExecution(a.id, { status: "failed", latencyMs: 1 });
  assert.equal(await billing.spentToday("usr_caps", "key_a"), 0, "released holds do not count");
  assert.equal(await billing.spentToday("usr_caps"), a.priceMicros, "per caller: key_b's hold");
});
