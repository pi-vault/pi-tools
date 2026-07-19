// src/providers/openai-codex.ts
import { hasApi, stream as streamOpenAICodexResponses } from "@earendil-works/pi-ai/compat";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { ProviderMeta, SearchFilters, SearchProvider, SearchResult } from "./types.ts";

const DEFAULT_MODEL = "gpt-5.4-mini";
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
            title: {
              type: "string",
              description: "Page title or clearest source title for the URL.",
            },
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

class OpenAICodexProvider implements SearchProvider {
  readonly name = "openai-codex";
  readonly label = "OpenAI Codex";

  constructor(
    private readonly model?: string,
    private readonly modelRegistry?: ModelRegistry,
  ) {}

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
    _filters?: SearchFilters,
  ): Promise<SearchResult[]> {
    signal?.throwIfAborted();
    if (!this.modelRegistry) throw new Error("Pi model registry unavailable");

    const model = this.modelRegistry.find("openai-codex", this.model ?? DEFAULT_MODEL);
    if (!model || !hasApi(model, "openai-codex-responses")) {
      throw new Error("OpenAI Codex model is unavailable");
    }
    if (!this.modelRegistry.isUsingOAuth(model)) {
      throw new Error("OpenAI Codex requires Pi OAuth; run /login for openai-codex");
    }

    const auth = await this.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) {
      throw new Error(`OpenAI Codex auth failed: ${auth.error}; run /login for openai-codex`);
    }
    if (!auth.apiKey) {
      throw new Error("OpenAI Codex OAuth credentials are unavailable; run /login");
    }

    const context = {
      systemPrompt: `Research the user's query with hosted web_search and call submit_search_results exactly once with at most ${maxResults} results. Return only real http/https URLs. Prefer primary sources. For snippet, write a dense 450-500 character, multi-sentence paragraph with the most query-relevant facts. Do not invent details or present unsupported text as source content. No prose. No internal references.`,
      messages: [{ role: "user" as const, content: query, timestamp: Date.now() }],
      tools: [SUBMIT_SEARCH_RESULTS_TOOL],
    };

    const message = await streamOpenAICodexResponses(model, context, {
      apiKey: auth.apiKey,
      headers: auth.headers,
      env: auth.env,
      signal,
      transport: "sse",
      reasoningEffort: "minimal",
      textVerbosity: "low",
      onPayload: injectCodexSearchPayload,
    }).result();

    if (message.stopReason === "aborted") {
      signal?.throwIfAborted();
      throw new Error("OpenAI Codex search aborted");
    }
    if (message.stopReason === "error") {
      throw new Error(`OpenAI Codex search failed: ${message.errorMessage ?? "unknown error"}`);
    }

    const submitCall = message.content.find(
      (block) => block.type === "toolCall" && block.name === "submit_search_results",
    );
    if (submitCall?.type !== "toolCall") {
      throw new Error("OpenAI Codex returned no structured search results");
    }

    const results = normalizeCodexToolCallResults(submitCall.arguments, maxResults);
    if (results.length === 0) {
      throw new Error("OpenAI Codex returned no usable search results");
    }
    return results;
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
    {
      type: "web_search",
      external_web_access: true,
      search_context_size: DEFAULT_SEARCH_CONTEXT_SIZE,
    },
    ...kept,
  ];
  body.tool_choice = "auto";
  body.parallel_tool_calls = false;

  const existing = Array.isArray(body.include)
    ? body.include.filter(
        (v): v is string => typeof v === "string" && v !== "web_search_call.action.sources",
      )
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

    const title = truncateText(cleanString(raw.title) || new URL(url).hostname, MAX_TITLE_LENGTH);
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

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

export const providerMeta: ProviderMeta = {
  name: "openai-codex",
  tier: 1,
  requiresKey: false,
  create: (_key, providerConfig, modelRegistry) => ({
    search: new OpenAICodexProvider(providerConfig?.model, modelRegistry),
  }),
};
