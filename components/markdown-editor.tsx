"use client";

/**
 * MarkdownEditor — textarea with a formatting toolbar, a live preview tab and
 * image insertion (button, paste or drop). Images are resized in the browser
 * (`prepareImage`, fit "contain"), uploaded through `onUploadImage` and
 * inserted as `![name](url)`; the markdown itself stays plain text.
 */

import { useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { Bold, Code, Heading2, ImagePlus, Italic, Link2, List, ListOrdered, Loader2, Quote, SquareCode, Strikethrough } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { ImageError, prepareImage } from "@/axon/image";
import { Markdown } from "@/components/markdown";
import { cn } from "@/lib/utils";
import type { UiKey } from "@/lib/i18n";
import { IMAGE_MIME_TYPES } from "@/types/profile";

interface Props {
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  /** Uploads a prepared data URL and returns the URL to reference, or an error message. */
  onUploadImage: (dataUrl: string) => Promise<{ url: string } | { error: string }>;
  onError: (message: string) => void;
  imageBox: { width: number; height: number; maxBytes: number };
  localImagePrefixes: readonly string[];
  placeholder?: string;
  id?: string;
}

type Wrap = { kind: "wrap"; before: string; after: string; fallback: string } | { kind: "line"; prefix: string | ((i: number) => string) } | { kind: "block"; before: string; after: string };

const TOOLS: Array<{ key: UiKey; icon: typeof Bold; action: Wrap; shortcut?: string }> = [
  { key: "editor.bold", icon: Bold, action: { kind: "wrap", before: "**", after: "**", fallback: "bold" }, shortcut: "b" },
  { key: "editor.italic", icon: Italic, action: { kind: "wrap", before: "*", after: "*", fallback: "italic" }, shortcut: "i" },
  { key: "editor.strike", icon: Strikethrough, action: { kind: "wrap", before: "~~", after: "~~", fallback: "text" } },
  { key: "editor.heading", icon: Heading2, action: { kind: "line", prefix: "## " } },
  { key: "editor.quote", icon: Quote, action: { kind: "line", prefix: "> " } },
  { key: "editor.list", icon: List, action: { kind: "line", prefix: "- " } },
  { key: "editor.orderedList", icon: ListOrdered, action: { kind: "line", prefix: (i) => `${i + 1}. ` } },
  { key: "editor.code", icon: Code, action: { kind: "wrap", before: "`", after: "`", fallback: "code" } },
  { key: "editor.codeBlock", icon: SquareCode, action: { kind: "block", before: "```\n", after: "\n```" } },
  { key: "editor.link", icon: Link2, action: { kind: "wrap", before: "[", after: "](https://)", fallback: "link" }, shortcut: "k" },
];

const ACCEPT = IMAGE_MIME_TYPES.join(",");

export function MarkdownEditor({ value, onChange, maxLength, onUploadImage, onError, imageBox, localImagePrefixes, placeholder, id }: Props) {
  const { t, locale } = useI18n();
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [uploading, setUploading] = useState(0);
  const [over, setOver] = useState(false);
  // Uploads finish after re-renders; edits must apply to the latest text, not the one captured at click time.
  const latest = useRef(value);
  latest.current = value;

  /** Replaces the selection and restores a caret/selection range after React re-renders. */
  function replace(start: number, end: number, text: string, select: [number, number]) {
    const current = latest.current;
    const next = current.slice(0, start) + text + current.slice(end);
    if (next.length > maxLength) return;
    latest.current = next;
    onChange(next);
    requestAnimationFrame(() => {
      const el = area.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(select[0], select[1]);
    });
  }

  function apply(action: Wrap) {
    const el = area.current;
    if (!el) return;
    setTab("write");
    const { selectionStart: s, selectionEnd: e } = el;
    const selected = value.slice(s, e);
    if (action.kind === "wrap") {
      const inner = selected || action.fallback;
      replace(s, e, action.before + inner + action.after, [s + action.before.length, s + action.before.length + inner.length]);
    } else if (action.kind === "block") {
      const lead = s > 0 && value[s - 1] !== "\n" ? "\n" : "";
      const text = `${lead}${action.before}${selected}${action.after}\n`;
      const caret = s + lead.length + action.before.length;
      replace(s, e, text, [caret, caret + selected.length]);
    } else {
      const lineStart = value.lastIndexOf("\n", s - 1) + 1;
      const block = value.slice(lineStart, e);
      const lines = block.split("\n");
      const prefixed = lines.map((l, i) => (typeof action.prefix === "function" ? action.prefix(i) : action.prefix) + l).join("\n");
      replace(lineStart, e, prefixed, [lineStart + prefixed.length, lineStart + prefixed.length]);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!(e.metaKey || e.ctrlKey)) return;
    const tool = TOOLS.find((x) => x.shortcut === e.key.toLowerCase());
    if (tool) {
      e.preventDefault();
      apply(tool.action);
    }
  }

  async function insertImages(files: File[]) {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (!images.length) return;
    setTab("write");
    for (const file of images) {
      setUploading((n) => n + 1);
      try {
        const dataUrl = await prepareImage(file, imageBox, { fit: "contain" });
        const res = await onUploadImage(dataUrl);
        if ("error" in res) {
          onError(res.error);
          continue;
        }
        const alt = file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[[\]]/g, "") || "image";
        const el = area.current;
        const text = latest.current;
        const at = el && tab === "write" ? Math.min(el.selectionEnd, text.length) : text.length;
        const lead = at > 0 && text[at - 1] !== "\n" ? "\n" : "";
        const snippet = `${lead}![${alt}](${res.url})\n`;
        replace(at, at, snippet, [at + snippet.length, at + snippet.length]);
      } catch (err) {
        onError(t(`settings.image.error.${err instanceof ImageError ? err.code : "decode"}` as UiKey));
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...e.clipboardData.files];
    if (files.some((f) => f.type.startsWith("image/"))) {
      e.preventDefault();
      void insertImages(files);
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    setOver(false);
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) {
      e.preventDefault();
      void insertImages(files);
    }
  }

  const tabClass = (active: boolean) => cn("h-9 px-3 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors", active ? "text-foreground shadow-[inset_0_-1px_0_hsl(var(--synapse))]" : "text-muted-foreground hover:text-foreground");

  return (
    <div className={cn("overflow-hidden rounded-lg border bg-muted transition-colors", over ? "border-synapse/60" : "border-border")}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-low/60 pr-2">
        <div role="tablist" className="flex">
          <button type="button" role="tab" aria-selected={tab === "write"} onClick={() => setTab("write")} className={tabClass(tab === "write")}>
            {t("editor.write")}
          </button>
          <button type="button" role="tab" aria-selected={tab === "preview"} onClick={() => setTab("preview")} className={tabClass(tab === "preview")}>
            {t("editor.preview")}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-0.5 py-1" role="toolbar" aria-label={t("editor.toolbar")}>
          {TOOLS.map((tool) => {
            const Icon = tool.icon;
            return (
              <button key={tool.key} type="button" onClick={() => apply(tool.action)} title={`${t(tool.key)}${tool.shortcut ? ` (⌘${tool.shortcut.toUpperCase()})` : ""}`} aria-label={t(tool.key)} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                <Icon className="h-3.5 w-3.5" />
              </button>
            );
          })}
          <span className="mx-1 h-4 w-px bg-border" />
          <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading > 0} title={t("editor.image")} aria-label={t("editor.image")} className="flex h-7 items-center gap-1.5 rounded-md px-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60">
            {uploading > 0 ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.1em] sm:inline">{t("editor.image")}</span>
          </button>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            multiple
            className="sr-only"
            onChange={(e) => {
              void insertImages([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div
        onDragOver={(e) => {
          if ([...e.dataTransfer.items].some((i) => i.kind === "file")) {
            e.preventDefault();
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        {tab === "write" ? (
          <textarea
            ref={area}
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value.slice(0, maxLength))}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={placeholder}
            rows={14}
            className="block min-h-[280px] w-full resize-y bg-transparent px-3 py-3 font-mono text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground/70"
          />
        ) : value.trim() ? (
          <Markdown source={value} localImagePrefixes={localImagePrefixes} className="min-h-[280px] px-4 py-3 text-sm text-foreground/90" />
        ) : (
          <p className="min-h-[280px] px-4 py-3 text-sm text-muted-foreground">{t("editor.nothing")}</p>
        )}
      </div>

      <div className="label-mono-sm flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-low/60 px-3 py-1.5 normal-case tracking-normal">
        <span>{uploading > 0 ? t("editor.uploading") : t("editor.hint")}</span>
        <span className={cn(value.length > maxLength * 0.9 && "text-warn")}>
          {value.length.toLocaleString(locale)} / {maxLength.toLocaleString(locale)}
        </span>
      </div>
    </div>
  );
}
