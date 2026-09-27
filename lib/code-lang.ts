/**
 * Code language guessing for fenced blocks in posts.
 *
 * Statistical auto-detection (highlight.js relevance) is unreliable on the
 * three-line snippets people paste into a post — `SELECT …` comes back as
 * bash, a Rust `fn main` as Arduino. So the guess is signature-based first:
 * a handful of weighted patterns per language, the best score wins, and the
 * highlighter's own guess is only a fallback (see `cortex/post-content.ts`).
 * Pure and isomorphic.
 */

/** Languages the post renderer highlights; ids match highlight.js grammar names. */
export const CODE_LANGS = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  python: "Python",
  bash: "Bash",
  json: "JSON",
  sql: "SQL",
  go: "Go",
  rust: "Rust",
  java: "Java",
  kotlin: "Kotlin",
  swift: "Swift",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  ruby: "Ruby",
  php: "PHP",
  yaml: "YAML",
  ini: "TOML / INI",
  xml: "HTML / XML",
  css: "CSS",
  scss: "SCSS",
  markdown: "Markdown",
  diff: "Diff",
  graphql: "GraphQL",
  lua: "Lua",
  r: "R",
  makefile: "Makefile",
  plaintext: "Text",
} as const;

export type CodeLang = keyof typeof CODE_LANGS;

/** What people write after the opening fence, mapped onto `CODE_LANGS`. */
const ALIASES: Record<string, CodeLang> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  node: "javascript",
  py: "python",
  python3: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  terminal: "bash",
  jsonc: "json",
  json5: "json",
  postgres: "sql",
  postgresql: "sql",
  psql: "sql",
  mysql: "sql",
  sqlite: "sql",
  golang: "go",
  rs: "rust",
  kt: "kotlin",
  kts: "kotlin",
  h: "c",
  "c++": "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  "c#": "csharp",
  rb: "ruby",
  yml: "yaml",
  toml: "ini",
  html: "xml",
  htm: "xml",
  svg: "xml",
  vue: "xml",
  md: "markdown",
  patch: "diff",
  gql: "graphql",
  text: "plaintext",
  txt: "plaintext",
  plain: "plaintext",
  make: "makefile",
};

/** Fence info string → a known language, or null when it names something we cannot highlight. */
export function normalizeLang(raw: string | null | undefined): CodeLang | null {
  const id = (raw ?? "").trim().toLowerCase();
  if (!id) return null;
  if (id in CODE_LANGS) return id as CodeLang;
  return ALIASES[id] ?? null;
}

type Signature = [RegExp, number];

