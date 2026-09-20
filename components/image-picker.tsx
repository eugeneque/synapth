"use client";

/**
 * Profile image pickers for the settings form: a drop zone for the header
 * banner and a square well for the avatar. Both hand the chosen file to
 * `prepareImage` (client-side crop + compress) and report a data URL up;
 * the form owns the value, so pickers stay stateless apart from drag/busy.
 */

import { useId, useRef, useState, type DragEvent } from "react";
import { Camera, Loader2, Pencil, Trash2, UploadCloud } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { ImageError, prepareImage, type ImageBox } from "@/axon/image";
import { AVATAR_IMAGE, COVER_IMAGE, IMAGE_MIME_TYPES } from "@/types/profile";
import { cn } from "@/lib/utils";

interface PickerProps {
  value: string | null;
  onChange: (url: string | null) => void;
  onError: (code: ImageError["code"]) => void;
}

const ACCEPT = IMAGE_MIME_TYPES.join(",");

/** Shared file → data URL pipeline; swallows the busy flag and routes errors to the form. */
function usePick(box: ImageBox, { onChange, onError }: Pick<PickerProps, "onChange" | "onError">) {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function pick(file: File | undefined) {
    if (!file || busy) return;
    setBusy(true);
    try {
      onChange(await prepareImage(file, box));
    } catch (err) {
      onError(err instanceof ImageError ? err.code : "decode");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const input = <input ref={inputRef} type="file" accept={ACCEPT} className="sr-only" onChange={(e) => void pick(e.target.files?.[0])} />;
  return { busy, pick, input, open: () => inputRef.current?.click() };
}

/** 3:1 banner. Empty state is a drop zone; with a value it previews and offers Change / Remove. */
export function CoverPicker({ value, onChange, onError, fallbackLabel }: PickerProps & { fallbackLabel: string }) {
  const { t } = useI18n();
  const id = useId();
  const [over, setOver] = useState(false);
  const { busy, pick, input, open } = usePick(COVER_IMAGE, { onChange, onError });

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
    void pick(e.dataTransfer.files?.[0]);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn("group relative h-40 overflow-hidden rounded-lg border transition-colors sm:h-44", over ? "border-synapse/60 bg-synapse/5" : "border-border", !value && "dot-matrix bg-gradient-to-r from-surface-lowest via-surface-low to-surface-lowest")}
    >
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : null}
      <div className={cn("absolute inset-0 bg-gradient-to-t from-card via-transparent to-transparent", value && "opacity-80")} />

      {value ? (
        <div className="label-mono-sm absolute left-4 top-3 flex items-center gap-2 tracking-[0.2em] text-foreground/80">
          <span className="dot-live" /> {fallbackLabel}
        </div>
      ) : (
        <button type="button" onClick={open} disabled={busy} aria-describedby={id} className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface-lowest/90 text-muted-foreground transition-colors group-hover:border-synapse/40 group-hover:text-synapse">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <UploadCloud className="h-5 w-5" />}
          </span>
          <span className="text-sm text-foreground">
            {t("settings.identity.coverDrop")} <span className="text-synapse underline underline-offset-2">{t("settings.identity.browse")}</span>
          </span>
          <span id={id} className="label-mono-sm normal-case tracking-normal">
            {t("settings.identity.coverEmptyHint")}
          </span>
        </button>
      )}

      {value && (
        <div className="absolute right-3 top-3 flex items-center gap-1.5">
          <button type="button" onClick={open} disabled={busy} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface-lowest/80 px-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-foreground backdrop-blur transition-colors hover:border-foreground/40">
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />} {t("settings.identity.change")}
          </button>
          <button type="button" onClick={() => onChange(null)} disabled={busy} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface-lowest/80 px-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground backdrop-blur transition-colors hover:border-danger/40 hover:text-danger">
            <Trash2 className="h-3 w-3" /> {t("settings.identity.remove")}
          </button>
        </div>
      )}
      {input}
    </div>
  );
}

/** 96px square avatar well with a hover overlay and an edit button in the corner. */
export function AvatarPicker({ value, onChange, onError, initial }: PickerProps & { initial: string }) {
  const { t } = useI18n();
  const { busy, input, open } = usePick(AVATAR_IMAGE, { onChange, onError });

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="relative">
        <button type="button" onClick={open} disabled={busy} aria-label={t("settings.identity.avatarUpload")} className="group relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-lg border-2 border-foreground/20 bg-surface-lowest transition-colors hover:border-synapse/50">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="font-display text-3xl font-medium">{initial}</span>
          )}
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
            {busy ? <Loader2 className="h-5 w-5 animate-spin text-white" /> : <Camera className="h-5 w-5 text-white" />}
            <span className="label-mono-sm text-[9px] text-white">{t("settings.identity.avatarUpload")}</span>
          </span>
        </button>
        <button type="button" onClick={open} disabled={busy} aria-hidden tabIndex={-1} className="absolute -bottom-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-synapse text-synapse-foreground shadow-glow transition-transform hover:scale-105">
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
      {value && (
        <button type="button" onClick={() => onChange(null)} disabled={busy} className="label-mono-sm inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-danger">
          <Trash2 className="h-3 w-3" /> {t("settings.identity.remove")}
        </button>
      )}
      {input}
    </div>
  );
}
