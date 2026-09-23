"use client";

/** Re-renders the current server page every `seconds` while the tab is visible, so staff screens stay current. */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function LiveRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}
