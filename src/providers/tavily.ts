// src/providers/tavily.ts
import type { FetchProvider, FetchResult, ProviderMeta, SearchFilters, SearchProvider, SearchResult } from "./types.ts";

interface TavilySearchResponse {
  results: Array<{ title: string; url: string; content: string }>;
}

interface TavilyExtractResponse {
  results: Array<{ raw_content: string }>;
}

export class TavilyProvider implements SearchProvider, FetchProvider {
  readonly name = "tavily";
  readonly label = "Tavily";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
    filters?: SearchFilters,
  ): Promise<SearchResult[]> {
    const body: Record<string, unknown> = {
      api_key: this.apiKey,
      query,
      max_results: maxResults,
    };

    if (filters?.includeDomains?.length) {
      body.include_domains = filters.includeDomains;
    }
    if (filters?.excludeDomains?.length) {
      body.exclude_domains = filters.excludeDomains;
    }
    // Note: Tavily does not support date filtering — startDate/endDate are silently ignored.

    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) throw new Error(`Tavily API error: ${response.status} ${response.statusText}`);
    const data = (await response.json()) as TavilySearchResponse;
    return (data.results ?? []).slice(0, maxResults).map((r) => ({
      title: r.title, url: r.url, snippet: r.content,
    }));
  }

  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult> {
    const response = await fetch("https://api.tavily.com/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: this.apiKey, urls: [url] }),
      signal,
    });
    if (!response.ok) throw new Error(`Tavily extract error: ${response.status} ${response.statusText}`);
    const data = (await response.json()) as TavilyExtractResponse;
    const content = data.results?.[0]?.raw_content ?? "";
    return { text: content };
  }
}

export const providerMeta: ProviderMeta = {
  name: "tavily",
  tier: 1,
  monthlyQuota: 1000,
  requiresKey: true,
  create: (key) => {
    const p = new TavilyProvider(key!);
    return { search: p, fetch: p };
  },
};
