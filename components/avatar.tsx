import Link from "next/link";
import { UserHoverCard } from "@/components/user-hover-card";
import type { AuthorRef } from "@/types/social";
import { cn } from "@/lib/utils";
import { safeImageSrc } from "@/lib/url-safety";

const SIZES = { xs: "h-6 w-6 text-[10px]", sm: "h-8 w-8 text-xs", md: "h-10 w-10 text-sm", lg: "h-12 w-12 text-base" } as const;

/** Square avatar (2px radius family): uploaded / OAuth image or the display-name initial. Linked avatars open the profile hover card on a long hover. */
export function Avatar({ author, size = "md", className, link = false }: { author: Pick<AuthorRef, "name" | "handle" | "image">; size?: keyof typeof SIZES; className?: string; link?: boolean }) {
  const initial = (author.name || author.handle || "?").trim()[0]?.toUpperCase() ?? "?";
  const src = safeImageSrc(author.image);
  const node = (
    <span className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-lowest font-display font-medium text-foreground", SIZES[size], className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        initial
      )}
    </span>
  );
  return link && author.handle ? (
    <UserHoverCard handle={author.handle}>
      <Link href={`/u/${author.handle}`} className="shrink-0 transition-transform duration-200 hover:scale-105">
        {node}
      </Link>
    </UserHoverCard>
  ) : (
    node
  );
}
