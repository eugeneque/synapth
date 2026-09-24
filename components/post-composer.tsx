"use client";

/**
 * PostComposer — the owner's "new post" box on the profile page.
 *
 *   - photos: picked, pasted or dropped; scaled in the browser
 *     (`prepareImage`, fit "contain") and uploaded one by one as drafts
 *     (`uploadPostPhoto`), then published in strip order with the post;
 *   - code: the toolbar button wraps the selection in a ``` fence (the
 *     language is guessed on the server when the fence names none);
 *   - @mentions: typing `@` opens a people picker fed by the global search.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { ArrowLeft, Code2, ImagePlus, Loader2, Send, X } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { useToast } from "@/axon/toast";
import { ImageError, prepareImage } from "@/axon/image";
import { discardPostPhoto, publishPost, uploadPostPhoto } from "@/app/(site)/social-actions";
import { Avatar } from "@/components/avatar";
import { VerifiedMark } from "@/components/verified-mark";
import { mentionAtCaret } from "@/lib/post-body";
import { cn } from "@/lib/utils";
import type { UiKey } from "@/lib/i18n";
import { IMAGE_MIME_TYPES } from "@/types/profile";
import type { GlobalSearchResponse } from "@/types/search";
import { POST_IMAGE, POST_MAX_IMAGES, POST_MAX_LENGTH, type AuthorRef, type Post } from "@/types/social";

interface Photo {
  key: string;
  preview: string;
  /** Draft id once uploaded. */
  id: string | null;
}

interface MentionState {
  start: number;
  query: string;
  people: AuthorRef[];
  loading: boolean;
  active: number;
}

const MENTION_DEBOUNCE_MS = 150;

