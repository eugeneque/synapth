import Link from "next/link";
import { BadgeCheck, History, Minus, PencilLine, Plus, ShieldOff, Sparkles } from "lucide-react";
import { Panel } from "@/components/panel";
import { Avatar } from "@/components/avatar";
import { cn, timeAgo } from "@/lib/utils";
import type { Translator, UiKey } from "@/lib/i18n";
import type { SkillsetChange, SkillsetChangeAction } from "@/types/skillset";

const ICON: Record<SkillsetChangeAction, typeof Plus> = { created: Sparkles, added: Plus, removed: Minus, edited: PencilLine, verified: BadgeCheck, unverified: ShieldOff };
const TONE: Record<SkillsetChangeAction, string> = { created: "text-synapse", added: "text-synapse", removed: "text-danger", edited: "text-info", verified: "text-synapse", unverified: "text-warn" };

/** "История изменений": one line per event, newest first; skills link to their catalogue page. */
export function SkillsetHistory({ changes, i18n }: { changes: SkillsetChange[]; i18n: Pick<Translator<UiKey>, "t" | "n"> }) {
  const { t } = i18n;
  return (
    <Panel id="history" title={t("skillset.history.title")} meta={i18n.n("skillset.history.count", changes.length)} icon={<History className="h-4 w-4 shrink-0 text-synapse" />} corners className="scroll-mt-20">
      {changes.length ? (
        <ol className="divide-y divide-border">
          {changes.map((c) => {
            const Icon = ICON[c.action];
            const skill = c.skillName ? (c.skillSlug ? <Link href={`/skills/${c.skillSlug}`} className="font-medium text-foreground hover:text-synapse">{c.skillName}</Link> : <span className="font-medium text-foreground">{c.skillName}</span>) : <span className="font-mono text-xs">{c.skillId}</span>;
            return (
              <li key={c.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-surface", TONE[c.action])}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-muted-foreground">
                    {c.action === "added" || c.action === "removed" ? (
                      <>
                        {t(`skillset.history.${c.action}`)} {skill}
                      </>
                    ) : c.action === "edited" ? (
                      <>
                        {t("skillset.history.edited")} <span className="text-foreground">{c.fields.map((f) => t(`skillset.field.${f}`)).join(", ")}</span>
                      </>
                    ) : (
                      t(c.action === "unverified" && c.auto ? "skillset.history.unverifiedAuto" : `skillset.history.${c.action}`)
                    )}
                  </p>
                  <p className="label-mono-sm mt-1 flex items-center gap-1.5 normal-case tracking-normal">
                    {c.actor ? (
                      <>
                        <Avatar author={c.actor} size="xs" className="h-4 w-4 text-[8px]" />
                        <Link href={`/u/${c.actor.handle}`} className="hover:text-foreground">
                          @{c.actor.handle}
                        </Link>
                        <span>·</span>
                      </>
                    ) : (
                      <span>{t("skillset.history.system")} ·</span>
                    )}
                    <time dateTime={c.createdAt} title={new Date(c.createdAt).toUTCString()}>
                      {timeAgo(c.createdAt, i18n)}
                    </time>
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="px-4 py-6 text-sm text-muted-foreground">{t("skillset.history.empty")}</p>
      )}
    </Panel>
  );
}
