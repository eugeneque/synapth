import { hasDatabase, prisma } from "@/cortex/db";
import { json } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Readiness probe for Docker and the deployment workflow. */
export async function GET() {
  if (!hasDatabase) {
    return json({ status: "unhealthy" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    return json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return json({ status: "unhealthy" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
