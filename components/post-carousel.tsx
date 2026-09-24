"use client";

/**
 * PostCarousel — the swipeable photo strip of a post. Native horizontal
 * scroll with snap points (touch and trackpad swipe for free), arrow buttons
 * and dots for the mouse, ←/→ when focused. The current slide is derived
 * from the scroll position, so every input method stays in sync.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { cn } from "@/lib/utils";
import type { PostImage } from "@/types/social";

export function PostCarousel({ images, className }: { images: PostImage[]; className?: string }) {
  const { t } = useI18n();
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const total = images.length;

  const go = useCallback(
    (to: number) => {
      const el = track.current;
      if (!el) return;
      const next = Math.max(0, Math.min(total - 1, to));
      el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
    },
    [total],
  );

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth))));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", onScroll);
    };
  }, []);

  if (!total) return null;

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label={t("posts.carousel.label")}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          go(index - 1);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          go(index + 1);
        }
      }}
      className={cn("group relative overflow-hidden rounded-lg border border-border bg-background focus:outline-none focus-visible:ring-1 focus-visible:ring-synapse/50", className)}
    >
      <div ref={track} className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain">
        {images.map((img, i) => (
          <div key={img.id} role="group" aria-roledescription="slide" aria-label={t("posts.carousel.goTo", { n: i + 1, total })} className="flex aspect-[4/3] w-full shrink-0 snap-center items-center justify-center bg-muted/40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.url} alt="" loading={i === 0 ? "eager" : "lazy"} draggable={false} className="h-full w-full select-none object-contain" />
          </div>
        ))}
      </div>

      {total > 1 && (
        <>
          <span className="pointer-events-none absolute right-2 top-2 rounded-md bg-background/80 px-2 py-0.5 font-mono text-[10px] tabular-nums text-foreground/80 backdrop-blur">
            {index + 1} / {total}
          </span>
          <CarouselArrow side="left" label={t("posts.carousel.prev")} hidden={index === 0} onClick={() => go(index - 1)} />
          <CarouselArrow side="right" label={t("posts.carousel.next")} hidden={index === total - 1} onClick={() => go(index + 1)} />
          <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
            {images.map((img, i) => (
              <button
                key={img.id}
                type="button"
                aria-label={t("posts.carousel.goTo", { n: i + 1, total })}
                aria-current={i === index}
                onClick={() => go(i)}
                className={cn("h-1.5 rounded-full transition-all", i === index ? "w-4 bg-synapse" : "w-1.5 bg-foreground/40 hover:bg-foreground/70")}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CarouselArrow({ side, label, hidden, onClick }: { side: "left" | "right"; label: string; hidden: boolean; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      tabIndex={-1}
      className={cn(
        "absolute top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/80 text-foreground backdrop-blur transition-opacity hover:bg-background",
        side === "left" ? "left-2" : "right-2",
        hidden ? "pointer-events-none opacity-0" : "opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-visible:opacity-100",
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
