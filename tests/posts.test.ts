import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createPost, deletePost, discardPostImage, getPostImage, listPosts, resetSocialForTests, uploadPostImage, NotFoundError } from "@/cortex/social";
import { listNotifications, resetNotificationsForTests } from "@/cortex/notifications";
import { highlightCode, renderPostContent } from "@/cortex/post-content";
import { detectLanguage, normalizeLang } from "@/lib/code-lang";
import { extractMentions, mentionAtCaret, splitInline, splitPostBody } from "@/lib/post-body";
import { POST_IMAGE_PATH, POST_MAX_IMAGES } from "@/types/social";

const DEMO = "usr_demo";
const ACME = "usr_acme";
const KITE = "usr_kite";

// 1×1 transparent PNG.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

beforeEach(() => {
  resetSocialForTests();
  resetNotificationsForTests();
});

test("body grammar: fences, inline code and mentions; code and emails are not mentions", () => {
  const blocks = splitPostBody("Hi @Acme and mail me at a@b.co\n\n```ts\nconst x = '@kite';\n```\nbye");
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ["text", "code", "text"],
  );
  assert.deepEqual(blocks[1], { kind: "code", lang: "ts", code: "const x = '@kite';" });
  assert.deepEqual(extractMentions("Hi @Acme, @acme and `@nimbus` — a@b.co\n```\n@kite\n```"), ["acme"]);
  assert.deepEqual(splitInline("ping @kite: run `ls`"), [
    { kind: "text", text: "ping " },
    { kind: "mention", handle: "kite", raw: "kite" },
    { kind: "text", text: ": run " },
    { kind: "code", text: "ls" },
  ]);
  // An unclosed fence runs to the end.
  assert.deepEqual(splitPostBody("```\nnpm i"), [{ kind: "code", lang: null, code: "npm i" }]);
});

test("mention autocomplete: the @partial right before the caret, not inside code", () => {
  assert.deepEqual(mentionAtCaret("hey @ac", 7), { start: 4, query: "ac" });
  assert.deepEqual(mentionAtCaret("@", 1), { start: 0, query: "" });
  assert.equal(mentionAtCaret("mail a@b", 8), null);
  assert.equal(mentionAtCaret("`@ac", 4), null);
  assert.equal(mentionAtCaret("```\n@ac", 7), null);
});

test("language detection: signatures for short snippets, aliases on fences", () => {
  const cases: [string, string][] = [
    ["SELECT id, name FROM users WHERE id = 1;", "sql"],
    ['{"a": 1, "b": [1, 2]}', "json"],
    ["npm install lowlight\ncd app", "bash"],
    ['fn main() {\n    println!("hi");\n}', "rust"],
    ["def foo(x):\n    return x * 2", "python"],
    ["interface A { b: string }\nexport function f(a: A): void {}", "typescript"],
    ["const x = await fetch(url);\nconsole.log(x);", "javascript"],
    ['package main\n\nimport "fmt"\n\nfunc main() { fmt.Println(1) }', "go"],
    ['<div class="x">hi</div>', "xml"],
    ["#include <iostream>\nint main() { std::cout << 1; }", "cpp"],
    ["@@ -1,2 +1,2 @@\n-a\n+b", "diff"],
  ];
  for (const [code, lang] of cases) assert.equal(detectLanguage(code), lang, code);
  assert.equal(detectLanguage("hello world"), null);
  assert.equal(normalizeLang("TS"), "typescript");
  assert.equal(normalizeLang("sh"), "bash");
  assert.equal(normalizeLang("brainfuck"), null);
});

