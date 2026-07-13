import { parseSofyaResults } from "./parsers.ts";
import type {
  FetchProvider,
  FetchResult,
  ProviderMeta,
  SearchFilters,
  SearchProvider,
  SearchResult,
} from "./types.ts";

const SOFYA_BASE = "https://sofya.co";

class SofyaProvider implements SearchProvider, FetchProvider {
  readonly name = "sofya";
  readonly label = "Sofya";
  private readonly apiKey: string;
  private readonly searchDepth: string;
  private readonly topic: string;

  constructor(apiKey: string, searchDepth?: string, topic?: string) {
    this.apiKey = apiKey;
    this.searchDepth = searchDepth ?? "basic";
    this.topic = topic ?? "general";
  }

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
    _filters?: SearchFilters,
  ): Promise<SearchResult[]> {
    const response = await fetch(`${SOFYA_BASE}/v1/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        query,
        search_depth: this.searchDepth,
        max_results: Math.min(maxResults, 20),
        include_answer: false,
        topic: this.topic,
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(
        `Sofya API error: ${response.status} ${response.statusText}`,
      );
    }

    const data: unknown = await response.json();
    return parseSofyaResults(data).slice(0, maxResults);
  }

  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult> {
    const response = await fetch(`${SOFYA_BASE}/v1/fetch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ urls: [url], include_raw_html: false }),
      signal,
    });

    if (!response.ok) {
      throw new Error(
        `Sofya fetch error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      results?: Array<{ content?: string; title?: string }>;
    };
    const first = data.results?.[0];
    return { text: first?.content ?? "", title: first?.title };
  }
}

export const providerMeta: ProviderMeta = {
  name: "sofya",
  tier: 2,
  monthlyQuota: null,
  requiresKey: true,
  create: (key, providerConfig) => {
    const cfg = providerConfig as any;
    const p = new SofyaProvider(key!, cfg?.searchDepth, cfg?.topic);
    return { search: p, fetch: p };
  },
};
