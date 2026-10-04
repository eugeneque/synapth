/**
 * Cortex · free-tier LLM gateway.
 *
 * Providers come from the awesome-freellm-apis directory
 * (github.com/open-free-llm-api/awesome-freellm-apis); every one of them
 * speaks the OpenAI `chat/completions` dialect. A provider is active when its
 * key is in the environment; calls walk the chain in order and fall through
 * on 429 / 5xx / timeouts, parking a rate-limited provider until its
 * `retry-after` passes. Without any key `llmAvailable()` is false and callers
 * keep their non-LLM path.
 *
 * Env:
 *   SYNAPTH_LLM=0                    — off (tests, local runs without network)
 *   SYNAPTH_LLM_CHAIN=groq,gemini    — order/subset of providers (default: preset order)
 *   <PROVIDER>_API_KEY               — key per provider (see LLM_PROVIDERS)
 *   SYNAPTH_LLM_MODEL_<ID>           — model override per provider (free model ids rotate often)
 */

export interface LlmProvider {
  id: string;
  baseUrl: string;
  keyEnv: string;
  model: string;
}

/** Ordered by free-tier generosity and latency; models are the directory's "best free" picks. */
export const LLM_PROVIDERS: readonly LlmProvider[] = [
  { id: "groq", baseUrl: "https://api.groq.com/openai/v1", keyEnv: "GROQ_API_KEY", model: "moonshotai/kimi-k2-instruct-0905" },
  { id: "cerebras", baseUrl: "https://api.cerebras.ai/v1", keyEnv: "CEREBRAS_API_KEY", model: "zai-glm-4.7" },
  { id: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", keyEnv: "GEMINI_API_KEY", model: "gemini-3.5-flash" },
  { id: "mistral", baseUrl: "https://api.mistral.ai/v1", keyEnv: "MISTRAL_API_KEY", model: "mistral-medium-3-5-128b" },
  { id: "openrouter", baseUrl: "https://openrouter.ai/api/v1", keyEnv: "OPENROUTER_API_KEY", model: "nvidia/nemotron-3-ultra-550b-a55b:free" },
  { id: "nvidia", baseUrl: "https://integrate.api.nvidia.com/v1", keyEnv: "NVIDIA_API_KEY", model: "z-ai/glm-5.1" },
];

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  /** Ask for a JSON object (`response_format`); the caller still validates it. */
  json?: boolean;
  /** Per-provider timeout. */
  timeoutMs?: number;
}

export interface ChatResult {
  text: string;
  provider: string;
  model: string;
}

export class LlmUnavailableError extends Error {
  constructor(public readonly attempts: string[]) {
    super(attempts.length ? `All LLM providers failed: ${attempts.join("; ")}` : "No LLM provider is configured");
    this.name = "LlmUnavailableError";
  }
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 15 * 60_000;

/** providerId → epoch ms until which it is skipped after a 429. */
const g = globalThis as unknown as { __synapthLlmCooldown_v1?: Map<string, number> };
const cooldown = (g.__synapthLlmCooldown_v1 ??= new Map());

type Env = Record<string, string | undefined>;

function modelFor(p: LlmProvider, env: Env): string {
  return env[`SYNAPTH_LLM_MODEL_${p.id.toUpperCase()}`]?.trim() || p.model;
}

/** Providers with a key, in chain order. */
export function activeProviders(env: Env = process.env): LlmProvider[] {
  if (env.SYNAPTH_LLM === "0") return [];
  const keyed = LLM_PROVIDERS.filter((p) => env[p.keyEnv]?.trim());
  const chain = env.SYNAPTH_LLM_CHAIN?.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!chain?.length) return keyed;
  return chain.flatMap((id) => keyed.filter((p) => p.id === id));
}

export function llmAvailable(env: Env = process.env): boolean {
  return activeProviders(env).length > 0;
}

function retryAfterMs(res: Response): number {
  const raw = res.headers.get("retry-after");
  const seconds = raw ? Number(raw) : NaN;
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAX_COOLDOWN_MS) : DEFAULT_COOLDOWN_MS;
}

/** One completion from the first provider that answers. Throws `LlmUnavailableError` when none does. */
export async function chat(messages: ChatMessage[], options: ChatOptions = {}, deps: { env?: Env; fetch?: FetchLike; now?: () => number } = {}): Promise<ChatResult> {
  const env = deps.env ?? process.env;
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const attempts: string[] = [];

  for (const provider of activeProviders(env)) {
    if ((cooldown.get(provider.id) ?? 0) > now()) {
      attempts.push(`${provider.id}: cooling down`);
      continue;
    }
    const model = modelFor(provider, env);
    try {
      const res = await doFetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${env[provider.keyEnv]!.trim()}` },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: options.maxTokens ?? 512,
          temperature: options.temperature ?? 0.2,
          ...(options.json ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
      if (res.status === 429) {
        cooldown.set(provider.id, now() + retryAfterMs(res));
        attempts.push(`${provider.id}: 429`);
        continue;
      }
      if (!res.ok) {
        attempts.push(`${provider.id}: HTTP ${res.status}`);
        continue;
      }
      const body = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
      const text = body.choices?.[0]?.message?.content;
      if (typeof text !== "string" || !text.trim()) {
        attempts.push(`${provider.id}: empty answer`);
        continue;
      }
      return { text, provider: provider.id, model };
    } catch (err) {
      attempts.push(`${provider.id}: ${err instanceof Error ? err.name : "error"}`);
    }
  }
  throw new LlmUnavailableError(attempts);
}

/** Pulls the first JSON object out of a model answer (models wrap it in fences or prose despite `json`). */
export function parseJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function resetLlmCooldownForTests() {
  cooldown.clear();
}