/** Weighted fingerprints. A single strong marker (weight ≥ 3) is enough; weak ones need company. */
const SIGNATURES: Partial<Record<CodeLang, Signature[]>> = {
  typescript: [
    [/\binterface\s+\w+(\s+extends\s+[\w, ]+)?\s*\{/, 3],
    [/\btype\s+\w+(<[^>]*>)?\s*=/, 3],
    [/\bimport\s+type\b/, 4],
    [/\bas\s+const\b/, 3],
    [/[\w)\]]\s*:\s*(string|number|boolean|void|unknown|any|never|Promise<|Record<)/, 3],
    [/\b(public|private|readonly)\s+\w+\s*[:(]/, 1],
    [/<\w+(\[\])?>\s*\(/, 1],
  ],
  javascript: [
    [/\b(const|let|var)\s+[\w{[][^=]*=/, 2],
    [/=>/, 1],
    [/\bconsole\.\w+\(/, 3],
    [/\brequire\(\s*["']/, 3],
    [/\bimport\s+[\w{*][^;]*\bfrom\s+["']/, 3],
    [/\bexport\s+(default|function|const|class|async)\b/, 2],
    [/\b(async\s+function|await\s+\w)/, 1],
    [/\bdocument\.|\bwindow\./, 2],
  ],
  python: [
    [/^\s*def\s+\w+\s*\(.*\)\s*(->\s*[\w[\], ]+)?:\s*$/m, 4],
    [/^\s*class\s+\w+(\(.*\))?:\s*$/m, 4],
    [/^\s*from\s+[\w.]+\s+import\s+/m, 4],
    [/^\s*import\s+\w+(\s+as\s+\w+)?\s*$/m, 2],
    [/if\s+__name__\s*==/, 5],
    [/^\s*(elif|except|with)\b.*:\s*$/m, 3],
    [/\bprint\(/, 1],
    [/\bself\./, 2],
    [/\b(None|True|False)\b/, 1],
  ],
  bash: [
    [/^#!\/(usr\/)?bin\/(env\s+)?(ba|z)?sh/m, 6],
    [/^\s*\$\s+\S/m, 3],
    [/^\s*(sudo|npm|npx|pnpm|yarn|bun|git|curl|wget|cd|ls|echo|brew|pip3?|docker|kubectl|apt(-get)?|mkdir|chmod|rm|cp|mv|cat|grep|claude|uvx?|cargo|go\s+(run|build|install)|export\s+[A-Z_]+=)\b/m, 3],
    [/\|\s*(sh|bash|grep|jq|xargs)\b/, 2],
    [/(^|\s)--?[a-z][\w-]*/, 1],
    [/\$\{?[A-Z_]+\}?/, 1],
  ],
  sql: [
    [/^\s*(select|insert\s+into|update\s+\w+\s+set|delete\s+from|create\s+(table|index|view|unique\s+index)|alter\s+table|drop\s+table|with\s+\w+\s+as\s*\()\b/im, 5],
    [/\b(from|where|join|group\s+by|order\s+by|values)\b/i, 1],
  ],
  go: [
    [/^package\s+\w+\s*$/m, 5],
    [/\bfunc\s+(\([^)]*\)\s*)?\w+\s*\(/, 4],
    [/\w+\s*:=\s*/, 2],
    [/\bfmt\.\w+\(/, 3],
    [/\bif\s+err\s*!=\s*nil\b/, 5],
  ],
  rust: [
    [/\bfn\s+\w+\s*(<[^>]*>)?\s*\(/, 4],
    [/\blet\s+mut\b/, 4],
    [/\b(println|format|vec|panic)!\(/, 5],
    [/\bimpl(<[^>]*>)?\s+\w+/, 3],
    [/^\s*use\s+\w+(::\w+)+/m, 3],
    [/->\s*(Result|Option|Self|&?str|i32|u\d+|usize)\b/, 3],
  ],
  java: [
    [/\bpublic\s+(static\s+)?(final\s+)?(class|interface|void|record)\b/, 4],
    [/\bSystem\.out\.print/, 5],
    [/^\s*import\s+java\./m, 5],
    [/@Override\b/, 3],
  ],
  kotlin: [
    [/\bfun\s+\w+\s*\(/, 4],
    [/\bval\s+\w+(\s*:\s*\w+)?\s*=/, 2],
    [/\bprintln\(/, 1],
  ],
  swift: [
    [/^\s*import\s+(SwiftUI|Foundation|UIKit)\b/m, 6],
    [/\bfunc\s+\w+\s*\([^)]*\)\s*(->|\{)/, 2],
    [/\bguard\s+let\b|\bif\s+let\b/, 4],
  ],
  c: [
    [/^\s*#include\s*<(stdio|stdlib|string|unistd)\.h>/m, 6],
    [/\bint\s+main\s*\(/, 2],
    [/\bprintf\s*\(/, 2],
    [/\bmalloc\s*\(/, 2],
  ],
  cpp: [
    [/^\s*#include\s*<\w+>/m, 3],
    [/\bstd::\w+/, 4],
    [/\b(cout|cin)\s*(<<|>>)/, 4],
    [/\btemplate\s*</, 3],
  ],
  csharp: [
    [/^\s*using\s+System(\.\w+)*;/m, 6],
    [/\bConsole\.Write(Line)?\(/, 5],
    [/^\s*namespace\s+[\w.]+/m, 3],
    [/\bpublic\s+(async\s+)?(Task|string|int|void)\s+\w+\s*\(/, 2],
  ],
  ruby: [
    [/^\s*def\s+\w+[?!]?(\(.*\))?\s*$/m, 3],
    [/^\s*end\s*$/m, 2],
    [/^\s*(puts|require|require_relative)\s+/m, 3],
    [/\bdo\s*\|\w+(,\s*\w+)*\|/, 4],
  ],
  php: [
    [/<\?php/, 8],
    [/\$\w+\s*=\s*[^=]/, 1],
    [/\becho\s+\$/, 3],
  ],
  yaml: [
    [/^[\w.-]+:\s*$/m, 2],
    [/^\s*-\s+[\w"'][^:]*$/m, 1],
    [/^[\w.-]+:\s+\S/m, 1],
    [/^---\s*$/m, 2],
  ],
  ini: [
    [/^\s*\[[\w.-]+\]\s*$/m, 3],
    [/^\s*[\w.-]+\s*=\s*("[^"]*"|\d+|true|false|\[)/m, 2],
  ],
  xml: [
    [/^\s*<!doctype\s+html/im, 8],
    [/^\s*<\?xml\b/m, 8],
    [/<([a-z][\w-]*)(\s[^<>]*)?>[\s\S]*<\/\1>/i, 4],
    [/<[a-z][\w-]*(\s+[\w:-]+="[^"]*")+\s*\/?>/i, 2],
  ],
  css: [
    [/^\s*[.#@:]?[\w-][\w\s.#:>,*[\]="'-]*\{\s*$/m, 2],
    [/^\s*[a-z-]+\s*:\s*[^;{}]+;\s*$/m, 2],
    [/@media\s|@keyframes\s|!important\b/, 3],
    [/\b\d+(px|rem|em|vh|vw)\b/, 1],
  ],
  scss: [
    [/^\s*\$[\w-]+\s*:/m, 3],
    [/@(mixin|include|use)\s/, 4],
    [/&:[\w-]+|&\.[\w-]+/, 2],
  ],
  markdown: [
    [/^#{1,6}\s+\S/m, 2],
    [/^\s*[-*]\s+\[[ x]\]\s/m, 3],
    [/\[[^\]]+\]\([^)]+\)/, 2],
  ],
  diff: [
    [/^(\+\+\+|---)\s+\S/m, 4],
    [/^@@\s+-\d+(,\d+)?\s+\+\d+(,\d+)?\s+@@/m, 8],
  ],
  graphql: [
    [/^\s*(query|mutation|subscription|fragment)\s+\w+/m, 4],
    [/^\s*type\s+\w+\s*(implements\s+\w+\s*)?\{\s*$/m, 3],
  ],
  lua: [
    [/\blocal\s+(function\s+)?\w+/, 3],
    [/\bfunction\s+\w+(\.\w+)*\s*\(.*\)\s*$/m, 1],
    [/\bthen\b[\s\S]*\bend\b/, 2],
  ],
};

/** Languages whose markers overlap: the left one wins a tie when it has its own evidence. */
const REFINES: [specific: CodeLang, general: CodeLang][] = [
  ["typescript", "javascript"],
  ["cpp", "c"],
  ["scss", "css"],
];

function isJson(code: string): boolean {
  const s = code.trim();
  if (!/^[[{]/.test(s)) return false;
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

/** Minimum score to trust a guess; below it the snippet renders as plain text. */
export const DETECT_THRESHOLD = 3;

/**
 * Best-effort language guess for a snippet, or null when nothing is
 * convincing. Scores are sums of matched signature weights (each pattern
 * counts once); the specific member of a family (TS over JS, C++ over C)
 * inherits the general one's score.
 */
export function detectLanguage(code: string): CodeLang | null {
  const sample = code.slice(0, 4000);
  if (!sample.trim()) return null;
  if (isJson(sample)) return "json";

  const scores = new Map<CodeLang, number>();
  for (const [lang, sigs] of Object.entries(SIGNATURES) as [CodeLang, Signature[]][]) {
    const score = sigs.reduce((sum, [re, w]) => (re.test(sample) ? sum + w : sum), 0);
    if (score) scores.set(lang, score);
  }
  for (const [specific, general] of REFINES) {
    const own = scores.get(specific);
    if (own) scores.set(specific, own + (scores.get(general) ?? 0));
  }

  let best: CodeLang | null = null;
  let top = 0;
  for (const [lang, score] of scores) {
    if (score > top) {
      best = lang;
      top = score;
    }
  }
  return top >= DETECT_THRESHOLD ? best : null;
}
