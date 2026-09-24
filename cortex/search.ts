/**
 * Cortex · Search engine
 *
 * A self-contained full-text engine over the catalogue — no external service.
 *
 *   • BM25F ranking over weighted fields (name ≫ tags ≫ description ≫ tools ≫ readme)
 *   • light English stemming + stop words
 *   • prefix expansion for the last term (type-ahead) and fuzzy fallback
 *     (Damerau-Levenshtein ≤ 1/2 with a trigram pre-filter) for typos
 *   • query syntax:  category:MCP  is:verified  lang:python  author:anthropics
 *                    tag:pdf  stars:>100  price:free|paid  "exact phrase"  -excluded
 *   • facets over the filtered result set, highlights as safe segments
 *
 * The index is rebuilt lazily whenever the repository's version stamp changes;
 * a few thousand documents index in tens of milliseconds.
 */

import { skillSource, type SecurityLevel, type Skill, type SkillCategory, type SkillSource } from "@/types/skill";
import { trendingScore } from "@/cortex/ranking";

// ---------------------------------------------------------------------------
// Text processing
// ---------------------------------------------------------------------------

const STOP = new Set(
  "a an the and or of for to in on at by with from as is are be this that it its into your you we our their can use using used via any all".split(" "),
);

/** Conservative English stemmer: plurals, -ing/-ed, -ly, -ization. Never shortens below 4 chars. */
export function stem(token: string): string {
  if (token.length <= 3 || /\d/.test(token)) return token;
  let t = token.replace(/(ization|isation)$/, "ize").replace(/(ational|tional)$/, "tion");
  const keep = (candidate: string) => (candidate.length >= 4 ? candidate : t);
  if (/(ies|ied)$/.test(t)) return keep(t.replace(/(ies|ied)$/, "y"));
  if (/ings?$/.test(t) && t.length > 6) return keep(t.replace(/ings?$/, ""));
  if (/ed$/.test(t) && !/eed$/.test(t) && t.length > 5) return keep(t.replace(/ed$/, ""));
  if (/ly$/.test(t) && t.length > 5) return keep(t.replace(/ly$/, ""));
  if (/(sh|ch|x|z)es$/.test(t)) return keep(t.replace(/es$/, ""));
  if (/s$/.test(t) && !/(ss|us|is|os)$/.test(t)) return keep(t.replace(/s$/, ""));
  return t;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9а-яё+#]+/i)
    .filter((t) => t.length >= 2 && !STOP.has(t))
    .map(stem);
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

type Field = "name" | "tags" | "description" | "tools" | "author" | "readme";
const FIELD_WEIGHT: Record<Field, number> = { name: 6, tags: 3.5, description: 2.5, tools: 2, author: 2, readme: 0.8 };
const FIELDS = Object.keys(FIELD_WEIGHT) as Field[];
const K1 = 1.2;
const B = 0.75;
const README_CAP = 20_000;

interface Posting {
  doc: number;
  tf: Partial<Record<Field, number>>;
}

export interface SearchIndex {
  skills: Skill[];
  postings: Map<string, Posting[]>;
  vocab: string[];
  /** term → document frequency */
  df: Map<string, number>;
  avgLen: Record<Field, number>;
  lengths: Array<Record<Field, number>>;
  /** lowercase name → doc, for exact-name boosts and suggestions */
  names: Array<{ name: string; doc: number }>;
  trigrams: Map<string, string[]>;
}

function fieldText(skill: Skill): Record<Field, string> {
  return {
    name: skill.name,
    tags: [...skill.tags, skill.category, skill.source?.language ?? ""].join(" "),
    description: skill.description,
    tools: skill.manifest.tools.map((t) => `${t.name} ${t.description}`).join(" "),
    author: `${skill.authorName} ${skill.source?.owner ?? ""} ${skill.source?.repo ?? ""}`,
    readme: (skill.readme ?? skill.manifest.systemPrompt ?? "").slice(0, README_CAP),
  };
}

export function buildIndex(skills: Skill[]): SearchIndex {
  const postings = new Map<string, Posting[]>();
  const lengths: Array<Record<Field, number>> = [];
  const totals: Record<Field, number> = { name: 0, tags: 0, description: 0, tools: 0, author: 0, readme: 0 };

  skills.forEach((skill, doc) => {
    const texts = fieldText(skill);
    const len = { name: 0, tags: 0, description: 0, tools: 0, author: 0, readme: 0 };
    const perTerm = new Map<string, Partial<Record<Field, number>>>();
    for (const field of FIELDS) {
      const tokens = tokenize(texts[field]);
      len[field] = tokens.length;
      totals[field] += tokens.length;
      for (const t of tokens) {
        const tf = perTerm.get(t) ?? {};
        tf[field] = (tf[field] ?? 0) + 1;
        perTerm.set(t, tf);
      }
    }
    lengths.push(len);
    for (const [term, tf] of perTerm) {
      const list = postings.get(term) ?? [];
      list.push({ doc, tf });
      postings.set(term, list);
    }
  });

  const n = Math.max(skills.length, 1);
  const avgLen = Object.fromEntries(FIELDS.map((f) => [f, totals[f] / n || 1])) as Record<Field, number>;
  const df = new Map<string, number>();
  for (const [term, list] of postings) df.set(term, list.length);
  const vocab = [...postings.keys()].sort();

  const trigrams = new Map<string, string[]>();
  for (const term of vocab) {
    for (const g of grams(term)) {
      const list = trigrams.get(g) ?? [];
      list.push(term);
      trigrams.set(g, list);
    }
  }

  return {
    skills,
    postings,
    vocab,
    df,
    avgLen,
    lengths,
    names: skills.map((s, doc) => ({ name: s.name.toLowerCase(), doc })),
    trigrams,
  };
}

function grams(term: string): string[] {
  const padded = `  ${term} `;
  const out: string[] = [];
  for (let i = 0; i < padded.length - 2; i++) out.push(padded.slice(i, i + 3));
  return out;
}

// ---------------------------------------------------------------------------
// Fuzzy matching
// ---------------------------------------------------------------------------

export function damerauLevenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) d[i][0] = i;
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

