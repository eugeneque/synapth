"use client";

/** Discussion panel on a catalogue entry: the comment thread bound to `commentOnSkill`. */

import { MessageSquare } from "lucide-react";
import { useState } from "react";
import { useI18n } from "@/axon/i18n";
import { commentOnSkill } from "@/app/(site)/social-actions";
import { CommentThread } from "@/components/comment-thread";
import { Panel } from "@/components/panel";
import type { AuthorRef, Comment } from "@/types/social";

export function SkillDiscussion({ skillId, slug, initial, viewer }: { skillId: string; slug: string; initial: Comment[]; viewer: AuthorRef | null }) {
  const { t, n } = useI18n();
  const [count, setCount] = useState(initial.length);
  return (
    <Panel id="discussion" title={t("discussion.title")} meta={n("posts.comments", count)} icon={<MessageSquare className="h-4 w-4 shrink-0 text-synapse" />} className="scroll-mt-24" bodyClassName="p-5">
      <CommentThread initial={initial} viewer={viewer} submit={(body) => commentOnSkill(skillId, body)} signInHref={`/signin?callbackUrl=/skills/${slug}`} onCountChange={(d) => setCount((c) => c + d)} />
    </Panel>
  );
}
