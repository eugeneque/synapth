/**
 * Cortex · Synapth CLI: link keys, linked machines, plan checks and installs.
 *
 * A user holds at most one **link key** (`slk_…`, issued in settings, shown
 * once, stored as SHA-256; issuing a new one retires the old). `synapth link`
 * trades it for a **device token** (`sdt_…`) bound to one machine; the token
 * is what every CLI call carries. Re-linking the same machine (same machine id
 * from ~/.synapth) replaces its old device instead of adding one.
 *
 * Everything that limits is decided here, never in the CLI: the plan comes
 * from the subscription (`currentPlanId` — a lapsed plan is Free), the device
 * cap and the daily install quota from `PlanLimits`. After a downgrade the
 * oldest devices up to the new cap keep working; the rest are `suspended`
 * (status works, installs do not) until the user unlinks some or upgrades.
 */

import { createHash, randomBytes } from "node:crypto";
import { prisma, hasDatabase } from "@/cortex/db";
import { getProfile } from "@/cortex/account";
import { currentPlanId, effectiveStatus, getSubscriptionRow } from "@/cortex/payments";
import { skillRepository, hydratePrompt } from "@/cortex/repository";
import { getSkillset, listSkillsets, skillsetSkills } from "@/cortex/skillsets";
import { cliBundle } from "@/lib/cli-bundle";
import { ownerPolicy, type Caller } from "@/cortex/api-keys";
import { runAgentTool } from "@/cortex/agent";
import { enforceAgentQuota } from "@/cortex/plans";
import { isListed } from "@/types/trust";
import { isUnlimited, PLANS } from "@/types/billing";
import {
  CLI_DEVICE_NAME_MAX,
  CLI_DEVICE_TOKEN_PREFIX,
  CLI_LINK_KEY_PREFIX,
  CLI_MIN_VERSION,
  CLI_VERSION,
  compareVersions,
  type CliInstallVia,
  type CliRecommendation,
  type CliSearchRow,
  type CliSkillsetRow,
  type CliBundle,
  type CliDeviceInfo,
  type CliErrorCode,
  type CliInstallResult,
  type CliLinkKeyInfo,
  type CliNoticeCode,
  type CliStatus,
  type CliTarget,
} from "@/types/cli";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

