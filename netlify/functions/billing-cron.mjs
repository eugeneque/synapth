/**
 * Netlify scheduled function: daily subscription renewals and agent-log
 * retention (`POST /api/cron/billing`). Same secret as the crawl cron:
 * needs `SYNAPTH_CRON_SECRET` in the site environment.
 */

export default async () => {
  const secret = process.env.SYNAPTH_CRON_SECRET;
  const base = process.env.URL;
  if (!secret || !base) {
    console.error("[billing-cron] SYNAPTH_CRON_SECRET or URL is not set; skipping");
    return new Response("not configured", { status: 500 });
  }
  const res = await fetch(new URL("/api/cron/billing", base), { method: "POST", headers: { authorization: `Bearer ${secret}` } });
  const body = await res.text();
  console.log(`[billing-cron] ${res.status} ${body.slice(0, 500)}`);
  return new Response(body, { status: res.status });
};

export const config = { schedule: "17 3 * * *" };
