// src/providers/openai-codex.ts
import type { ProviderConfigEntry } from "../config.ts";
import type { ProviderMeta, SearchFilters, SearchProvider, SearchResult } from "./types.ts";
import { parseOpenAINativeResults } from "./parsers.ts";

/**
 * Dual-mode OpenAI Codex provider.
 *
 * Mode A (Codex): Uses Pi AuthStorage + streamOpenAICodexResponses via @earendil-works/pi-ai.
 *   Activated when Pi packages are available and AuthStorage has an openai-codex key.
 *   Returns rich snippets via submit_search_results tool call.
 *
 * Mode B (Responses API): Uses user-provided OPENAI_API_KEY with the Responses API.
 *   Activated as fallback when Mode A is unavailable.
 *   Returns url_citation annotations (title + url, no snippets).
 *
 * Mode resolution is deferred to first search() call (lazy init) because
 * AuthStorage.getApiKey() is async but ProviderMeta.create() is sync.
 */

const DEFAULT_MODEL_A = "gpt-5.4-mini";
const DEFAULT_MODEL_B = "gpt-4.1-nano";
const RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const DEFAULT_SEARCH_CONTEXT_SIZE = "low";
const MAX_TOOL_RESULTS = 20;
const MAX_TITLE_LENGTH = 200;
const MAX_SNIPPET_LENGTH = 1000;

const SUBMIT_SEARCH_RESULTS_TOOL = {
  name: "submit_search_results",
  description: "Submit structured search results based on the available source evidence.",
  parameters: {
    type: "object",
    properties: {
      results: {
        type: "array",
        maxItems: MAX_TOOL_RESULTS,
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Page title or clearest source title for the URL." },
            url: { type: "string", description: "Canonical http/https URL for the result." },
            snippet: {
              type: "string",
              description:
                "A dense 450-500 character, multi-sentence paragraph with the most query-relevant facts.",
            },
          },
          required: ["title", "url", "snippet"],
        },
      },
    },
    required: ["results"],
  },
} as const;

type ResolvedMode = "codex" | "responses-api" | "unavailable";

// Minimal type shapes for dynamically imported Pi packages.
type PiStreamFn = (model: unknown, context: unknown, options: unknown) => { result(): Promise<PiStreamMessage> };
type PiGetModelFn = (provider: string, modelId: string) => unknown | undefined;
interface PiAuthStorage {
  getApiKey(provider: string, opts?: { includeFallback?: boolean }): Promise<string | undefined>;
}
interface PiStreamMessage {
  stopReason: string;
  errorMessage?: string;
  content: Array<{ type: string; name?: string; arguments?: unknown }>;
}

class OpenAICodexProvider implements SearchProvider {
  readonly name = "openai-codex";
  readonly label = "OpenAI Codex";

  private readonly userApiKey?: string;
  private readonly model?: string;
  private resolvedMode: ResolvedMode | null = null;
  private resolvePromise: Promise<void> | null = null;

  // Mode A dependencies (resolved lazily via dynamic import)
  private streamFn: PiStreamFn | null = null;
  private getModelFn: PiGetModelFn | null = null;
  private authStorage: PiAuthStorage | null = null;