function fuzzyCandidates(index: SearchIndex, term: string): string[] {
  if (term.length < 4) return [];
  const max = term.length >= 8 ? 2 : 1;
  const counts = new Map<string, number>();
  for (const g of grams(term)) for (const t of index.trigrams.get(g) ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, c]) => c >= Math.max(1, term.length - 3))
    .map(([t]) => t)
    .filter((t) => damerauLevenshtein(term, t, max) <= max)
    .sort((a, b) => (index.df.get(b) ?? 0) - (index.df.get(a) ?? 0))
    .slice(0, 5);
}

function prefixCandidates(index: SearchIndex, prefix: string): string[] {
  if (prefix.length < 2) return [];
  // vocab is sorted: binary search to the first term ≥ prefix, then walk.
  let lo = 0;
  let hi = index.vocab.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (index.vocab[mid] < prefix) lo = mid + 1;
    else hi = mid;
  }
  const out: string[] = [];
  for (let i = lo; i < index.vocab.length && index.vocab[i].startsWith(prefix) && out.length < 25; i++) out.push(index.vocab[i]);
  return out.sort((a, b) => (index.df.get(b) ?? 0) - (index.df.get(a) ?? 0)).slice(0, 8);
}

// ---------------------------------------------------------------------------
// Query parsing
// ---------------------------------------------------------------------------

export interface ParsedQuery {
  terms: string[];
  phrases: string[];
  excluded: string[];
  filters: {
    category?: SkillCategory;
    securityLevel?: SecurityLevel;
    language?: string;
    author?: string;
    tag?: string[];
    minStars?: number;
    price?: "free" | "paid";
    origin?: string;
  };
  /** Raw words (unstemmed) for highlighting. */
  raw: string[];
}

