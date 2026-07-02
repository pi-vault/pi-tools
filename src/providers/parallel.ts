// src/providers/parallel.ts
import type {
  FetchProvider,
  FetchResult,
  SearchFilters,
  SearchProvider,
  SearchResult,
} from "./types.ts";

const PARALLEL_SEARCH_ENDPOINT = "https://api.parallel.ai/v1/search";
const PARALLEL_EXTRACT_ENDPOINT = "https://api.parallel.ai/v1/extract";

interface ParallelSearchResponse {
  search_id: string;
  results: Array<{
    url: string;
    title: string;
    excerpts: string[];
    publish_date?: string;
  }>;
  session_id: string;
}

interface ParallelExtractResponse {
  extract_id: string;
  results: Array<{
    url: string;
    title?: string;
    excerpts?: string[];
    full_content?: string;
  }>;
  session_id: string;
}

export class ParallelProvider implements SearchProvider, FetchProvider {
  readonly name = "parallel";
  readonly label = "Parallel";
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
    _filters?: SearchFilters,
  ): Promise<SearchResult[]> {
    const response = await fetch(PARALLEL_SEARCH_ENDPOINT, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        search_queries: [query],
        objective: query,
        mode: "basic",
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(
        `Parallel search error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as ParallelSearchResponse;
    return (data.results ?? []).slice(0, maxResults).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.excerpts.join(" "),
    }));
  }

  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult> {
    const response = await fetch(PARALLEL_EXTRACT_ENDPOINT, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ urls: [url], full_content: true }),
      signal,
    });

    if (!response.ok) {
      throw new Error(
        `Parallel extract error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as ParallelExtractResponse;
    const result = data.results?.[0];
    if (!result) {
      throw new Error(`Parallel extract error: no results for ${url}`);
    }

    return {
      text: result.full_content ?? result.excerpts?.join("\n\n") ?? "",
      title: result.title,
    };
  }
}
