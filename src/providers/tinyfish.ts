import type {
  FetchProvider,
  ProviderMeta,
  SearchFilters,
  SearchProvider,
  SearchResult,
} from "./types.ts";

const SEARCH_ENDPOINT = "https://api.search.tinyfish.ai/";
const FETCH_ENDPOINT = "https://api.fetch.tinyfish.ai";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export class TinyFishProvider implements SearchProvider, FetchProvider {
  readonly name = "tinyfish";
  readonly label = "TinyFish";
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
    filters?: SearchFilters,
  ): Promise<SearchResult[]> {
    if (maxResults <= 0) return [];

    const url = new URL(SEARCH_ENDPOINT);
    url.searchParams.set("query", query);
    if (filters?.includeDomains?.length) {
      url.searchParams.set("include_domains", filters.includeDomains.join(","));
    }
    if (filters?.excludeDomains?.length) {
      url.searchParams.set("exclude_domains", filters.excludeDomains.join(","));
    }
    if (filters?.startDate) url.searchParams.set("after_date", filters.startDate);
    if (filters?.endDate) url.searchParams.set("before_date", filters.endDate);

    const response = await fetch(url, {
      headers: { Accept: "application/json", "X-API-Key": this.apiKey },
      signal,
    });
    if (!response.ok) {
      throw new Error(`TinyFish search error: ${response.status} ${response.statusText}`);
    }

    const data: unknown = await response.json();
    if (!isRecord(data) || !Array.isArray(data.results)) return [];
    const results: SearchResult[] = [];
    for (const entry of data.results) {
      if (!isRecord(entry) || !validHttpUrl(entry.url)) continue;
      results.push({
        title: typeof entry.title === "string" ? entry.title : "",
        snippet: typeof entry.snippet === "string" ? entry.snippet : "",
        url: entry.url,
      });
      if (results.length >= maxResults) break;
    }
    return results;
  }

  async fetch(url: string, signal?: AbortSignal) {
    const response = await fetch(FETCH_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
      },
      body: JSON.stringify({ urls: [url], format: "markdown" }),
      signal,
    });
    if (!response.ok) {
      throw new Error(`TinyFish fetch error: ${response.status} ${response.statusText}`);
    }

    const data: unknown = await response.json();
    if (!isRecord(data)) throw new Error(`TinyFish fetch error: no result for ${url}`);

    const results = Array.isArray(data.results) ? data.results : [];
    const match = results.find((entry) => isRecord(entry) && entry.url === url);
    if (match && typeof match.text === "string") {
      return {
        text: match.text,
        title: typeof match.title === "string" ? match.title : undefined,
        contentType: "text/markdown",
      };
    }

    const errors = Array.isArray(data.errors) ? data.errors : [];
    const errorMatch = errors.find(
      (entry) => isRecord(entry) && entry.url === url && typeof entry.error === "string",
    );
    if (errorMatch) {
      throw new Error(`TinyFish fetch error: ${errorMatch.error}`);
    }
    throw new Error(`TinyFish fetch error: no result for ${url}`);
  }
}

export const providerMeta: ProviderMeta = {
  name: "tinyfish",
  tier: 2,
  requiresKey: true,
  create: (key) => {
    const provider = new TinyFishProvider(key!);
    return { search: provider, fetch: provider };
  },
};
