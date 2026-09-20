"use client";

import { useI18n } from "@/axon/i18n";
import { cn } from "@/lib/utils";
import { SKILL_CATEGORIES, type SkillCategory } from "@/types/skill";

interface Props {
  value: SkillCategory | null;
  onChange: (category: SkillCategory | null) => void;
  counts?: Partial<Record<SkillCategory, number>>;
  total?: number;
}

/** Category segment row: uppercase mono buttons, the active one on a raised surface (design.md §6). */
export function CategoryPills({ value, onChange, counts, total }: Props) {
  const { t } = useI18n();
  const item = (label: string, active: boolean, onClick: () => void, hint?: string, count?: number) => (
    <button
      key={label}
      type="button"
      title={hint}
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-3 font-mono text-[11px] font-medium uppercase tracking-[0.14em] transition-colors",
        active ? "bg-surface-high text-foreground shadow-sm" : "text-muted-foreground hover:bg-surface hover:text-foreground",
      )}
    >
      {label}
      {typeof count === "number" && <span className={cn("text-[10px] tracking-normal", active ? "text-synapse" : "opacity-60")}>({count.toLocaleString("en")})</span>}
    </button>
  );

  return (
    <div className="no-scrollbar flex items-center gap-1 overflow-x-auto sm:gap-2">
      {item(t("category.all"), value === null, () => onChange(null), undefined, total)}
      {SKILL_CATEGORIES.map((c) => item(t(`category.${c}.label`), value === c, () => onChange(value === c ? null : c), t(`category.${c}.hint`), counts?.[c]))}
    </div>
  );
}
