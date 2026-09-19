import { billing } from "@/cortex/billing";
import { resolveCaller } from "@/cortex/api-keys";
import { UnauthorizedError } from "@/cortex/auth";
import { microsToUsd } from "@/types/economy";
import { json, withErrors } from "@/lib/api";

export const GET = withErrors(async (request: Request) => {
  const caller = await resolveCaller(request);
  if (!caller) throw new UnauthorizedError();
  const [wallet, ledger, creator] = await Promise.all([billing.getWallet(caller.userId), billing.ledger(caller.userId, 20), billing.creatorSummary(caller.userId)]);
  return json({ wallet, balanceUsd: microsToUsd(wallet.balanceMicros), ledger, creator });
});
