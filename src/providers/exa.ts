// src/providers/exa.ts
import type {
  CodeSearchProvider,
  CodeSearchResult,
  FetchProvider,
  FetchResult,
  ProviderMeta,
  SearchFilters,
  SearchProvider,
  SearchResult,
} from "./types.ts";

interface ExaSearchResponse {
  results: Array<{ title: string; url: string; text?: string }>;
}

interface ExaContentsResponse {
  results: Array<{ text: string }>;
}

export class ExaProvider implements SearchProvider, FetchProvider, CodeSearchProvider {
  readonly name = "exa";
  readonly label = "Exa";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
    };
  }

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
    filters?: SearchFilters,
  ): Promise<SearchResult[]> {
    const body: Record<string, unknown> = {
      query,
      numResults: maxResults,
      useAutoprompt: true,
      type: "auto",
    };

    if (filters?.includeDomains?.length) {
      body.includeDomains = filters.includeDomains;
    }
    if (filters?.excludeDomains?.length) {
      body.excludeDomains = filters.excludeDomains;
    }
    if (filters?.startDate) {
      body.startPublishedDate = filters.startDate;
    }
    if (filters?.endDate) {
      body.endPublishedDate = filters.endDate;
    }

    const response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) throw new Error(`Exa API error: ${response.status} ${response.statusText}`);
    const data = (await response.json()) as ExaSearchResponse;
    return (data.results ?? []).slice(0, maxResults).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.text ?? "",
    }));
  }

  async codeSearch(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
  ): Promise<CodeSearchResult[]> {
    const response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        query,
        numResults: maxResults,
        type: "auto",
        category: "code",
      }),
      signal,
    });
    if (!response.ok)
      throw new Error(`Exa code search error: ${response.status} ${response.statusText}`);
    const data = (await response.json()) as ExaSearchResponse;
    return (data.results ?? []).slice(0, maxResults).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.text ?? "",
    }));
  }

  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult> {
    const response = await fetch("https://api.exa.ai/contents", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ urls: [url], text: true }),
      signal,
    });
    if (!response.ok)
      throw new Error(`Exa contents error: ${response.status} ${response.statusText}`);
    const data = (await response.json()) as ExaContentsResponse;
    return { text: data.results?.[0]?.text ?? "" };
  }
}

export const providerMeta: ProviderMeta = {
  name: "exa",
  tier: 1,
  monthlyQuota: 1000,
  requiresKey: true,
  create: (key) => {
    const p = new ExaProvider(key!);
    return { search: p, fetch: p, codeSearch: p };
  },
};
