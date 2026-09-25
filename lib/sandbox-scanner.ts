/**
 * Cortex · Sandbox Scanner
 *
 * Static threat analysis of a Synapth manifest (ТЗ §2, stages 2–3 and 6). It
 * never executes anything: the manifest is flattened to "surfaces" (system
 * prompt, tool descriptions, entrypoint command, env, flow), every surface is
 * normalised (NFKC, zero-width stripped, encoded runs decoded) and run
 * through the rule catalogue. Findings produced elsewhere — dependency audit
 * (DP-*, `lib/dependency-scanner.ts`), repository intake (ST-04) — come in
 * through `ScanContext.extraFindings` and are scored the same way.
 *
 * Outcome is decided by rules, not by the score (stage 6):
 *   Rejected   — the manifest does not parse (ST-01) or intake forbids it: never published
 *   Quarantine — a trap fired or explicit malware was found (MC-10, DY-01)
 *   Sandbox    — at least one high/critical finding
 *   Community  — medium findings at most
 *   Verified   — Community + `reviewed: true` + score ≥ 85; never by the scanner alone
 *
 * Rule ids follow the catalogue in `RULE_CATALOG` (9 groups, 62 rules). Rules
 * that need AST, external databases or the dynamic sandbox are listed there
 * with `status: "planned"` so reports stay reproducible when they land.
 */

import type { SecurityLevel, Skill, SkillManifest } from "@/types/skill";
import type { ScanOutcome } from "@/types/trust";
import { VERIFIED_MIN_SCORE } from "@/types/trust";

export const SCANNER_VERSION = "2.0.0";
/** Semver of the rule set; every report carries it so a verdict can be reproduced. */
export const RULES_VERSION = "2026.09.0";

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export type FindingKind =
  | "prompt_injection"
  | "malicious_command"
  | "secret_leak"
  | "exfiltration"
  | "over_permissioned"
  | "malformed"
  | "remote"
  | "dependency"
  | "behaviour";

export type RuleGroup = "PI" | "EX" | "MC" | "SK" | "OP" | "ST" | "RM" | "DP" | "DY";

export interface ScanFinding {
  kind: FindingKind;
  severity: Severity;
  /** Where the pattern was found, e.g. `systemPrompt`, `tools[2].description`, `package.json`. */
  surface: string;
  /** Short human explanation. */
  message: string;
  /** The matched fragment, truncated and with secrets masked. */
  evidence: string;
  rule: string;
  /** Forces the outcome regardless of severity (ST-01 → Rejected, MC-10 → Quarantine). */
  verdict?: "Rejected" | "Quarantine";
  /** A live credential: the entry must not be republished (crawler) or accepted (publish API). */
  blocksPublication?: boolean;
}

