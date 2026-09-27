#!/usr/bin/env node
// Bundles the Synapth CLI (cli/synapth.ts + lib/) into one dependency-free
// ESM file the site serves at /cli/synapth.mjs. Runs before `next build`
// and after `npm install`; the output is gitignored.

import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

await build({
  entryPoints: [path.join(ROOT, "cli/synapth.ts")],
  outfile: path.join(ROOT, "public/cli/synapth.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: { js: "#!/usr/bin/env node" },
  legalComments: "none",
  logLevel: "warning",
});
