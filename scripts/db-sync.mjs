#!/usr/bin/env node
/**
 * Brings the attached Postgres (Neon on Netlify) in line with prisma/schema.prisma.
 * Runs before `next build` on Netlify; locally: `npm run db:sync`.
 *
 *   1. one-off data fixes `db push` cannot express (see PRE_PUSH_SQL);
 *   2. `prisma db push` — additive changes only: without --accept-data-loss
 *      Prisma refuses anything destructive and the deploy fails loudly;
 *   3. the platform ledger account that billing credits fees to.
 *
 * No database URL → nothing to do (in-memory mode). SYNAPTH_SKIP_DB_SYNC=1 opts out.
 */

import { spawnSync } from "node:child_process";

// Direct (unpooled) connection first: schema changes should not go through PgBouncer.
const url =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
  process.env.DATABASE_URL ||
  process.env.NETLIFY_DATABASE_URL ||
  "";

if (process.env.SYNAPTH_SKIP_DB_SYNC === "1") {
  console.log("[db-sync] SYNAPTH_SKIP_DB_SYNC=1 — skipped");
  process.exit(0);
}
if (!url) {
  console.log("[db-sync] no database URL — in-memory mode, nothing to sync");
  process.exit(0);
}

const env = { ...process.env, DATABASE_URL: url };

function prisma(args, input) {
  const res = spawnSync("npx", ["prisma", ...args], { env, input, stdio: [input ? "pipe" : "inherit", "inherit", "inherit"], encoding: "utf8" });
  if (res.status !== 0) {
    console.error(`[db-sync] prisma ${args[0]} ${args[1] ?? ""} failed`);
    process.exit(res.status ?? 1);
  }
}

/**
 * The role enum used to be (user, creator, admin). `creator` never carried a
 * permission, so its holders become plain users and the enum value is renamed
 * in place to `moderator` — a removal would need --accept-data-loss.
 * Idempotent; a fresh database has no "UserRole" type yet and skips it.
 * Also drops award rows and notifications of retired badges (anything not in `BADGES`, types/badges.ts)
 * and collapses post reactions to one per (post, user).
 */
const PRE_PUSH_SQL = `
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'UserRole' AND e.enumlabel = 'creator')
     AND NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'UserRole' AND e.enumlabel = 'moderator') THEN
    UPDATE "User" SET "role" = 'user' WHERE "role"::text = 'creator';
    ALTER TYPE "UserRole" RENAME VALUE 'creator' TO 'moderator';
  END IF;
END $$;

-- Retired badges: "platform-admin" (admins are not revealed on profiles) and the pre-2026-09
-- catalogue that the current achievement set replaced.
DO $$
DECLARE retired text[] := ARRAY['platform-admin', 'verified-publisher', 'mcp-author', 'prompt-author', 'tool-author',
  'github-importer', 'conversationalist', 'magnet', 'curator', 'early-adopter'];
BEGIN
  IF to_regclass('"UserBadge"') IS NOT NULL THEN
    DELETE FROM "UserBadge" WHERE "badgeId" = ANY(retired);
  END IF;
  IF to_regclass('"Notification"') IS NOT NULL THEN
    DELETE FROM "Notification" WHERE "kind" = 'badge' AND "subject"->>'badgeId' = ANY(retired);
  END IF;
END $$;

-- Post reactions went from one row per (post, user, emoji) to one per (post, user): keep each
-- user's latest emoji, then narrow the primary key. Skipped once the key has two columns.
DO $$
BEGIN
  IF to_regclass('"PostReaction"') IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('"PostReaction"') AND contype = 'p' AND array_length(conkey, 1) = 3
  ) THEN
    DELETE FROM "PostReaction" a USING "PostReaction" b
    WHERE a."postId" = b."postId" AND a."userId" = b."userId"
      AND (a."createdAt" < b."createdAt" OR (a."createdAt" = b."createdAt" AND a."emoji" > b."emoji"));
    ALTER TABLE "PostReaction" DROP CONSTRAINT "PostReaction_pkey", ADD CONSTRAINT "PostReaction_pkey" PRIMARY KEY ("postId", "userId");
  END IF;
END $$;

-- Email confirmation (cortex/email-verification.ts) arrived on 2026-09-25: password accounts
-- created before it never received a code, so they are treated as confirmed. The cut-off date
-- keeps this idempotent: later signups stay unconfirmed until they enter their code.
DO $$
BEGIN
  IF to_regclass('"User"') IS NOT NULL THEN
    UPDATE "User" SET "emailVerified" = "createdAt"
    WHERE "emailVerified" IS NULL AND "passwordHash" IS NOT NULL AND "createdAt" < '2026-09-25';
  END IF;
END $$;
`;

/**
 * Fee recipient in cortex/billing.ts (PLATFORM_USER_ID); wallets reference users, so the row must exist.
 * It has no email or password and cannot sign in; the "synapth" handle is left for a real, loginable account.
 */
const POST_PUSH_SQL = `
INSERT INTO "User" ("id", "name", "handle", "role", "createdAt", "updatedAt")
VALUES ('usr_platform', 'Synapth Platform', 'platform', 'user', now(), now())
ON CONFLICT DO NOTHING;
-- The fee account used to hold the "synapth" handle; free it for the official posting account.
UPDATE "User" SET "handle" = 'platform', "name" = 'Synapth Platform' WHERE "id" = 'usr_platform' AND "handle" = 'synapth';
INSERT INTO "Wallet" ("id", "userId", "updatedAt")
VALUES ('wal_platform', 'usr_platform', now())
ON CONFLICT DO NOTHING;
`;

console.log("[db-sync] migrating legacy data");
prisma(["db", "execute", "--stdin", "--url", url], PRE_PUSH_SQL);
console.log("[db-sync] pushing schema");
prisma(["db", "push", "--skip-generate"]);
console.log("[db-sync] ensuring platform account");
prisma(["db", "execute", "--stdin", "--url", url], POST_PUSH_SQL);
console.log("[db-sync] done");
