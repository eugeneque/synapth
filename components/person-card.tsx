"use client";

import Link from "next/link";
import { Users } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { FriendButton } from "@/components/friend-button";
import { VerifiedMark } from "@/components/verified-mark";
import { useI18n } from "@/axon/i18n";
import { cn } from "@/lib/utils";
import type { AuthorRef, FriendState, PersonSummary } from "@/types/social";

/** People search row: who they are in one glance, and the friend control right there. */
export function PersonCard({ person, className }: { person: PersonSummary; className?: string }) {
  const { t, n } = useI18n();
  const name = person.name || person.handle;
  return (
    <article className={cn("lift group relative flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 hover:border-foreground/25", className)}>
      <div className="flex items-start gap-3.5">
        <Avatar author={person} size="lg" className="rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Link href={`/u/${person.handle}`} className="truncate text-base font-semibold tracking-tight transition-colors after:absolute after:inset-0 after:content-[''] group-hover:text-synapse">
              {name}
            </Link>
            {person.verified && <VerifiedMark size="sm" />}
          </div>
          <p className="truncate text-sm text-muted-foreground">
            @{person.handle}
            {person.occupation && <> · {t(`occupation.${person.occupation}`)}</>}
          </p>
        </div>
      </div>
      <p className={cn("line-clamp-2 min-h-[2.5rem] text-sm leading-relaxed", person.bio ? "text-foreground/80" : "text-muted-foreground/70")}>{person.bio || t("people.noBio")}</p>
      <div className="relative z-10 mt-auto flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5" /> {n("friend.count", person.friends)}
        </span>
        <FriendButton toId={person.id} handle={person.handle} name={name} initial={person.state} size="sm" />
      </div>
    </article>
  );
}

/** A friend tile for profile lists: avatar, name, handle; optional friend control for request lists. */
export function FriendTile({ person, state }: { person: AuthorRef; state?: FriendState }) {
  const name = person.name || person.handle;
  return (
    <div className="group relative flex items-center gap-3 rounded-xl border border-border bg-surface-lowest/60 p-2.5 pr-3 transition-colors hover:border-foreground/25">
      <Avatar author={person} size="md" className="rounded-lg" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1">
          <Link href={`/u/${person.handle}`} className="truncate text-sm font-medium transition-colors after:absolute after:inset-0 after:content-[''] group-hover:text-synapse">
            {name}
          </Link>
          {person.verified && <VerifiedMark size="sm" className="shrink-0" />}
        </div>
        <p className="truncate text-xs text-muted-foreground">@{person.handle}</p>
      </div>
      {/* Icon-only: in narrow grid cells a labelled pill used to squeeze the name to nothing and spill out of the tile. */}
      {state && <FriendButton toId={person.id} handle={person.handle} name={name} initial={state} size="icon" className="relative z-10" />}
    </div>
  );
}