export function parseQuery(q: string): ParsedQuery {
  const parsed: ParsedQuery = { terms: [], phrases: [], excluded: [], filters: {}, raw: [] };
  const re = /"([^"]+)"|(-?)([a-z]+):([^\s]+)|(-?)(\S+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q))) {
    if (m[1]) {
      parsed.phrases.push(m[1].toLowerCase());
      parsed.raw.push(...m[1].split(/\s+/));
      continue;
    }
    if (m[3]) {
      const key = m[3].toLowerCase();
      const val = m[4];
      switch (key) {
        case "category":
        case "type":
        case "c": {
          const v = val.toLowerCase();
          parsed.filters.category = v === "mcp" ? "MCP" : v === "prompt" ? "Prompt" : v === "tool" ? "Tool" : undefined;
          break;
        }
        case "is":
        case "level": {
          const v = val.toLowerCase();
          parsed.filters.securityLevel = v === "verified" ? "Verified" : v === "community" ? "Community" : v === "sandbox" ? "Sandbox" : undefined;
          if (v === "free" || v === "paid") parsed.filters.price = v;
          break;
        }
        case "lang":
        case "language":
          parsed.filters.language = val.toLowerCase();
          break;
        case "author":
        case "owner":
        case "by":
          parsed.filters.author = val.toLowerCase().replace(/^@/, "");
          break;
        case "tag":
        case "topic":
          parsed.filters.tag = [...(parsed.filters.tag ?? []), val.toLowerCase()];
          break;
        case "stars": {
          const n = Number(val.replace(/^>=?/, ""));
          if (!Number.isNaN(n)) parsed.filters.minStars = n;
          break;
        }
        case "price":
          if (val === "free" || val === "paid") parsed.filters.price = val;
          break;
        case "origin":
        case "source":
          parsed.filters.origin = val.toLowerCase();
          break;
        default:
          parsed.raw.push(`${key}:${val}`);
          parsed.terms.push(...tokenize(`${key} ${val}`));
      }
      continue;
    }
    const word = m[6];
    if (m[5] === "-" && word.length > 1) {
      parsed.excluded.push(...tokenize(word));
    } else {
      parsed.raw.push(word);
      parsed.terms.push(...tokenize(word));
    }
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchOptions {
  limit?: number;
  offset?: number;
  /** Extra structured filters merged with the query syntax. */
  category?: SkillCategory;
  securityLevel?: SecurityLevel;
  language?: string;
  author?: string;
  source?: SkillSource;
  /** "relevance" (default when q is non-empty) or any catalogue sort. */
  sort?: "relevance" | "trending" | "recent" | "stars";
  /** Expand the last term as a prefix (type-ahead). Default true. */
  prefix?: boolean;
}

export interface Highlight {
  field: "name" | "description" | "readme";
  segments: Array<{ text: string; match: boolean }>;
}

export interface SearchHit {
  skill: Skill;
  score: number;
  highlights: Highlight[];
  /** Which query terms matched (after stemming), incl. fuzzy corrections. */
  matched: string[];
}

export interface FacetBucket {
  value: string;
  count: number;
}

export interface SearchResult {
  hits: SearchHit[];
  total: number;
  limit: number;
  offset: number;
  facets: { category: FacetBucket[]; securityLevel: FacetBucket[]; language: FacetBucket[]; tags: FacetBucket[]; author: FacetBucket[] };
  /** "Did you mean" — populated when fuzzy matching replaced a term. */
  corrections: Array<{ from: string; to: string }>;
  parsed: ParsedQuery;
  tookMs: number;
}

function bm25(tf: number, df: number, n: number, len: number, avg: number): number {
  const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
  return idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (len / avg))));
}

function passesFilters(skill: Skill, f: ParsedQuery["filters"], o: SearchOptions): boolean {
  const category = o.category ?? f.category;
  if (category && skill.category !== category) return false;
  const level = o.securityLevel ?? f.securityLevel;
  if (level && skill.securityLevel !== level) return false;
  const lang = (o.language ?? f.language)?.toLowerCase();
  if (lang && (skill.source?.language ?? "").toLowerCase() !== lang) return false;
  const author = (o.author ?? f.author)?.toLowerCase();
  if (author && skill.authorName.toLowerCase() !== author && skill.source?.owner.toLowerCase() !== author) return false;
  if (f.tag?.length && !f.tag.every((t) => skill.tags.includes(t))) return false;
  if (f.minStars !== undefined && skill.githubStars < f.minStars) return false;
  if (f.price === "free" && skill.pricePerCall > 0) return false;
  if (f.price === "paid" && skill.pricePerCall === 0) return false;
  if (f.origin && skill.origin !== f.origin) return false;
  if (o.source && skillSource(skill) !== o.source) return false;
  return true;
}

