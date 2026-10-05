/**
 * Preloaded into every test process (`tsx --import`, see `npm test`). Test files
 * run in parallel processes; with one shared catalog file they trampled each
 * other's writes and install counters (flaky `48212 !== 48211`, `ENOENT` on the
 * temp-file rename, a crawl that updated 0 of 3). Each process gets its own.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "synapth-test-catalog-"));
process.env.SYNAPTH_CATALOG_PATH = path.join(dir, "catalog.json");
process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
