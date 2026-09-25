/**
 * Cortex · Agent API core (ТЗ §1 «AI-first»).
 *
 * One implementation behind both transports — REST `/api/v1/agent/<tool>`
 * and the MCP server at `/mcp`. Every operation:
 *   1. applies the caller's policy *before* search, so forbidden options are
 *      never seen (FR-AI-11);
 *   2. answers with `pol`, the compact restriction summary (FR-AI-12);
 *   3. writes one AgentAuditLog row (FR-AI-62);
 *   4. fails with a coded error plus a hint for the agent (FR-AI-60).
 *
 * `resolve_task` has no LLM in this build: intents are the task's search
 * terms and candidates come from BM25F, the documented fallback (step 4).
 * Nothing is installed silently (D5): the platform returns a plan with
 * hashes, the client executes it with the human's consent.
 */

import { z } from "zod";
import { skillRepository, hydratePrompt } from "@/cortex/repository";
import { getSkillset, listSkillsets } from "@/cortex/skillsets";
import { recordAgentAction } from "@/cortex/agent-audit";
import { installHint } from "@/cortex/agent-context";
import { contentHash, signContentHash, skillFiles, type PlatformSignature } from "@/cortex/signing";
import { prisma, hasDatabase } from "@/cortex/db";
import type { Caller } from "@/cortex/api-keys";
import { tokenize } from "@/cortex/search";
import { scanSkill, scanUntrustedText } from "@/lib/sandbox-scanner";
import { installSnippet, type InstallTarget } from "@/axon/install";
import { usdToMicros } from "@/types/economy";
import { capabilityClasses, compactPolicy, DEFAULT_POLICY, evaluatePolicy, POLICY_PERMISSIONS, tightenPolicy, type ApiKeyScope, type CompactPolicy, type KeyPolicy, type PolicyPermission } from "@/types/api-keys";
import { AGENT_PROTOCOL_VERSION, type AgentErrorCode, type AgentItemRef, type AgentToolSpec, type AgentVariant, type ApprovalCard, type LockEntry } from "@/types/agent";
import { isListed, meetsTrust, TRUST_RANK, TRUST_WEIGHT, type TrustLevel } from "@/types/trust";
import { SKILL_CATEGORIES, type SecurityLevel, type Skill } from "@/types/skill";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

const STATUS: Record<AgentErrorCode, number> = {
  policy_denied: 403,
  budget_exceeded: 402,
  approval_required: 409,
  integrity_mismatch: 409,
  revoked: 410,
  rate_limited: 429,
  not_found: 404,
  scope_missing: 403,
  unauthorized: 401,
  invalid_request: 400,
};

const HINTS: Record<AgentErrorCode, string> = {
  policy_denied: "The key policy forbids this entry. Pick another variant from resolve_task or ask the key owner to adjust the policy.",
  budget_exceeded: "The spend cap or balance does not cover this call. Choose a cheaper tool or ask the owner to top up or raise the cap.",
  approval_required: "Show approvalCard to the human and repeat the call with approved=true once they agree.",
  integrity_mismatch: "The files differ from the signed hashes. Abort the installation, discard the files and fetch them again.",
  revoked: "This version was withdrawn. Offer the human to remove it; do not use it any further.",
  rate_limited: "Too many requests. Wait for Retry-After seconds, then retry once.",
  not_found: "No such entry for this key. Search again; quarantined and filtered entries are invisible.",
  scope_missing: "The key lacks the scope this tool needs. Ask the owner for a key with that scope.",
  unauthorized: "Send a valid key in X-Synapth-Key. Anonymous callers may only use search.",
  invalid_request: "The arguments do not match the tool's input schema. Fix them and retry.",
};

