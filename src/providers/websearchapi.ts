// src/providers/websearchapi.ts
import type { ProviderMeta, SearchFilters, SearchProvider, SearchResult } from "./types.ts";

const WEBSEARCHAPI_ENDPOINT = "https://api.websearchapi.ai/ai-search";

interface WebSearchApiResponse {
  organic?: Array<{
    title: string;
    url: string;
    description: string;
  }>;
}

export class WebSearchApiProvider implements SearchProvider {
  readonly name = "websearchapi";
  readonly label = "WebSearchAPI";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
    _filters?: SearchFilters,
  ): Promise<SearchResult[]> {
    const response = await fetch(WEBSEARCHAPI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ query, maxResults }),
      signal,
    });

    if (!response.ok) {
      throw new Error(
        `WebSearchAPI error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as WebSearchApiResponse;
    return (data.organic ?? []).slice(0, maxResults).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
    }));
  }
}

export const providerMeta: ProviderMeta = {
  name: "websearchapi",
  tier: 1,
  monthlyQuota: null,
  requiresKey: true,
  create: (key) => ({ search: new WebSearchApiProvider(key!) }),
};
