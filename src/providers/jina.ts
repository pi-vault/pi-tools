// src/providers/jina.ts
import type { FetchProvider, FetchResult, SearchProvider, SearchResult } from "./types.ts";

interface JinaSearchResponse {
  data: Array<{
    title: string;
    url: string;
    description: string;
  }>;
}

export class JinaProvider implements SearchProvider, FetchProvider {
  readonly name = "jina";
  readonly label = "Jina";
  private apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      Accept: "application/json",
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
  ): Promise<SearchResult[]> {
    const url = `https://s.jina.ai/?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: this.headers(),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Jina search error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as JinaSearchResponse;
    return (data.data ?? []).slice(0, maxResults).map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.description,
    }));
  }

  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult> {
    const readerUrl = `https://r.jina.ai/${url}`;
    const response = await fetch(readerUrl, {
      headers: {
        ...this.headers(),
        Accept: "text/plain",
      },
      signal,
    });

    if (!response.ok) {
      throw new Error(`Jina reader error: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    return { text };
  }
}
