import { PrismaClient } from "@prisma/client";

/**
 * Connection string. `DATABASE_URL` wins; the Netlify DB extension (Neon)
 * provisions `NETLIFY_DATABASE_URL` (pooled) instead, so a site wired through
 * the Netlify UI gets Postgres without renaming variables.
 */
export const databaseUrl = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL || "";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Overrides `env("DATABASE_URL")` in the schema; undefined keeps Prisma's own lookup.
    datasourceUrl: databaseUrl || undefined,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export const hasDatabase = Boolean(databaseUrl);

/** Function runtimes (Netlify, Lambda): the in-memory store lives only as long as one warm instance. */
export const isServerless = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
