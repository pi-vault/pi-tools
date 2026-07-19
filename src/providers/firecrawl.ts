// src/providers/firecrawl.ts
import type {
  FetchProvider,
  FetchResult,
  ProviderMeta,
  SearchFilters,
  SearchProvider,
  SearchResult,
} from "./types.ts";
import { parseFirecrawlResults } from "./parsers.ts";

interface FirecrawlScrapeResponse {
  data: { markdown: string };
}

export class FirecrawlProvider implements SearchProvider, FetchProvider {
  readonly name = "firecrawl";
  readonly label = "Firecrawl";
  private apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      h.Authorization = `Bearer ${this.apiKey}`;
    }
    return h;
  }

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
    _filters?: SearchFilters,
  ): Promise<SearchResult[]> {
    const response = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ query, limit: maxResults }),
      signal,
    });
    if (!response.ok)
      throw new Error(`Firecrawl search error: ${response.status} ${response.statusText}`);
    const data: unknown = await response.json();
    return parseFirecrawlResults(data).slice(0, maxResults);
  }

  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult> {
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ url, formats: ["markdown"] }),
      signal,
    });
    if (!response.ok)
      throw new Error(`Firecrawl scrape error: ${response.status} ${response.statusText}`);
    const data = (await response.json()) as FirecrawlScrapeResponse;
    return { text: data.data?.markdown ?? "" };
  }
}

export const providerMeta: ProviderMeta = {
  name: "firecrawl",
  tier: 1,
  requiresKey: false,
  usageCost: (operation) =>
    operation.capability === "search" ? 2 * Math.max(1, Math.ceil(operation.maxResults / 10)) : 1,
  create: (key) => {
    const p = new FirecrawlProvider(key);
    return { search: p, fetch: p };
  },
};
