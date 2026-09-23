/**
 * Netlify scheduled function: fires the automatic crawler pass every 2 hours
 * (UTC, same grid as `CRAWL_CRON` in cortex/crawl-jobs.ts).
 *
 * The crawl itself runs inside the Next.js app (`POST /api/cron/crawl`) so it
 * shares the Prisma client and the catalogue code; this function only knocks
 * with the shared secret. Needs `SYNAPTH_CRON_SECRET` in the site environment.
 */

export default async () => {
  const secret = process.env.SYNAPTH_CRON_SECRET;
  const base = process.env.URL;
  if (!secret || !base) {
    console.error("[crawl-cron] SYNAPTH_CRON_SECRET or URL is not set; skipping");
    return new Response("not configured", { status: 500 });
  }
  const res = await fetch(new URL("/api/cron/crawl", base), { method: "POST", headers: { authorization: `Bearer ${secret}` } });
  const body = await res.text();
  console.log(`[crawl-cron] ${res.status} ${body.slice(0, 500)}`);
  return new Response(body, { status: res.status });
};

export const config = { schedule: "0 */2 * * *" };
