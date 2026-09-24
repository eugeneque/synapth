"use client";

/**
 * McpPromoCard — in-app promo for connecting the Synapth MCP server to an agent.
 *
 * Artwork lives at `MCP_PROMO_IMAGE`; until it exists the gradient stage with
 * the plug glyph stands in. "Close" hides the card for this browser only
 * (localStorage, guarded — private windows just show it again).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plug } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { Button } from "@/components/ui/button";

export const MCP_PROMO_IMAGE = "/promo/mcp-connect.png";
const DISMISS_KEY = "synapth_mcp_promo_dismissed";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function McpPromoCard() {
  const { t } = useI18n();
  // Hidden until mounted so a dismissed card never flashes in.
  const [visible, setVisible] = useState(false);
  const [imageOk, setImageOk] = useState(true);

  useEffect(() => setVisible(!readDismissed()), []);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* storage unavailable — hide for this page view only */
    }
  }

  if (!visible) return null;

  return (
    <div className="animate-rise overflow-hidden rounded-xl border border-border bg-card">
      <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_20%_20%,hsl(var(--synapse)/0.35),transparent_60%),radial-gradient(circle_at_80%_30%,hsl(280_80%_70%/0.3),transparent_60%),radial-gradient(circle_at_50%_100%,hsl(30_90%_70%/0.25),transparent_60%)]">
        {imageOk ? (
          // eslint-disable-next-line @next/next/no-img-element -- static promo art, no optimisation needed
          <img src={MCP_PROMO_IMAGE} alt="" className="absolute inset-0 h-full w-full object-cover" onError={() => setImageOk(false)} />
        ) : (
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card shadow-glow">
            <Plug className="h-6 w-6 text-synapse" />
          </span>
        )}
      </div>
      <div className="space-y-1.5 p-4">
        <p className="text-sm font-semibold tracking-tight text-foreground">{t("settings.mcpPromo.title")}</p>
        <p className="text-[12px] leading-relaxed text-muted-foreground">{t("settings.mcpPromo.body")}</p>
        <div className="grid grid-cols-2 gap-2 pt-2">
          <Button asChild size="sm">
            <Link href="/dashboard/developer#keys">{t("settings.mcpPromo.connect")}</Link>
          </Button>
          <Button variant="outline" size="sm" onClick={dismiss}>
            {t("settings.mcpPromo.close")}
          </Button>
        </div>
      </div>
    </div>
  );
}
