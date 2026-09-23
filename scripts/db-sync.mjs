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
`;

/** Fee recipient in cortex/billing.ts (PLATFORM_USER_ID); wallets reference users, so the row must exist. */
const POST_PUSH_SQL = `
INSERT INTO "User" ("id", "name", "handle", "role", "createdAt", "updatedAt")
VALUES ('usr_platform', 'Synapth', 'synapth', 'user', now(), now())
ON CONFLICT DO NOTHING;
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
