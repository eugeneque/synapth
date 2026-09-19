/**
 * Cortex · Sandbox Scanner
 *
 * Static threat analysis of a Synapth manifest. It never executes anything:
 * the manifest is flattened to a set of "surfaces" (system prompt, tool
 * descriptions, entrypoint command, env, flow) and each surface is run
 * through pattern checks. The result decides the `securityLevel` badge.
 *
 *   Sandbox   — at least one HIGH/CRITICAL finding, or unknown shape
 *   Community — clean scan, not human-reviewed
 *   Verified  — clean scan + `reviewed: true` (set by a moderator), never by the scanner alone
 */

import type { SecurityLevel, SkillManifest } from "@/types/skill";

export const SCANNER_VERSION = "1.3.0";

export type Severity = "low" | "medium" | "high" | "critical";

export type FindingKind =
  | "prompt_injection"
  | "malicious_command"
  | "secret_leak"
  | "exfiltration"
  | "over_permissioned"
  | "malformed";

export interface ScanFinding {
  kind: FindingKind;
  severity: Severity;
  /** Where in the manifest the pattern was found, e.g. `systemPrompt`, `tools[2].description`. */
  surface: string;
  /** Short human explanation. */
  message: string;
  /** The matched fragment, truncated and with secrets masked. */
  evidence: string;
  rule: string;
}

export interface ScanReport {
  scannerVersion: string;
  level: SecurityLevel;
  score: number; // 0..100, higher is safer
  findings: ScanFinding[];
  surfacesScanned: number;
  durationMs: number;
}

interface Surface {
  path: string;
  text: string;
}

