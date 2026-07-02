// src/providers/firecrawl.ts
import type { FetchProvider, FetchResult, SearchFilters, SearchProvider, SearchResult } from "./types.ts";

interface FirecrawlSearchResponse {
  data: Array<{ title: string; url: string; markdown?: string; description?: string }>;
}

interface FirecrawlScrapeResponse {
  data: { markdown: string };
}

export class FirecrawlProvider implements SearchProvider, FetchProvider {
  readonly name = "firecrawl";
  readonly label = "Firecrawl";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  async search(query: string, maxResults: number, signal?: AbortSignal, _filters?: SearchFilters): Promise<SearchResult[]> {
    const response = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ query, limit: maxResults }),
      signal,
    });
    if (!response.ok) throw new Error(`Firecrawl search error: ${response.status} ${response.statusText}`);
    const data = (await response.json()) as FirecrawlSearchResponse;
    return (data.data ?? []).slice(0, maxResults).map((r) => ({
      title: r.title, url: r.url, snippet: r.description ?? r.markdown?.slice(0, 200) ?? "",
    }));
  }

  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult> {
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ url, formats: ["markdown"] }),
      signal,
    });
    if (!response.ok) throw new Error(`Firecrawl scrape error: ${response.status} ${response.statusText}`);
    const data = (await response.json()) as FirecrawlScrapeResponse;
    return { text: data.data?.markdown ?? "" };
  }
}