export class AgentError extends Error {
  readonly status: number;
  readonly hint: string;
  constructor(
    readonly code: AgentErrorCode,
    message: string,
    readonly rule?: string,
  ) {
    super(message);
    this.name = "AgentError";
    this.status = STATUS[code];
    this.hint = HINTS[code];
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface AgentCall {
  caller: Caller | null;
  policy: KeyPolicy;
  pol: CompactPolicy;
}

export function agentCall(caller: Caller | null): AgentCall {
  const policy = caller?.policy ?? DEFAULT_POLICY;
  return { caller, policy, pol: compactPolicy(policy) };
}

const subjectOf = (s: Skill) => ({ id: s.id, slug: s.slug, category: s.category, securityLevel: s.securityLevel, manifest: s.manifest, priceMicros: usdToMicros(s.pricePerCall) });

function permitted(policy: KeyPolicy, skill: Skill) {
  return isListed(skill.securityLevel) && evaluatePolicy(policy, subjectOf(skill)).ok;
}

async function loadSkill(idOrSlug: string): Promise<Skill | null> {
  const skill = (await skillRepository.byId(idOrSlug)) ?? (await skillRepository.bySlug(idOrSlug));
  return skill && isListed(skill.securityLevel) ? skill : null;
}

/** Visible and allowed, or a coded error — the policy decision lands in the journal. */
async function requirePermitted(call: AgentCall, action: string, idOrSlug: string): Promise<Skill> {
  const skill = await loadSkill(idOrSlug);
  if (!skill) throw new AgentError("not_found", `No entry "${idOrSlug}"`);
  const decision = evaluatePolicy(call.policy, subjectOf(skill));
  if (!decision.ok) {
    await recordAgentAction(call.caller, { action, objectType: "skill", objectId: skill.id, objectVersion: skill.version, decision: "deny", rule: decision.rule, result: "policy_denied" });
    // Say which rule fired, never what the entry is: it stays invisible to this key.
    throw new AgentError("policy_denied", `Denied by policy rule ${decision.rule}`, decision.rule);
  }
  return skill;
}

// ---------------------------------------------------------------------------
// Entry facts
// ---------------------------------------------------------------------------

/** Rough context weight: prompt + tool schemas, ~4 chars per token. */
export function estimateTokens(skill: Pick<Skill, "manifest" | "readme">): number {
  const prompt = skill.manifest.systemPrompt ?? "";
  const tools = JSON.stringify(skill.manifest.tools ?? []);
  return Math.ceil((prompt.length + tools.length) / 4) + 20;
}

const itemRef = (s: Skill): AgentItemRef => ({ id: s.id, slug: s.slug, name: s.name, category: s.category, version: s.version, trust: s.securityLevel, price: s.pricePerCall });

function findingCounts(skills: Skill[]) {
  const out = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const s of skills) for (const f of scanSkill(s).findings) if (f.severity in out) out[f.severity as keyof typeof out] += 1;
  return out;
}

const RISKY: ReadonlyArray<string> = ["shell", "network", "filesystem:write", "env"];

/** ТЗ §1, step 5 — what needs a human «yes» before it is connected. */
export function needsApproval(skill: Skill, policy: KeyPolicy = DEFAULT_POLICY): boolean {
  const perms = skill.manifest.permissions ?? [];
  const ep = skill.manifest.entrypoint?.type;
  if (skill.category === "MCP" || ep === "mcp-stdio" || ep === "mcp-sse") return true;
  if (perms.some((p) => RISKY.includes(p))) return true;
  if (policy.maxPerCallMicros !== null && usdToMicros(skill.pricePerCall) > policy.maxPerCallMicros) return true;
  if (ep === "prompt" || skill.category === "Prompt") return !meetsTrust(skill.securityLevel, "Verified");
  return false;
}

const permsOf = (skills: Skill[]): PolicyPermission[] => [...new Set(skills.flatMap((s) => capabilityClasses(s.manifest.permissions)))].sort((a, b) => POLICY_PERMISSIONS.indexOf(a) - POLICY_PERMISSIONS.indexOf(b));

function lowestTrust(skills: Skill[]): SecurityLevel {
  return skills.reduce<SecurityLevel>((acc, s) => (TRUST_RANK[s.securityLevel] < TRUST_RANK[acc] ? s.securityLevel : acc), "Gov");
}

function approvalCard(title: string, skills: Skill[], why: string, trust: TrustLevel): ApprovalCard {
  const price = skills.reduce((sum, s) => sum + s.pricePerCall, 0);
  return {
    title,
    what: skills.map((s) => `${s.name} ${s.version} (${s.category})`).join(", ").slice(0, 300),
    why: why.slice(0, 200),
    permissions: [...new Set(skills.flatMap((s) => s.manifest.permissions ?? []))],
    price: price > 0 ? `$${price.toFixed(4)} per call` : "free",
    trust,
  };
}

export function lockEntry(skill: Skill, hash: string): LockEntry {
  return { id: skill.id, slug: skill.slug, version: skill.version, contentHash: hash, trust: skill.securityLevel, permissions: [...(skill.manifest.permissions ?? [])] };
}

export async function skillContentHash(skill: Skill): Promise<{ hash: string; files: ReturnType<typeof skillFiles> }> {
  const full = await hydratePrompt(skill);
  const files = skillFiles(skill, full.manifest.systemPrompt ?? null);
  return { hash: contentHash(files), files };
}

// ---------------------------------------------------------------------------
// Input schemas (shared by REST and MCP)
// ---------------------------------------------------------------------------

const idSchema = z.string().trim().min(1).max(160);
const clientSchema = z.enum(["claude-code", "cursor", "claude-desktop", "api", "curl", "other"]).default("api");
const lockSchema = z.object({ id: idSchema, slug: z.string().max(160).optional(), version: z.string().max(64), contentHash: z.string().regex(/^[0-9a-f]{64}$/), trust: z.string().optional(), permissions: z.array(z.string().max(32)).max(10).default([]) });

export const inputSchemas = {
  search: z.object({ q: z.string().max(200).default(""), category: z.enum(SKILL_CATEGORIES).optional(), limit: z.number().int().min(1).max(50).default(10) }),
  resolve_task: z.object({
    task: z.string().trim().min(3).max(2000),
    client: clientSchema,
    ctx: z.object({ lang: z.string().max(32).optional(), stack: z.array(z.string().max(40)).max(20).optional(), os: z.string().max(40).optional() }).partial().default({}),
    budget: z.object({ tokens: z.number().int().min(500).max(200_000).optional(), usdPerDay: z.number().min(0).max(10_000).optional() }).default({}),
    constraints: z
      .object({
        minTrust: z.enum(["Sandbox", "Community", "Verified", "Certified", "Gov"]).optional(),
        deniedPermissions: z.array(z.enum(POLICY_PERMISSIONS)).optional(),
        categories: z.array(z.enum(SKILL_CATEGORIES)).optional(),
      })
      .default({}),
    installed: z.array(z.string().regex(/^[0-9a-f]{64}$/)).max(200).default([]),
  }),
  get_skill: z.object({ id: idSchema }),
  get_pack: z.object({ id: idSchema }),
  fetch_skill: z.object({ id: idSchema }),
  install_plan: z.object({ ids: z.array(idSchema).max(50).default([]), pack: idSchema.optional(), client: clientSchema }).refine((v) => v.ids.length > 0 || v.pack, "ids or pack is required"),
  confirm_install: z.object({ lock: z.array(lockSchema).min(1).max(50), client: clientSchema }),
  report_outcome: z.object({ id: idSchema, result: z.enum(["success", "partial", "fail"]), tokens: z.number().int().min(0).max(10_000_000).optional(), durationMs: z.number().int().min(0).max(86_400_000).optional(), comment: z.string().max(500).optional() }),
  check_updates: z.object({ lock: z.array(lockSchema).min(1).max(200) }),
  execute: z.object({ id: idSchema, tool: z.string().max(64).nullable().default(null), input: z.unknown().default({}), idempotencyKey: z.string().max(128).optional() }),
} as const;

export type AgentToolName = keyof typeof inputSchemas;

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

export interface AgentSearchEntry {
  i: string;
  s: string;
  n: string;
  d: string;
  c: Skill["category"];
  sec: SecurityLevel;
  p: number;
  perm: PolicyPermission[];
  tok: number;
  install: string;
}

export async function agentSearch(call: AgentCall, input: z.infer<typeof inputSchemas.search>) {
  const res = await skillRepository.search(input.q, { limit: 100, category: input.category, sort: input.q ? "relevance" : "trending" });
  const allowed = res.hits.map((h) => h.skill).filter((s) => permitted(call.policy, s));
  const items: AgentSearchEntry[] = allowed.slice(0, input.limit).map((s) => ({
    i: s.id,
    s: s.slug,
    n: s.name,
    d: s.description.replace(/\s+/g, " ").slice(0, 160),
    c: s.category,
    sec: s.securityLevel,
    p: s.pricePerCall,
    perm: capabilityClasses(s.manifest.permissions),
    tok: estimateTokens(s),
    install: installHint(s),
  }));
  await recordAgentAction(call.caller, { action: "search", objectType: "query", objectId: input.q.slice(0, 120) || null, decision: "allow", result: "ok" });
  return { items, n: allowed.length, pol: call.pol };
}

// ---------------------------------------------------------------------------
// resolve_task
// ---------------------------------------------------------------------------

const RANK = { rel: 0.45, trust: 0.2, success: 0.2, retention: 0.1, tokens: 0.05 } as const;
const MAX_INTENTS = 10;
const PACK_COVERAGE = 0.8;
const DANGEROUS_COMBOS: Array<[PolicyPermission, PolicyPermission]> = [
  ["filesystem", "network"],
  ["env", "network"],
  ["shell", "network"],
  ["clipboard", "network"],
];

interface Candidate {
  skill: Skill;
  rel: number;
  intents: Set<string>;
  tokens: number;
  score: number;
}

/** Tools with the same name or a dangerous permission pair across skills (PK-TOOL, PK-COMBO). */
function conflicts(chosen: Candidate[], next: Candidate): boolean {
  const names = new Set(chosen.flatMap((c) => c.skill.manifest.tools.map((t) => t.name)));
  if (next.skill.manifest.tools.some((t) => names.has(t.name))) return true;
  const have = new Set(permsOf(chosen.map((c) => c.skill)));
  const add = capabilityClasses(next.skill.manifest.permissions);
  return DANGEROUS_COMBOS.some(([a, b]) => (have.has(a) && add.includes(b) && !add.includes(a)) || (have.has(b) && add.includes(a) && !add.includes(b)));
}

function variantOf(type: AgentVariant["type"], id: string, members: Candidate[], intents: string[], trust: TrustLevel, policy: KeyPolicy, budgetTokens: number, title: string): AgentVariant {
  const skills = members.map((m) => m.skill);
  const covered = new Set(members.flatMap((m) => [...m.intents]));
  const coverage = intents.length ? covered.size / intents.length : 0;
  const tokens = members.reduce((sum, m) => sum + m.tokens, 0);
  const score = members.length ? members.reduce((sum, m) => sum + m.score, 0) / members.length : 0;
  const requiresApproval = type === "pack" || skills.some((s) => needsApproval(s, policy));
  const reason = `Covers ${covered.size}/${intents.length} intents (${[...covered].slice(0, 5).join(", ") || "—"}); ${trust}; ~${tokens} tokens${tokens > budgetTokens ? " (over budget)" : ""}.`.slice(0, 200);
  return {
    id,
    type,
    items: skills.map(itemRef),
    reason,
    tokens,
    permissions: permsOf(skills),
    trust,
    price: Math.round(skills.reduce((sum, s) => sum + s.pricePerCall, 0) * 1e6) / 1e6,
    findings: findingCounts(skills),
    coverage: Math.round(coverage * 100) / 100,
    score: Math.round((score + (type === "pack" ? 0.05 : 0)) * 1000) / 1000,
    requiresApproval,
    approvalCard: requiresApproval ? approvalCard(title, skills, reason, trust) : null,
  };
}

export async function resolveTask(call: AgentCall, input: z.infer<typeof inputSchemas.resolve_task>) {
  const policy = tightenPolicy(call.policy, input.constraints);
  const budgetTokens = input.budget.tokens ?? 8_000;
  // FR-AI-21: the task text is untrusted. It only ever reaches the search index here, but flag injections in the journal.
  const injected = scanUntrustedText(input.task, "task").filter((f) => f.severity === "high" || f.severity === "critical");
  const intents = [...new Set(tokenize(input.task))].slice(0, MAX_INTENTS);

  // Candidates: the whole task plus every intent on its own (BM25F), policy first.
  const byId = new Map<string, Candidate>();
  const add = (skill: Skill, score: number, intent: string | null) => {
    if (!permitted(policy, skill)) return;
    const cur = byId.get(skill.id) ?? { skill, rel: 0, intents: new Set<string>(), tokens: estimateTokens(skill), score: 0 };
    cur.rel += score;
    if (intent) cur.intents.add(intent);
    byId.set(skill.id, cur);
  };
  for (const hit of (await skillRepository.search(input.task, { limit: 50 })).hits) add(hit.skill, hit.score, null);
  for (const intent of intents) for (const hit of (await skillRepository.search(intent, { limit: 25, prefix: false })).hits) add(hit.skill, hit.score, intent);

  const installed = new Set(input.installed);
  let candidates = [...byId.values()].sort((a, b) => b.rel - a.rel).slice(0, 50);
  if (installed.size) {
    const hashes = await Promise.all(candidates.map(async (c) => (await skillContentHash(c.skill)).hash));
    candidates = candidates.filter((_, i) => !installed.has(hashes[i]));
  }
  const maxRel = Math.max(1e-9, ...candidates.map((c) => c.rel));
  const success = await successRates(candidates.map((c) => c.skill.id));
  for (const c of candidates) {
    c.score =
      RANK.rel * (c.rel / maxRel) +
      RANK.trust * TRUST_WEIGHT[c.skill.securityLevel] +
      RANK.success * (success.get(c.skill.id) ?? 0.5) +
      RANK.retention * c.skill.stats.retentionRate -
      RANK.tokens * Math.min(1, c.tokens / budgetTokens);
  }
  candidates.sort((a, b) => b.score - a.score);

  const variants: AgentVariant[] = [];

  // 1) A ready pack that covers ≥ 80 % of the intents.
  const packIds = new Set<string>();
  for (const c of candidates.slice(0, 8)) for (const s of await listSkillsets({ skillId: c.skill.id, limit: 5 })) packIds.add(s.slug);
  let bestPack: AgentVariant | null = null;
  for (const slug of packIds) {
    const set = await getSkillset(slug);
    if (!set || set.trust === "Sandbox" || TRUST_RANK[set.trust] < TRUST_RANK[policy.minTrust]) continue;
    const members: Candidate[] = [];
    let blocked = false;
    for (const item of set.items) {
      const skill = item.skill ? await loadSkill(item.skill.id) : null;
      if (!skill || !permitted(policy, skill)) {
        blocked = true;
        break;
      }
      members.push(byId.get(skill.id) ?? { skill, rel: 0, intents: new Set(), tokens: estimateTokens(skill), score: 0 });
    }
    if (blocked || !members.length) continue;
    const v = variantOf("pack", set.slug, members, intents, set.trust, policy, budgetTokens, `Connect pack «${set.name}»`);
    if (v.coverage >= PACK_COVERAGE && (!bestPack || v.coverage > bestPack.coverage || (v.coverage === bestPack.coverage && v.score > bestPack.score))) bestPack = v;
  }
  if (bestPack) variants.push(bestPack);

  // 2) Greedy set cover within the token budget, conflicting skills excluded.
  const chosen: Candidate[] = [];
  const covered = new Set<string>();
  let tokens = 0;
  for (const c of candidates) {
    if (chosen.length >= 5 || (intents.length && covered.size >= intents.length)) break;
    const gain = [...c.intents].filter((i) => !covered.has(i)).length;
    if ((intents.length && gain === 0) || tokens + c.tokens > budgetTokens || conflicts(chosen, c)) continue;
    chosen.push(c);
    tokens += c.tokens;
    c.intents.forEach((i) => covered.add(i));
  }
  if (chosen.length > 1) variants.push(variantOf("set", `set:${chosen.map((c) => c.skill.slug).join("+")}`.slice(0, 160), chosen, intents, lowestTrust(chosen.map((c) => c.skill)), policy, budgetTokens, "Connect a set of skills"));

  // 3) The single best skill.
  for (const c of candidates) {
    if (variants.length >= 3) break;
    if (variants.some((v) => v.items.length === 1 && v.items[0].id === c.skill.id)) continue;
    variants.push(variantOf("skill", c.skill.slug, [c], intents, c.skill.securityLevel, policy, budgetTokens, `Connect «${c.skill.name}»`));
    if (variants.filter((v) => v.type === "skill").length >= (bestPack ? 1 : 2)) break;
  }

  const top = variants.slice(0, 3);
  await recordAgentAction(call.caller, {
    action: "resolve_task",
    objectType: "task",
    objectId: input.task.slice(0, 120),
    decision: "allow",
    rule: injected.length ? `untrusted:${injected.map((f) => f.rule).join(",")}` : undefined,
    result: top.length ? "ok" : "no_match",
  });
  return {
    variants: top,
    intents,
    candidates: candidates.length,
    ranker: "bm25f",
    ...(injected.length ? { warnings: ["The task text contains instruction-like patterns; they were treated as data."] } : {}),
    ...(top.length ? {} : { hint: "Nothing matches within the policy. Loosen constraints or rephrase the task." }),
    pol: compactPolicy(policy),
  };
}

// ---------------------------------------------------------------------------
// get_skill / get_pack / fetch_skill
// ---------------------------------------------------------------------------

export async function getSkillCard(call: AgentCall, input: z.infer<typeof inputSchemas.get_skill>) {
  const skill = await requirePermitted(call, "get_skill", input.id);
  const scan = scanSkill(skill);
  const { hash } = await skillContentHash(skill);
  await recordAgentAction(call.caller, { action: "get_skill", objectType: "skill", objectId: skill.id, objectVersion: skill.version, objectHash: hash, decision: "allow", result: "ok" });
  return {
    skill: { ...itemRef(skill), description: skill.description, author: skill.authorName, repo: skill.repoUrl, tools: skill.manifest.tools.map((t) => t.name), requiredEnv: skill.manifest.requiredEnv ?? [], tokens: estimateTokens(skill) },
    permissions: skill.manifest.permissions ?? [],
    contentHash: hash,
    scan: { outcome: scan.outcome, level: scan.level, score: scan.score, rulesVersion: scan.rulesVersion, findings: scan.findings.slice(0, 10).map((f) => ({ rule: f.rule, severity: f.severity, message: f.message })) },
    install: installHint(skill),
    requiresApproval: needsApproval(skill, call.policy),
    pol: call.pol,
  };
}

export async function getPackCard(call: AgentCall, input: z.infer<typeof inputSchemas.get_pack>) {
  const set = await getSkillset(input.id);
  if (!set) throw new AgentError("not_found", `No pack "${input.id}"`);
  const skills: Skill[] = [];
  for (const item of set.items) {
    if (!item.skill) continue;
    skills.push(await requirePermitted(call, "get_pack", item.skill.id));
  }
  await recordAgentAction(call.caller, { action: "get_pack", objectType: "pack", objectId: set.id, decision: "allow", result: "ok" });
  return {
    pack: { id: set.id, slug: set.slug, name: set.name, summary: set.summary, trust: set.trust, author: set.author.handle, items: skills.map(itemRef) },
    permissions: permsOf(skills),
    tokens: skills.reduce((sum, s) => sum + estimateTokens(s), 0),
    requiresApproval: true,
    pol: call.pol,
  };
}

export async function fetchSkill(call: AgentCall, input: z.infer<typeof inputSchemas.fetch_skill>): Promise<{ id: string; slug: string; version: string; files: ReturnType<typeof skillFiles>; contentHash: string; signature: PlatformSignature; lock: LockEntry; requiresApproval: boolean; approvalCard: ApprovalCard | null; pol: CompactPolicy }> {
  const skill = await requirePermitted(call, "fetch_skill", input.id);
  if (skill.manifest.entrypoint?.type !== "prompt") {
    throw new AgentError("invalid_request", `${skill.slug} is ${skill.manifest.entrypoint?.type ?? "unknown"}: use install_plan (MCP) or execute (HTTP tools)`);
  }
  const { hash, files } = await skillContentHash(skill);
  const requiresApproval = needsApproval(skill, call.policy);
  await recordAgentAction(call.caller, { action: "fetch_skill", objectType: "skill", objectId: skill.id, objectVersion: skill.version, objectHash: hash, decision: "allow", result: "ok" });
  return {
    id: skill.id,
    slug: skill.slug,
    version: skill.version,
    files,
    contentHash: hash,
    signature: signContentHash(hash),
    lock: lockEntry(skill, hash),
    requiresApproval,
    approvalCard: requiresApproval ? approvalCard(`Load «${skill.name}» into the agent`, [skill], skill.description, skill.securityLevel) : null,
    pol: call.pol,
  };
}

// ---------------------------------------------------------------------------
// install_plan / confirm_install
// ---------------------------------------------------------------------------

const TARGET: Record<z.infer<typeof clientSchema>, InstallTarget> = { "claude-code": "claude-code", cursor: "cursor", "claude-desktop": "claude-desktop", api: "curl", curl: "curl", other: "curl" };

export async function installPlan(call: AgentCall, input: z.infer<typeof inputSchemas.install_plan>) {
  const ids = [...input.ids];
  let packName: string | null = null;
  if (input.pack) {
    const set = await getSkillset(input.pack);
    if (!set) throw new AgentError("not_found", `No pack "${input.pack}"`);
    if (set.trust === "Sandbox") throw new AgentError("policy_denied", "The pack contains Sandbox or quarantined entries (PK-SEC)", "PK-SEC");
    packName = set.name;
    ids.push(...set.items.flatMap((i) => (i.skill ? [i.skill.id] : [])));
  }
  const skills: Skill[] = [];
  for (const id of [...new Set(ids)]) skills.push(await requirePermitted(call, "install_plan", id));

  const target = TARGET[input.client];
  const steps = [];
  const lock: LockEntry[] = [];
  for (const skill of skills) {
    const { hash } = await skillContentHash(skill);
    lock.push(lockEntry(skill, hash));
    const ep = skill.manifest.entrypoint?.type;
    if (ep === "http") {
      steps.push({ id: skill.id, kind: "none" as const, note: "HTTP tool: nothing to install, call it through execute (skills:execute)." });
      continue;
    }
    if (ep === "prompt") {
      steps.push({ id: skill.id, kind: "fetch" as const, note: "Prompt skill: call fetch_skill, verify the hashes, then save to .claude/skills/<slug>/SKILL.md or keep it in context." });
      continue;
    }
    const snippet = installSnippet(skill, target);
    steps.push({ id: skill.id, kind: snippet.language === "json" ? ("config" as const) : ("command" as const), language: snippet.language, code: snippet.code });
  }
  const requiresApproval = Boolean(input.pack) || skills.some((s) => needsApproval(s, call.policy));
  const trust = lowestTrust(skills);
  await recordAgentAction(call.caller, { action: "install_plan", objectType: input.pack ? "pack" : "skill", objectId: input.pack ?? skills.map((s) => s.id).join(",").slice(0, 190), decision: "allow", result: "ok" });
  return {
    steps,
    env: [...new Set(skills.flatMap((s) => s.manifest.requiredEnv ?? []))],
    lock,
    requiresApproval,
    approvalCard: requiresApproval ? approvalCard(packName ? `Install pack «${packName}»` : "Install skills", skills, "Execute the steps only after the human agrees; then call confirm_install with the lock entries.", trust) : null,
    pol: call.pol,
  };
}

export async function confirmInstall(call: AgentCall, input: z.infer<typeof inputSchemas.confirm_install>) {
  const confirmed: LockEntry[] = [];
  for (const entry of input.lock) {
    const skill = await loadSkill(entry.id);
    if (!skill) {
      await recordAgentAction(call.caller, { action: "confirm_install", objectType: "skill", objectId: entry.id, objectVersion: entry.version, objectHash: entry.contentHash, decision: "deny", result: "revoked" });
      throw new AgentError("revoked", `${entry.id} is no longer available`);
    }
    const { hash } = await skillContentHash(skill);
    if (hash !== entry.contentHash || skill.version !== entry.version) {
      await recordAgentAction(call.caller, { action: "confirm_install", objectType: "skill", objectId: skill.id, objectVersion: entry.version, objectHash: entry.contentHash, decision: "deny", rule: "hash", result: "integrity_mismatch" });
      throw new AgentError("integrity_mismatch", `${skill.slug}: the installed files do not match version ${skill.version}`);
    }
    await skillRepository.recordInstall(skill.id, input.client, call.caller?.userId);
    await recordAgentAction(call.caller, { action: "confirm_install", objectType: "skill", objectId: skill.id, objectVersion: skill.version, objectHash: hash, decision: "allow", result: "ok" });
    confirmed.push(lockEntry(skill, hash));
  }
  return { installed: confirmed.length, lock: confirmed, pol: call.pol };
}

// ---------------------------------------------------------------------------
// report_outcome / check_updates
// ---------------------------------------------------------------------------

export interface AgentReportRow {
  id: string;
  skillId: string;
  userId: string;
  keyId: string | null;
  result: "success" | "partial" | "fail";
  tokens: number | null;
  durationMs: number | null;
  comment: string | null;
  weight: number;
  day: string;
  createdAt: string;
}

const gr = globalThis as unknown as { __synapthAgentReports_v1?: AgentReportRow[] };
const memoryReports: AgentReportRow[] = gr.__synapthAgentReports_v1 ?? (gr.__synapthAgentReports_v1 = []);

/** FR-AI-51: young keys and the author's own keys do not move ratings; older keys weigh more. */
export function reportWeight(caller: Pick<Caller, "userId" | "keyCreatedAt" | "via">, skill: Pick<Skill, "authorId">, now = Date.now()): number {
  if (caller.userId === skill.authorId) return 0;
  if (caller.via !== "api-key" || !caller.keyCreatedAt) return caller.via === "session" ? 0.5 : 0;
  const ageDays = (now - Date.parse(caller.keyCreatedAt)) / 86_400_000;
  if (ageDays < 7) return 0;
  return Math.min(1, 0.4 + ageDays / 60);
}

export async function reportOutcome(call: AgentCall, input: z.infer<typeof inputSchemas.report_outcome>) {
  const caller = call.caller!;
  const skill = await loadSkill(input.id);
  if (!skill) throw new AgentError("not_found", `No entry "${input.id}"`);
  const day = new Date().toISOString().slice(0, 10);
  const weight = reportWeight(caller, skill);
  const row: AgentReportRow = { id: `rep_${Math.random().toString(36).slice(2, 12)}`, skillId: skill.id, userId: caller.userId, keyId: caller.keyId, result: input.result, tokens: input.tokens ?? null, durationMs: input.durationMs ?? null, comment: input.comment ?? null, weight, day, createdAt: new Date().toISOString() };
  const duplicate = hasDatabase
    ? await prisma.agentReport.findFirst({ where: { skillId: skill.id, userId: caller.userId, keyId: caller.keyId, day }, select: { id: true } })
    : memoryReports.find((r) => r.skillId === skill.id && r.userId === caller.userId && r.keyId === caller.keyId && r.day === day);
  if (duplicate) throw new AgentError("invalid_request", "One report per installation per day; this one is already recorded");
  if (hasDatabase) {
    const { id: _id, createdAt: _at, ...data } = row;
    await prisma.agentReport.create({ data });
  } else memoryReports.push(row);
  await recordAgentAction(caller, { action: "report_outcome", objectType: "skill", objectId: skill.id, objectVersion: skill.version, decision: "allow", result: input.result });
  return { accepted: true, counted: weight > 0, pol: call.pol };
}

/** Weighted share of successful reports; partial counts half. Unknown skills are absent. */
export async function successRates(skillIds: string[]): Promise<Map<string, number>> {
  const rows: Array<Pick<AgentReportRow, "skillId" | "result" | "weight">> = hasDatabase
    ? await prisma.agentReport.findMany({ where: { skillId: { in: skillIds }, weight: { gt: 0 } }, select: { skillId: true, result: true, weight: true } }).then((r) => r.map((x) => ({ ...x, result: x.result as AgentReportRow["result"] })))
    : memoryReports.filter((r) => skillIds.includes(r.skillId) && r.weight > 0);
  const acc = new Map<string, { ok: number; total: number }>();
  for (const r of rows) {
    const cur = acc.get(r.skillId) ?? { ok: 0, total: 0 };
    cur.total += r.weight;
    cur.ok += r.weight * (r.result === "success" ? 1 : r.result === "partial" ? 0.5 : 0);
    acc.set(r.skillId, cur);
  }
  return new Map([...acc].filter(([, v]) => v.total > 0).map(([id, v]) => [id, v.ok / v.total]));
}

export async function checkUpdates(call: AgentCall, input: z.infer<typeof inputSchemas.check_updates>) {
  const updates = [];
  for (const entry of input.lock) {
    const raw = (await skillRepository.byId(entry.id)) ?? (entry.slug ? await skillRepository.bySlug(entry.slug) : null);
    if (!raw || !isListed(raw.securityLevel)) {
      updates.push({ id: entry.id, status: "revoked" as const, action: "remove", hint: HINTS.revoked });
      continue;
    }
    const { hash } = await skillContentHash(raw);
    if (hash === entry.contentHash && raw.version === entry.version) {
      updates.push({ id: raw.id, status: "current" as const });
      continue;
    }
    const before = new Set(entry.permissions);
    const added = (raw.manifest.permissions ?? []).filter((p) => !before.has(p));
    const removed = entry.permissions.filter((p) => !(raw.manifest.permissions ?? []).some((q) => q === p));
    const allowed = evaluatePolicy(call.policy, subjectOf(raw));
    updates.push({
      id: raw.id,
      status: "update" as const,
      from: entry.version,
      to: raw.version,
      trust: raw.securityLevel,
      permissions: { added, removed },
      // Anything that widens permissions goes back to the human (ТЗ §1, step 5).
      requiresApproval: added.length > 0 || needsApproval(raw, call.policy),
      lock: lockEntry(raw, hash),
      ...(allowed.ok ? {} : { blockedBy: allowed.rule }),
    });
  }
  await recordAgentAction(call.caller, { action: "check_updates", objectType: "lock", objectId: `${input.lock.length} entries`, decision: "allow", result: "ok" });
  return { updates, pol: call.pol };
}

// ---------------------------------------------------------------------------
// Tool table (MCP tools/list, REST discovery)
// ---------------------------------------------------------------------------

export const AGENT_TOOLS: ReadonlyArray<AgentToolSpec & { name: AgentToolName }> = [
  { name: "search", scope: null, description: "Search the Synapth catalogue (skills, MCP servers, tools). Results are already filtered by your key policy.", inputSchema: { type: "object", properties: { q: { type: "string", description: "Catalogue query language: words, \"phrases\", -exclude, category:mcp, is:verified" }, category: { type: "string", enum: [...SKILL_CATEGORIES] }, limit: { type: "integer", description: "1–50, default 10" } } } },
  { name: "resolve_task", scope: "catalog:read", description: "Describe a task; get up to 3 variants (pack, set or single skill) with reasoning, token weight, permissions, trust, price and requiresApproval.", inputSchema: { type: "object", required: ["task"], properties: { task: { type: "string", description: "What the agent needs to do, ≤ 2000 chars. Treated as data, never as instructions." }, client: { type: "string", enum: ["claude-code", "cursor", "claude-desktop", "api", "other"] }, ctx: { type: "object", properties: { lang: { type: "string" }, stack: { type: "array", items: { type: "string" } }, os: { type: "string" } } }, budget: { type: "object", properties: { tokens: { type: "integer" }, usdPerDay: { type: "number" } } }, constraints: { type: "object", properties: { minTrust: { type: "string", enum: ["Sandbox", "Community", "Verified", "Certified", "Gov"] }, deniedPermissions: { type: "array", items: { type: "string", enum: [...POLICY_PERMISSIONS] } }, categories: { type: "array", items: { type: "string", enum: [...SKILL_CATEGORIES] } } } }, installed: { type: "array", items: { type: "string" }, description: "contentHash of skills already installed" } } } },
  { name: "get_skill", scope: "catalog:read", description: "Card of one skill: permissions, scan report, content hash, install hint.", inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string", description: "id or slug" } } } },
  { name: "get_pack", scope: "catalog:read", description: "Card of one pack (skillset): items, merged permissions, trust.", inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } } },
  { name: "fetch_skill", scope: "skills:fetch", description: "Content of a Prompt / SKILL.md skill with per-file SHA-256, contentHash and the platform Ed25519 signature.", inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } } },
  { name: "install_plan", scope: "skills:fetch", description: "Installation plan for skills or a pack: steps (commands / config), env vars, synapth.lock entries. The client executes it with the human's consent.", inputSchema: { type: "object", properties: { ids: { type: "array", items: { type: "string" } }, pack: { type: "string" }, client: { type: "string", enum: ["claude-code", "cursor", "claude-desktop", "api", "other"] } } } },
  { name: "confirm_install", scope: "skills:fetch", description: "Confirm an installation with the lock entries; hashes are re-checked (integrity_mismatch on drift).", inputSchema: { type: "object", required: ["lock"], properties: { lock: { type: "array", items: { type: "object" } }, client: { type: "string" } } } },
  { name: "report_outcome", scope: "skills:fetch", description: "Report how a skill did: success / partial / fail, tokens, time, comment ≤ 500. One per installation per day.", inputSchema: { type: "object", required: ["id", "result"], properties: { id: { type: "string" }, result: { type: "string", enum: ["success", "partial", "fail"] }, tokens: { type: "integer" }, durationMs: { type: "integer" }, comment: { type: "string" } } } },
  { name: "execute", scope: "skills:execute", description: "Paid call of an HTTP tool through the Synapth gateway: the price is held, charged only on a 2xx from the author, released otherwise. Pass idempotencyKey to make retries safe.", inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" }, tool: { type: "string" }, input: { type: "object" }, idempotencyKey: { type: "string", description: "8–128 chars; a repeat within 24 h returns the stored result without a new charge" } } } },
  { name: "check_updates", scope: "skills:fetch", description: "Check a synapth.lock: available updates with permission diffs, and revoked versions the client must offer to remove.", inputSchema: { type: "object", required: ["lock"], properties: { lock: { type: "array", items: { type: "object" } } } } },
];

