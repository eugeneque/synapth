"use client";

/**
 * FriendsCard — the profile's friend list as a side card: one row per person
 * (round avatar, name, occupation) with a round friend control reflecting the
 * viewer's own relation to that person. The first rows show, the rest fold
 * behind "Show more". For the owner, requests live in the same card: incoming
 * ones on top (they need an answer), the owner's unanswered ones folded into
 * a footnote at the bottom.
 */

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, Clock, Search, UserPlus, Users } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { Avatar } from "@/components/avatar";
import { FriendButton } from "@/components/friend-button";
import { VerifiedMark } from "@/components/verified-mark";
import { cn } from "@/lib/utils";
import type { AuthorRef, FriendState } from "@/types/social";

export type FriendRow = AuthorRef & { state: FriendState };

interface Props {
  friends: FriendRow[];
  /** Owner only: people waiting for the owner's answer. */
  incoming?: AuthorRef[] | null;
  /** Owner only: the owner's own requests nobody answered yet. */
  outgoing?: AuthorRef[] | null;
  isOwner: boolean;
  /** Profile display name, for the empty state. */
  name: string;
  className?: string;
}

const VISIBLE = 6;

export function FriendsCard({ friends, incoming, outgoing, isOwner, name, className }: Props) {
  const { t, n } = useI18n();
  const [all, setAll] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(false);
  const shown = all ? friends : friends.slice(0, VISIBLE);

  return (
    <section id="friends" className={cn("scroll-mt-24 overflow-hidden rounded-xl border border-border bg-card", className)}>
      <header className="flex items-center justify-between gap-3 px-5 pb-2 pt-5">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Users className="h-4 w-4 text-synapse" /> {t("profile.friends.title")}
        </h2>
        <span className="rounded-md bg-surface px-1.5 py-px font-mono text-[11px] tabular-nums text-muted-foreground">{friends.length}</span>
      </header>

      {incoming && incoming.length > 0 && (
        <div className="mx-3 mb-2 rounded-lg border border-synapse/30 bg-synapse/[0.06] px-2 pb-1 pt-2">
          <p className="label-mono-sm flex items-center gap-1.5 px-2 text-synapse">
            <UserPlus className="h-3.5 w-3.5" /> {n("profile.friends.incomingNote", incoming.length)}
          </p>
          <ul className="stagger mt-1">
            {incoming.map((p) => (
              <PersonRow key={p.id} person={p} state="incoming" />
            ))}
          </ul>
        </div>
      )}

      {friends.length > 0 ? (
        <ul className="stagger px-3">
          {shown.map((p) => (
            <PersonRow key={p.id} person={p} state={p.state} />
          ))}
        </ul>
      ) : (
        <p className="px-5 pb-4 pt-1 text-sm leading-relaxed text-muted-foreground">
          {isOwner ? t("profile.friends.emptyOwner") : t("profile.friends.empty", { name })}
          {isOwner && (
            <Link href="/search?tab=people" className="mt-3 flex w-fit items-center gap-1.5 text-synapse hover:underline">
              <Search className="h-3.5 w-3.5" /> {t("profile.friends.find")}
            </Link>
          )}
        </p>
      )}

      {friends.length > VISIBLE && (
        <button type="button" onClick={() => setAll((a) => !a)} aria-expanded={all} className="mx-auto flex items-center gap-1 px-3 pb-4 pt-2 text-sm font-medium text-synapse transition-colors hover:text-synapse/80">
          {all ? t("profile.friends.showLess") : t("profile.friends.showMore", { n: friends.length - VISIBLE })}
          <ChevronDown className={cn("h-4 w-4 transition-transform duration-200", all && "rotate-180")} />
        </button>
      )}
      {friends.length > 0 && friends.length <= VISIBLE && <div className="h-3" />}

      {/* Footnote: the owner's unanswered requests, folded — they are bookkeeping, not the list. */}
      {isOwner && outgoing && outgoing.length > 0 && (
        <div className="border-t border-border bg-surface-lowest/40">
          <button type="button" onClick={() => setPendingOpen((o) => !o)} aria-expanded={pendingOpen} className="flex w-full items-center gap-2 px-5 py-3 text-left text-xs text-muted-foreground transition-colors hover:text-foreground">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">{t("profile.friends.outgoing")}</span>
            <span className="rounded-md bg-surface px-1.5 py-px font-mono text-[11px] tabular-nums">{outgoing.length}</span>
            <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform duration-200", pendingOpen && "rotate-180")} />
          </button>
          {pendingOpen && (
            <ul className="stagger animate-rise px-3 pb-2">
              {outgoing.map((p) => (
                <PersonRow key={p.id} person={p} state="requested" />
              ))}
            </ul>
          )}
          <p className="px-5 pb-3 text-[11px] leading-snug text-muted-foreground/70">{t("profile.friends.privateNote")}</p>
        </div>
      )}
    </section>
  );
}

function PersonRow({ person, state }: { person: AuthorRef; state: FriendState }) {
  const { t } = useI18n();
  const name = person.name || person.handle;
  return (
    <li className="group relative flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-surface-lowest/70">
      <Avatar author={person} size="md" className="rounded-full" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1">
          <Link href={`/u/${person.handle}`} className="truncate text-sm font-semibold tracking-tight transition-colors after:absolute after:inset-0 after:content-[''] group-hover:text-synapse">
            {name}
          </Link>
          {person.verified && <VerifiedMark size="sm" className="shrink-0" />}
        </div>
        <p className="truncate text-xs text-muted-foreground">{person.occupation ? t(`occupation.${person.occupation}`) : `@${person.handle}`}</p>
      </div>
      <FriendButton toId={person.id} handle={person.handle} name={name} initial={state} size="icon" className="relative z-10" />
    </li>
  );
}
