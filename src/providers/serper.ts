// src/providers/serper.ts
import type { SearchProvider, SearchResult } from "./types.ts";

interface SerperResponse {
  organic: Array<{ title: string; link: string; snippet: string }>;
}

export class SerperProvider implements SearchProvider {
  readonly name = "serper";
  readonly label = "Google Serper";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": this.apiKey,
      },
      body: JSON.stringify({ q: query, num: maxResults }),
      signal,
    });
    if (!response.ok) throw new Error(`Serper API error: ${response.status} ${response.statusText}`);
    const data = (await response.json()) as SerperResponse;
    return (data.organic ?? []).slice(0, maxResults).map((r) => ({
      title: r.title, url: r.link, snippet: r.snippet,
    }));
  }
}
