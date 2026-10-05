"use client";

/**
 * Synapth CLI in settings as a numbered walkthrough: 1 get the link key
 * (issued here, shown once), 2 install, 3 link this computer, then the
 * machines already linked and the optional MCP hookup. Each step shows
 * whether it is done. Server actions live in
 * app/(site)/dashboard/settings/actions.ts; the limits come from the plan.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, KeyRound, Laptop, RefreshCw, ShieldOff, Unlink, X } from "lucide-react";
import { useI18n } from "@/axon/i18n";
import { useToast } from "@/axon/toast";
import { issueCliKey, revokeCliKey, unlinkCliDevice } from "@/app/(site)/dashboard/settings/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/copy-button";
import { CliInstall } from "@/components/cli-install";
import { Spinner } from "@/components/ui/spinner";
import { isUnlimited, type PlanId } from "@/types/billing";
import type { CliDeviceInfo, CliLinkKeyInfo } from "@/types/cli";
import { cliInstallCommand } from "@/lib/cli-install";
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

  const linkCommand = `synapth link ${issued ?? "slk_…"}`;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">{t("cli.lead")}</p>

      {/* Plan limits. */}
      <dl className="grid grid-cols-3 gap-2">
        {[
          { k: t("cli.limit.installs"), v: `${installsToday}/${limit(limits.installsPerDay)}` },
          { k: t("cli.limit.devices"), v: `${devices.length}/${limit(limits.devices)}` },
          { k: t("cli.limit.skillsets"), v: limits.bulk ? t("cli.limit.yes") : t("cli.limit.pro") },
        ].map((x) => (
          <div key={x.k} className="rounded-lg border border-border bg-muted px-3 py-2">
            <dt className="label-mono-sm">{x.k}</dt>
            <dd className="mt-0.5 font-mono text-sm text-foreground">{x.v}</dd>
          </div>
        ))}
      </dl>
      {plan === "free" && (
        <p className="-mt-3 text-xs text-muted-foreground">
          {t("cli.freeHint")}{" "}
          <Link href="/pro" className="text-synapse hover:underline">
            {t("cli.upgrade")} →
          </Link>
        </p>
      )}

      <ol className="flex flex-col">
        {/* 1 · link key. */}
        <Step n={1} title={t("cli.step.key")} state={linkKey || issued ? "done" : "todo"}>
          <p className="text-xs text-muted-foreground">{t("cli.step.keyLead")}</p>
          {issued ? (
            <div className="space-y-2.5 rounded-lg border border-synapse/40 bg-synapse/5 p-3.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[13px] font-medium">{t("cli.key.issued")}</p>
                <button type="button" onClick={() => setIssued(null)} aria-label={t("keys.hide")} className="text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-synapse/30 bg-background px-3 py-2">
                <KeyRound className="h-4 w-4 shrink-0 text-synapse" />
                <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[12px] text-synapse">{issued}</code>
                <CopyButton text={issued} label={t("cli.key.copy")} />
              </div>
              <p className="text-xs text-warn">{t("cli.key.once")}</p>
            </div>
          ) : linkKey ? (
            <div className="space-y-1.5 rounded-lg border border-border bg-muted px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-[13px] font-medium">
                  <span className="dot-live" /> {t("cli.key.active")}
                  <code className="font-mono text-[12px] text-synapse">{linkKey.prefix}••••••••</code>
                </span>
                <span className="label-mono-sm normal-case tracking-normal">
                  {t("cli.key.created", { when: timeAgo(linkKey.createdAt, i18n) })} · {linkKey.lastUsedAt ? t("cli.key.used", { when: timeAgo(linkKey.lastUsedAt, i18n) }) : t("cli.key.unused")}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">{t("cli.key.hidden")}</p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t("cli.key.none")}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={linkKey ? "mono" : "default"} className="h-8 px-3 text-xs" onClick={issue} disabled={pending}>
              {pending ? <Spinner size={12} /> : linkKey ? <RefreshCw className="h-3.5 w-3.5" /> : <KeyRound className="h-3.5 w-3.5" />} {linkKey ? t("cli.key.rotate") : t("cli.key.generate")}
            </Button>
            {linkKey && (
              <Button size="sm" variant="ghost" className="h-8 px-3 text-xs text-danger" onClick={revokeKey} disabled={pending}>
                <ShieldOff className="h-3.5 w-3.5" /> {t("cli.key.revoke")}
              </Button>
            )}
          </div>
        </Step>

        {/* 2 · install. */}
        <Step n={2} title={t("cli.step.install")} state={devices.length > 0 ? "done" : "todo"}>
          <CliInstall origin={origin} variant="panel" />
          <p className="text-[11px] text-muted-foreground">{t("cli.step.installHint")}</p>
        </Step>

        {/* 3 · link. */}
        <Step n={3} title={t("cli.step.link")} state={devices.length > 0 ? "done" : "todo"}>
          <p className="text-xs text-muted-foreground">{issued ? t("cli.step.linkLead") : linkKey ? t("cli.step.linkLead") : t("cli.step.linkNoKey")}</p>
          {(issued || linkKey) && <Command code={linkCommand} />}
          {issued && (
            <>
              <p className="text-[11px] text-muted-foreground">{t("cli.key.oneLiner")}</p>
              <Command code={cliInstallCommand(origin, issued)} />
            </>
          )}
          <div className="space-y-2 pt-1">
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
        </Step>

        {/* Bonus · agents. */}
        <Step title={t("cli.step.mcp")} state="optional" last>
          <Command code="synapth mcp add" />
          <p className="text-[11px] text-muted-foreground">{t("cli.step.mcpHint")}</p>
        </Step>
      </ol>

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

/** One numbered step of the walkthrough: marker + rail on the left, title, state chip and body. */
function Step({ n, title, state, last = false, children }: { n?: number; title: string; state: "done" | "todo" | "optional"; last?: boolean; children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <li className="flex gap-4">
      <div className="flex flex-col items-center">
        <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-xs", state === "done" ? "border-synapse bg-synapse text-synapse-foreground" : "border-border bg-muted text-muted-foreground")}>
          {state === "done" ? <Check className="h-3.5 w-3.5" /> : (n ?? "+")}
        </span>
        {!last && <span className="my-1 w-px flex-1 bg-border" />}
      </div>
      <div className={cn("min-w-0 flex-1 space-y-3", !last && "pb-7")}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          <Badge variant={state === "done" ? "synapse" : "chip"}>{t(`cli.state.${state}`)}</Badge>
        </div>
        {children}
      </div>
    </li>
  );
}
