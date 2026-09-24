"use client";

/**
 * SkillsetEditor — create / edit form: avatar, name, summary, markdown
 * description (with images) and the composition, filled from the catalogue
 * through `SkillPickerDialog`. Saving goes through `saveSkillset`; the server
 * diffs the composition and writes the history.
 */

import { useCallback, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowDown, ArrowUp, Loader2, Plus, Save, Trash2, X } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { useToast } from "@/axon/toast";
import { removeSkillset, saveSkillset, uploadSkillsetDescriptionImage } from "@/app/(site)/skillset-actions";
import { AvatarPicker } from "@/components/image-picker";
import { MarkdownEditor } from "@/components/markdown-editor";
import { SkillPickerDialog } from "@/components/skill-picker-dialog";
import { CategoryIcon } from "@/components/category-icon";
import { SecurityBadge } from "@/components/security-badge";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { UiKey } from "@/lib/i18n";
import { SKILLSET_DESCRIPTION_MAX, SKILLSET_IMAGE, SKILLSET_IMAGE_PATH, SKILLSET_ITEMS_MAX, SKILLSET_NAME_MAX, SKILLSET_SUMMARY_MAX, type SkillsetSkillRef } from "@/types/skillset";

export interface SkillsetDraft {
  id: string;
  slug: string;
  name: string;
  summary: string;
  description: string;
  avatar: string | null;
  items: SkillsetSkillRef[];
}

const LOCAL_IMAGES = [SKILLSET_IMAGE_PATH] as const;

