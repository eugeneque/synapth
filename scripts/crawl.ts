/**
 * Synapth crawler CLI.
 *
 *   npm run crawl -- --max 300 --min-stars 5
 *   npm run crawl -- --query "topic:mcp-server" --no-code-search
 *   npm run crawl -- --repo anthropics/skills
 *   npm run crawl -- --source mcp-registry --source npm   (registries only)
 *
 * Writes to data/catalog.json; the dev server picks the file up on the next request.
 */

import { parseArgs } from "node:util";
import { crawl, CRAWL_SOURCES, DEFAULT_QUERIES, type CrawlSource } from "@/cortex/crawler";

const { values } = parseArgs({
  options: {
    max: { type: "string", default: "200" },
    "min-stars": { type: "string", default: "0" },
    concurrency: { type: "string", default: "4" },
    query: { type: "string", multiple: true },
    repo: { type: "string", multiple: true },
    source: { type: "string", multiple: true },
    refresh: { type: "boolean", default: false },
    "no-code-search": { type: "boolean", default: false },
    "require-manifest": { type: "boolean", default: false },
    quiet: { type: "boolean", default: false },
  },
});

const sources = values.source?.map((s) => {
  if (!(CRAWL_SOURCES as readonly string[]).includes(s)) throw new Error(`--source must be one of ${CRAWL_SOURCES.join(", ")}`);
  return s as CrawlSource;
});

const controller = new AbortController();
process.on("SIGINT", () => {
  console.error("\naborting after current repos…");
  controller.abort();
});

async function main() {
const progress = await crawl({
  maxRepos: Number(values.max),
  minStars: Number(values["min-stars"]),
  concurrency: Number(values.concurrency),
  queries: values.repo?.length ? [] : values.query?.length ? values.query : DEFAULT_QUERIES,
  sources: values.repo?.length ? [] : sources,
  candidates: values.repo?.length ? values.repo.map((fullName) => ({ fullName, foundBy: "cli" })) : undefined,
  codeSearch: values.repo?.length ? false : !values["no-code-search"],
  refresh: values.refresh || Boolean(values.repo?.length),
  requireManifest: values["require-manifest"],
  signal: controller.signal,
  // onProgress fires once per log line, so the last entry is always the new one.
  onProgress: (p) => {
    if (!values.quiet) console.log(p.log[p.log.length - 1]);
  },
});

console.log(JSON.stringify({ ...progress, log: undefined, rateLimit: undefined }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
