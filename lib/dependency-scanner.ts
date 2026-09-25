/**
 * Dependency scanner (ТЗ §2, stage 4 — supply chain), static part.
 *
 * Reads the package manifests that sit next to a skill (package.json and
 * lock files, requirements.txt, pyproject.toml, setup.py, go.mod) and
 * produces DP-* findings that need no network:
 *   DP-02 install hooks, DP-03 typosquatting, DP-04 missing lock / ranges,
 *   DP-06 dependency confusion.
 * It also returns the resolved package list; `cortex/dependency-audit.ts`
 * queries OSV and the registries with it (DP-01, DP-05).
 */

import type { ScanFinding } from "@/lib/sandbox-scanner";

export type Ecosystem = "npm" | "PyPI" | "Go";

export interface PackageRef {
  ecosystem: Ecosystem;
  name: string;
  /** Exact version when a lock file or a pin gives one. */
  version: string | null;
}

export interface DependencyScan {
  /** Manifests and lock files that were found, repository-relative. */
  files: string[];
  lockfiles: string[];
  packages: PackageRef[];
  findings: ScanFinding[];
}

/** Files the crawler reads next to a manifest (and at the repository root). */
export const DEPENDENCY_FILES = [
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "requirements.txt",
  "pyproject.toml",
  "poetry.lock",
  "uv.lock",
  "Pipfile.lock",
  "setup.py",
  "go.mod",
  "go.sum",
] as const;

const NPM_LOCKS = ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb"];
const PY_LOCKS = ["poetry.lock", "uv.lock", "Pipfile.lock"];

/**
 * Popular package names a typosquat would imitate. Not the full top-10 000 of
 * the ТЗ — the most-imitated names, which is where typosquats concentrate.
 */
