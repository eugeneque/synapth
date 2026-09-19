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
