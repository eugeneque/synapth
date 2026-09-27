import { test } from "node:test";
import assert from "node:assert/strict";
import { PermissionDeniedError, RoleChangeError } from "@/cortex/roles";
import { grantPro, revokePro } from "@/cortex/pro-grants";
import { cancelSubscription, currentPlanId, getSubscriptionRow, quotePlanChange, renewDueSubscriptions, resetPaymentsForTests, settleMockPayment, startCheckout } from "@/cortex/payments";
import { getProStatuses } from "@/cortex/subscription-store";
import { getAuthorRef } from "@/cortex/account";
import { PLANS } from "@/types/billing";

const ADMIN = "usr_demo";
const DAY = 86_400_000;

test("an admin grants Pro: limits, the mark and «subscriber since» follow", async () => {
  resetPaymentsForTests();
  const state = await grantPro(ADMIN, "usr_kite", 3);
  assert.equal(state.active, true);
  assert.equal(state.granted, true);
  assert.equal(await currentPlanId("usr_kite"), "pro");

  const ref = await getAuthorRef("usr_kite");
  assert.ok(ref?.pro, "author refs carry the Pro mark");
  assert.equal(ref.pro.since, state.since);
  assert.equal((await getAuthorRef("usr_acme"))?.pro, null, "no plan → no mark");
});

test("only admins grant, and never over a paid subscription", async () => {
  resetPaymentsForTests();
  await assert.rejects(grantPro("usr_acme", "usr_kite", 1), PermissionDeniedError);
  await assert.rejects(grantPro(ADMIN, "usr_kite", 7), RoleChangeError, "only the listed lengths");
  await assert.rejects(grantPro(ADMIN, "usr_platform", 1), RoleChangeError, "system accounts hold no plan");

  const out = await startCheckout("usr_nimbus", { kind: "subscription", plan: "pro", period: "month", method: "card" }, { returnBase: "https://synapth.test" });
  assert.equal(out.kind, "redirect");
  if (out.kind === "redirect") await settleMockPayment("usr_nimbus", out.paymentId, "succeeded");
  await assert.rejects(grantPro(ADMIN, "usr_nimbus", 12), (err: RoleChangeError) => err.status === 409);
  await assert.rejects(revokePro(ADMIN, "usr_nimbus"), (err: RoleChangeError) => err.status === 409, "paid plans are the subscriber's");
});

test("granting again extends the grant and keeps «subscriber since»; revoke ends it at once", async () => {
  resetPaymentsForTests();
  const first = await grantPro(ADMIN, "usr_kite", 1);
  const second = await grantPro(ADMIN, "usr_kite", 12);
  assert.equal(second.since, first.since);
  assert.ok(Date.parse(second.until!) > Date.parse(first.until!) + 300 * DAY);

  await assert.rejects(cancelSubscription("usr_kite"), "a grant is not the user's to cancel");
  const revoked = await revokePro(ADMIN, "usr_kite");
  assert.equal(revoked.active, false);
  assert.equal(await currentPlanId("usr_kite"), "free");
  assert.equal((await getProStatuses(["usr_kite"])).size, 0);
});

test("a grant earns no proration and simply ends with its period", async () => {
  resetPaymentsForTests();
  await grantPro(ADMIN, "usr_kite", 1);
  const quote = await quotePlanChange("usr_kite", "pro", "year");
  assert.equal(quote.change, "new");
  assert.equal(quote.amount, PLANS.pro.price.year, "buying over a grant costs the full price");

  const sub = (await getSubscriptionRow("usr_kite"))!;
  const after = Date.parse(sub.currentPeriodEnd) + DAY;
  assert.equal(await currentPlanId("usr_kite", after), "free", "no grace window for grants");
  const res = await renewDueSubscriptions(after);
  assert.equal(res.ended, 1);
  assert.equal((await getSubscriptionRow("usr_kite"))!.status, "canceled");
});
