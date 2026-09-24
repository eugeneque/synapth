"use client";

/**
 * FriendButton — the one friend control. What a click does depends on the
 * relation: send a request, accept an incoming one, withdraw a pending
 * request, or unfriend (the destructive label only shows on hover / focus).
 * Signed-out visitors go to the sign-in gate; on your own profile it is hidden.
 * `size="icon"` is the round icon-only control for list rows (label in the tooltip).
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, Clock, Loader2, Plus, UserCheck, UserMinus, UserPlus, UserX } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { useToast } from "@/axon/toast";
import { toggleFriend } from "@/app/(site)/social-actions";
import { cn } from "@/lib/utils";
import type { FriendState } from "@/types/social";

interface Props {
  toId: string;
  handle: string;
  name: string;
  initial: FriendState;
  size?: "md" | "sm" | "icon";
  onChange?: (next: FriendState) => void;
  className?: string;
}

export function FriendButton({ toId, handle, name, initial, size = "md", onChange, className }: Props) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [state, setState] = useState(initial);
  // The same person can appear twice on a page (requests strip + grid); a server refresh after
  // either button's action hands the other a new `initial`, which must win over its stale state.
  const [synced, setSynced] = useState(initial);
  if (initial !== synced) {
    setSynced(initial);
    setState(initial);
  }
  const [pending, start] = useTransition();
  const sm = size === "sm";
  const iconOnly = size === "icon";

  if (state === "self") return null;

  const shell = cn(
    "group/friend relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-full border font-medium transition-all duration-200 active:scale-[0.97] disabled:opacity-70",
    iconOnly ? "h-8 w-8" : sm ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm",
    state === "none" || state === "anonymous" ? "border-synapse/40 bg-synapse/10 text-synapse hover:-translate-y-px hover:border-synapse/70 hover:bg-synapse/15" : state === "incoming" ? "border-synapse bg-synapse text-synapse-foreground shadow-glow hover:-translate-y-px" : "border-border bg-surface-lowest/80 text-foreground hover:border-foreground/30",
    className,
  );
  const icon = cn("shrink-0", sm || iconOnly ? "h-3.5 w-3.5" : "h-4 w-4");

  if (state === "anonymous") {
    return (
      <Link href={`/signin?callbackUrl=/u/${handle}`} className={shell} aria-label={t("friend.add")} title={iconOnly ? t("friend.add") : undefined}>
        {iconOnly ? <Plus className={icon} /> : <UserPlus className={icon} />}
        {!iconOnly && t("friend.add")}
      </Link>
    );
  }

  function click() {
    start(async () => {
      const res = await toggleFriend(toId, handle);
      if (!res.ok) {
        toast({ tone: "danger", title: t("friend.failed"), body: res.error });
        return;
      }
      const prev = state;
      setState(res.data);
      onChange?.(res.data);
      if (res.data === "requested") toast({ tone: "success", title: t("friend.sentTitle"), body: t("friend.sentBody", { name }) });
      else if (res.data === "friends" && prev === "incoming") toast({ tone: "success", title: t("friend.acceptedTitle"), body: t("friend.acceptedBody", { name }) });
    });
  }

  // Resting label + the label that replaces it on hover for the undo-style states.
  const [Rest, rest, Hover, hover] =
    state === "friends"
      ? [UserCheck, t("friend.friends"), UserMinus, t("friend.remove")]
      : state === "requested"
        ? [Clock, t("friend.requested"), UserX, t("friend.cancel")]
        : state === "incoming"
          ? [UserPlus, t("friend.accept"), UserPlus, t("friend.accept")]
          : [UserPlus, t("friend.add"), UserPlus, t("friend.add")];
  const swaps = state === "friends" || state === "requested";

  if (iconOnly) {
    const Idle = state === "incoming" ? Check : state === "none" ? Plus : Rest;
    return (
      <button type="button" onClick={click} disabled={pending} aria-pressed={state === "friends" || state === "requested"} aria-label={swaps ? hover : rest} title={swaps ? `${rest} · ${hover}` : rest} className={cn(shell, swaps && "hover:border-danger/40 hover:text-danger focus-visible:border-danger/40 focus-visible:text-danger")}>
        {pending ? (
          <Loader2 className={cn(icon, "animate-spin")} />
        ) : swaps ? (
          <>
            <Idle className={cn(icon, "group-hover/friend:hidden group-focus-visible/friend:hidden")} />
            <Hover className={cn(icon, "hidden group-hover/friend:block group-focus-visible/friend:block")} />
          </>
        ) : (
          <Idle className={icon} />
        )}
      </button>
    );
  }

  return (
    <button type="button" onClick={click} disabled={pending} aria-pressed={state === "friends" || state === "requested"} aria-label={swaps ? hover : rest} className={cn(shell, swaps && "hover:border-danger/40 hover:text-danger focus-visible:border-danger/40 focus-visible:text-danger")}>
      {pending ? (
        <Loader2 className={cn(icon, "animate-spin")} />
      ) : swaps ? (
        <>
          <Rest className={cn(icon, "group-hover/friend:hidden group-focus-visible/friend:hidden")} />
          <Hover className={cn(icon, "hidden group-hover/friend:block group-focus-visible/friend:block")} />
        </>
      ) : (
        <Rest className={icon} />
      )}
      {swaps ? (
        <span className="grid">
          {/* Both labels share one grid cell so the pill keeps the wider width and does not jump on hover. */}
          <span className="col-start-1 row-start-1 group-hover/friend:invisible group-focus-visible/friend:invisible">{rest}</span>
          <span className="invisible col-start-1 row-start-1 group-hover/friend:visible group-focus-visible/friend:visible">{hover}</span>
        </span>
      ) : (
        <span>{rest}</span>
      )}
    </button>
  );
}