/** `initial` = editing an existing set; `seed` pre-fills the composition of a new one. */
export function SkillsetEditor({ initial, seed = [], canDelete = false }: { initial: SkillsetDraft | null; seed?: SkillsetSkillRef[]; canDelete?: boolean }) {
  const { t, n } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [avatar, setAvatar] = useState<string | null>(initial?.avatar ?? null);
  const [items, setItems] = useState<SkillsetSkillRef[]>(initial?.items ?? seed);
  const [picker, setPicker] = useState(false);
  const [saving, startSave] = useTransition();
  const [deleting, startDelete] = useTransition();

  const selected = useMemo(() => new Set(items.map((i) => i.id)), [items]);
  const full = items.length >= SKILLSET_ITEMS_MAX;
  const sandboxed = items.filter((i) => i.securityLevel === "Sandbox").length;

  const fail = useCallback((message: string) => toast({ tone: "danger", title: t("skillset.editor.failed"), body: message }), [toast, t]);
  const closePicker = useCallback(() => setPicker(false), []);

  function toggle(skill: SkillsetSkillRef) {
    setItems((prev) => (prev.some((i) => i.id === skill.id) ? prev.filter((i) => i.id !== skill.id) : prev.length >= SKILLSET_ITEMS_MAX ? prev : [...prev, skill]));
  }

  function move(index: number, delta: -1 | 1) {
    setItems((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startSave(async () => {
      const res = await saveSkillset(initial?.id ?? null, { name, summary, description, avatar, skillIds: items.map((i) => i.id) });
      if (!res.ok) {
        fail(res.error);
        return;
      }
      toast({ tone: "success", title: t(initial ? "skillset.editor.saved" : "skillset.editor.created"), body: name });
      router.push(`/skillsets/${res.data.slug}`);
      router.refresh();
    });
  }

  function destroy() {
    if (!initial || !window.confirm(t("skillset.editor.confirmDelete", { name: initial.name }))) return;
    startDelete(async () => {
      const res = await removeSkillset(initial.id);
      if (!res.ok) {
        fail(res.error);
        return;
      }
      toast({ tone: "success", title: t("skillset.editor.deleted"), body: initial.name });
      router.push("/dashboard/skillsets");
      router.refresh();
    });
  }

  const upload = useCallback(async (dataUrl: string) => {
    const res = await uploadSkillsetDescriptionImage(dataUrl);
    return res.ok ? { url: res.data.url } : { error: res.error };
  }, []);

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <div className="flex min-w-0 flex-col gap-6 lg:col-span-7">
        <Panel title={t("skillset.editor.identity")} corners bodyClassName="p-5">
          <div className="flex flex-col gap-5 sm:flex-row">
            <div className="space-y-1.5">
              <Label>{t("skillset.editor.avatar")}</Label>
              <AvatarPicker value={avatar} onChange={setAvatar} onError={(code) => fail(t(`settings.image.error.${code}` as UiKey))} initial={(name.trim()[0] ?? "S").toUpperCase()} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="ss-name">{t("skillset.editor.name")}</Label>
                <Input id="ss-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={SKILLSET_NAME_MAX} required minLength={2} placeholder={t("skillset.editor.namePlaceholder")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ss-summary">{t("skillset.editor.summary")}</Label>
                <textarea id="ss-summary" value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={SKILLSET_SUMMARY_MAX} rows={3} placeholder={t("skillset.editor.summaryPlaceholder")} className="w-full resize-none rounded-lg border border-border bg-muted px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/70 focus-visible:border-synapse/60" />
                <p className="label-mono-sm text-right normal-case tracking-normal">
                  {summary.length} / {SKILLSET_SUMMARY_MAX}
                </p>
              </div>
            </div>
          </div>
        </Panel>

        <section className="space-y-2">
          <Label htmlFor="ss-description" className="label-mono">
            {t("skillset.editor.description")}
          </Label>
          <MarkdownEditor id="ss-description" value={description} onChange={setDescription} maxLength={SKILLSET_DESCRIPTION_MAX} onUploadImage={upload} onError={fail} imageBox={SKILLSET_IMAGE} localImagePrefixes={LOCAL_IMAGES} placeholder={t("skillset.editor.descriptionPlaceholder")} />
        </section>
      </div>

      <aside className="flex min-w-0 flex-col gap-6 lg:col-span-5">
        <Panel
          title={t("skillset.editor.composition")}
          meta={`${items.length} / ${SKILLSET_ITEMS_MAX}`}
          corners
          actions={
            <Button type="button" size="sm" variant="mono" onClick={() => setPicker(true)}>
              <Plus /> {t("skillset.editor.add")}
            </Button>
          }
          footer={<span>{t("skillset.editor.compositionHint")}</span>}
        >
          {items.length ? (
            <ol className="divide-y divide-border">
              {items.map((skill, i) => (
                <li key={skill.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="w-5 shrink-0 text-right font-mono text-[11px] text-muted-foreground">{i + 1}</span>
                  <CategoryIcon category={skill.category} className="h-4 w-4 shrink-0 text-synapse" />
                  <div className="min-w-0 flex-1">
                    <Link href={`/skills/${skill.slug}`} target="_blank" className="block truncate text-sm font-medium hover:text-synapse">
                      {skill.name}
                    </Link>
                    <span className="flex items-center gap-2">
                      <SecurityBadge level={skill.securityLevel} />
                      <span className="truncate font-mono text-[11px] text-muted-foreground">{t(`skillset.kind.${skill.category}`)}</span>
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t("skillset.editor.up")} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30">
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label={t("skillset.editor.down")} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30">
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => toggle(skill)} aria-label={t("skillset.editor.remove", { name: skill.name })} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-danger/10 hover:text-danger">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <button type="button" onClick={() => setPicker(true)} className="flex w-full flex-col items-center gap-2 px-6 py-10 text-center text-sm text-muted-foreground transition-colors hover:text-foreground">
              <Plus className="h-5 w-5 text-synapse" />
              {t("skillset.editor.emptyComposition")}
            </button>
          )}
        </Panel>

        {sandboxed > 0 && (
          <p className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/10 p-3 text-xs text-warn">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {n("skillset.editor.sandboxWarning", sandboxed)}
          </p>
        )}
        {initial && (
          <p className="text-xs text-muted-foreground">{t("skillset.editor.verificationNote")}</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={saving || name.trim().length < 2}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />} {t(initial ? "skillset.editor.save" : "skillset.editor.create")}
          </Button>
          <Button asChild variant="ghost">
            <Link href={initial ? `/skillsets/${initial.slug}` : "/search?tab=skillsets"}>{t("skillset.editor.cancel")}</Link>
          </Button>
          {initial && canDelete && (
            <Button type="button" variant="destructive" onClick={destroy} disabled={deleting} className="ml-auto">
              {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />} {t("skillset.editor.delete")}
            </Button>
          )}
        </div>
      </aside>

      <SkillPickerDialog open={picker} onClose={closePicker} selected={selected} onToggle={toggle} full={full} />
    </form>
  );
}
