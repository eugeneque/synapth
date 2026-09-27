/**
 * Cortex · Post content
 *
 * Turns a post's raw body into the render-ready `PostBlock[]`: code fences
 * are tokenized with lowlight (highlight.js grammars, hast output — never an
 * HTML string, so nothing reaches `dangerouslySetInnerHTML`), a missing
 * fence language is guessed (`lib/code-lang.ts`, then the highlighter's own
 * relevance guess), and @handles become mentions when the handle belongs to
 * an account. Lives on the server so the client bundle carries no grammars.
 */

import { common, createLowlight } from "lowlight";
import type { Element, ElementContent, Root } from "hast";
import { CODE_LANGS, detectLanguage, normalizeLang, type CodeLang } from "@/lib/code-lang";
import { splitInline, splitPostBody } from "@/lib/post-body";
import type { AuthorRef, CodeToken, PostBlock, PostInline } from "@/types/social";

const lowlight = createLowlight(common);

/** Grammars the fallback guess may pick from: the common set minus look-alikes that win on everything (Arduino, VB.NET, …). */
const AUTO_SUBSET = (Object.keys(CODE_LANGS) as CodeLang[]).filter((l) => l !== "plaintext" && lowlight.registered(l));

/** highlight.js relevance below this is noise on short snippets. */
const AUTO_MIN_RELEVANCE = 6;

function flatten(root: Root): CodeToken[] {
  const out: CodeToken[] = [];
  const walk = (nodes: ElementContent[], cls: string | undefined) => {
    for (const node of nodes) {
      if (node.type === "text") {
        const last = out[out.length - 1];
        if (last && last.cls === cls) last.text += node.value;
        else out.push(cls ? { text: node.value, cls } : { text: node.value });
      } else if (node.type === "element") {
        const own = classList(node);
        walk(node.children, own || cls);
      }
    }
  };
  walk(root.children as ElementContent[], undefined);
  return out;
}

function classList(el: Element): string {
  const raw: unknown = el.properties?.className;
  const list = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? raw.split(/\s+/) : [];
  // Only highlight.js scope classes (and their `name_` sub-scopes) survive: a token cannot carry arbitrary classes.
  return list.filter((c: string) => /^(hljs-[\w-]+|[a-z]+_)$/.test(c)).join(" ");
}

/** Highlights one snippet; `hint` is the fence info string (may be empty or unknown). */
export function highlightCode(code: string, hint: string | null): { lang: string; label: string; auto: boolean; tokens: CodeToken[] } {
  const named = normalizeLang(hint);
  const plain = { tokens: [{ text: code }] };
  if (named) {
    if (named === "plaintext" || !lowlight.registered(named)) return { lang: named, label: CODE_LANGS[named], auto: false, ...plain };
    return { lang: named, label: CODE_LANGS[named], auto: false, tokens: flatten(lowlight.highlight(named, code)) };
  }
  // An unknown fence language: keep the author's label, render plain.
  if (hint?.trim()) return { lang: "plaintext", label: hint.trim().slice(0, 24), auto: false, ...plain };

  const guess = detectLanguage(code);
  if (guess && guess !== "plaintext" && lowlight.registered(guess)) return { lang: guess, label: CODE_LANGS[guess], auto: true, tokens: flatten(lowlight.highlight(guess, code)) };
  const auto = lowlight.highlightAuto(code, { subset: AUTO_SUBSET });
  const lang = normalizeLang(auto.data?.language);
  if (lang && (auto.data?.relevance ?? 0) >= AUTO_MIN_RELEVANCE) return { lang, label: CODE_LANGS[lang], auto: true, tokens: flatten(auto) };
  return { lang: "plaintext", label: CODE_LANGS.plaintext, auto: true, ...plain };
}

/** Bounded memo: feeds re-render the same posts over and over, and highlighting is the expensive part. */
const cache = new Map<string, ReturnType<typeof highlightCode>>();
const CACHE_LIMIT = 500;

function highlightCached(code: string, hint: string | null) {
  const key = `${hint ?? ""}\u0000${code}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const value = highlightCode(code, hint);
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
  return value;
}

/** `people` — mentioned accounts by lowercased handle; any other `@word` stays plain text. */
export function renderPostContent(body: string, people: Map<string, AuthorRef>): PostBlock[] {
  return splitPostBody(body).map((block): PostBlock => {
    if (block.kind === "code") return { kind: "code", code: block.code, ...highlightCached(block.code, block.lang) };
    const parts: PostInline[] = [];
    const pushText = (text: string) => {
      const last = parts[parts.length - 1];
      if (last?.kind === "text") last.text += text;
      else parts.push({ kind: "text", text });
    };
    for (const part of splitInline(block.text)) {
      const user = part.kind === "mention" ? people.get(part.handle) : undefined;
      if (part.kind === "text") pushText(part.text);
      else if (part.kind === "code") parts.push(part);
      else if (user) parts.push({ kind: "mention", user });
      else pushText(`@${part.raw}`);
    }
    return { kind: "text", parts };
  });
}