test("highlighting: named, guessed and unknown fence languages; tokens reassemble the source", () => {
  const named = highlightCode("const a = 1;", "js");
  assert.equal(named.lang, "javascript");
  assert.equal(named.auto, false);
  assert.ok(named.tokens.some((t) => t.cls?.includes("hljs-keyword")));
  assert.equal(named.tokens.map((t) => t.text).join(""), "const a = 1;");

  const guessed = highlightCode("SELECT * FROM skills;", null);
  assert.deepEqual([guessed.lang, guessed.label, guessed.auto], ["sql", "SQL", true]);

  const unknown = highlightCode("+++[>+<-]", "brainfuck");
  assert.deepEqual([unknown.lang, unknown.label, unknown.tokens], ["plaintext", "brainfuck", [{ text: "+++[>+<-]" }]]);

  // Markup inside code is text, never HTML.
  const html = highlightCode("<script>alert(1)</script>", "html");
  assert.equal(html.tokens.map((t) => t.text).join(""), "<script>alert(1)</script>");
  assert.ok(html.tokens.every((t) => !t.cls || /^[\w\s-]+$/.test(t.cls)));
});

test("rendered content: only real accounts become mentions", () => {
  const acme = { id: ACME, name: "Acme Labs", handle: "acme", image: null, occupation: null };
  const [block] = renderPostContent("hi @Acme and @ghost", new Map([["acme", acme]]));
  assert.deepEqual(block, {
    kind: "text",
    parts: [
      { kind: "text", text: "hi " },
      { kind: "mention", user: acme },
      { kind: "text", text: " and @ghost" },
    ],
  });
});

test("mentions: tagged people get post.mention (instead of post.new), the author and strangers do not", async () => {
  const post = await createPost(DEMO, "Thanks @acme and @kite! cc @demo @nobody\n```\n@nimbus\n```");
  const mentions = post.content.flatMap((b) => (b.kind === "text" ? b.parts.filter((p) => p.kind === "mention") : []));
  assert.deepEqual(
    mentions.map((m) => (m.kind === "mention" ? m.user.handle : "")),
    ["acme", "kite", "demo"],
  );
  assert.equal(post.content[1].kind, "code");

  const acme = await listNotifications(ACME);
  assert.equal(acme.items.filter((n) => n.kind === "post.mention").length, 1);
  assert.equal(acme.items.filter((n) => n.kind === "post.new").length, 0);
  assert.equal((await listNotifications(DEMO)).items.filter((n) => n.kind === "post.mention").length, 0);
  // Inside a code block `@nimbus` is literal.
  assert.equal((await listNotifications("usr_nimbus")).items.filter((n) => n.kind === "post.mention").length, 0);
});

test("photos: drafts attach in order, only to their owner's post, and are served only once published", async () => {
  const a = await uploadPostImage(DEMO, PNG);
  const b = await uploadPostImage(DEMO, PNG);
  assert.equal(await getPostImage(a.id), null, "drafts are not served");
  await assert.rejects(uploadPostImage(DEMO, "data:text/html;base64,PGgxPg=="));

  // Someone else's draft cannot be attached.
  await assert.rejects(createPost(KITE, "steal", { imageIds: [a.id] }), NotFoundError);

  const post = await createPost(DEMO, "", { imageIds: [b.id, a.id] });
  assert.deepEqual(
    post.images.map((i) => i.id),
    [b.id, a.id],
  );
  assert.equal(post.images[0].url, `${POST_IMAGE_PATH}${b.id}`);
  assert.equal((await getPostImage(a.id))?.mime, "image/png");
  assert.deepEqual((await listPosts(DEMO))[0].images, post.images);

  // Attached photos cannot be reused or discarded.
  await assert.rejects(createPost(DEMO, "again", { imageIds: [a.id] }), NotFoundError);
  await discardPostImage(DEMO, a.id);
  assert.ok(await getPostImage(a.id));

  await deletePost(DEMO, post.id);
  assert.equal(await getPostImage(a.id), null);
});

test("photos: empty posts, too many photos and duplicates are rejected; discarded drafts are gone", async () => {
  await assert.rejects(createPost(DEMO, "   "));
  const ids = [];
  for (let i = 0; i <= POST_MAX_IMAGES; i++) ids.push((await uploadPostImage(DEMO, PNG)).id);
  await assert.rejects(createPost(DEMO, "many", { imageIds: ids }));
  await assert.rejects(createPost(DEMO, "dup", { imageIds: [ids[0], ids[0]] }));

  await discardPostImage(DEMO, ids[0]);
  await assert.rejects(createPost(DEMO, "gone", { imageIds: [ids[0]] }), NotFoundError);
});
