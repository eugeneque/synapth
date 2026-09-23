/**
 * Next.js boot hook. On a long-lived Node server (`next start`) it arms the
 * in-process timer for the automatic crawl; serverless deployments use the
 * Netlify scheduled function instead (see cortex/crawl-jobs.ts).
 */
export async function register() {
  // Keep the import inside the check: the edge build drops the branch, and with it node:fs.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startCrawlScheduler } = await import("@/cortex/crawl-jobs");
    startCrawlScheduler();
  }
}