export function search(index: SearchIndex, q: string, options: SearchOptions = {}): SearchResult {
  const started = performance.now();
  const parsed = parseQuery(q);
  const n = index.skills.length;
  const limit = Math.min(Math.max(options.limit ?? 24, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  const corrections: SearchResult["corrections"] = [];

  // Expand each term into (term, weight) alternatives: exact → prefix → fuzzy.
  const groups: Array<Array<{ term: string; weight: number }>> = [];
  parsed.terms.forEach((term, i) => {
    const alts: Array<{ term: string; weight: number }> = [];
    if (index.postings.has(term)) alts.push({ term, weight: 1 });
    const isLast = i === parsed.terms.length - 1;
    if ((options.prefix ?? true) && isLast) for (const p of prefixCandidates(index, term)) if (p !== term) alts.push({ term: p, weight: 0.6 });
    if (!alts.length) {
      const fuzzy = fuzzyCandidates(index, term);
      if (fuzzy.length) {
        corrections.push({ from: term, to: fuzzy[0] });
        for (const fz of fuzzy) alts.push({ term: fz, weight: 0.5 });
      }
    }
    if (alts.length) groups.push(alts);
  });

  const scores = new Map<number, { score: number; matched: Set<string>; groupsHit: number }>();
  for (const group of groups) {
    const perDocBest = new Map<number, { score: number; term: string }>();
    for (const { term, weight } of group) {
      const df = index.df.get(term) ?? 0;
      for (const posting of index.postings.get(term) ?? []) {
        let s = 0;
        for (const field of FIELDS) {
          const tf = posting.tf[field];
          if (!tf) continue;
          s += FIELD_WEIGHT[field] * bm25(tf, df, n, index.lengths[posting.doc][field], index.avgLen[field]);
        }
        s *= weight;
        const cur = perDocBest.get(posting.doc);
        if (!cur || s > cur.score) perDocBest.set(posting.doc, { score: s, term });
      }
    }
    for (const [doc, best] of perDocBest) {
      const cur = scores.get(doc) ?? { score: 0, matched: new Set<string>(), groupsHit: 0 };
      cur.score += best.score;
      cur.matched.add(best.term);
      cur.groupsHit += 1;
      scores.set(doc, cur);
    }
  }

  const hasText = groups.length > 0 || parsed.phrases.length > 0;
  let candidates: number[];
  if (groups.length) {
    // Require every term group to match (AND) when there are ≤ 2 groups; otherwise allow one miss.
    const required = groups.length <= 2 ? groups.length : groups.length - 1;
    candidates = [...scores.entries()].filter(([, v]) => v.groupsHit >= required).map(([doc]) => doc);
  } else {
    candidates = index.skills.map((_, i) => i);
  }

  const excluded = new Set(parsed.excluded);
  const filtered = candidates.filter((doc) => {
    const skill = index.skills[doc];
    if (!passesFilters(skill, parsed.filters, options)) return false;
    const blob = hasText || excluded.size || parsed.phrases.length ? Object.values(fieldText(skill)).join("\n").toLowerCase() : "";
    if (excluded.size && tokenize(blob).some((t) => excluded.has(t))) return false;
    if (parsed.phrases.length && !parsed.phrases.every((p) => blob.includes(p))) return false;
    return true;
  });

  const facets = computeFacets(filtered.map((d) => index.skills[d]));

  const sortMode = options.sort ?? (hasText ? "relevance" : "trending");
  const ranked = filtered
    .map((doc) => {
      const skill = index.skills[doc];
      const base = scores.get(doc)?.score ?? 0;
      const exactName = skill.name.toLowerCase() === q.trim().toLowerCase() ? 25 : 0;
      const prior = 1 + 0.12 * Math.log10(1 + skill.githubStars) + (skill.securityLevel === "Verified" ? 0.15 : skill.securityLevel === "Sandbox" ? -0.3 : 0);
      return { doc, score: (base + exactName) * prior };
    })
    .sort((a, b) => {
      switch (sortMode) {
        case "relevance":
          return b.score - a.score || index.skills[b.doc].githubStars - index.skills[a.doc].githubStars;
        case "trending":
          return trendingScore(index.skills[b.doc]) - trendingScore(index.skills[a.doc]);
        case "recent":
          return Date.parse(index.skills[b.doc].createdAt) - Date.parse(index.skills[a.doc].createdAt);
        case "stars":
          return index.skills[b.doc].githubStars - index.skills[a.doc].githubStars;
      }
    });

  const page = ranked.slice(offset, offset + limit);
  const highlightTerms = [...new Set([...parsed.raw.map((w) => w.toLowerCase()), ...groups.flat().map((g) => g.term)])].filter((t) => t.length >= 2);

  return {
    hits: page.map(({ doc, score }) => ({
      skill: index.skills[doc],
      score: Math.round(score * 100) / 100,
      matched: [...(scores.get(doc)?.matched ?? [])],
      highlights: hasText ? highlight(index.skills[doc], highlightTerms) : [],
    })),
    total: ranked.length,
    limit,
    offset,
    facets,
    corrections,
    parsed,
    tookMs: Math.round((performance.now() - started) * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Facets & highlights
// ---------------------------------------------------------------------------

function bucketize(values: Iterable<string | null | undefined>, top: number): FacetBucket[] {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, top);
}

export function computeFacets(skills: Skill[]): SearchResult["facets"] {
  return {
    category: bucketize(skills.map((s) => s.category), 3),
    securityLevel: bucketize(skills.map((s) => s.securityLevel), 3),
    language: bucketize(skills.map((s) => s.source?.language), 10),
    tags: bucketize(skills.flatMap((s) => s.tags.filter((t) => !["mcp", "prompt", "tool"].includes(t))), 15),
    author: bucketize(skills.map((s) => s.source?.owner ?? s.authorName), 10),
  };
}

function highlight(skill: Skill, terms: string[]): Highlight[] {
  const out: Highlight[] = [];
  const pattern = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");

  const segmentize = (text: string): Highlight["segments"] =>
    text.split(pattern).filter(Boolean).map((part) => ({ text: part, match: terms.some((t) => part.toLowerCase().startsWith(t)) }));

  out.push({ field: "name", segments: segmentize(skill.name) });
  out.push({ field: "description", segments: segmentize(skill.description.slice(0, 220)) });

  const body = skill.readme ?? "";
  const idx = body.search(pattern);
  if (idx >= 0) {
    const start = Math.max(0, body.lastIndexOf("\n", idx) + 1, idx - 90);
    const snippet = body.slice(start, start + 200).replace(/[#*`>|]/g, "").replace(/\s+/g, " ").trim();
    out.push({ field: "readme", segments: segmentize(`${start > 0 ? "…" : ""}${snippet}…`) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Suggestions (type-ahead)
// ---------------------------------------------------------------------------

export interface Suggestion {
  type: "skill" | "term" | "author" | "tag";
  text: string;
  slug?: string;
  count?: number;
}

export function suggest(index: SearchIndex, q: string, limit = 8): Suggestion[] {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  const out: Suggestion[] = [];

  for (const { name, doc } of index.names) {
    if (name.startsWith(needle) || name.includes(` ${needle}`)) out.push({ type: "skill", text: index.skills[doc].name, slug: index.skills[doc].slug });
    if (out.length >= 4) break;
  }

  const authors = bucketize(index.skills.map((s) => s.source?.owner ?? s.authorName), 1000).filter((a) => a.value.toLowerCase().startsWith(needle)).slice(0, 2);
  for (const a of authors) out.push({ type: "author", text: `author:${a.value}`, count: a.count });

  const tags = bucketize(index.skills.flatMap((s) => s.tags), 1000).filter((t) => t.value.startsWith(needle)).slice(0, 2);
  for (const t of tags) out.push({ type: "tag", text: `tag:${t.value}`, count: t.count });

  const lastWord = needle.split(/\s+/).pop() ?? needle;
  for (const term of prefixCandidates(index, stem(lastWord))) {
    if (out.length >= limit) break;
    if (!out.some((s) => s.text === term)) out.push({ type: "term", text: needle.replace(/\S+$/, term), count: index.df.get(term) });
  }
  return out.slice(0, limit);
}
