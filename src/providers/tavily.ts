// src/providers/tavily.ts
import type { FetchProvider, FetchResult, SearchProvider, SearchResult } from "./types.ts";

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

  async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: this.apiKey, query, max_results: maxResults }),
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
