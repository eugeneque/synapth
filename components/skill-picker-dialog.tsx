"use client";

/**
 * SkillPickerDialog — the "add to skillset" modal: searches the whole
 * catalogue through `GET /api/v1/search` (same query language as /explore),
 * filters by kind (skills / MCP / plugins) and toggles entries in and out of
 * the set being edited. Selection lives in the editor; the dialog only reports.
 */

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Plus, Search, X } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { CategoryIcon } from "@/components/category-icon";
import { SecurityBadge } from "@/components/security-badge";
import { cn } from "@/lib/utils";
import type { Skill, SkillCategory } from "@/types/skill";
import type { SkillsetSkillRef } from "@/types/skillset";

interface Props {
  open: boolean;
  onClose: () => void;
  selected: ReadonlySet<string>;
  onToggle: (skill: SkillsetSkillRef) => void;
  /** Adding is disabled once the set is full; removing always works. */
  full: boolean;
}

const KINDS: Array<SkillCategory | "all"> = ["all", "Prompt", "MCP", "Tool"];
const PAGE = 20;

const toRef = (s: Skill): SkillsetSkillRef => ({ id: s.id, slug: s.slug, name: s.name, description: s.description, category: s.category, securityLevel: s.securityLevel, version: s.version, authorName: s.authorName });

export function SkillPickerDialog({ open, onClose, selected, onToggle, full }: Props) {
  const { t, n } = useI18n();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<SkillCategory | "all">("all");
  const [hits, setHits] = useState<SkillsetSkillRef[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef(0);

  async function load(offset: number) {
    const id = ++request.current;
    setLoading(true);
    setFailed(false);
    const params = new URLSearchParams({ q, limit: String(PAGE), offset: String(offset) });
    if (kind !== "all") params.set("category", kind);
    try {
      const res = await fetch(`/api/v1/search?${params}`, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { hits: Array<{ skill: Skill }>; total: number };
      if (id !== request.current) return;
      const page = body.hits.map((h) => toRef(h.skill));
      setHits((prev) => (offset ? [...prev, ...page] : page));
      setTotal(body.total);
    } catch {
      if (id === request.current) setFailed(true);
    } finally {
      if (id === request.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => void load(0), q ? 200 : 0);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, q, kind]);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/70 p-4 backdrop-blur-sm sm:pt-[10vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="skill-picker-title" className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <header className="panel-head">
          <div className="flex items-center gap-2.5">
            <span className="dot-live shrink-0" />
            <h2 id="skill-picker-title" className="label-mono text-foreground">
              {t("skillset.picker.title")}
            </h2>
            <span className="label-mono-sm hidden normal-case tracking-normal sm:inline">{n("skillset.picker.selected", selected.size)}</span>
          </div>
          <button type="button" onClick={onClose} aria-label={t("skillset.picker.close")} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-3 border-b border-border p-4">
          <label className="flex h-10 items-center gap-2 rounded-lg border border-border bg-muted px-3 focus-within:border-synapse/60">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("skillset.picker.placeholder")} className="h-full w-full bg-transparent font-mono text-sm outline-none placeholder:text-muted-foreground/70" aria-label={t("skillset.picker.placeholder")} />
            {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
          </label>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("skillset.picker.kind")}>
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                className={cn("inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors", kind === k ? "border-synapse/40 bg-synapse/10 text-synapse" : "border-border text-muted-foreground hover:text-foreground")}
              >
                {k !== "all" && <CategoryIcon category={k} className="h-3 w-3" />}
                {t(k === "all" ? "category.all" : `skillset.kinds.${k}`)}
              </button>
            ))}
          </div>
        </div>

        <ul className="flex-1 divide-y divide-border overflow-y-auto">
          {hits.map((skill) => {
            const on = selected.has(skill.id);
            return (
              <li key={skill.id} className="flex items-center gap-3 px-4 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-synapse">
                  <CategoryIcon category={skill.category} className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{skill.name}</span>
                    <SecurityBadge level={skill.securityLevel} />
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    <span className="font-mono">{skill.authorName} · v{skill.version}</span> — {skill.description}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onToggle(skill)}
                  disabled={!on && full}
                  aria-pressed={on}
                  className={cn("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors disabled:opacity-50", on ? "border-synapse/50 bg-synapse/10 text-synapse hover:border-danger/40 hover:bg-danger/10 hover:text-danger" : "border-border bg-muted text-foreground hover:border-synapse/40 hover:text-synapse")}
                >
                  {on ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                  {on ? t("skillset.picker.added") : t("skillset.picker.add")}
                </button>
              </li>
            );
          })}
          {!loading && !hits.length && <li className="px-4 py-10 text-center text-sm text-muted-foreground">{failed ? t("skillset.picker.failed") : t("skillset.picker.none")}</li>}
        </ul>

        <footer className="label-mono-sm flex items-center justify-between gap-2 border-t border-border bg-surface-low/60 px-4 py-2">
          <span>{full ? t("skillset.picker.full") : n("skillset.picker.found", total)}</span>
          <div className="flex items-center gap-2">
            {hits.length < total && (
              <button type="button" onClick={() => void load(hits.length)} disabled={loading} className="rounded-md border border-border px-2.5 py-1 hover:text-foreground disabled:opacity-50">
                {t("skillset.picker.more")}
              </button>
            )}
            <button type="button" onClick={onClose} className="rounded-md border border-synapse/40 bg-synapse/10 px-2.5 py-1 text-synapse hover:bg-synapse/20">
              {t("skillset.picker.done")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
