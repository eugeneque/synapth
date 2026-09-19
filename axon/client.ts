import type { Paginated, Skill, SkillCreateInput, SkillQuery } from "@/types/skill";
import type { AgentContextPayload } from "@/types/agent";
import type { ExecutionReceipt, Wallet } from "@/types/economy";
import type { ScanReport } from "@/lib/sandbox-scanner";
import type { FacetBucket, Highlight, ParsedQuery, Suggestion } from "@/cortex/search";
import type { ImportResult } from "@/lib/github-parser";

export interface AxonOptions {
  baseUrl?: string;
  /** Agent API key, sent as X-Synapth-Key. */
  apiKey?: string;
  fetch?: typeof fetch;
}

export interface SearchResponse {
  hits: Array<{ skill: Skill; score: number; matched: string[]; highlights: Highlight[] }>;
  total: number;
  limit: number;
  offset: number;
  facets: { category: FacetBucket[]; securityLevel: FacetBucket[]; language: FacetBucket[]; tags: FacetBucket[]; author: FacetBucket[] };
  corrections: Array<{ from: string; to: string }>;
  filters: ParsedQuery["filters"];
  tookMs: number;
}

export interface SearchParams extends Omit<SkillQuery, "sort"> {
  sort?: "relevance" | "trending" | "recent" | "stars";
}

export class AxonError extends Error {
  constructor(public readonly status: number, message: string, public readonly body?: unknown) {
    super(message);
    this.name = "AxonError";
  }
}

function toSearchParams(query: SkillQuery): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/**
 * Typed client for the Cortex API. The same class serves the web UI
 * (`new Axon()`) and agents (`new Axon({ apiKey })` + `agentContext()`).
 */
export class Axon {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: AxonOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? (typeof window === "undefined" ? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000" : "")).replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    // Wrapped so the browser's fetch keeps its `this` (calling a detached fetch throws "Illegal invocation").
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
  }

  private async request<T>(path: string, init: RequestInit & { agent?: boolean } = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (this.apiKey) headers.set("X-Synapth-Key", this.apiKey);
    if (init.agent) headers.set("X-Agent-Request", "true");

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers });
    const text = await res.text();
    const body = text ? safeJson(text) : null;
    if (!res.ok) {
      const message = (body as { error?: string } | null)?.error ?? `${res.status} ${res.statusText}`;
      throw new AxonError(res.status, message, body);
    }
    return body as T;
  }

  skills = {
    list: (query: SkillQuery = {}) => this.request<Paginated<Skill>>(`/api/v1/skills${toSearchParams(query)}`),
    get: (idOrSlug: string) => this.request<Skill>(`/api/v1/skills/${encodeURIComponent(idOrSlug)}`),
    create: (input: SkillCreateInput) => this.request<{ skill: Skill; scan: ScanReport }>(`/api/v1/skills`, { method: "POST", body: JSON.stringify(input) }),
    install: (id: string, client: string) => this.request<{ ok: true; downloadsCount: number }>(`/api/v1/skills/${id}`, { method: "POST", body: JSON.stringify({ action: "install", client }) }),
    execute: (id: string, tool: string | null, input: unknown) =>
      this.request<{ receipt: ExecutionReceipt; result: unknown }>(`/api/v1/skills/${id}/execute`, { method: "POST", body: JSON.stringify({ tool, input }) }),
  };

  search = {
    query: (params: SearchParams) => this.request<SearchResponse>(`/api/v1/search${toSearchParams(params as unknown as SkillQuery)}`),
    suggest: (q: string) => this.request<{ suggestions: Suggestion[] }>(`/api/v1/search?suggest=1&q=${encodeURIComponent(q)}`),
  };

  crawl = {
    status: () => this.request<CrawlStatus>(`/api/v1/crawl`),
    start: (body: { maxRepos?: number; minStars?: number; repos?: string[]; queries?: string[]; refresh?: boolean }) => this.request<CrawlStatus>(`/api/v1/crawl`, { method: "POST", body: JSON.stringify(body) }),
    abort: () => this.request<CrawlStatus>(`/api/v1/crawl`, { method: "DELETE" }),
  };

  /** Agent-first: minified system prompt + tool schemas, ready for the context window. */
  agentContext = (query: SkillQuery = {}) => this.request<AgentContextPayload>(`/api/v1/skills${toSearchParams(query)}`, { agent: true });

  import = {
    github: (url: string, options: { dryRun?: boolean; mock?: boolean } = {}) =>
      this.request<{ import: ImportResult; scan: ScanReport; skill: Skill | null }>(`/api/v1/import/github`, { method: "POST", body: JSON.stringify({ url, ...options }) }),
  };

  account = {
    wallet: () => this.request<{ wallet: Wallet; balanceUsd: number }>(`/api/v1/account/wallet`),
  };
}

export interface CrawlStatus {
  running: boolean;
  error: string | null;
  progress: {
    phase: string;
    discovered: number;
    processed: number;
    imported: number;
    rejected: number;
    errors: number;
    skillsCreated: number;
    skillsUpdated: number;
    current: string | null;
    startedAt: string;
    log: string[];
  } | null;
  state: { repos: number; imported: number; rejected: number; errors: number; skills: number; lastRun: { startedAt: string; finishedAt: string; processed: number; created: number; updated: number } | null };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const axon = new Axon();