export function PostComposer({ viewer, handle, onPublished }: { viewer: AuthorRef; handle: string; onPublished: (post: Post) => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [draft, setDraft] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [mention, setMention] = useState<MentionState | null>(null);
  const [pending, start] = useTransition();
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const searchSeq = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  /** Caret to restore after a programmatic edit; applied in the same commit, before the next keystroke lands. */
  const pendingCaret = useRef<number | null>(null);

  useEffect(() => () => clearTimeout(searchTimer.current), []);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el || pendingCaret.current === null) return;
    el.focus();
    el.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [draft]);

  const canPublish = !pending && uploading === 0 && (draft.trim().length > 0 || photos.length > 0);

  // ---- photos ------------------------------------------------------------

  const addFiles = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => (IMAGE_MIME_TYPES as readonly string[]).includes(f.type) || f.type.startsWith("image/"));
      if (!images.length) return;
      const room = POST_MAX_IMAGES - photos.length;
      if (images.length > room) toast({ tone: "warn", title: t("posts.photoFailed"), body: t("posts.photoLimit", { n: POST_MAX_IMAGES }) });
      for (const file of images.slice(0, Math.max(0, room))) {
        const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`;
        setUploading((n) => n + 1);
        try {
          const preview = await prepareImage(file, POST_IMAGE, { fit: "contain" });
          setPhotos((list) => [...list, { key, preview, id: null }]);
          const res = await uploadPostPhoto(preview);
          if (!res.ok) {
            setPhotos((list) => list.filter((p) => p.key !== key));
            toast({ tone: "danger", title: t("posts.photoFailed"), body: res.error });
          } else {
            setPhotos((list) => list.map((p) => (p.key === key ? { ...p, id: res.data.id } : p)));
          }
        } catch (err) {
          setPhotos((list) => list.filter((p) => p.key !== key));
          const code = err instanceof ImageError ? err.code : "decode";
          toast({ tone: "danger", title: t("posts.photoFailed"), body: t(`settings.image.error.${code}` as UiKey) });
        } finally {
          setUploading((n) => n - 1);
        }
      }
    },
    [photos.length, t, toast],
  );

  function removePhoto(photo: Photo) {
    setPhotos((list) => list.filter((p) => p.key !== photo.key));
    if (photo.id) void discardPostPhoto(photo.id);
  }

  function movePhotoLeft(index: number) {
    if (index <= 0) return;
    setPhotos((list) => {
      const next = [...list];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }

  // ---- text editing helpers ---------------------------------------------

  function replaceRange(from: number, to: number, insert: string, caretOffset = insert.length) {
    const next = (draft.slice(0, from) + insert + draft.slice(to)).slice(0, POST_MAX_LENGTH);
    pendingCaret.current = Math.min(next.length, from + caretOffset);
    setDraft(next);
  }

  function insertCode() {
    const el = area.current;
    const from = el?.selectionStart ?? draft.length;
    const to = el?.selectionEnd ?? draft.length;
    const selected = draft.slice(from, to);
    const lead = from > 0 && draft[from - 1] !== "\n" ? "\n" : "";
    const tail = to < draft.length && draft[to] !== "\n" ? "\n" : "";
    const block = `${lead}\`\`\`\n${selected}\n\`\`\`${tail}`;
    // Caret lands inside the fence: after the selection, or on the empty line.
    replaceRange(from, to, block, lead.length + 4 + selected.length);
  }

  // ---- mentions ----------------------------------------------------------

  function syncMention(text: string, caret: number) {
    const at = mentionAtCaret(text, caret);
    clearTimeout(searchTimer.current);
    if (!at) {
      setMention(null);
      return;
    }
    setMention((m) => ({ start: at.start, query: at.query, people: m && m.start === at.start ? m.people : [], loading: true, active: 0 }));
    const seq = ++searchSeq.current;
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/v1/search/global?q=${encodeURIComponent(`@${at.query}`)}&limit=6`);
        const body = (await res.json()) as GlobalSearchResponse;
        if (seq !== searchSeq.current) return;
        const people = body.items.flatMap((h) => (h.kind === "user" && h.person.id !== viewer.id ? [h.person] : []));
        setMention((m) => (m ? { ...m, people, loading: false, active: 0 } : m));
      } catch {
        if (seq === searchSeq.current) setMention((m) => (m ? { ...m, people: [], loading: false } : m));
      }
    }, MENTION_DEBOUNCE_MS);
  }

  function pickMention(person: AuthorRef) {
    if (!mention) return;
    const caret = area.current?.selectionStart ?? mention.start + 1 + mention.query.length;
    setMention(null);
    replaceRange(mention.start, caret, `@${person.handle} `);
  }

  // ---- publish -----------------------------------------------------------

  function publish() {
    if (!canPublish) return;
    const body = draft.trim();
    const imageIds = photos.map((p) => p.id).filter((id): id is string => Boolean(id));
    start(async () => {
      const res = await publishPost(body, handle, imageIds);
      if (!res.ok) {
        toast({ tone: "danger", title: t("posts.failed"), body: res.error });
        return;
      }
      onPublished(res.data);
      setDraft("");
      setPhotos([]);
      setMention(null);
      toast({ tone: "success", title: t("posts.publishedTitle"), body: t("posts.publishedBody") });
    });
  }

  const showMentions = mention && (mention.loading || mention.people.length > 0 || mention.query.length > 0);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        publish();
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        void addFiles([...e.dataTransfer.files]);
      }}
      className={cn("rounded-xl border bg-card p-4 transition-colors", dragging ? "border-synapse/60" : "border-border")}
    >
      <div className="flex items-start gap-3">
        <Avatar author={viewer} size="md" />
        <div className="relative min-w-0 flex-1">
          <textarea
            ref={area}
            value={draft}
            onChange={(e) => {
              const next = e.target.value.slice(0, POST_MAX_LENGTH);
              setDraft(next);
              syncMention(next, e.target.selectionStart ?? next.length);
            }}
            onSelect={(e) => {
              const el = e.currentTarget;
              if (el.selectionStart === el.selectionEnd) {
                const at = mentionAtCaret(el.value, el.selectionStart);
                if (!at) setMention(null);
                else if (!mention || mention.start !== at.start) syncMention(el.value, el.selectionStart);
              } else setMention(null);
            }}
            onBlur={() => setTimeout(() => setMention(null), 120)}
            onPaste={(e) => {
              const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
              if (!files.length) return;
              e.preventDefault();
              void addFiles(files);
            }}
            onKeyDown={(e) => {
              if (mention && mention.people.length) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const d = e.key === "ArrowDown" ? 1 : -1;
                  setMention({ ...mention, active: (mention.active + d + mention.people.length) % mention.people.length });
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  pickMention(mention.people[mention.active]);
                  return;
                }
              }
              if (mention && e.key === "Escape") {
                e.preventDefault();
                setMention(null);
                return;
              }
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") publish();
            }}
            rows={3}
            placeholder={t("posts.placeholder")}
            aria-autocomplete="list"
            aria-controls="post-mention-list"
            className="w-full resize-y rounded-lg border border-border bg-muted px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:border-synapse/60 focus:outline-none focus:ring-1 focus:ring-synapse/25"
          />

          {showMentions && (
            <div id="post-mention-list" role="listbox" aria-label={t("posts.mention.label")} className="absolute left-0 right-0 top-full z-20 mt-1 max-w-sm overflow-hidden rounded-lg border border-border bg-card p-1 shadow-2xl">
              {mention.people.length === 0 ? (
                <div className="px-2.5 py-2 font-mono text-[11px] text-muted-foreground">{mention.loading ? t("posts.mention.searching") : t("posts.mention.empty")}</div>
              ) : (
                mention.people.map((p, i) => (
                  <button
                    key={p.id}
                    type="button"
                    role="option"
                    aria-selected={i === mention.active}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setMention({ ...mention, active: i })}
                    onClick={() => pickMention(p)}
                    className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors", i === mention.active ? "bg-accent" : "hover:bg-accent/60")}
                  >
                    <Avatar author={p} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1 truncate text-sm font-medium text-foreground">
                        {p.name || p.handle}
                        {p.verified && <VerifiedMark size="sm" />}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">@{p.handle}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          )}

          {photos.length > 0 && (
            <ul className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {photos.map((photo, i) => (
                <li key={photo.key} className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.preview} alt="" className={cn("h-full w-full object-cover", !photo.id && "opacity-50")} />
                  {!photo.id && <Loader2 className="absolute inset-0 m-auto h-4 w-4 animate-spin text-foreground" />}
                  <span className="absolute left-1 top-1 rounded bg-background/80 px-1 font-mono text-[9px] tabular-nums text-foreground/80">{i + 1}</span>
                  <button type="button" onClick={() => removePhoto(photo)} aria-label={t("posts.photoRemove")} className="absolute right-1 top-1 rounded-full bg-background/85 p-0.5 text-foreground transition-colors hover:text-danger">
                    <X className="h-3 w-3" />
                  </button>
                  {i > 0 && (
                    <button type="button" onClick={() => movePhotoLeft(i)} aria-label={t("posts.photoMove")} className="absolute bottom-1 left-1 rounded-full bg-background/85 p-0.5 text-foreground opacity-0 transition-opacity hover:text-synapse focus:opacity-100 group-hover:opacity-100">
                      <ArrowLeft className="h-3 w-3" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1">
              <input
                ref={fileInput}
                type="file"
                accept={IMAGE_MIME_TYPES.join(",")}
                multiple
                hidden
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])];
                  e.target.value = "";
                  void addFiles(files);
                }}
              />
              <ToolbarButton icon={ImagePlus} label={t("posts.addPhotos")} disabled={photos.length >= POST_MAX_IMAGES} onClick={() => fileInput.current?.click()} badge={photos.length ? `${photos.length}/${POST_MAX_IMAGES}` : undefined} />
              <ToolbarButton icon={Code2} label={t("posts.addCode")} onClick={insertCode} />
              <span className="label-mono-sm ml-2 hidden normal-case tracking-normal sm:inline">
                {draft.length} / {POST_MAX_LENGTH} · {t("posts.shortcut")}
              </span>
            </div>
            <button type="submit" disabled={!canPublish} className="inline-flex h-8 items-center gap-2 rounded-lg bg-synapse px-4 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-synapse-foreground shadow-glow transition-all hover:shadow-glow-lg disabled:opacity-50 disabled:shadow-none">
              {pending || uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} {t("posts.publish")}
            </button>
          </div>
          <p className="mt-1.5 font-mono text-[10px] text-muted-foreground/70">{t("posts.hint")}</p>
        </div>
      </div>
    </form>
  );
}

function ToolbarButton({ icon: Icon, label, onClick, disabled, badge }: { icon: typeof Code2; label: string; onClick: () => void; disabled?: boolean; badge?: string }) {
  return (
    // mousedown keeps the textarea focused, so the caret the toolbar acts on is the one the user left.
    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick} disabled={disabled} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground disabled:opacity-40">
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
      {badge && <span className="tabular-nums text-synapse">{badge}</span>}
    </button>
  );
}