export class CliError extends Error {
  constructor(
    public readonly code: CliErrorCode,
    public readonly status: number,
    message: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "CliError";
  }
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function token(prefix: string, length: number): string {
  let body = "";
  while (body.length < length) {
    // 248 = 62 × 4: rejection sampling keeps the alphabet uniform.
    for (const byte of randomBytes(length + 16)) if (byte < 248 && body.length < length) body += BASE62[byte % 62];
  }
  return `${prefix}${body}`;
}

const newId = (p: string) => `${p}_${randomBytes(8).toString("hex")}`;
const DAY = 86_400_000;
const utcDayStart = (now: number) => Math.floor(now / DAY) * DAY;

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

interface LinkKeyRow {
  userId: string;
  keyHash: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface DeviceRow {
  id: string;
  userId: string;
  name: string;
  platform: string;
  arch: string;
  cliVersion: string;
  /** SHA-256 of the machine id the CLI generated; re-linking the same machine replaces the row. */
  machineHash: string;
  tokenHash: string;
  prefix: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

interface InstallRow {
  id: string;
  userId: string;
  deviceId: string;
  skillId: string;
  target: string;
  via: CliInstallVia;
  createdAt: string;
}

interface Store {
  linkKeys: LinkKeyRow[];
  devices: DeviceRow[];
  installs: InstallRow[];
}

const g = globalThis as unknown as { __synapthCli_v1?: Store };
const mem: Store = g.__synapthCli_v1 ?? (g.__synapthCli_v1 = { linkKeys: [], devices: [], installs: [] });

type DbDevice = Omit<DeviceRow, "createdAt" | "lastSeenAt" | "revokedAt"> & { createdAt: Date; lastSeenAt: Date | null; revokedAt: Date | null };
const deviceFromDb = (r: DbDevice): DeviceRow => ({ ...r, createdAt: r.createdAt.toISOString(), lastSeenAt: r.lastSeenAt?.toISOString() ?? null, revokedAt: r.revokedAt?.toISOString() ?? null });

async function activeDevices(userId: string): Promise<DeviceRow[]> {
  if (!hasDatabase) return mem.devices.filter((d) => d.userId === userId && !d.revokedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const rows = await prisma.cliDevice.findMany({ where: { userId, revokedAt: null }, orderBy: { createdAt: "asc" } });
  return rows.map(deviceFromDb);
}

async function deviceLimit(userId: string): Promise<number> {
  return PLANS[await currentPlanId(userId)].limits.cliDevices;
}

function toInfo(row: DeviceRow, suspended: boolean): CliDeviceInfo {
  const { userId: _u, machineHash: _m, tokenHash: _t, ...info } = row;
  return { ...info, suspended };
}

/** Oldest-first: the first `limit` active devices work, the rest are suspended. */
const isSuspended = (row: DeviceRow, active: DeviceRow[], limit: number) => !isUnlimited(limit) && active.findIndex((d) => d.id === row.id) >= limit;

// ---------------------------------------------------------------------------
// Link keys (settings)
// ---------------------------------------------------------------------------

export async function getLinkKey(userId: string): Promise<CliLinkKeyInfo | null> {
  if (!hasDatabase) {
    const row = mem.linkKeys.find((k) => k.userId === userId);
    return row ? { prefix: row.prefix, createdAt: row.createdAt, lastUsedAt: row.lastUsedAt } : null;
  }
  const row = await prisma.cliLinkKey.findUnique({ where: { userId } });
  return row ? { prefix: row.prefix, createdAt: row.createdAt.toISOString(), lastUsedAt: row.lastUsedAt?.toISOString() ?? null } : null;
}

/** Issues the user's link key, retiring the previous one. Linked devices are untouched. The plain key is returned once. */
export async function issueLinkKey(userId: string): Promise<{ key: string; info: CliLinkKeyInfo }> {
  const key = token(CLI_LINK_KEY_PREFIX, 32);
  const prefix = key.slice(0, CLI_LINK_KEY_PREFIX.length + 4);
  const keyHash = sha256(key);
  const now = new Date();
  if (!hasDatabase) {
    mem.linkKeys = mem.linkKeys.filter((k) => k.userId !== userId);
    mem.linkKeys.push({ userId, keyHash, prefix, createdAt: now.toISOString(), lastUsedAt: null });
  } else {
    await prisma.cliLinkKey.upsert({ where: { userId }, create: { userId, keyHash, prefix, createdAt: now }, update: { keyHash, prefix, createdAt: now, lastUsedAt: null } });
  }
  return { key, info: { prefix, createdAt: now.toISOString(), lastUsedAt: null } };
}

export async function revokeLinkKey(userId: string): Promise<void> {
  if (!hasDatabase) {
    mem.linkKeys = mem.linkKeys.filter((k) => k.userId !== userId);
    return;
  }
  await prisma.cliLinkKey.deleteMany({ where: { userId } });
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

export interface MachineInfo {
  /** Random id the CLI keeps in ~/.synapth/config.json. */
  machineId: string;
  name: string;
  platform: string;
  arch: string;
  cliVersion: string;
}

const printable = (value: string, max: number) => value.replace(/[^\x20-\x7E]/g, "").trim().slice(0, max);

export function assertCliVersion(version: string) {
  if (compareVersions(version, CLI_MIN_VERSION) < 0) {
    throw new CliError("cli_outdated", 426, `Synapth CLI ${version} is too old; ${CLI_MIN_VERSION}+ is required — run \`synapth upgrade\``, { minimum: CLI_MIN_VERSION, latest: CLI_VERSION });
  }
}

/** `synapth link <key>`: binds this machine to the key's owner and returns the device token (shown once). */
export async function linkDevice(linkKey: string, machine: MachineInfo, now = new Date()): Promise<{ token: string; device: CliDeviceInfo; userId: string }> {
  assertCliVersion(machine.cliVersion);
  const keyHash = sha256(linkKey.trim());
  let userId: string | null;
  if (!hasDatabase) {
    const row = mem.linkKeys.find((k) => k.keyHash === keyHash);
    userId = row?.userId ?? null;
    if (row) row.lastUsedAt = now.toISOString();
  } else {
    const row = await prisma.cliLinkKey.findUnique({ where: { keyHash } });
    userId = row?.userId ?? null;
    if (row) await prisma.cliLinkKey.update({ where: { userId: row.userId }, data: { lastUsedAt: now } });
  }
  if (!userId) throw new CliError("link_key_invalid", 401, "Unknown link key — issue one in Settings → CLI");

  const machineHash = sha256(`${userId}:${machine.machineId}`);
  const active = await activeDevices(userId);
  const same = active.filter((d) => d.machineHash === machineHash);
  const limit = await deviceLimit(userId);
  // The machine being re-linked frees its own slot.
  if (!isUnlimited(limit) && active.length - same.length >= limit) {
    throw new CliError("device_limit", 409, `Your plan allows ${limit} linked machine${limit === 1 ? "" : "s"}; unlink one in Settings → CLI or upgrade`, { limit, devices: active.length, billing: `${APP_URL}/pro` });
  }

  const plain = token(CLI_DEVICE_TOKEN_PREFIX, 40);
  const row: DeviceRow = {
    id: newId("dev"),
    userId,
    name: printable(machine.name, CLI_DEVICE_NAME_MAX) || "machine",
    platform: printable(machine.platform, 24) || "unknown",
    arch: printable(machine.arch, 16) || "unknown",
    cliVersion: printable(machine.cliVersion, 16),
    machineHash,
    tokenHash: sha256(plain),
    prefix: plain.slice(0, CLI_DEVICE_TOKEN_PREFIX.length + 4),
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    revokedAt: null,
  };
  if (!hasDatabase) {
    for (const d of same) d.revokedAt = now.toISOString();
    mem.devices.push(row);
  } else {
    await prisma.$transaction([
      prisma.cliDevice.updateMany({ where: { userId, machineHash, revokedAt: null }, data: { revokedAt: now } }),
      prisma.cliDevice.create({ data: { ...row, createdAt: now, lastSeenAt: now, revokedAt: null } }),
    ]);
  }
  const after = [...active.filter((d) => d.machineHash !== machineHash), row];
  return { token: plain, device: toInfo(row, isSuspended(row, after, limit)), userId };
}

export async function listDevices(userId: string): Promise<CliDeviceInfo[]> {
  const [active, limit] = await Promise.all([activeDevices(userId), deviceLimit(userId)]);
  return active.map((d) => toInfo(d, isSuspended(d, active, limit))).reverse();
}

export async function revokeDevice(userId: string, deviceId: string): Promise<boolean> {
  if (!hasDatabase) {
    const row = mem.devices.find((d) => d.id === deviceId && d.userId === userId && !d.revokedAt);
    if (!row) return false;
    row.revokedAt = new Date().toISOString();
    return true;
  }
  const res = await prisma.cliDevice.updateMany({ where: { id: deviceId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
  return res.count > 0;
}

export interface CliCaller {
  device: DeviceRow;
  /** Beyond the plan's device cap (oldest-first rule): status works, installs do not. */
  suspended: boolean;
}

/** Resolves `Authorization: Bearer sdt_…`; revocation is instant (looked up on every call). */
export async function requireDevice(request: Request): Promise<CliCaller> {
  const header = request.headers.get("authorization") ?? "";
  const plain = header.match(/^Bearer\s+(sdt_[0-9A-Za-z]+)$/)?.[1];
  if (!plain) throw new CliError("device_invalid", 401, "This machine is not linked — run `synapth link <key>`");
  const hash = sha256(plain);
  const row = !hasDatabase ? (mem.devices.find((d) => d.tokenHash === hash) ?? null) : await prisma.cliDevice.findUnique({ where: { tokenHash: hash } }).then((r) => (r ? deviceFromDb(r) : null));
  if (!row) throw new CliError("device_invalid", 401, "Unknown device token — run `synapth link <key>` again");
  if (row.revokedAt) throw new CliError("device_revoked", 401, "This machine was unlinked from your account — run `synapth link <key>` to link it again");

  const version = request.headers.get("x-synapth-cli");
  if (version) assertCliVersion(version);

  const now = new Date();
  // One write per minute is plenty for "last seen".
  if (!row.lastSeenAt || now.getTime() - Date.parse(row.lastSeenAt) > 60_000 || (version && version !== row.cliVersion)) {
    const cliVersion = version ? printable(version, 16) : row.cliVersion;
    if (hasDatabase) await prisma.cliDevice.update({ where: { id: row.id }, data: { lastSeenAt: now, cliVersion } });
    row.lastSeenAt = now.toISOString();
    row.cliVersion = cliVersion;
  }
  const [active, limit] = await Promise.all([activeDevices(row.userId), deviceLimit(row.userId)]);
  return { device: row, suspended: isSuspended(row, active, limit) };
}

// ---------------------------------------------------------------------------
// Status and quota
// ---------------------------------------------------------------------------

export async function installsToday(userId: string, now = Date.now()): Promise<number> {
  const since = utcDayStart(now);
  if (!hasDatabase) return mem.installs.filter((i) => i.userId === userId && Date.parse(i.createdAt) >= since).length;
  return prisma.cliInstallEvent.count({ where: { userId, createdAt: { gte: new Date(since) } } });
}

export async function cliStatus(caller: CliCaller, now = Date.now()): Promise<CliStatus> {
  const { device } = caller;
  const [profile, sub, planId, used, active] = await Promise.all([getProfile(device.userId), getSubscriptionRow(device.userId), currentPlanId(device.userId, now), installsToday(device.userId, now), activeDevices(device.userId)]);
  const limits = PLANS[planId].limits;
  const subStatus = sub ? effectiveStatus(sub, now) : "none";
  const lapsedFrom = sub && subStatus === "canceled" && sub.plan !== "free" ? sub.plan : null;

  const notices: CliNoticeCode[] = [];
  if (subStatus === "grace") notices.push("grace");
  if (subStatus === "past_due") notices.push("past_due");
  if (lapsedFrom) notices.push("expired");
  if (sub && subStatus === "active" && sub.cancelAtPeriodEnd) notices.push("cancel_scheduled");
  if (!isUnlimited(limits.cliInstallsPerDay)) {
    if (used >= limits.cliInstallsPerDay) notices.push("quota_exhausted");
    else if (used >= limits.cliInstallsPerDay * 0.8) notices.push("quota_low");
  }
  if (caller.suspended) notices.push("device_suspended");
  if (compareVersions(device.cliVersion, CLI_VERSION) < 0) notices.push("cli_update");

  return {
    user: { id: device.userId, handle: profile?.handle ?? device.userId, name: profile?.name ?? "" },
    device: toInfo(device, caller.suspended),
    plan: { id: planId, status: subStatus, lapsedFrom, periodEnd: sub?.currentPeriodEnd ?? null, cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false },
    limits: { devices: limits.cliDevices, installsPerDay: limits.cliInstallsPerDay, bulk: limits.cliBulk },
    usage: { installsToday: used, devices: active.length },
    resetAt: new Date(utcDayStart(now) + DAY).toISOString(),
    notices,
    cli: { latest: CLI_VERSION, minimum: CLI_MIN_VERSION },
    links: { billing: `${APP_URL}/dashboard/billing`, devices: `${APP_URL}/dashboard/settings#cli` },
  };
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

export interface InstallRequest {
  /** A skill slug, or a skillset slug with `set: true`. */
  slug: string;
  set?: boolean;
  target: CliTarget;
  allowSandbox?: boolean;
  /** `mcp` — the agent asked through `synapth mcp`; agents never get Sandbox entries. */
  via?: CliInstallVia;
}

async function recordInstalls(caller: CliCaller, bundles: CliBundle[], target: CliTarget, via: CliInstallVia, now: Date) {
  const rows: InstallRow[] = bundles.map((b) => ({ id: newId("cin"), userId: caller.device.userId, deviceId: caller.device.id, skillId: b.id, target, via, createdAt: now.toISOString() }));
  if (!hasDatabase) mem.installs.push(...rows);
  else await prisma.cliInstallEvent.createMany({ data: rows.map((r) => ({ ...r, createdAt: now })) });
  // Catalogue counters are a side effect: a failure there must not fail an install the quota already counted.
  await Promise.all(bundles.map((b) => skillRepository.recordInstall(b.id, `cli:${target}`, caller.device.userId).catch((err) => console.error("[cli] recordInstall failed", err))));
}

const NOT_INSTALLABLE = {
  sandbox: "This entry is Sandbox (not reviewed yet); pass --allow-sandbox to install it anyway",
  sandboxAgent: "This entry is Sandbox (not reviewed yet): agents cannot install it — a person can, with `synapth install --allow-sandbox`",
  http: "This entry is an HTTP tool: it runs on the Synapth gateway, there is nothing to install — call it through the API",
  unsupported: "This entry has no local install",
  target: "This entry cannot be installed into the chosen agent; try --target claude-code",
} as const;

/**
 * Checks device, plan and quota, then returns what to write. The quota counts
 * installed entries only (skipped ones are free), and a skillset that would
 * overrun it is refused whole rather than half-installed. Two concurrent
 * installs can overshoot by one batch: the count is not locked.
 */
export async function installForDevice(caller: CliCaller, input: InstallRequest, now = new Date()): Promise<CliInstallResult> {
  const userId = caller.device.userId;
  const via = input.via ?? "cli";
  if (caller.suspended) {
    throw new CliError("device_suspended", 403, "Your plan allows fewer linked machines than you have; this one is paused — unlink another in Settings → CLI or upgrade", { devices: `${APP_URL}/dashboard/settings#cli`, billing: `${APP_URL}/pro` });
  }
  const planId = await currentPlanId(userId, now.getTime());
  const limits = PLANS[planId].limits;
  if (input.set && !limits.cliBulk) {
    throw new CliError("plan_required", 402, "Installing a whole skillset needs Synapth Pro", { plan: planId, required: "pro", billing: `${APP_URL}/pro` });
  }

  const skills = input.set ? await skillsetEntries(input.slug) : [await installableSkill(input.slug)];
  const installed: CliBundle[] = [];
  const skipped: CliInstallResult["skipped"] = [];
  for (const skill of skills) {
    if (!isListed(skill.securityLevel)) continue;
    const outcome = cliBundle(await hydratePrompt(skill), input.target, { allowSandbox: input.allowSandbox && via !== "mcp" });
    if (outcome.ok) installed.push(outcome.bundle);
    else skipped.push({ slug: skill.slug, name: skill.name, reason: outcome.reason });
  }
  if (!installed.length && !input.set) {
    const reason = skipped[0]?.reason ?? "unsupported";
    throw new CliError("not_installable", 422, NOT_INSTALLABLE[reason === "sandbox" && via === "mcp" ? "sandboxAgent" : reason], { reason });
  }

  const used = await installsToday(userId, now.getTime());
  if (!isUnlimited(limits.cliInstallsPerDay) && used + installed.length > limits.cliInstallsPerDay) {
    const retryAfter = Math.max(1, Math.ceil((utcDayStart(now.getTime()) + DAY - now.getTime()) / 1000));
    const what = used >= limits.cliInstallsPerDay ? "is used up" : `has ${limits.cliInstallsPerDay - used} left, ${installed.length} needed`;
    throw new CliError("quota_exceeded", 429, `Daily install quota of ${limits.cliInstallsPerDay} ${what}`, { plan: planId, used, limit: limits.cliInstallsPerDay, retryAfter, billing: `${APP_URL}/pro` });
  }

  if (installed.length) await recordInstalls(caller, installed, input.target, via, now);
  return { installed, skipped, usage: { installsToday: used + installed.length, installsPerDay: limits.cliInstallsPerDay } };
}

async function installableSkill(slug: string) {
  const skill = await skillRepository.bySlug(slug);
  if (!skill || !isListed(skill.securityLevel)) throw new CliError("not_found", 404, `No catalogue entry "${slug}"`);
  return skill;
}

async function skillsetEntries(slug: string) {
  const set = await getSkillset(slug);
  if (!set) throw new CliError("not_found", 404, `No skillset "${slug}"`);
  return skillsetSkills(set);
}

/**
 * `synapth recommend` / the `recommend_skills` MCP tool: the agent API's
 * `resolve_task` under the owner's policy (Sandbox is never offered), counted
 * against the plan's daily resolve quota like any agent call.
 */
export async function cliRecommend(caller: CliCaller, task: string, target: CliTarget): Promise<CliRecommendation[]> {
  const userId = caller.device.userId;
  await enforceAgentQuota(userId, "resolve");
  const agentCaller: Caller = { userId, via: "cli-device", keyId: null, keyCreatedAt: null, scopes: ["catalog:read"], policy: await ownerPolicy(userId), agentName: `synapth-cli/${caller.device.cliVersion}` };
  const res = (await runAgentTool(agentCaller, "resolve_task", { task, client: target })) as { variants: Array<{ type: "pack" | "set" | "skill"; id: string; reason: string; trust: string; coverage: number; tokens: number; permissions: string[]; items: Array<{ slug: string; name: string; trust: string; category: string }> }> };
  return res.variants.map((v) => ({
    type: v.type,
    // A pack installs by its skillset slug; a set or a skill by its entries' slugs.
    install: v.type === "pack" ? { set: v.id } : { skills: v.items.map((i) => i.slug) },
    reason: v.reason,
    trust: v.trust,
    coverage: v.coverage,
    tokens: v.tokens,
    permissions: v.permissions,
    items: v.items.map((i) => ({ slug: i.slug, name: i.name, trust: i.trust, category: i.category })),
  }));
}

/**
 * Compact rows for `synapth search` and the `search_skills` MCP tool: listed
 * entries plus skillsets (packs) matching the query. `results` keeps its old
 * shape, so CLIs that predate packs just ignore `skillsets`.
 */
export async function cliSearch(q: string, limit = 10): Promise<{ results: CliSearchRow[]; skillsets: CliSkillsetRow[] }> {
  const res = await skillRepository.search(q, { limit: Math.min(Math.max(limit, 1), 30) });
  const results = res.hits
    .map((h) => h.skill)
    .filter((s) => isListed(s.securityLevel))
    .map((s) => ({ slug: s.slug, name: s.name, description: s.description.slice(0, 160), category: s.category, securityLevel: s.securityLevel, version: s.version, entrypoint: s.manifest.entrypoint.type }));

  const found = await listSkillsets({ q, limit: 5, sort: "popular" });
  const skillsets: CliSkillsetRow[] = [];
  for (const summary of found) {
    const set = await getSkillset(summary.slug);
    if (!set) continue;
    const entries = (await skillsetSkills(set)).filter((s) => isListed(s.securityLevel));
    if (!entries.length) continue;
    skillsets.push({
      slug: summary.slug,
      name: summary.name,
      summary: summary.summary.slice(0, 160),
      verified: summary.verified,
      favorites: summary.favorites,
      entries: entries.slice(0, 8).map((s) => ({ slug: s.slug, name: s.name, securityLevel: s.securityLevel })),
      total: entries.length,
    });
  }
  return { results, skillsets };
}

/** Test helper. */
export function resetCliForTests() {
  mem.linkKeys.length = 0;
  mem.devices.length = 0;
  mem.installs.length = 0;
}
