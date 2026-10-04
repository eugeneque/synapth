import { cn } from "@/lib/utils";
import { safeImageSrc } from "@/lib/url-safety";
import { DitherAvatar } from "@/components/dither-kit/avatar";
import { PALETTE } from "@/components/dither-kit/palette";

const SIZES = { sm: "h-10 w-10 text-sm", md: "h-14 w-14 text-lg", lg: "h-20 w-20 text-2xl sm:h-24 sm:w-24" } as const;

/** Skillset avatar: the uploaded square image, or a dithered glyph in the signal tone seeded by the name. */
export function SkillsetAvatar({ name, avatar, size = "md", className }: { name: string; avatar: string | null; size?: keyof typeof SIZES; className?: string }) {
  const src = safeImageSrc(avatar);
  return (
    <span className={cn("relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-lowest font-display font-medium text-foreground", SIZES[size], className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <DitherAvatar name={name || "skillset"} fill={PALETTE.synapse.line} animate={false} className="h-[70%] w-[70%]" />
      )}
    </span>
  );
}
