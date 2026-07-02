// src/providers/serper.ts
import type { SearchFilters, SearchProvider, SearchResult } from "./types.ts";
import { applyDomainFilters } from "../utils/filters.ts";

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

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
    filters?: SearchFilters,
  ): Promise<SearchResult[]> {
    const effectiveQuery = applyDomainFilters(query, filters);

    const body: Record<string, unknown> = {
      q: effectiveQuery,
      num: maxResults,
    };

    const tbs = buildTbs(filters);
    if (tbs) {
      body.tbs = tbs;
    }

    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": this.apiKey,
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) throw new Error(`Serper API error: ${response.status} ${response.statusText}`);
    const data = (await response.json()) as SerperResponse;
    return (data.organic ?? []).slice(0, maxResults).map((r) => ({
      title: r.title, url: r.link, snippet: r.snippet,
    }));
  }
}

/**
 * Builds a Google `tbs` (time-based search) parameter string.
 * Format: cdr:1,cd_min:MM/DD/YYYY,cd_max:MM/DD/YYYY
 */
function buildTbs(filters?: SearchFilters): string | null {
  if (!filters) return null;
  if (!filters.startDate && !filters.endDate) return null;

  const min = filters.startDate ? isoToMDY(filters.startDate) : "";
  const max = filters.endDate ? isoToMDY(filters.endDate) : "";
  return `cdr:1,cd_min:${min},cd_max:${max}`;
}

/** Converts "YYYY-MM-DD" to "MM/DD/YYYY" for Google's tbs format. */
function isoToMDY(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${month}/${day}/${year}`;
}
