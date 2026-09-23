import type { Translator, UiKey } from "@/lib/i18n";
import type { ModerationStatus } from "@/types/moderation";
import { cn } from "@/lib/utils";

const TONE: Record<ModerationStatus, string> = {
  pending: "bg-warn/10 text-warn",
  approved: "bg-synapse/10 text-synapse",
  rejected: "bg-danger/10 text-danger",
};

/** Request status chip (queue rows, review page). */
export function ModerationStatusChip({ status, t, className }: { status: ModerationStatus; t: Translator<UiKey>["t"]; className?: string }) {
  return <span className={cn("label-mono-sm rounded px-2 py-0.5", TONE[status], className)}>{t(`moderation.status.${status}`)}</span>;
}
