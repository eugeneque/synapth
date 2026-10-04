"use client";

/**
 * Synapth CLI in settings: the install one-liner, the link key (issued here,
 * shown once) and the machines linked with it. Server actions live in
 * app/(site)/dashboard/settings/actions.ts; the limits come from the plan.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KeyRound, Laptop, RefreshCw, ShieldOff, Unlink, X } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { useToast } from "@/axon/toast";
import { issueCliKey, revokeCliKey, unlinkCliDevice } from "@/app/(site)/dashboard/settings/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/copy-button";
import { Spinner } from "@/components/ui/spinner";
import { isUnlimited, type PlanId } from "@/types/billing";
import type { CliDeviceInfo, CliLinkKeyInfo } from "@/types/cli";
import { cn, timeAgo } from "@/lib/utils";

export interface CliPanelState {
  linkKey: CliLinkKeyInfo | null;
  devices: CliDeviceInfo[];
  plan: PlanId;
  limits: { devices: number; installsPerDay: number; bulk: boolean };
  installsToday: number;
}

function Command({ code }: { code: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
      <span className="select-none font-mono text-[11px] text-synapse">$</span>
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[11.5px]">{code}</code>
      <CopyButton text={code} compact />
    </div>
  );
}

export function CliPanel({ initial, origin }: { initial: CliPanelState; origin: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { toast } = useToast();
  const router = useRouter();
  const [issued, setIssued] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { linkKey, devices, limits, installsToday, plan } = initial;
  const limit = (n: number) => (isUnlimited(n) ? "∞" : String(n));
  const installCmd = `curl -fsSL ${origin}/cli/install | sh`;

  function issue() {
    if (linkKey && !window.confirm(t("cli.key.rotateConfirm"))) return;
    startTransition(async () => {
      const res = await issueCliKey();
      if (!res.ok) {
        toast({ tone: "danger", title: res.error });
        return;
      }
      setIssued(res.key);
      router.refresh();
    });
  }

  function revokeKey() {
    if (!window.confirm(t("cli.key.revokeConfirm"))) return;
    startTransition(async () => {
      await revokeCliKey();
      setIssued(null);
      toast({ tone: "success", title: t("cli.key.revoked") });
      router.refresh();
    });
  }

  function unlink(device: CliDeviceInfo) {
    if (!window.confirm(t("cli.device.unlinkConfirm", { name: device.name }))) return;
    startTransition(async () => {
      const res = await unlinkCliDevice(device.id);
      toast({ tone: res.ok ? "success" : "danger", title: res.ok ? t("cli.device.unlinked", { name: device.name }) : t("cli.device.unlinkFailed") });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Plan limits. */}
      <dl className="grid grid-cols-3 gap-2">
        {[
          { k: t("cli.limit.installs"), v: `${installsToday}/${limit(limits.installsPerDay)}` },
          { k: t("cli.limit.devices"), v: `${devices.length}/${limit(limits.devices)}` },
          { k: t("cli.limit.skillsets"), v: limits.bulk ? t("cli.limit.yes") : t("cli.limit.pro") },
        ].map((s) => (
          <div key={s.k} className="rounded-lg border border-border bg-muted px-3 py-2">
            <dt className="label-mono-sm">{s.k}</dt>
            <dd className="mt-0.5 font-mono text-sm text-foreground">{s.v}</dd>
          </div>
        ))}
      </dl>
      {plan === "free" && (
        <p className="text-xs text-muted-foreground">
          {t("cli.freeHint")}{" "}
          <Link href="/pro" className="text-synapse hover:underline">
            {t("cli.upgrade")} →
          </Link>
        </p>
      )}

      {/* 1 · install. */}
      <div className="space-y-2">
        <p className="label-mono-sm">{t("cli.step.install")}</p>
        <Command code={installCmd} />
        <p className="text-[11px] text-muted-foreground">{t("cli.step.installHint")}</p>
      </div>

      {/* 2 · link key. */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="label-mono-sm">{t("cli.step.link")}</p>
          <div className="flex gap-1.5">
            {linkKey && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-danger" onClick={revokeKey} disabled={pending}>
                <ShieldOff className="h-3.5 w-3.5" /> {t("cli.key.revoke")}
              </Button>
            )}
            <Button size="sm" variant="mono" className="h-7 px-2.5 text-[11px]" onClick={issue} disabled={pending}>
              {pending ? <Spinner size={12} /> : linkKey ? <RefreshCw className="h-3.5 w-3.5" /> : <KeyRound className="h-3.5 w-3.5" />} {linkKey ? t("cli.key.rotate") : t("cli.key.generate")}
            </Button>
          </div>
        </div>

        {issued ? (
          <div className="space-y-2.5 rounded-lg border border-synapse/40 bg-synapse/5 p-3.5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[13px] font-medium">{t("cli.key.issued")}</p>
              <button type="button" onClick={() => setIssued(null)} aria-label={t("keys.hide")} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-warn">{t("cli.key.once")}</p>
            <Command code={`synapth link ${issued}`} />
            <p className="text-[11px] text-muted-foreground">{t("cli.key.oneLiner")}</p>
            <Command code={`curl -fsSL ${origin}/cli/install | sh -s -- ${issued}`} />
          </div>
        ) : linkKey ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted px-3 py-2">
            <code className="font-mono text-[12px] text-synapse">{linkKey.prefix}••••••••</code>
            <span className="label-mono-sm normal-case tracking-normal">
              {t("cli.key.created", { when: timeAgo(linkKey.createdAt, i18n) })} · {linkKey.lastUsedAt ? t("cli.key.used", { when: timeAgo(linkKey.lastUsedAt, i18n) }) : t("cli.key.unused")}
            </span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t("cli.key.none")}</p>
        )}
      </div>

      {/* 3 · machines. */}
      <div className="space-y-2">
        <p className="label-mono-sm">{t("cli.devices", { n: devices.length, max: limit(limits.devices) })}</p>
        <ul className="flex flex-col gap-2">
          {devices.length === 0 && <li className="text-xs text-muted-foreground">{t("cli.devices.empty")}</li>}
          {devices.map((d) => (
            <li key={d.id} className={cn("flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted p-3", d.suspended && "border-warn/40")}>
              <Laptop className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-[13px] font-medium">
                  {d.name}
                  {d.suspended && <Badge variant="sandbox">{t("cli.device.suspended")}</Badge>}
                </p>
                <p className="label-mono-sm normal-case tracking-normal">
                  {d.platform}/{d.arch} · cli {d.cliVersion} · {d.prefix}•••• · {d.lastSeenAt ? t("cli.device.seen", { when: timeAgo(d.lastSeenAt, i18n) }) : t("cli.device.linked", { when: timeAgo(d.createdAt, i18n) })}
                </p>
              </div>
              <Button size="sm" variant="destructive" className="h-7 px-2 text-[11px]" onClick={() => unlink(d)} disabled={pending}>
                <Unlink className="h-3.5 w-3.5" /> {t("cli.device.unlink")}
              </Button>
            </li>
          ))}
        </ul>
        {devices.some((d) => d.suspended) && <p className="text-xs text-warn">{t("cli.device.suspendedHint")}</p>}
      </div>

      {/* 4 · agents. */}
      <div className="space-y-2">
        <p className="label-mono-sm">{t("cli.step.mcp")}</p>
        <Command code="synapth mcp add" />
        <p className="text-[11px] text-muted-foreground">{t("cli.step.mcpHint")}</p>
      </div>

      {/* Cheat sheet. */}
      <div className="space-y-1.5 rounded-lg border border-dashed border-border p-3">
        <p className="label-mono-sm">{t("cli.usage")}</p>
        <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed text-muted-foreground">{`synapth                                 # interactive menu
synapth setup                           # link + connect your agents
synapth install [slug] --target claude-code|cursor|claude-desktop
synapth recommend "query our Postgres and file Jira tickets"
synapth install <skillset> --set        # Pro
synapth mcp add                         # let agents install skills themselves`}</pre>
      </div>
    </div>
  );
}