interface Rule {
  id: string;
  kind: FindingKind;
  severity: Severity;
  pattern: RegExp;
  message: string;
  /** Restrict a rule to surfaces whose path matches. */
  only?: RegExp;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const PROMPT_INJECTION_RULES: Rule[] = [
  {
    id: "PI-001",
    kind: "prompt_injection",
    severity: "high",
    pattern: /ignore\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/i,
    message: "Attempts to override the host agent's instructions.",
  },
  {
    id: "PI-002",
    kind: "prompt_injection",
    severity: "high",
    pattern: /(you\s+are\s+now|from\s+now\s+on\s+you\s+are)\s+(in\s+)?(developer|god|jailbreak|unrestricted|dan)\s*mode/i,
    message: "Persona hijack / jailbreak trigger phrase.",
  },
  {
    id: "PI-003",
    kind: "prompt_injection",
    severity: "medium",
    pattern: /do\s+not\s+(tell|inform|reveal\s+to|mention\s+to)\s+the\s+user/i,
    message: "Instructs the model to hide behaviour from the user.",
  },
  {
    id: "PI-004",
    kind: "prompt_injection",
    severity: "high",
    pattern: /(reveal|print|repeat|output|dump)\s+(your|the)\s+(system\s+prompt|hidden\s+instructions|initial\s+prompt)/i,
    message: "Tries to extract the host system prompt.",
  },
  {
    id: "PI-005",
    kind: "prompt_injection",
    severity: "medium",
    pattern: /<\s*\/?\s*(system|assistant|instruction|im_start|im_end)\s*>|\[INST\]|<<SYS>>/i,
    message: "Contains chat-template control tokens.",
  },
  {
    id: "PI-006",
    kind: "prompt_injection",
    severity: "medium",
    pattern: /(always|silently|secretly)\s+(call|invoke|run|execute)\s+[`"']?[\w.-]+[`"']?\s+(before|after|on)\s+(every|each|any)/i,
    message: "Forces unconditional tool invocation on every turn.",
  },
  {
    id: "PI-007",
    kind: "prompt_injection",
    severity: "low",
    pattern: /[​-‏‪-‮⁦-⁩]/,
    message: "Zero-width / bidi control characters (possible hidden text).",
  },
];

const MALICIOUS_COMMAND_RULES: Rule[] = [
  {
    id: "MC-001",
    kind: "malicious_command",
    severity: "critical",
    pattern: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b\s+(--no-preserve-root\s+)?("?\/"?(\s|$|\*)|~\/?(\s|$|\*)|\$HOME\/?(\s|$)|\*|\.\s*$)/im,
    message: "Recursive forced deletion of root, home or everything.",
  },
  {
    id: "MC-002",
    kind: "malicious_command",
    severity: "critical",
    pattern: /\b(mkfs(\.\w+)?|dd\s+if=|shred\s+|:\(\)\s*\{\s*:\|:&\s*\};:)/i,
    message: "Disk-destroying or fork-bomb command.",
  },
  {
    id: "MC-003",
    kind: "malicious_command",
    severity: "critical",
    pattern: /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/i,
    message: "Pipes a remote script directly into a shell.",
  },
  {
    id: "MC-004",
    kind: "malicious_command",
    severity: "high",
    pattern: /\b(chmod\s+(-R\s+)?[0-7]*7[0-7]{2}\s+\/|chown\s+-R\s+\S+\s+\/\s|sudo\s+su\b|passwd\s+root)/i,
    message: "Privilege / permission tampering on system paths.",
  },
  {
    id: "MC-005",
    kind: "malicious_command",
    severity: "high",
    pattern: /\b(nc|ncat|netcat)\b[^\n]*-e\s+\/bin\/(ba)?sh|\/dev\/tcp\/\d+\.\d+/i,
    message: "Reverse shell pattern.",
  },
  {
    id: "MC-006",
    kind: "malicious_command",
    severity: "high",
    pattern: /\b(crontab\s+-|systemctl\s+(enable|start)|launchctl\s+load|reg\s+add\s+HK)/i,
    message: "Persistence mechanism.",
  },
  {
    id: "MC-007",
    kind: "malicious_command",
    severity: "low",
    pattern: /\b(base64\s+(-d|--decode)|eval\s*\(|exec\s*\(|child_process|os\.system|subprocess\.(Popen|call|run))\b/i,
    message: "Dynamic code execution / decoded payload.",
  },
  {
    id: "MC-008",
    kind: "malicious_command",
    severity: "high",
    pattern: /(~|\$HOME|\/Users\/\w+|\/home\/\w+)\/\.(ssh|aws|gnupg|config\/gh|netrc|npmrc|docker\/config\.json)/i,
    message: "Touches credential stores in the home directory.",
  },
];

const SECRET_RULES: Rule[] = [
  { id: "SK-001", kind: "secret_leak", severity: "critical", pattern: /\bsk-(proj-|ant-)?[A-Za-z0-9_-]{20,}\b/, message: "OpenAI / Anthropic-style API key." },
  { id: "SK-002", kind: "secret_leak", severity: "critical", pattern: /\bAKIA[0-9A-Z]{16}\b/, message: "AWS access key id." },
  { id: "SK-003", kind: "secret_leak", severity: "critical", pattern: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/, message: "GitHub token." },
  { id: "SK-004", kind: "secret_leak", severity: "critical", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, message: "Slack token." },
  { id: "SK-005", kind: "secret_leak", severity: "critical", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/, message: "Google API key." },
  { id: "SK-006", kind: "secret_leak", severity: "critical", pattern: /-----BEGIN\s+(RSA|EC|OPENSSH|DSA|PGP)?\s*PRIVATE\s+KEY-----/, message: "Private key block." },
  { id: "SK-007", kind: "secret_leak", severity: "high", pattern: /\b(api[_-]?key|secret|token|password|passwd)\b\s*[:=]\s*["']?[A-Za-z0-9_\-\/+=]{16,}["']?/i, message: "Hard-coded credential assignment." },
  { id: "SK-008", kind: "secret_leak", severity: "high", pattern: /\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis|amqp):\/\/[^\s:@\/]+:[^\s@\/]+@/i, message: "Connection string with embedded password." },
  { id: "SK-009", kind: "secret_leak", severity: "high", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, message: "JWT literal." },
];

const EXFILTRATION_RULES: Rule[] = [
  {
    id: "EX-001",
    kind: "exfiltration",
    severity: "high",
    pattern: /(send|post|upload|forward|transmit)\s+(the\s+|all\s+|any\s+)?(conversation|chat\s+history|user('s)?\s+(data|files|messages)|environment\s+variables|credentials|\.env)/i,
    message: "Instructs the agent to send user data elsewhere.",
  },
  {
    id: "EX-002",
    kind: "exfiltration",
    severity: "medium",
    pattern: /https?:\/\/(?!127\.|10\.|0\.0\.0\.0|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/,
    message: "Raw public IP address endpoint (no domain, no TLS accountability).",
  },
  {
    id: "EX-003",
    kind: "exfiltration",
    severity: "medium",
    pattern: /https?:\/\/[^\s"']*\.(ngrok(-free)?\.app|ngrok\.io|trycloudflare\.com|loca\.lt|serveo\.net|requestbin\.\w+|webhook\.site|pipedream\.net)\b/i,
    message: "Ephemeral tunnel / request-catcher endpoint.",
  },
];

const RULES: Rule[] = [...PROMPT_INJECTION_RULES, ...MALICIOUS_COMMAND_RULES, ...SECRET_RULES, ...EXFILTRATION_RULES];

const SEVERITY_WEIGHT: Record<Severity, number> = { low: 3, medium: 10, high: 30, critical: 60 };

// ---------------------------------------------------------------------------
// Surface extraction
// ---------------------------------------------------------------------------

function collectSurfaces(manifest: SkillManifest): Surface[] {
  const surfaces: Surface[] = [];
  const push = (path: string, value: unknown) => {
    if (typeof value === "string" && value.trim()) surfaces.push({ path, text: value });
  };

  push("name", manifest.name);
  push("description", manifest.description);
  push("systemPrompt", manifest.systemPrompt);

  manifest.tools?.forEach((tool, i) => {
    push(`tools[${i}].name`, tool.name);
    push(`tools[${i}].description`, tool.description);
    // Parameter descriptions and defaults are a favourite hiding place for injected text.
    push(`tools[${i}].parameters`, JSON.stringify(tool.parameters ?? {}));
    tool.examples?.forEach((ex, j) => push(`tools[${i}].examples[${j}]`, JSON.stringify(ex)));
  });

  const ep = manifest.entrypoint;
  if (ep) {
    if (ep.type === "mcp-stdio") {
      push("entrypoint.command", [ep.command, ...(ep.args ?? [])].join(" "));
      if (ep.env) push("entrypoint.env", JSON.stringify(ep.env));
    } else if (ep.type === "mcp-sse" || ep.type === "http") {
      push("entrypoint.url", ep.url);
      if ("headers" in ep && ep.headers) push("entrypoint.headers", JSON.stringify(ep.headers));
    }
  }

  manifest.flow?.forEach((step, i) => push(`flow[${i}].label`, step.label));
  manifest.requiredEnv?.forEach((name, i) => push(`requiredEnv[${i}]`, name));

  return surfaces;
}

function maskEvidence(fragment: string): string {
  // Keep the first 6 chars of long tokens so a reviewer recognises the key type; mask the rest.
  return fragment.replace(/[A-Za-z0-9_\-\/+=]{16,}/g, (m) => `${m.slice(0, 6)}${"•".repeat(Math.min(m.length - 6, 12))}`).slice(0, 140);
}

// ---------------------------------------------------------------------------
// Structural checks (not regex-based)
// ---------------------------------------------------------------------------

function structuralFindings(manifest: SkillManifest): ScanFinding[] {
  const findings: ScanFinding[] = [];

  if (manifest.schemaVersion !== 1) {
    findings.push({
      kind: "malformed",
      severity: "high",
      surface: "schemaVersion",
      message: `Unsupported schemaVersion ${String(manifest.schemaVersion)}.`,
      evidence: String(manifest.schemaVersion),
      rule: "ST-001",
    });
  }

  if (!Array.isArray(manifest.tools)) {
    findings.push({ kind: "malformed", severity: "high", surface: "tools", message: "`tools` must be an array.", evidence: typeof manifest.tools, rule: "ST-002" });
  } else {
    manifest.tools.forEach((tool, i) => {
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name ?? "")) {
        findings.push({ kind: "malformed", severity: "medium", surface: `tools[${i}].name`, message: "Tool name must match ^[a-zA-Z0-9_-]{1,64}$ (LLM provider constraint).", evidence: String(tool.name), rule: "ST-003" });
      }
      if (tool.parameters && tool.parameters.type && tool.parameters.type !== "object") {
        findings.push({ kind: "malformed", severity: "medium", surface: `tools[${i}].parameters`, message: "Top-level parameters schema must be an object.", evidence: String(tool.parameters.type), rule: "ST-004" });
      }
    });
  }

  const perms = new Set(manifest.permissions ?? []);
  const isPromptOnly = manifest.category === "Prompt" || manifest.entrypoint?.type === "prompt";
  if (isPromptOnly && (perms.has("shell") || perms.has("filesystem:write"))) {
    // Claude Code skills legitimately declare `allowed-tools: Bash` to run their scripts — flag for review, don't sandbox.
    findings.push({ kind: "over_permissioned", severity: "low", surface: "permissions", message: "Prompt skill declares shell / write access; review its scripts before installing.", evidence: [...perms].join(","), rule: "OP-001" });
  }
  if (perms.has("shell") && perms.has("network") && perms.has("env")) {
    findings.push({ kind: "over_permissioned", severity: "medium", surface: "permissions", message: "shell + network + env together allow full credential exfiltration; requires manual review.", evidence: [...perms].join(","), rule: "OP-002" });
  }

  // Declared env vs. secrets in entrypoint env: values must be references, not literals.
  if (manifest.entrypoint?.type === "mcp-stdio" && manifest.entrypoint.env) {
    for (const [k, v] of Object.entries(manifest.entrypoint.env)) {
      if (!/^\$\{?[A-Z0-9_]+\}?$/.test(v) && v.length > 12) {
        findings.push({ kind: "secret_leak", severity: "high", surface: `entrypoint.env.${k}`, message: "Env value should be a ${VAR} reference, not a literal.", evidence: maskEvidence(v), rule: "ST-005" });
      }
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ScanOptions {
  /** Set by moderators after a human review. The scanner never grants Verified alone. */
  reviewed?: boolean;
}

export function scanManifest(manifest: SkillManifest, options: ScanOptions = {}): ScanReport {
  const started = performance.now();
  const surfaces = collectSurfaces(manifest);
  const findings: ScanFinding[] = [...structuralFindings(manifest)];

  for (const surface of surfaces) {
    for (const rule of RULES) {
      if (rule.only && !rule.only.test(surface.path)) continue;
      const match = surface.text.match(rule.pattern);
      if (!match) continue;
      findings.push({
        kind: rule.kind,
        severity: rule.severity,
        surface: surface.path,
        message: rule.message,
        evidence: maskEvidence(match[0]),
        rule: rule.id,
      });
    }
  }

  const penalty = findings.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0);
  const score = Math.max(0, 100 - penalty);

  return {
    scannerVersion: SCANNER_VERSION,
    level: assignSecurityLevel(findings, options),
    score,
    findings: findings.sort((a, b) => SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity]),
    surfacesScanned: surfaces.length,
    durationMs: Math.round((performance.now() - started) * 100) / 100,
  };
}

export function assignSecurityLevel(findings: ScanFinding[], options: ScanOptions = {}): SecurityLevel {
  const worst = findings.reduce<Severity | null>((acc, f) => {
    if (!acc) return f.severity;
    return SEVERITY_WEIGHT[f.severity] > SEVERITY_WEIGHT[acc] ? f.severity : acc;
  }, null);

  if (worst === "critical" || worst === "high") return "Sandbox";
  if (worst === "medium" && findings.filter((f) => f.severity === "medium").length >= 3) return "Sandbox";
  return options.reviewed ? "Verified" : "Community";
}

/** Convenience for API handlers: throws when the manifest is not installable at all. */
export function assertInstallable(report: ScanReport): void {
  const critical = report.findings.filter((f) => f.severity === "critical");
  if (critical.length) {
    const list = critical.map((f) => `${f.rule} @ ${f.surface}: ${f.message}`).join("; ");
    throw new SandboxViolationError(`Manifest rejected by sandbox scanner: ${list}`, report);
  }
}

export class SandboxViolationError extends Error {
  constructor(message: string, public readonly report: ScanReport) {
    super(message);
    this.name = "SandboxViolationError";
  }
}
