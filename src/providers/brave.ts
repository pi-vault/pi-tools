// src/providers/brave.ts
import type { SearchFilters, SearchProvider, SearchResult } from "./types.ts";
import { applyDomainFilters } from "../utils/filters.ts";

interface BraveSearchResponse {
  web?: {
    results: Array<{
      title: string;
      url: string;
      description: string;
    }>;
  };
}

export class BraveProvider implements SearchProvider {
  readonly name = "brave";
  readonly label = "Brave Search";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
    filters?: SearchFilters,
  ): Promise<SearchResult[]> {
    const effectiveQuery = applyDomainFilters(query, filters);

    const params = new URLSearchParams({
      q: effectiveQuery,
      count: String(maxResults),
    });

    const freshness = buildFreshness(filters);
    if (freshness) {
      params.set("freshness", freshness);
    }

    const url = `https://api.search.brave.com/res/v1/web/search?${params.toString()}`;
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": this.apiKey,
      },
      signal,
    });

    if (!response.ok) {
      throw new Error(`Brave API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as BraveSearchResponse;
    return (data.web?.results ?? []).slice(0, maxResults).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
    }));
  }
}

function buildFreshness(filters?: SearchFilters): string | null {
  if (!filters) return null;
  if (!filters.startDate && !filters.endDate) return null;
  return `${filters.startDate ?? ""}to${filters.endDate ?? ""}`;
}