  constructor(userApiKey?: string, providerConfig?: ProviderConfigEntry) {
    this.userApiKey = userApiKey;
    this.model = (providerConfig as Record<string, unknown> | undefined)
      ?.model as string | undefined;
  }

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
    _filters?: SearchFilters,
  ): Promise<SearchResult[]> {
    if (!this.resolvedMode) {
      if (!this.resolvePromise) {
        this.resolvePromise = this.resolveMode();
      }
      await this.resolvePromise;
    }

    switch (this.resolvedMode) {
      case "codex":
        return this.searchModeA(query, maxResults, signal);
      case "responses-api":
        return this.searchModeB(query, maxResults, signal);
      default:
        return [];
    }
  }

  private async resolveMode(): Promise<void> {
    // Try Mode A: dynamic import of Pi packages
    try {
      const [piAi, piAgent] = await Promise.all([
        import("@earendil-works/pi-ai") as unknown as Promise<{
          streamOpenAICodexResponses: PiStreamFn;
          getModel: PiGetModelFn;
        }>,
        import("@earendil-works/pi-coding-agent") as unknown as Promise<{
          AuthStorage: { create(): PiAuthStorage };
        }>,
      ]);

      const authStorage = piAgent.AuthStorage.create();
      const key = await authStorage.getApiKey("openai-codex", {
        includeFallback: false,
      });
      if (key) {
        this.streamFn = piAi.streamOpenAICodexResponses;
        this.getModelFn = piAi.getModel;
        this.authStorage = authStorage;
        this.resolvedMode = "codex";
        return;
      }
    } catch {
      // Pi packages not available — fall through to Mode B
    }

    // Try Mode B: user-provided API key
    if (this.userApiKey) {
      this.resolvedMode = "responses-api";
      return;
    }

    this.resolvedMode = "unavailable";
  }

  /** Mode A: Streaming Codex via Pi AuthStorage. */
  private async searchModeA(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
  ): Promise<SearchResult[]> {
    if (!this.streamFn || !this.getModelFn || !this.authStorage) return [];

    // Re-fetch key each call (tokens can expire)
    const apiKey = await this.authStorage.getApiKey("openai-codex", {
      includeFallback: false,
    });
    if (!apiKey) {
      // Key expired — fall back to Mode B if user key available
      if (this.userApiKey) {
        this.resolvedMode = "responses-api";
        return this.searchModeB(query, maxResults, signal);
      }
      return [];
    }

    const modelId = this.model ?? DEFAULT_MODEL_A;
    const model = this.getModelFn("openai-codex", modelId);
    if (!model) return [];

    const context = {
      systemPrompt: `Research the user's query with hosted web_search and call submit_search_results exactly once with at most ${maxResults} results. Return only real http/https URLs. Prefer primary sources. For snippet, write a dense 450-500 character, multi-sentence paragraph with the most query-relevant facts. Do not invent details or present unsupported text as source content. No prose. No internal references.`,
      messages: [{ role: "user" as const, content: query, timestamp: Date.now() }],
      tools: [SUBMIT_SEARCH_RESULTS_TOOL],
    };

    const message = await this.streamFn(model, context, {
      apiKey,
      signal,
      transport: "sse",
      reasoningEffort: "minimal",
      textVerbosity: "low",
      onPayload: injectCodexSearchPayload,
    }).result();

    if (message.stopReason === "error" || message.stopReason === "aborted") {
      return [];
    }

    const submitCall = message.content.find(
      (block) => block.type === "toolCall" && block.name === "submit_search_results",
    );
    if (!submitCall || submitCall.type !== "toolCall") return [];

    return normalizeCodexToolCallResults(submitCall.arguments, maxResults);
  }

  /** Mode B: Direct POST to OpenAI Responses API. */
  private async searchModeB(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
  ): Promise<SearchResult[]> {
    if (!this.userApiKey) return [];

    const response = await fetch(RESPONSES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.userApiKey}`,
      },
      body: JSON.stringify({
        model: this.model ?? DEFAULT_MODEL_B,
        tools: [{ type: "web_search" }],
        tool_choice: "required",
        input: `Search the web for: ${query}`,
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(
        `OpenAI Codex API error: ${response.status} ${response.statusText}`,
      );
    }

    const data: unknown = await response.json();
    return parseOpenAINativeResults(data).slice(0, maxResults);
  }
}

// --- Utilities ---

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Payload injection callback for streamOpenAICodexResponses.
 * Adds web_search tool with external_web_access and search_context_size.
 */
export function injectCodexSearchPayload(payload: unknown): unknown {
  const body = isRecord(payload) ? payload : {};
  const kept = Array.isArray(body.tools)
    ? (body.tools as unknown[]).filter((t) => !isRecord(t) || t.type !== "web_search")
    : [];

  body.tools = [
    { type: "web_search", external_web_access: true, search_context_size: DEFAULT_SEARCH_CONTEXT_SIZE },
    ...kept,
  ];
  body.tool_choice = "auto";
  body.parallel_tool_calls = false;

  const existing = Array.isArray(body.include)
    ? body.include.filter((v): v is string => typeof v === "string" && v !== "web_search_call.action.sources")
    : [];
  body.include = [...existing, "web_search_call.action.sources"];

  return body;
}

/**
 * Parse the submit_search_results tool call arguments into SearchResult[].
 */
export function normalizeCodexToolCallResults(args: unknown, maxResults: number): SearchResult[] {
  if (!isRecord(args) || !Array.isArray(args.results)) return [];

  const limit = Math.max(1, Math.min(maxResults, MAX_TOOL_RESULTS));
  const seen = new Set<string>();
  const results: SearchResult[] = [];

  for (const raw of args.results) {
    if (!isRecord(raw)) continue;

    const url = normalizeHttpUrl(raw.url);
    if (!url) continue;

    const dedupeKey = url.toLowerCase().replace(/\/+$/, "");
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const title = truncateText(cleanString(raw.title) || safeHostname(url), MAX_TITLE_LENGTH);
    const snippet = truncateText(cleanString(raw.snippet), MAX_SNIPPET_LENGTH);

    results.push({ title, url, snippet });
    if (results.length >= limit) break;
  }

  return results;
}

function normalizeHttpUrl(value: unknown): string | undefined {
  const input = cleanString(value);
  if (!input) return undefined;
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function safeHostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

export const providerMeta: ProviderMeta = {
  name: "openai-codex",
  tier: 1,
  monthlyQuota: null,
  requiresKey: false,
  create: (key?: string, providerConfig?: ProviderConfigEntry) => ({
    search: new OpenAICodexProvider(key, providerConfig),
  }),
};
