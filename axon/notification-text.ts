/**
 * Turns a notification row into the words the toast and the feed card show.
 * Pure: takes the translator so both client and server renderers agree.
 */

import type { Translator, UiKey } from "@/lib/i18n";
import type { Notification } from "@/types/social";

export interface NotificationText {
  /** Full sentence, actor included — what a toast shows. */
  title: string;
  /** The sentence without the actor's name, for cards that render the name as a link. */
  verb: string;
  body: string | null;
  cta: string;
  href: string | null;
}

export function describeNotification(n: Notification, { t, n: plural }: Pick<Translator<UiKey>, "t" | "n">, viewerHandle: string | null): NotificationText {
  const actor = n.actor?.name || n.actor?.handle || t("notif.someone");
  const s = n.subject;
  // Actor sentences keep `{name}` first in every locale, so dropping it leaves the verb phrase.
  const withActor = (key: UiKey, params: Record<string, string | number> = {}) => ({ title: t(key, { ...params, name: actor }), verb: t(key, { ...params, name: "" }).trim() });
  switch (s.kind) {
    case "impulse":
      return { ...withActor("notif.impulse.title"), body: plural("notif.impulse.body", s.total), cta: t("notif.cta.profile"), href: n.actor ? `/u/${n.actor.handle}` : null };
    case "comment.post":
      return { ...withActor("notif.commentPost.title"), body: s.excerpt, cta: t("notif.cta.post"), href: viewerHandle ? `/u/${viewerHandle}#post-${s.postId}` : null };
    case "comment.skill":
      return { ...withActor("notif.commentSkill.title", { skill: s.skillName }), body: s.excerpt, cta: t("notif.cta.discussion"), href: `/skills/${s.slug}#discussion` };
    case "skill.updated":
      return { title: t("notif.skillUpdated.title", { skill: s.skillName, version: s.version }), verb: "", body: s.previousVersion ? t("notif.skillUpdated.body", { prev: s.previousVersion }) : t("notif.skillUpdated.first"), cta: t("notif.cta.skill"), href: `/skills/${s.slug}` };
    case "moderation.requested":
      return { ...withActor("notif.modRequested.title", { skill: s.skillName }), body: t("notif.modRequested.body"), cta: t("notif.cta.review"), href: `/dashboard/moderation/${s.requestId}` };
    case "moderation.decided":
      return {
        title: t(s.verdict === "approved" ? "notif.modApproved.title" : "notif.modRejected.title", { skill: s.skillName }),
        verb: "",
        body: s.note || t(s.verdict === "approved" ? "notif.modApproved.body" : "notif.modRejected.body"),
        cta: t("notif.cta.skill"),
        href: `/skills/${s.slug}`,
      };
    case "skillset.updated":
      return { ...withActor("notif.skillsetUpdated.title", { skillset: s.name }), body: t("notif.skillsetUpdated.body", { added: s.added, removed: s.removed }), cta: t("notif.cta.skillset"), href: `/skillsets/${s.slug}#history` };
    case "skillset.verified":
      return { title: t(s.verified ? "notif.skillsetVerified.title" : "notif.skillsetUnverified.title", { skillset: s.name }), verb: "", body: t(s.verified ? "notif.skillsetVerified.body" : "notif.skillsetUnverified.body"), cta: t("notif.cta.skillset"), href: `/skillsets/${s.slug}` };
    case "verification.requested":
      return { ...withActor("notif.verifyRequested.title"), body: t("notif.verifyRequested.body"), cta: t("notif.cta.review"), href: `/dashboard/admin/verification/${s.requestId}` };
    case "verification.updated":
      if (s.code === "claimed") return { ...withActor("notif.verify.claimed.title"), body: t("notif.verify.claimed.body"), cta: t("notif.cta.verification"), href: "/dashboard/settings#verification" };
      return { title: t(`notif.verify.${s.code}.title`), verb: "", body: s.note || t(`notif.verify.${s.code}.body`), cta: t("notif.cta.verification"), href: "/dashboard/settings#verification" };
    case "badge":
      return { title: t("notif.badge.title", { badge: t(`badge.${s.badgeId}.title` as UiKey) }), verb: "", body: t(`badge.${s.badgeId}.body` as UiKey), cta: t("notif.cta.badges"), href: viewerHandle ? `/u/${viewerHandle}#badges` : null };
    case "system":
      return { title: s.title, verb: "", body: s.body, cta: t("notif.cta.open"), href: s.href };
  }
}