type Handler = (call: AgentCall, input: never) => Promise<unknown>;
const HANDLERS: Record<AgentToolName, Handler> = {
  search: agentSearch as Handler,
  resolve_task: resolveTask as Handler,
  get_skill: getSkillCard as Handler,
  get_pack: getPackCard as Handler,
  fetch_skill: fetchSkill as Handler,
  install_plan: installPlan as Handler,
  confirm_install: confirmInstall as Handler,
  report_outcome: reportOutcome as Handler,
  check_updates: checkUpdates as Handler,
  execute: (async (call: AgentCall, input: z.infer<typeof inputSchemas.execute>) => {
    // Lazy: the gateway imports this module for its errors.
    const { executeSkill, GatewayFailure } = await import("@/cortex/gateway");
    const res = await executeSkill(call.caller!, input.id, { tool: input.tool, input: input.input }, { idempotencyKey: input.idempotencyKey });
    if (res.status >= 400) throw new GatewayFailure(res.status, res.body as Record<string, unknown>);
    return { ...(res.body as object), replayed: res.replayed };
  }) as Handler,
};

export const isAgentTool = (name: string): name is AgentToolName => name in HANDLERS;

/**
 * Validates, checks the scope and runs one tool. Transports only map the
 * result or the `AgentError` to their wire format.
 */
export async function runAgentTool(caller: Caller | null, name: AgentToolName, args: unknown): Promise<unknown> {
  const spec = AGENT_TOOLS.find((t) => t.name === name)!;
  if (spec.scope) {
    if (!caller) throw new AgentError("unauthorized", `${name} needs an API key`);
    if (!caller.scopes.includes(spec.scope as ApiKeyScope)) throw new AgentError("scope_missing", `${name} needs the ${spec.scope} scope`, spec.scope);
  }
  const parsed = inputSchemas[name].safeParse(args ?? {});
  if (!parsed.success) throw new AgentError("invalid_request", parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
  return HANDLERS[name](agentCall(caller), parsed.data as never);
}

export const AGENT_SERVER_INFO = { name: "synapth-mcp", version: "0.1.0", protocol: AGENT_PROTOCOL_VERSION } as const;

export function resetAgentReportsForTests() {
  memoryReports.length = 0;
}