export const POPULAR_PACKAGES: Record<"npm" | "PyPI", readonly string[]> = {
  npm: [
    "react", "react-dom", "react-dnd", "next", "vue", "angular", "svelte", "express", "koa", "fastify", "lodash", "underscore", "axios", "node-fetch", "request",
    "chalk", "commander", "yargs", "debug", "dotenv", "moment", "dayjs", "date-fns", "uuid", "nanoid", "zod", "yup", "joi", "ajv", "typescript", "tslib",
    "webpack", "vite", "rollup", "esbuild", "babel-core", "@babel/core", "eslint", "prettier", "jest", "mocha", "chai", "vitest", "cross-env", "rimraf", "glob",
    "minimist", "semver", "colors", "inquirer", "ora", "boxen", "execa", "shelljs", "fs-extra", "mkdirp", "body-parser", "cookie-parser", "cors", "helmet",
    "jsonwebtoken", "bcrypt", "bcryptjs", "passport", "mongoose", "mongodb", "mysql", "mysql2", "pg", "redis", "ioredis", "sequelize", "prisma", "@prisma/client",
    "socket.io", "ws", "puppeteer", "playwright", "cheerio", "jsdom", "sharp", "openai", "@anthropic-ai/sdk", "langchain", "@modelcontextprotocol/sdk",
    "electron", "discord.js", "telegraf", "node-telegram-bot-api", "stripe", "aws-sdk", "firebase", "graphql", "apollo-server", "rxjs", "immer", "redux",
    "tailwindcss", "postcss", "autoprefixer", "classnames", "clsx", "styled-components", "nodemon", "pm2", "ethers", "web3", "crypto-js", "color", "colorette", "picocolors", "kleur", "tsx", "ts-node",
  ],
  PyPI: [
    "requests", "urllib3", "httpx", "aiohttp", "numpy", "pandas", "scipy", "matplotlib", "seaborn", "scikit-learn", "tensorflow", "torch", "keras",
    "flask", "django", "fastapi", "uvicorn", "gunicorn", "starlette", "pydantic", "sqlalchemy", "psycopg2", "psycopg2-binary", "pymongo", "redis",
    "boto3", "botocore", "openai", "anthropic", "langchain", "transformers", "tokenizers", "tiktoken", "mcp", "fastmcp", "beautifulsoup4", "lxml",
    "selenium", "playwright", "pillow", "opencv-python", "pyyaml", "toml", "python-dotenv", "click", "typer", "rich", "tqdm", "colorama", "setuptools",
    "wheel", "pip", "cryptography", "pycryptodome", "paramiko", "jinja2", "markupsafe", "certifi", "idna", "charset-normalizer", "six", "attrs",
    "python-dateutil", "pytz", "tomli", "tomlkit", "typing-extensions", "packaging", "filelock", "anyio", "sniffio", "httpcore", "pytest", "black", "flake8", "mypy", "jupyter", "notebook", "ipython", "celery", "discord.py", "python-telegram-bot",
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Closest popular name within 1 edit (2 for names of 8+ chars), or null. */
export function typosquatTarget(name: string, ecosystem: "npm" | "PyPI"): string | null {
  const list = POPULAR_PACKAGES[ecosystem];
  const norm = (s: string) => (ecosystem === "PyPI" ? s.toLowerCase().replace(/[-_.]+/g, "-") : s.toLowerCase());
  const n = norm(name);
  if (n.length < 5 || list.some((p) => norm(p) === n)) return null;
  const budget = n.length >= 8 ? 2 : 1;
  for (const p of list) {
    const d = levenshtein(n, norm(p));
    if (d > 0 && d <= budget) return p;
  }
  return null;
}

const INTERNAL_NAME = /(^|[-_.])(internal|private|corp|intranet|priv)([-_.]|$)/i;

/** "^1.2.3", "~1.2", ">=1", "*", "latest" — anything that is not an exact version. */
const isRange = (spec: string) => !/^v?\d+\.\d+\.\d+([-+][\w.-]+)?$/.test(spec.trim());

const finding = (rule: string, severity: ScanFinding["severity"], surface: string, message: string, evidence: string): ScanFinding => ({ kind: "dependency", severity, surface, message, evidence: evidence.slice(0, 140), rule });

function parseJson<T>(text: string | undefined): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface NpmLock {
  packages?: Record<string, { version?: string }>;
  dependencies?: Record<string, { version?: string }>;
}

function npmLockVersions(lock: NpmLock | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!lock) return out;
  for (const [path, meta] of Object.entries(lock.packages ?? {})) {
    const name = path.replace(/^.*node_modules\//, "");
    if (path && meta.version && !out.has(name)) out.set(name, meta.version);
  }
  for (const [name, meta] of Object.entries(lock.dependencies ?? {})) if (meta.version && !out.has(name)) out.set(name, meta.version);
  return out;
}

function parseRequirements(text: string): Array<{ name: string; spec: string }> {
  return text
    .split("\n")
    .map((l) => l.replace(/#.*/, "").trim())
    .filter((l) => l && !l.startsWith("-") && !l.includes("://"))
    .map((l) => {
      const m = l.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?\s*(.*)$/);
      return m ? { name: m[1], spec: m[3].split(";")[0].trim() } : null;
    })
    .filter((r): r is { name: string; spec: string } => r !== null);
}

/** `[project] dependencies = ["x>=1", …]` and `[tool.poetry.dependencies] x = "^1"`. */
function parsePyproject(text: string): Array<{ name: string; spec: string }> {
  const out: Array<{ name: string; spec: string }> = [];
  const arr = text.match(/^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m);
  if (arr) for (const m of arr[1].matchAll(/["']([^"']+)["']/g)) out.push(...parseRequirements(m[1]));
  const poetry = text.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(\n\[|$)/);
  if (poetry) {
    for (const line of poetry[1].split("\n")) {
      const m = line.match(/^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*=\s*["']([^"']+)["']/);
      if (m && m[1] !== "python") out.push({ name: m[1], spec: m[2] });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * `files` maps repository-relative paths to contents; only the basenames in
 * `DEPENDENCY_FILES` matter. Paths are reported as given.
 */
export function scanDependencies(files: Record<string, string>): DependencyScan {
  const byName = new Map<string, { path: string; text: string }>();
  for (const [path, text] of Object.entries(files)) {
    const base = path.split("/").pop() ?? path;
    if ((DEPENDENCY_FILES as readonly string[]).includes(base) && !byName.has(base)) byName.set(base, { path, text });
  }
  const findings: ScanFinding[] = [];
  const packages: PackageRef[] = [];
  const lockfiles = [...byName.keys()].filter((b) => NPM_LOCKS.includes(b) || PY_LOCKS.includes(b) || b === "go.sum").map((b) => byName.get(b)!.path);

  // ---- npm -------------------------------------------------------------------
  const pkgFile = byName.get("package.json");
  const pkg = parseJson<PackageJson>(pkgFile?.text);
  if (pkgFile && pkg) {
    for (const hook of ["preinstall", "install", "postinstall", "prepare"] as const) {
      const script = pkg.scripts?.[hook];
      // `prepare` usually builds TypeScript; only flag it when it fetches or executes remote code.
      if (script && (hook !== "prepare" || /\b(curl|wget|node\s+-e|sh\s+-c|bash\s+-c)\b/.test(script))) {
        findings.push(finding("DP-02", "high", pkgFile.path, `\`${hook}\` script runs on every install.`, `${hook}: ${script}`));
      }
    }
    const deps = { ...pkg.optionalDependencies, ...pkg.dependencies };
    const hasLock = NPM_LOCKS.some((l) => byName.has(l));
    const locked = npmLockVersions(parseJson<NpmLock>(byName.get("package-lock.json")?.text ?? byName.get("npm-shrinkwrap.json")?.text));
    const ranged: string[] = [];
    for (const [name, spec] of Object.entries(deps)) {
      const exact = locked.get(name) ?? (!isRange(spec) ? spec.replace(/^v/, "") : null);
      packages.push({ ecosystem: "npm", name, version: exact });
      if (!hasLock && isRange(spec)) ranged.push(`${name}@${spec}`);
      const target = typosquatTarget(name, "npm");
      if (target) findings.push(finding("DP-03", "high", pkgFile.path, `\`${name}\` is one or two edits away from the popular \`${target}\`.`, name));
      if (!name.startsWith("@") && INTERNAL_NAME.test(name)) findings.push(finding("DP-06", "medium", pkgFile.path, `\`${name}\` looks like an internal package resolved from the public registry.`, name));
    }
    if (Object.keys(deps).length && !hasLock) findings.push(finding("DP-04", "medium", pkgFile.path, "No npm lock file: installs resolve whatever the ranges allow today.", ranged.slice(0, 5).join(", ") || "no lock file"));
  }

  // ---- Python ----------------------------------------------------------------
  const pyDeps: Array<{ name: string; spec: string; path: string }> = [];
  const req = byName.get("requirements.txt");
  if (req) pyDeps.push(...parseRequirements(req.text).map((d) => ({ ...d, path: req.path })));
  const pyproject = byName.get("pyproject.toml");
  if (pyproject) pyDeps.push(...parsePyproject(pyproject.text).map((d) => ({ ...d, path: pyproject.path })));
  if (pyDeps.length) {
    const hasLock = PY_LOCKS.some((l) => byName.has(l));
    const ranged = pyDeps.filter((d) => !/^==\s*[\w.]+$/.test(d.spec));
    for (const d of pyDeps) {
      const pin = d.spec.match(/^==\s*([\w.]+)$/)?.[1] ?? null;
      packages.push({ ecosystem: "PyPI", name: d.name, version: pin });
      const target = typosquatTarget(d.name, "PyPI");
      if (target) findings.push(finding("DP-03", "high", d.path, `\`${d.name}\` is one or two edits away from the popular \`${target}\`.`, d.name));
      if (INTERNAL_NAME.test(d.name)) findings.push(finding("DP-06", "medium", d.path, `\`${d.name}\` looks like an internal package resolved from the public index.`, d.name));
    }
    if (!hasLock && ranged.length) findings.push(finding("DP-04", "medium", ranged[0].path, "Python dependencies are not pinned and there is no lock file.", ranged.slice(0, 5).map((d) => `${d.name}${d.spec}`).join(", ")));
  }
  const setup = byName.get("setup.py");
  if (setup && /cmdclass\s*=|class\s+\w+\s*\(\s*(install|develop|egg_info)\s*\)/.test(setup.text)) {
    findings.push(finding("DP-02", "high", setup.path, "setup.py overrides install commands (code runs on pip install).", "cmdclass"));
  }

  // ---- Go ----------------------------------------------------------------------
  const gomod = byName.get("go.mod");
  if (gomod) {
    for (const m of gomod.text.matchAll(/^\s*(?:require\s+)?([\w.-]+\.[\w.-]+\/[\w./-]+)\s+(v[\w.+-]+)/gm)) packages.push({ ecosystem: "Go", name: m[1], version: m[2] });
    if (!byName.has("go.sum") && packages.some((p) => p.ecosystem === "Go")) findings.push(finding("DP-04", "medium", gomod.path, "go.mod without go.sum: module hashes are not pinned.", "go.sum missing"));
  }

  return { files: [...byName.values()].map((f) => f.path), lockfiles, packages, findings };
}
