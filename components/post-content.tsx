"use client";

/**
 * PostContent — renders a post's server-parsed body (`Post.content`): text
 * with @mentions (links with the user hover card) and `inline code`, and
 * code blocks already tokenized by `cortex/post-content.ts`, so no
 * highlighter and no raw HTML reach the client.
 */

import Link from "next/link";
import { useI18n } from "@/axon/i18n";
import { CopyButton } from "@/components/copy-button";
import { UserHoverCard } from "@/components/user-hover-card";
import { cn } from "@/lib/utils";
import type { PostBlock, PostInline } from "@/types/social";

export function PostContent({ blocks, className }: { blocks: PostBlock[]; className?: string }) {
  if (!blocks.length) return null;
  return (
    <div className={cn("space-y-3 text-sm leading-relaxed text-foreground/90", className)}>
      {blocks.map((block, i) => (block.kind === "code" ? <CodeBlock key={i} block={block} /> : <TextBlock key={i} parts={block.parts} />))}
    </div>
  );
}

function TextBlock({ parts }: { parts: PostInline[] }) {
  return (
    <p className="whitespace-pre-wrap break-words">
      {parts.map((part, i) => {
        if (part.kind === "code") return <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-synapse">{part.text}</code>;
        if (part.kind === "mention")
          return (
            <UserHoverCard key={i} handle={part.user.handle}>
              <Link href={`/u/${part.user.handle}`} className="font-medium text-synapse underline-offset-2 hover:underline">
                @{part.user.handle}
              </Link>
            </UserHoverCard>
          );
        return <span key={i}>{part.text}</span>;
      })}
    </p>
  );
}

function CodeBlock({ block }: { block: Extract<PostBlock, { kind: "code" }> }) {
  const { t } = useI18n();
  return (
    <figure className="overflow-hidden rounded-lg border border-border bg-background">
      <figcaption className="flex items-center justify-between gap-3 border-b border-border bg-muted/60 px-3 py-1.5">
        <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          <span className="text-foreground/80">{block.label}</span>
          {block.auto && block.lang !== "plaintext" && (
            <span title={t("posts.code.autoTitle")} className="rounded border border-border px-1 py-px text-[9px] tracking-[0.1em] text-muted-foreground/80">
              {t("posts.code.auto")}
            </span>
          )}
        </span>
        <CopyButton text={block.code} compact />
      </figcaption>
      <pre className="code-tokens max-h-[28rem] overflow-auto p-3 font-mono text-xs leading-relaxed" data-lang={block.lang}>
        <code>
          {block.tokens.map((tok, i) =>
            tok.cls ? (
              <span key={i} className={tok.cls}>
                {tok.text}
              </span>
            ) : (
              tok.text
            ),
          )}
        </code>
      </pre>
    </figure>
  );
}
