/**
 * Post body grammar — deliberately tiny, not Markdown:
 *
 *   - ```lang … ``` fences on their own lines are code blocks (the language
 *     is optional and guessed when missing, see `lib/code-lang.ts`);
 *   - `inline code` in backticks;
 *   - @handle mentions (outside code only).
 *
 * Everything else is plain text with line breaks kept. Pure and isomorphic:
 * the server parses to resolve mentions and highlight code, the composer
 * uses the same mention matcher for autocomplete.
 */

export type PostSourceBlock = { kind: "text"; text: string } | { kind: "code"; lang: string | null; code: string };

export type PostSourceInline = { kind: "text"; text: string } | { kind: "code"; text: string } | { kind: "mention"; handle: string; raw: string };

const FENCE_OPEN = /^[ \t]*```[ \t]*([\w+#.-]{0,32})[ \t]*$/;
const FENCE_CLOSE = /^[ \t]*```[ \t]*$/;

/** Splits a body into text and fenced code blocks. An unclosed fence runs to the end of the post. */
export function splitPostBody(body: string): PostSourceBlock[] {
  const out: PostSourceBlock[] = [];
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  let text: string[] = [];
  const flushText = () => {
    const joined = text.join("\n");
    if (joined.trim()) out.push({ kind: "text", text: joined.replace(/^\n+|\n+$/g, "") });
    text = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const open = FENCE_OPEN.exec(lines[i]);
    if (!open) {
      text.push(lines[i]);
      continue;
    }
    flushText();
    const code: string[] = [];
    let j = i + 1;
    while (j < lines.length && !FENCE_CLOSE.test(lines[j])) code.push(lines[j++]);
    i = j; // skip the closing fence (or run past the end)
    const joined = code.join("\n").replace(/^\n+|\s+$/g, "");
    if (joined) out.push({ kind: "code", lang: open[1] || null, code: joined });
  }
  flushText();
  return out;
}

/**
 * A mention starts at a word boundary (not inside an email or a URL path):
 * `@handle` after start / whitespace / an opening bracket or quote.
 */
const MENTION = /(^|[\s([{"'«„—-])@([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)(?![\w-])/gi;

/** Splits a text block into plain runs, `inline code` and @mentions. Handles come back lowercased. */
export function splitInline(text: string): PostSourceInline[] {
  const out: PostSourceInline[] = [];
  const push = (part: PostSourceInline) => {
    const last = out[out.length - 1];
    if (part.kind === "text" && last?.kind === "text") last.text += part.text;
    else if (part.kind !== "text" || part.text) out.push(part);
  };
  // Inline code first: mentions inside backticks are not mentions.
  const pieces = text.split(/(`[^`\n]+`)/);
  for (const piece of pieces) {
    if (piece.length > 2 && piece.startsWith("`") && piece.endsWith("`")) {
      push({ kind: "code", text: piece.slice(1, -1) });
      continue;
    }
    let last = 0;
    for (const m of piece.matchAll(MENTION)) {
      const at = m.index! + m[1].length;
      push({ kind: "text", text: piece.slice(last, at) });
      push({ kind: "mention", handle: m[2].toLowerCase(), raw: m[2] });
      last = at + 1 + m[2].length;
    }
    push({ kind: "text", text: piece.slice(last) });
  }
  return out;
}

/** Unique lowercased handles mentioned in the body, in order of first appearance (code excluded). */
export function extractMentions(body: string, limit = Infinity): string[] {
  const seen = new Set<string>();
  for (const block of splitPostBody(body)) {
    if (block.kind !== "text") continue;
    for (const part of splitInline(block.text)) {
      if (part.kind === "mention") seen.add(part.handle);
      if (seen.size >= limit) return [...seen];
    }
  }
  return [...seen];
}

/**
 * The `@partial` the caret sits right after, for autocomplete: start offset
 * of the `@` and the typed query (may be empty). Null when the caret is not
 * inside a mention.
 */
export function mentionAtCaret(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|[\s([{"'«„—-])@([a-z0-9-]{0,32})$/i.exec(before);
  if (!m) return null;
  // Inside an unclosed fence or inline code, `@` is literal.
  if ((before.match(/^[ \t]*```/gm)?.length ?? 0) % 2 === 1) return null;
  const line = before.slice(before.lastIndexOf("\n") + 1);
  if ((line.match(/`/g)?.length ?? 0) % 2 === 1) return null;
  return { start: caret - m[2].length - 1, query: m[2].toLowerCase() };
}
