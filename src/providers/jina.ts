// src/providers/jina.ts
import type {
  FetchProvider,
  FetchResult,
  ProviderMeta,
  SearchFilters,
  SearchProvider,
  SearchResult,
} from "./types.ts";
import { parseJinaResults } from "./parsers.ts";

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
    _filters?: SearchFilters,
  ): Promise<SearchResult[]> {
    const url = `https://s.jina.ai/?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: this.headers(),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Jina search error: ${response.status} ${response.statusText}`);
    }

    const data: unknown = await response.json();
    return parseJinaResults(data).slice(0, maxResults);
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

export const providerMeta: ProviderMeta = {
  name: "jina",
  tier: 3,
  monthlyQuota: null,
  requiresKey: false,
  create: (key) => {
    const p = new JinaProvider(key);
    return { search: p, fetch: p };
  },
};
