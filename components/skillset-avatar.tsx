import { Boxes } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeImageSrc } from "@/lib/url-safety";

const SIZES = { sm: "h-10 w-10 text-sm", md: "h-14 w-14 text-lg", lg: "h-20 w-20 text-2xl sm:h-24 sm:w-24" } as const;

/** Skillset avatar: the uploaded square image, or a monogram over the dot matrix. */
export function SkillsetAvatar({ name, avatar, size = "md", className }: { name: string; avatar: string | null; size?: keyof typeof SIZES; className?: string }) {
  const src = safeImageSrc(avatar);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span className={cn("relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-lowest font-display font-medium text-foreground", !src && "dot-matrix", SIZES[size], className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : initials ? (
        <span className="text-synapse">{initials}</span>
      ) : (
        <Boxes className="h-1/2 w-1/2 text-synapse" />
      )}
    </span>
  );
}
