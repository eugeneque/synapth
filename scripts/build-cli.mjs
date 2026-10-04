#!/usr/bin/env node
// Bundles the Synapth CLI (cli/synapth.mjs + cli/migrate.ts + lib/) into one dependency-free
// ESM file the site serves at /cli/synapth.mjs. Runs before `next dev`,
// `next build` and `npm test`; the output is gitignored.

import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

await build({
  entryPoints: [path.join(ROOT, "cli/synapth.mjs")],
  outfile: path.join(ROOT, "public/cli/synapth.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: { js: "#!/usr/bin/env node" },
  legalComments: "none",
  logLevel: "warning",
});
