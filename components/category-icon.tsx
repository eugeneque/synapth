import { Plug, MessageSquareText, Wrench } from "lucide-react";
import type { SkillCategory } from "@/types/skill";

export const CATEGORY_META: Record<SkillCategory, { icon: typeof Plug; label: string; hint: string }> = {
  MCP: { icon: Plug, label: "MCP", hint: "Model Context Protocol servers" },
  Prompt: { icon: MessageSquareText, label: "Prompt", hint: "System prompt modifications" },
  Tool: { icon: Wrench, label: "Tool", hint: "Callable HTTP tools" },
};

export function CategoryIcon({ category, className = "h-4 w-4" }: { category: SkillCategory; className?: string }) {
  const Icon = CATEGORY_META[category].icon;
  return <Icon className={className} aria-label={CATEGORY_META[category].label} />;
}
