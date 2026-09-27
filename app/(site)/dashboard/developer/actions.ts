"use server";

import { revalidatePath } from "next/cache";
import { z, ZodError } from "zod";
import { requireUser } from "@/cortex/auth";
import { enforceRateLimit, RateLimitError } from "@/cortex/rate-limit";
import { ApiKeyLimitError, issueApiKey, revokeApiKey } from "@/cortex/api-keys";
import { planLimits } from "@/cortex/plans";
import { API_KEY_LABEL_MAX, API_KEY_SCOPES, API_KEY_TTL_CHOICES, POLICY_PERMISSIONS, type ApiKeyInfo } from "@/types/api-keys";
import { SKILL_CATEGORIES } from "@/types/skill";
import { usdToMicros } from "@/types/economy";

const usdCap = z.number().min(0).max(10_000).nullable();

const createSchema = z.object({
  label: z.string().trim().min(1).max(API_KEY_LABEL_MAX),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1),
  ttlDays: z.number().int().refine((d) => (API_KEY_TTL_CHOICES as readonly number[]).includes(d)),
  minTrust: z.enum(["Sandbox", "Community", "Verified", "Gov"]),
  deniedPermissions: z.array(z.enum(POLICY_PERMISSIONS)),
  categories: z.array(z.enum(SKILL_CATEGORIES)).nullable(),
  maxPerCallUsd: usdCap,
  maxDailyUsd: usdCap,
});

export type CreateKeyInput = z.input<typeof createSchema>;
export type CreateKeyResult = { ok: true; key: string; info: ApiKeyInfo } | { ok: false; error: string };

export async function createApiKey(input: CreateKeyInput): Promise<CreateKeyResult> {
  const user = await requireUser();
  try {
    enforceRateLimit("write", `user:${user.id}`);
    const v = createSchema.parse(input);
    const { key, info } = await issueApiKey(user.id, {
      maxActive: (await planLimits(user.id)).keys,
      label: v.label,
      scopes: v.scopes,
      ttlDays: v.ttlDays,
      policy: {
        minTrust: v.minTrust,
        deniedPermissions: v.deniedPermissions,
        categories: v.categories && v.categories.length < SKILL_CATEGORIES.length ? v.categories : null,
        maxPerCallMicros: v.maxPerCallUsd === null ? null : usdToMicros(v.maxPerCallUsd),
        maxDailyMicros: v.maxDailyUsd === null ? null : usdToMicros(v.maxDailyUsd),
      },
    });
    revalidatePath("/dashboard/developer");
    return { ok: true, key, info };
  } catch (err) {
    if (err instanceof RateLimitError) return { ok: false, error: `Too many changes, retry in ${err.result.retryAfter}s` };
    if (err instanceof ApiKeyLimitError) return { ok: false, error: err.message };
    if (err instanceof ZodError) return { ok: false, error: `${err.issues[0].path.join(".")}: ${err.issues[0].message}` };
    throw err;
  }
}

export async function revokeApiKeyAction(keyId: string): Promise<{ ok: boolean }> {
  const user = await requireUser();
  enforceRateLimit("write", `user:${user.id}`);
  const ok = await revokeApiKey(user.id, z.string().min(1).max(64).parse(keyId));
  revalidatePath("/dashboard/developer");
  return { ok };
}