export interface ScanReport {
  scannerVersion: string;
  rulesVersion: string;
  outcome: ScanOutcome;
  /** Stored level. For `Rejected` this is only a placeholder — callers must not publish. */
  level: SecurityLevel;
  /** Risk score 0..100, higher is safer: max(0, 100 − 60·crit − 25·high − 8·med − 2·low). */
  score: number;
  /** Clean enough to file for Verified (stage 7 preconditions the scanner can check). */
  verifiable: boolean;
  findings: ScanFinding[];
  surfacesScanned: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Rule catalogue (ТЗ §2 «Каталог правил детекции»)
// ---------------------------------------------------------------------------

export type DetectionMethod = "pattern" | "ast" | "entropy" | "external" | "sandbox" | "llm" | "manifest";

export interface RuleSpec {
  id: string;
  group: RuleGroup;
  /** Base severity; some rules escalate or demote by context (noted in `title`). */
  severity: Severity | "reject";
  methods: DetectionMethod[];
  /** `active` — runs today; `partial` — a static approximation of the full method; `planned` — needs AST / sandbox / external data. */
  status: "active" | "partial" | "planned";
  title: string;
}

const R = (id: string, severity: RuleSpec["severity"], methods: DetectionMethod[], status: RuleSpec["status"], title: string): RuleSpec => ({ id, group: id.slice(0, 2) as RuleGroup, severity, methods, status, title });

export const RULE_CATALOG: readonly RuleSpec[] = [
  R("PI-01", "high", ["pattern", "llm"], "partial", "Instruction override, role spoofing, system prompt extraction"),
  R("PI-02", "high", ["pattern"], "active", "Hidden text: zero-width, Unicode tags, bidi overrides, instructions in HTML comments (critical when an imperative is hidden)"),
  R("PI-03", "medium", ["pattern"], "active", "Encoded inserts (base64, hex, URL-encoding) longer than 80 chars, re-scanned by PI and EX"),
  R("PI-04", "critical", ["pattern", "llm"], "partial", "Tool description poisoning: the description commands the model"),
  R("PI-05", "high", ["pattern", "llm"], "partial", "Shadowing: the description steers other tools or servers"),
  R("PI-06", "high", ["pattern"], "active", "Concealment from the user"),
  R("PI-07", "medium", ["pattern"], "active", "Jailbreak and persona templates"),
  R("PI-08", "high", ["sandbox"], "planned", "Instructions inside tool responses"),
  R("PI-09", "medium", ["pattern"], "active", "Autorun: always call this tool first / on every message"),
  R("PI-10", "low", ["manifest"], "active", "Abnormal length: tool description > 2000 or parameter description > 500 chars"),

  R("EX-01", "critical", ["pattern"], "active", "Instruction to send data to an address (high without a URL)"),
  R("EX-02", "high", ["pattern"], "active", "Markdown links / images with data-bearing query parameters"),
  R("EX-03", "critical", ["ast"], "partial", "Flow from a sensitive source to a network sink (static: credential store access, high)"),
  R("EX-04", "high", ["ast", "sandbox"], "planned", "DNS exfiltration"),
  R("EX-05", "high", ["pattern"], "active", "Hard-coded sink services: webhooks, bot APIs, tunnels, request catchers (raw IP: medium)"),
  R("EX-06", "high", ["manifest", "llm"], "partial", "Parameters that fish for context: conversation_history, system_prompt, all_files…"),

  R("MC-01", "critical", ["pattern"], "active", "Download-and-execute in one command, reverse shells"),
  R("MC-02", "high", ["ast"], "partial", "Dynamic execution: eval, exec, new Function, pickle.loads, yaml.load (low in prose)"),
  R("MC-03", "high", ["ast"], "partial", "Command injection: shell=True, child_process.exec with concatenation"),
  R("MC-04", "critical", ["pattern"], "active", "Destructive commands: rm -rf / ~, mkfs, dd of=/dev/, chmod -R 777, format"),
  R("MC-05", "critical", ["pattern", "sandbox"], "partial", "Persistence: shell rc files, cron, systemd, launchd, Run keys, other MCP configs"),
  R("MC-06", "high", ["pattern", "sandbox"], "partial", "Code downloaded at runtime: download → chmod +x → run, import by URL"),
  R("MC-07", "high", ["pattern", "entropy"], "partial", "Obfuscation: exec(b64decode(…)), eval(atob(…)), fromCharCode chains"),
  R("MC-08", "high", ["pattern"], "active", "Privilege escalation: sudo, doas, setuid"),
  R("MC-09", "medium", ["ast", "sandbox"], "planned", "Path traversal"),
  R("MC-10", "critical", ["pattern", "sandbox"], "partial", "Mining and resource abuse → Quarantine"),

  R("SK-01", "high", ["pattern", "entropy"], "active", "AI provider keys: OpenAI, Anthropic, Yandex Cloud, GigaChat"),
  R("SK-02", "high", ["pattern"], "active", "Cloud and service tokens: AWS, GitHub, Slack, Google, Telegram bots"),
  R("SK-03", "high", ["pattern"], "active", "PEM private keys, JWTs, DB connection strings with passwords"),
  R("SK-04", "medium", ["entropy"], "active", "High-entropy literal next to key/token/secret/password; literal env values"),
  R("SK-05", "medium", ["external"], "planned", "Secrets in the last 50 commits"),
  R("SK-06", "high", ["pattern", "llm"], "partial", "Prompt asks the user for a password or token in chat"),

  R("OP-01", "high", ["ast", "sandbox"], "partial", "Undeclared capability (static: a shell entrypoint without the shell permission)"),
  R("OP-02", "low", ["ast", "sandbox"], "planned", "Declared but unused permission"),
  R("OP-03", "medium", ["manifest"], "partial", "Too broad permissions (static: prompt skill with shell / write access, low)"),
  R("OP-04", "medium", ["manifest"], "active", "Dangerous combination inside one skill: filesystem + network, env + network"),
  R("OP-05", "medium", ["llm"], "planned", "Secrets beyond the stated purpose"),

  R("ST-01", "reject", ["manifest"], "active", "Invalid manifest or tool JSON Schema → Rejected"),
  R("ST-02", "medium", ["pattern"], "active", "Launch command without a pinned version (npx pkg@latest, uvx pkg, image:latest)"),
  R("ST-03", "high", ["manifest"], "active", "Brand impersonation: «official» + a known brand, owner is not that brand"),
  R("ST-04", "high", ["manifest"], "active", "Executable binaries in the repository (Prompt skills: Rejected)"),
  R("ST-05", "low", ["manifest"], "active", "Tool without a description or a parameter schema"),
  R("ST-06", "low", ["manifest"], "active", "No licence or a licence forbidding redistribution (Gov: blocks)"),

  R("RM-01", "high", ["external"], "partial", "No TLS or invalid certificate (static: plain http:// endpoint)"),
  R("RM-02", "medium", ["external"], "planned", "Domain younger than 30 days"),
  R("RM-03", "high", ["external"], "planned", "tools/list changes between requests or over time"),
  R("RM-04", "critical", ["external"], "planned", "Cloaking: different answers to the scanner and to clients"),
  R("RM-05", "medium", ["external"], "planned", "OAuth asks for broad scopes"),
  R("RM-06", "info", ["external"], "planned", "Hosting outside Russia (Gov: blocks, GV-RES)"),

  R("DP-01", "high", ["external"], "active", "Known vulnerability (OSV), severity as the advisory"),
  R("DP-02", "high", ["manifest"], "active", "preinstall / install / postinstall scripts, setup.py cmdclass"),
  R("DP-03", "high", ["manifest"], "active", "Typosquatting: 1–2 edits from a popular package"),
  R("DP-04", "medium", ["manifest"], "active", "No lock file or versions given as ranges"),
  R("DP-05", "low", ["external"], "active", "Package younger than 30 days or < 100 weekly downloads"),
  R("DP-06", "medium", ["manifest"], "active", "Dependency confusion: public package named like an internal one"),

  R("DY-01", "critical", ["sandbox"], "planned", "Canary read or sent → Quarantine"),
  R("DY-02", "high", ["sandbox"], "planned", "Requests to undeclared domains (medium when network is declared)"),
  R("DY-03", "high", ["sandbox"], "planned", "Access to files outside the working directory"),
  R("DY-04", "high", ["sandbox"], "planned", "Child processes without the shell permission"),
  R("DY-05", "high", ["sandbox"], "planned", "tools/list descriptions differ from the manifest"),
  R("DY-06", "medium", ["sandbox"], "planned", "Resource abuse: CPU > 90 % for 30 s, memory at the limit"),
  R("DY-07", "medium", ["sandbox"], "planned", "Server did not start or crashed — «not dynamically checked»"),
];

// ---------------------------------------------------------------------------
// Pattern rules
// ---------------------------------------------------------------------------

interface Surface {
  path: string;
  /** Raw text (PI-02 looks at the bytes). */
  raw: string;
  /** NFKC, zero-width and bidi controls removed — what every other rule sees. */
  text: string;
}

interface RuleContext {
  manifest: SkillManifest;
  surface: Surface;
  toolNames: Set<string>;
}

interface PatternRule {
  id: string;
  kind: FindingKind;
  severity: Severity;
  pattern: RegExp;
  message: string;
  /** Restrict a rule to surfaces whose path matches. */
  only?: RegExp;
  /** Match the raw text instead of the normalised one. */
  raw?: boolean;
  /** Context-dependent severity; `null` drops the hit. */
  severityFor?: (match: RegExpMatchArray, ctx: RuleContext) => Severity | null;
  verdict?: ScanFinding["verdict"];
  blocksPublication?: boolean;
}

const TOOL_TEXT = /^tools\[\d+\]\.(description|parameters)$/;
const ENTRYPOINT = /^entrypoint\./;
const IMPERATIVE = /\b(ignore|disregard|forget|always|never|must|do not|don't|send|read|call|execute|run|reveal|you are)\b|игнорируй|забудь|всегда|никогда|отправь|прочитай|выполни/i;
/** Prose surfaces: a pattern mentioned in documentation is weaker than one in the launch command. */
const inCommand = (ctx: RuleContext) => ENTRYPOINT.test(ctx.surface.path);
const demote = (s: Severity): Severity => (s === "critical" ? "high" : s === "high" ? "medium" : s === "medium" ? "low" : s === "low" ? "info" : "info");
const inExamples = (ctx: RuleContext) => /\.examples\[\d+\]$/.test(ctx.surface.path);

const PI_RULES: PatternRule[] = [
  { id: "PI-01", kind: "prompt_injection", severity: "high", pattern: /\b(ignore|disregard)\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier|preceding)\s+(instructions?|prompts?|rules?|directions?)/i, message: "Attempts to override the host agent's instructions." },
  { id: "PI-01", kind: "prompt_injection", severity: "high", pattern: /(забудь|игнорируй|проигнорируй)\s+(все\s+)?(предыдущие|прошлые|прежние|вышеуказанные)(\s+(инструкции|указания|правила))?|忽略(之前|以上|前面)的?(所有)?(指令|指示|说明)/i, message: "Attempts to override the host agent's instructions." },
  { id: "PI-01", kind: "prompt_injection", severity: "high", pattern: /<\|im_(start|end)\|>|<\s*\/?\s*(system|assistant|instruction)\s*>|\[INST\]|<<SYS>>|^\s*(system|assistant)\s*:\s*(you|ignore|from now)/im, message: "Spoofs chat-template roles or control tokens." },
  { id: "PI-01", kind: "prompt_injection", severity: "high", pattern: /(reveal|print|repeat|output|dump)\s+(your|the)\s+(system\s+prompt|hidden\s+instructions|initial\s+prompt)/i, message: "Tries to extract the host system prompt." },
  { id: "PI-01", kind: "prompt_injection", severity: "high", pattern: /you\s+are\s+(now\s+)?(no\s+longer|not)\s+bound\s+by/i, message: "Declares the model free of its instructions." },
  {
    id: "PI-02",
    kind: "prompt_injection",
    severity: "high",
    raw: true,
    pattern: /[​-‏⁠﻿‪-‮⁦-⁩]|[\u{E0000}-\u{E007F}]/u,
    message: "Zero-width, Unicode tag or bidi control characters (hidden text).",
    severityFor: (_m, ctx) => (IMPERATIVE.test(decodeTags(ctx.surface.raw)) && /[\u{E0000}-\u{E007F}]/u.test(ctx.surface.raw) ? "critical" : "high"),
  },
  {
    id: "PI-02",
    kind: "prompt_injection",
    severity: "high",
    pattern: /<!--([\s\S]*?)-->/,
    message: "HTML comment carrying instructions for the model.",
    severityFor: (m) => (IMPERATIVE.test(m[1] ?? "") ? "critical" : null),
  },
  {
    id: "PI-04",
    kind: "prompt_injection",
    severity: "critical",
    only: TOOL_TEXT,
    pattern: /<\s*(IMPORTANT|SYSTEM|CRITICAL|HIDDEN)\s*>|(before|prior\s+to|after)\s+(using|calling|invoking|running)\s+(this|any|the)\s+(tool|function)[^.]{0,80}\b(read|open|cat|send|include|pass|upload|fetch)\b|(перед|прежде\s+чем)\s+(вызовом|использованием|вызывать|использовать)[^.]{0,80}(прочитай|отправь|передай)/i,
    message: "Tool description commands the model instead of describing the function.",
  },
  {
    id: "PI-05",
    kind: "prompt_injection",
    severity: "high",
    pattern: /(when|whenever|if)\s+(you\s+)?(call|use|invoke|run)\s+(the\s+)?[`"']?([a-z_][\w.-]*)[`"']?(\s+tool)?[^.]{0,60}\b(also|always|add|include|bcc|forward|redirect|instead)\b/i,
    message: "Steers another tool's behaviour (shadowing).",
    // Guidance about the skill's own tools is documentation, not shadowing.
    severityFor: (m, ctx) => (ctx.toolNames.has((m[5] ?? "").toLowerCase()) || ["this", "it", "them", "the"].includes((m[5] ?? "").toLowerCase()) ? null : "high"),
  },
  { id: "PI-06", kind: "prompt_injection", severity: "high", pattern: /(do\s+not|don'?t|never)\s+(tell|inform|notify|reveal\s+(this\s+)?to|mention\s+(this\s+|it\s+)?to|show\s+(this\s+)?to)\s+the\s+user|without\s+(asking|telling|informing|notifying)\s+the\s+user|\b(silently|secretly)\s+(call|invoke|run|execute|send|upload|add|forward|read|write|delete|copy)\b|не\s+(сообщай|говори|показывай|упоминай)[^.]{0,20}пользовател/i, message: "Instructs the model to hide behaviour from the user." },
  { id: "PI-07", kind: "prompt_injection", severity: "medium", pattern: /\bdo\s+anything\s+now\b|\bDAN\s+mode\b|\b(developer|god|jailbreak|unrestricted)\s+mode\b|\bwithout\s+(any\s+)?(restrictions|limitations|content\s+filters)\b|без\s+(каких-либо\s+)?ограничений/i, message: "Jailbreak / persona template." },
  {
    id: "PI-09",
    kind: "prompt_injection",
    severity: "medium",
    pattern: /(always|silently|secretly)\s+(call|invoke|run|execute|use)\s+[`"']?[\w.-]+[`"']?\s+(first|before|after|on)\b|(call|invoke|run|use)\s+(this\s+tool\s+)?(on|for|after|before)\s+(every|each)\s+(message|turn|user\s+message|prompt|request)/i,
    message: "Forces unconditional tool invocation.",
    // "Always call list_tables first when you don't know the schema" is guidance, not autorun.
    severityFor: (m, ctx) => (/^[^.]{0,40}\b(when|if|unless|in\s+case|only)\b/i.test(ctx.surface.text.slice((m.index ?? 0) + m[0].length)) ? null : "medium"),
  },
];

const EX_RULES: PatternRule[] = [
  {
    id: "EX-01",
    kind: "exfiltration",
    severity: "critical",
    pattern: /(send|post|upload|forward|transmit|exfiltrate|отправь|перешли|передай)\s+(the\s+|all\s+|any\s+|every\s+|все\s+)?(conversation|chat\s+history|user('s)?\s+(data|files|messages)|environment\s+variables|credentials|\.env|api\s+keys?|secrets|содержимое\s+(файлов|\.env)|историю\s+(чата|переписки)|переписку)/i,
    message: "Instructs the agent to send user data elsewhere.",
    severityFor: (_m, ctx) => (/https?:\/\//i.test(ctx.surface.text) ? "critical" : "high"),
  },
  { id: "EX-02", kind: "exfiltration", severity: "high", pattern: /!?\[[^\]]*\]\(\s*https?:\/\/[^)\s]*[?&][\w-]+=\s*(\{[^}]*\}|\$\{[^}]*\}|<[^>]+>|%s)/i, message: "Markdown link or image carries data in its query string." },
  { id: "EX-03", kind: "exfiltration", severity: "high", pattern: /(~|\$HOME|\/Users\/\w+|\/home\/\w+)\/\.(ssh|aws|gnupg|config\/gh|netrc|npmrc|docker\/config\.json)/i, message: "Touches credential stores in the home directory." },
  { id: "EX-05", kind: "exfiltration", severity: "high", pattern: /discord(app)?\.com\/api\/webhooks|api\.telegram\.org\/bot|pastebin\.com|transfer\.sh|ngrok(-free)?\.(app|io)|trycloudflare\.com|loca\.lt|serveo\.net|requestbin\.\w+|webhook\.site|pipedream\.net|hookbin\.com|beeceptor\.com|interact\.sh|burpcollaborator\.net|oast\.(fun|me|pro|live|site|online)/i, message: "Hard-coded sink service (webhook, bot API, tunnel, request catcher)." },
  { id: "EX-05", kind: "exfiltration", severity: "medium", pattern: /https?:\/\/(?!127\.|10\.|0\.0\.0\.0|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/, message: "Raw public IP address endpoint (no domain, no TLS accountability)." },
];

const MC_RULES: PatternRule[] = [
  { id: "MC-01", kind: "malicious_command", severity: "critical", pattern: /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z|da|k)?sh\b|\b(iwr|irm|invoke-webrequest|invoke-restmethod)\b[^\n|]*\|\s*(iex|invoke-expression)\b/i, message: "Pipes a remote script directly into a shell.", severityFor: (_m, ctx) => (inExamples(ctx) ? "high" : "critical") },
  { id: "MC-01", kind: "malicious_command", severity: "critical", pattern: /\b(nc|ncat|netcat)\b[^\n]*-e\s+\/bin\/(ba)?sh|\/dev\/tcp\/\d+\.\d+/i, message: "Reverse shell pattern." },
  {
    id: "MC-02",
    kind: "malicious_command",
    severity: "high",
    pattern: /\b(eval|exec)\s*\(|\bnew\s+Function\s*\(|\bpickle\.loads?\s*\(|\byaml\.load\s*\((?![^)]*SafeLoader)/,
    message: "Dynamic code execution.",
    severityFor: (_m, ctx) => (inCommand(ctx) ? "high" : "low"),
  },
  { id: "MC-03", kind: "malicious_command", severity: "high", pattern: /shell\s*=\s*True|child_process\.exec(Sync)?\s*\(\s*[^)]*(\+\s*\w|\$\{)/, message: "Command built from input and run through a shell." },
  { id: "MC-03", kind: "malicious_command", severity: "low", pattern: /\b(child_process|os\.system|subprocess\.(Popen|call|run))\b/i, message: "Spawns processes; check how arguments are built." },
  { id: "MC-04", kind: "malicious_command", severity: "critical", pattern: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b\s+(--no-preserve-root\s+)?("?\/"?(\s|$|\*)|~\/?(\s|$|\*)|\$HOME\/?(\s|$)|\*|\.\s*$)/im, message: "Recursive forced deletion of root, home or everything." },
  { id: "MC-04", kind: "malicious_command", severity: "critical", pattern: /\b(mkfs(\.\w+)?\s|dd\s+[^\n]*of=\/dev\/|shred\s+|:\(\)\s*\{\s*:\|:&\s*\};:|chmod\s+-R\s+0?777\s+\/|\bformat\s+[a-z]:)/i, message: "Disk-destroying or fork-bomb command." },
  {
    id: "MC-05",
    kind: "malicious_command",
    severity: "critical",
    pattern: /(>>?|tee(\s+-a)?)\s*(~|\$HOME)\/\.(bashrc|zshrc|bash_profile|profile|zprofile)\b|\bcrontab\s+-(\s|$)|\|\s*crontab\b|\bsystemctl\s+(--user\s+)?enable\b|\blaunchctl\s+(load|bootstrap)\b|\breg\s+add\s+HK\w*\\[^\n]*\\Run\b|(write|modify|edit|append|overwrite|>>?)\s*[^\n]{0,40}(\.cursor\/mcp\.json|claude_desktop_config\.json|\.claude\.json)/i,
    message: "Persistence mechanism or tampering with other MCP configs.",
  },
  { id: "MC-06", kind: "malicious_command", severity: "high", pattern: /\b(curl|wget)\b[^\n]*(-o\s*|-O\s*|>\s*)\S+[^\n]*(&&|;)\s*chmod\s+\+x|\bimport\s*\(\s*["']https?:\/\//i, message: "Downloads code at runtime and runs it." },
  { id: "MC-07", kind: "malicious_command", severity: "high", pattern: /\bexec\s*\(\s*(base64\.)?b64decode|\beval\s*\(\s*atob\s*\(|base64\s+(-d|--decode)[^\n]*\|\s*(ba)?sh|String\.fromCharCode\s*\(\s*\d+\s*(,\s*\d+\s*){7,}\)/i, message: "Obfuscated payload." },
  {
    id: "MC-08",
    kind: "malicious_command",
    severity: "high",
    pattern: /\b(sudo|doas)\s+(-[a-zA-Z]+\s+)*(apt(-get)?|yum|dnf|rm|chmod|chown|su|bash|sh|tee|cp|mv|systemctl|npm|pip3?|install|-i\b|-s\b)|\bsetuid\s*\(|chmod\s+[ugoa]*\+s\b|passwd\s+root/i,
    message: "Privilege escalation.",
    severityFor: (_m, ctx) => (inExamples(ctx) ? "medium" : "high"),
  },
  { id: "MC-10", kind: "malicious_command", severity: "critical", verdict: "Quarantine", pattern: /stratum\+(tcp|ssl):\/\/|\b(xmrig|minerd|cpuminer)\b|\b(minexmr|supportxmr|nanopool|2miners|ethermine|f2pool|hashvault|moneroocean)\.(com|org|pro|net|stream)\b/i, message: "Cryptocurrency mining." },
];

const SK_RULES: PatternRule[] = [
  { id: "SK-01", kind: "secret_leak", severity: "high", blocksPublication: true, pattern: /\bsk-(proj-|ant-(api\d{2}-)?)?[A-Za-z0-9_-]{20,}\b|\bAQVN[A-Za-z0-9_-]{30,}\b|\by0_[A-Za-z0-9_-]{30,}\b|\bt1\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{40,}|GIGACHAT_(CREDENTIALS|AUTH_KEY)\s*[:=]\s*["']?[A-Za-z0-9+/=]{40,}/, message: "AI provider API key (OpenAI / Anthropic / Yandex Cloud / GigaChat)." },
  { id: "SK-02", kind: "secret_leak", severity: "high", blocksPublication: true, pattern: /\bAKIA[0-9A-Z]{16}\b/, message: "AWS access key id." },
  { id: "SK-02", kind: "secret_leak", severity: "high", blocksPublication: true, pattern: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/, message: "GitHub token." },
  { id: "SK-02", kind: "secret_leak", severity: "high", blocksPublication: true, pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, message: "Slack token." },
  { id: "SK-02", kind: "secret_leak", severity: "high", blocksPublication: true, pattern: /\bAIza[0-9A-Za-z_-]{35}\b/, message: "Google API key." },
  { id: "SK-02", kind: "secret_leak", severity: "high", blocksPublication: true, pattern: /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/, message: "Telegram bot token." },
  { id: "SK-03", kind: "secret_leak", severity: "high", blocksPublication: true, pattern: /-----BEGIN\s+(RSA|EC|OPENSSH|DSA|PGP)?\s*PRIVATE\s+KEY-----/, message: "Private key block." },
  { id: "SK-03", kind: "secret_leak", severity: "high", blocksPublication: true, pattern: /\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis|amqp):\/\/[^\s:@\/]+:[^\s@\/$]+@/i, message: "Connection string with embedded password." },
  { id: "SK-03", kind: "secret_leak", severity: "high", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, message: "JWT literal." },
  {
    id: "SK-04",
    kind: "secret_leak",
    severity: "medium",
    pattern: /\b(api[_-]?key|secret|token|password|passwd)\b\s*[:=]\s*["']?([A-Za-z0-9_\-\/+=]{20,})["']?/i,
    message: "High-entropy literal assigned to a credential name.",
    severityFor: (m) => (shannonEntropy(m[2] ?? "") > 4.5 ? "medium" : null),
  },
  { id: "SK-06", kind: "secret_leak", severity: "high", pattern: /(ask|prompt|request)\s+(the\s+)?user\s+(for|to\s+(enter|provide|paste|share|type))\s+(their\s+|your\s+|the\s+|an?\s+)?(password|api\s*key|access\s+token|token|credentials|secret)|(попроси|запроси)\s+(у\s+)?пользовател\w*\s+(ввести\s+|прислать\s+)?(пароль|токен|ключ)/i, message: "Asks the user to paste a credential into the chat instead of reading it from env." },
];

const PATTERN_RULES: PatternRule[] = [...PI_RULES, ...EX_RULES, ...MC_RULES, ...SK_RULES];
/** Rules re-run on decoded inserts (PI-03). */
const DECODED_RULES: PatternRule[] = [...PI_RULES.filter((r) => !r.raw), ...EX_RULES];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

export function worstSeverity(findings: Pick<ScanFinding, "severity">[]): Severity | null {
  return findings.reduce<Severity | null>((acc, f) => (!acc || SEVERITY_ORDER[f.severity] > SEVERITY_ORDER[acc] ? f.severity : acc), null);
}

/** max(0, 100 − 60·crit − 25·high − 8·med − 2·low) — for comparison and the Verified threshold, not for the outcome. */
export function riskScore(findings: Pick<ScanFinding, "severity">[]): number {
  const n = (s: Severity) => findings.filter((f) => f.severity === s).length;
  return Math.max(0, 100 - 60 * n("critical") - 25 * n("high") - 8 * n("medium") - 2 * n("low"));
}

export function shannonEntropy(s: string): number {
  if (!s) return 0;
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const INVISIBLE = /[​-‏⁠﻿‪-‮⁦-⁩]|[\u{E0000}-\u{E007F}]/gu;

export function normalizeText(text: string): string {
  return text.normalize("NFKC").replace(INVISIBLE, "");
}

/** Unicode tag characters mirror ASCII (U+E0041 = "A"): the classic invisible-instruction carrier. */
function decodeTags(text: string): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0xe0020 && cp <= 0xe007e) out += String.fromCharCode(cp - 0xe0000);
  }
  return out;
}

function decodeBase64(run: string): string | null {
  try {
    const bin = atob(run.replace(/[^A-Za-z0-9+/=]/g, ""));
    // Mostly printable text only — images and binaries are not "inserts".
    const printable = [...bin].filter((c) => /[\x20-\x7E\n\r\t]/.test(c)).length;
    return bin.length && printable / bin.length > 0.9 ? bin : null;
  } catch {
    return null;
  }
}

function decodeHex(run: string): string | null {
  const bytes = run.match(/.{2}/g)?.map((h) => parseInt(h, 16)) ?? [];
  const text = String.fromCharCode(...bytes);
  const printable = [...text].filter((c) => /[\x20-\x7E\n\r\t]/.test(c)).length;
  return text.length && printable / text.length > 0.9 ? text : null;
}

function decodeUrl(run: string): string | null {
  try {
    return decodeURIComponent(run);
  } catch {
    return null;
  }
}

function maskEvidence(fragment: string): string {
  // Keep the first 6 chars of long tokens so a reviewer recognises the key type; mask the rest.
  return fragment.replace(/[A-Za-z0-9_\-\/+=]{16,}/g, (m) => `${m.slice(0, 6)}${"•".repeat(Math.min(m.length - 6, 12))}`).slice(0, 140);
}

// ---------------------------------------------------------------------------
// Surface extraction
// ---------------------------------------------------------------------------

function collectSurfaces(manifest: SkillManifest): Surface[] {
  const surfaces: Surface[] = [];
  const push = (path: string, value: unknown) => {
    if (typeof value === "string" && value.trim()) surfaces.push({ path, raw: value, text: normalizeText(value) });
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

function runRules(rules: PatternRule[], surface: Surface, ctx: Omit<RuleContext, "surface">, into: ScanFinding[], rewrite?: (f: ScanFinding) => ScanFinding) {
  for (const rule of rules) {
    if (rule.only && !rule.only.test(surface.path)) continue;
    const match = (rule.raw ? surface.raw : surface.text).match(rule.pattern);
    if (!match) continue;
    const severity = rule.severityFor ? rule.severityFor(match, { ...ctx, surface }) : rule.severity;
    if (!severity) continue;
    const finding: ScanFinding = { kind: rule.kind, severity, surface: surface.path, message: rule.message, evidence: maskEvidence(match[0]), rule: rule.id };
    if (rule.verdict) finding.verdict = rule.verdict;
    if (rule.blocksPublication) finding.blocksPublication = true;
    into.push(rewrite ? rewrite(finding) : finding);
  }
}

/** PI-03: decode long encoded runs and re-scan them with the PI and EX rules. */
function encodedFindings(surface: Surface, ctx: Omit<RuleContext, "surface">): ScanFinding[] {
  const out: ScanFinding[] = [];
  const runs: Array<{ run: string; decoded: string | null; kind: string }> = [];
  for (const m of surface.text.matchAll(/[A-Za-z0-9+/]{80,}={0,2}/g)) runs.push({ run: m[0], decoded: /^[0-9a-fA-F]+$/.test(m[0]) ? decodeHex(m[0]) : decodeBase64(m[0]), kind: "base64/hex" });
  for (const m of surface.text.matchAll(/(?:%[0-9A-Fa-f]{2}){27,}/g)) runs.push({ run: m[0], decoded: decodeUrl(m[0]), kind: "url-encoded" });
  for (const { run, decoded, kind } of runs) {
    if (!decoded) continue;
    const inner: ScanFinding[] = [];
    const decodedSurface: Surface = { path: surface.path, raw: decoded, text: normalizeText(decoded) };
    runRules(DECODED_RULES, decodedSurface, ctx, inner);
    const worst = worstSeverity(inner);
    const severity: Severity = worst && SEVERITY_ORDER[worst] > SEVERITY_ORDER.medium ? worst : "medium";
    out.push({
      kind: "prompt_injection",
      severity,
      surface: surface.path,
      message: inner.length ? `Encoded ${kind} insert hides: ${inner.map((f) => `${f.rule} ${f.message}`).join("; ")}` : `Long encoded ${kind} insert in text.`,
      evidence: maskEvidence(run),
      rule: "PI-03",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Structural checks
// ---------------------------------------------------------------------------

const CONTEXT_FISHING_PARAMS = /^(conversation_?history|chat_?history|system_?prompt|all_?files|previous_?messages|full_?context|entire_?conversation|memory_?dump)$/i;
const SHELLS = /^(bash|sh|zsh|dash|ksh|fish|powershell|pwsh|cmd(\.exe)?)$/i;
const BRANDS = ["github", "google", "anthropic", "openai", "microsoft", "slack", "notion", "stripe", "yandex", "sber", "gigachat", "atlassian", "jira", "figma", "vercel", "cloudflare", "aws", "amazon", "apple", "meta", "telegram", "discord", "linear", "supabase", "gitlab", "docker"];

/** Launch commands that fetch a package at start-up; without a pinned version they are a swap channel (ST-02). */
function unpinnedLaunch(command: string, args: string[]): string | null {
  const bin = command.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  const positional = args.filter((a) => !a.startsWith("-"));
  const pkg = positional[0];
  if (["npx", "bunx", "pnpx"].includes(bin) || (bin === "pnpm" && positional[0] === "dlx")) {
    const name = bin === "pnpm" ? positional[1] : pkg;
    if (!name) return null;
    const version = name.startsWith("@") ? name.split("@")[2] : name.split("@")[1];
    return !version || version === "latest" ? name : null;
  }
  if (["uvx", "pipx"].includes(bin) || (bin === "uv" && positional[0] === "tool")) {
    const name = bin === "pipx" && pkg === "run" ? positional[1] : bin === "uv" ? positional[2] : pkg;
    if (!name) return null;
    return /==|@\d/.test(name) ? null : name;
  }
  if (bin === "docker" && positional[0] === "run") {
    const image = positional[positional.length - 1];
    if (!image) return null;
    const tag = image.includes("@sha256:") ? "digest" : image.split("/").pop()?.split(":")[1];
    return !tag || tag === "latest" ? image : null;
  }
  return null;
}

function structuralFindings(manifest: SkillManifest, ctx: ScanContext): ScanFinding[] {
  const findings: ScanFinding[] = [];
  const reject = (surface: string, message: string, evidence: string) => findings.push({ kind: "malformed", severity: "high", surface, message, evidence, rule: "ST-01", verdict: "Rejected" });

  // ST-01 — the manifest must be a valid schemaVersion 1 document with object schemas.
  if (manifest.schemaVersion !== 1) reject("schemaVersion", `Unsupported schemaVersion ${String(manifest.schemaVersion)}.`, String(manifest.schemaVersion));
  if (typeof manifest.name !== "string" || !manifest.name.trim()) reject("name", "Manifest has no name.", String(manifest.name));
  if (!Array.isArray(manifest.tools)) {
    reject("tools", "`tools` must be an array.", typeof manifest.tools);
  } else {
    manifest.tools.forEach((tool, i) => {
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name ?? "")) reject(`tools[${i}].name`, "Tool name must match ^[a-zA-Z0-9_-]{1,64}$ (LLM provider constraint).", String(tool.name));
      if (tool.parameters && tool.parameters.type && tool.parameters.type !== "object") reject(`tools[${i}].parameters`, "Top-level parameters schema must be an object.", String(tool.parameters.type));

      // ST-05 — a tool the model cannot understand.
      if (!tool.description?.trim() || !tool.parameters) findings.push({ kind: "malformed", severity: "low", surface: `tools[${i}]`, message: "Tool has no description or no parameter schema.", evidence: String(tool.name), rule: "ST-05" });

      // PI-10 — abnormal lengths.
      if ((tool.description?.length ?? 0) > 2000) findings.push({ kind: "prompt_injection", severity: "low", surface: `tools[${i}].description`, message: "Tool description longer than 2000 characters.", evidence: `${tool.description.length} chars`, rule: "PI-10" });
      for (const [param, schema] of Object.entries(tool.parameters?.properties ?? {})) {
        if ((schema?.description?.length ?? 0) > 500) findings.push({ kind: "prompt_injection", severity: "low", surface: `tools[${i}].parameters.${param}`, message: "Parameter description longer than 500 characters.", evidence: `${schema.description!.length} chars`, rule: "PI-10" });
        // EX-06 — parameters that exist only to pull the context out.
        if (CONTEXT_FISHING_PARAMS.test(param)) findings.push({ kind: "exfiltration", severity: "high", surface: `tools[${i}].parameters.${param}`, message: "Parameter asks the model for its context (history, system prompt, all files).", evidence: param, rule: "EX-06" });
      }
    });
  }

  const perms = new Set(manifest.permissions ?? []);
  const isPromptOnly = manifest.category === "Prompt" || manifest.entrypoint?.type === "prompt";
  if (isPromptOnly && (perms.has("shell") || perms.has("filesystem:write"))) {
    // Claude Code skills legitimately declare `allowed-tools: Bash` to run their scripts — flag for review, don't sandbox.
    findings.push({ kind: "over_permissioned", severity: "low", surface: "permissions", message: "Prompt skill declares shell / write access; review its scripts before installing.", evidence: [...perms].join(","), rule: "OP-03" });
  }
  const net = perms.has("network");
  const combos = [
    net && (perms.has("filesystem:read") || perms.has("filesystem:write")) && "filesystem + network",
    net && perms.has("env") && "env + network",
    net && perms.has("shell") && "shell + network",
    net && perms.has("clipboard") && "clipboard + network",
  ].filter(Boolean) as string[];
  if (combos.length) findings.push({ kind: "over_permissioned", severity: "medium", surface: "permissions", message: `Permission combination allows reading local data and sending it out (${combos.join(", ")}); requires manual review.`, evidence: [...perms].join(","), rule: "OP-04" });

  const ep = manifest.entrypoint;
  if (ep?.type === "mcp-stdio") {
    // OP-01 (static part) — a shell entrypoint is shell access whatever the manifest says.
    const bin = ep.command.split(/[\\/]/).pop() ?? "";
    if (manifest.permissions && SHELLS.test(bin) && !perms.has("shell")) findings.push({ kind: "over_permissioned", severity: "high", surface: "entrypoint.command", message: "Launches a shell but does not declare the `shell` permission.", evidence: ep.command, rule: "OP-01" });

    const unpinned = unpinnedLaunch(ep.command, ep.args ?? []);
    if (unpinned) findings.push({ kind: "malformed", severity: "medium", surface: "entrypoint.command", message: "Launch command fetches a package without a pinned version.", evidence: unpinned, rule: "ST-02" });

    // SK-04 — env values must be ${VAR} references, not literals.
    for (const [k, v] of Object.entries(ep.env ?? {})) {
      if (!/^\$\{?[A-Z0-9_]+\}?$/.test(v) && v.length > 12) findings.push({ kind: "secret_leak", severity: "medium", surface: `entrypoint.env.${k}`, message: "Env value should be a ${VAR} reference, not a literal.", evidence: maskEvidence(v), rule: "SK-04" });
    }
  }

  // RM-01 (static part) — remote endpoints must speak TLS.
  if ((ep?.type === "mcp-sse" || ep?.type === "http") && /^http:\/\//i.test(ep.url) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/i.test(ep.url)) {
    findings.push({ kind: "remote", severity: "high", surface: "entrypoint.url", message: "Remote endpoint without TLS.", evidence: ep.url.slice(0, 140), rule: "RM-01" });
  }

  // ST-03 — «official» + a brand the repository owner is not.
  const label = normalizeText(`${manifest.name} ${manifest.description}`).toLowerCase();
  if (ctx.owner && /\b(official|официальн\w*)\b/i.test(label)) {
    const owner = ctx.owner.toLowerCase();
    const brand = BRANDS.find((b) => new RegExp(`\\b${b}\\b`).test(label) && !owner.includes(b));
    if (brand) findings.push({ kind: "malformed", severity: "high", surface: "name", message: `Presents itself as official ${brand} but the repository owner is @${ctx.owner}.`, evidence: manifest.name.slice(0, 140), rule: "ST-03" });
  }

  // ST-04 — binaries shipped without sources; forbidden outright in Prompt skills.
  const binaries = (ctx.files ?? []).filter((p) => /\.(exe|dll|so|dylib|elf|bin|msi|appimage)$/i.test(p));
  if (binaries.length) {
    findings.push({ kind: "malformed", severity: "high", surface: "repository", message: isPromptOnly ? "Executable binaries are not allowed in Prompt skills." : "Repository ships executable binaries.", evidence: binaries.slice(0, 5).join(", "), rule: "ST-04", ...(isPromptOnly ? { verdict: "Rejected" as const } : {}) });
  }

  // ST-06 — unknown or missing licence (only when the source was inspected).
  if (ctx.license === null) findings.push({ kind: "malformed", severity: "low", surface: "repository", message: "No licence: redistribution terms are unknown.", evidence: "license: none", rule: "ST-06" });

  return findings;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ScanOptions {
  /** Set by moderators after a human review. The scanner never grants Verified alone. */
  reviewed?: boolean;
  /** A gov-moderator already granted Gov on top of Verified; kept while the scan stays clean. */
  gov?: boolean;
}

/** What the scanner knows beyond the manifest (repository snapshot, dependency audit). */
export interface ScanContext {
  /** Repository owner, for brand checks (ST-03). */
  owner?: string | null;
  /** SPDX id; `null` = inspected and missing, `undefined` = unknown. */
  license?: string | null;
  /** Repository file paths, for the binaries check (ST-04). */
  files?: string[];
  /** Findings produced outside the manifest: DP-* dependency audit, intake. */
  extraFindings?: ScanFinding[];
}

export function scanManifest(manifest: SkillManifest, options: ScanOptions = {}, context: ScanContext = {}): ScanReport {
  const started = performance.now();
  const surfaces = collectSurfaces(manifest);
  const toolNames = new Set((Array.isArray(manifest.tools) ? manifest.tools : []).map((t) => String(t.name).toLowerCase()));
  const findings: ScanFinding[] = [...structuralFindings(manifest, context), ...(context.extraFindings ?? [])];

  for (const surface of surfaces) {
    runRules(PATTERN_RULES, surface, { manifest, toolNames }, findings);
    findings.push(...encodedFindings(surface, { manifest, toolNames }));
  }

  const outcome = decideOutcome(findings);
  const score = riskScore(findings);
  const verifiable = outcome === "Community" && score >= VERIFIED_MIN_SCORE;

  return {
    scannerVersion: SCANNER_VERSION,
    rulesVersion: RULES_VERSION,
    outcome,
    level: levelFor(outcome, verifiable, options),
    score,
    verifiable,
    findings: findings.sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]),
    surfacesScanned: surfaces.length,
    durationMs: Math.round((performance.now() - started) * 100) / 100,
  };
}

/** Stage 6: rules decide, not the sum of points. */
export function decideOutcome(findings: ScanFinding[]): ScanOutcome {
  if (findings.some((f) => f.verdict === "Rejected")) return "Rejected";
  if (findings.some((f) => f.verdict === "Quarantine")) return "Quarantine";
  const worst = worstSeverity(findings);
  return worst === "critical" || worst === "high" ? "Sandbox" : "Community";
}

function levelFor(outcome: ScanOutcome, verifiable: boolean, options: ScanOptions): SecurityLevel {
  if (outcome === "Quarantine") return "Quarantine";
  if (outcome !== "Community") return "Sandbox";
  if (options.reviewed && verifiable) return options.gov ? "Gov" : "Verified";
  return "Community";
}

/** Level the scanner would assign to a bare set of findings (tests, rescans). */
export function assignSecurityLevel(findings: ScanFinding[], options: ScanOptions = {}): SecurityLevel {
  const outcome = decideOutcome(findings);
  return levelFor(outcome, outcome === "Community" && riskScore(findings) >= VERIFIED_MIN_SCORE, options);
}

/** Scan a catalogue entry with what the crawler stored about its repository. */
export function scanSkill(skill: Pick<Skill, "manifest" | "securityLevel" | "source">, options: ScanOptions = {}): ScanReport {
  const reviewed = options.reviewed ?? (skill.securityLevel === "Verified" || skill.securityLevel === "Gov");
  const gov = options.gov ?? skill.securityLevel === "Gov";
  const audit = skill.source?.audit;
  return scanManifest(skill.manifest, { reviewed, gov }, { owner: skill.source?.owner ?? null, license: audit ? skill.source?.license ?? null : undefined, files: audit?.binaries, extraFindings: audit?.findings ?? [] });
}

/** Convenience for API handlers: throws when the manifest must not be published at all. */
export function assertInstallable(report: ScanReport): void {
  const blocking = report.findings.filter((f) => f.verdict || f.blocksPublication || f.severity === "critical");
  if (blocking.length) {
    const list = blocking.map((f) => `${f.rule} @ ${f.surface}: ${f.message}`).join("; ");
    throw new SandboxViolationError(`Manifest rejected by sandbox scanner: ${list}`, report);
  }
}

export class SandboxViolationError extends Error {
  constructor(message: string, public readonly report: ScanReport) {
    super(message);
    this.name = "SandboxViolationError";
  }
}

// ---------------------------------------------------------------------------
// Version inheritance (ТЗ §2, stage 7 «Привязка»)
// ---------------------------------------------------------------------------

/** What a reviewer signed off on: permissions, prompts, tool descriptions and the launch target. */
export function reviewFingerprint(manifest: SkillManifest): string {
  return JSON.stringify({
    permissions: [...(manifest.permissions ?? [])].sort(),
    systemPrompt: manifest.systemPrompt ?? "",
    tools: (Array.isArray(manifest.tools) ? manifest.tools : []).map((t) => [t.name, t.description, t.parameters ?? null]),
    entrypoint: manifest.entrypoint ?? null,
  });
}

/**
 * A new version inherits Verified / Gov only when the permissions, prompts and
 * tool descriptions are unchanged and the scan found nothing that lifts it out
 * of Community; otherwise it drops to what the scanner assigned and needs a
 * fresh review.
 */
export function inheritLevel(previous: { level: SecurityLevel; manifest: SkillManifest } | null, next: { manifest: SkillManifest; scanned: SecurityLevel }): SecurityLevel {
  if (!previous || (previous.level !== "Verified" && previous.level !== "Gov")) return next.scanned;
  if (next.scanned !== "Community") return next.scanned;
  return reviewFingerprint(previous.manifest) === reviewFingerprint(next.manifest) ? previous.level : next.scanned;
}

/**
 * PI / EX rules over a free-text input that will reach a model (FR-AI-21:
 * `resolve_task` text is untrusted; the On-prem prompt filter reuses this).
 */
export function scanUntrustedText(text: string, path = "input"): ScanFinding[] {
  const surface: Surface = { path, raw: text, text: normalizeText(text) };
  const ctx = { manifest: { schemaVersion: 1, name: "", description: "", category: "Prompt", tools: [], entrypoint: { type: "prompt" } } as SkillManifest, toolNames: new Set<string>() };
  const findings: ScanFinding[] = [];
  runRules([...PI_RULES, ...EX_RULES], surface, ctx, findings);
  findings.push(...encodedFindings(surface, ctx));
  return findings;
}
