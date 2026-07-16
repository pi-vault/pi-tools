// src/providers/openai-web-search.ts
import { parseOpenAINativeResults } from "./parsers.ts";
import type {
  ProviderMeta,
  SearchFilters,
  SearchProvider,
  SearchResult,
} from "./types.ts";
import type { ProviderConfigEntry } from "../config.ts";

const RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-4.1-mini";

class OpenAiWebSearchProvider implements SearchProvider {
  readonly name = "openai-web-search";
  readonly label = "OpenAI Web Search";

  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, config?: { model?: string }) {
    this.apiKey = apiKey;
    this.model = config?.model ?? DEFAULT_MODEL;
  }

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
    _filters?: SearchFilters,
  ): Promise<SearchResult[]> {
    const response = await fetch(RESPONSES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        tools: [{ type: "web_search" }],
        input: `Search the web for: ${query}`,
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(
        `OpenAI Native API error: ${response.status} ${response.statusText}`,
      );
    }

    const data: unknown = await response.json();
    return parseOpenAINativeResults(data).slice(0, maxResults);
  }
}

export function createOpenAiWebSearchProvider(
  apiKey: string,
  config?: { model?: string },
): { search: SearchProvider } {
  return {
    search: new OpenAiWebSearchProvider(apiKey, config),
  };
}

export const providerMeta: ProviderMeta = {
  name: "openai-web-search",
  tier: 1,
  monthlyQuota: null,
  requiresKey: true,
  create: (key?: string, providerConfig?: ProviderConfigEntry) => {
    if (!key) return {};
    // Only register when providerEnabled is not explicitly false
    if (providerConfig?.enabled === false) return {};
    return createOpenAiWebSearchProvider(key, {
      model: (providerConfig as any)?.model,
    });
  },
};
