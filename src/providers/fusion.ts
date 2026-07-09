import type { SearchResult } from "./types.ts";

export interface ProviderResults {
  providerName: string;
  results: SearchResult[];
}

export interface FusedResult {
  result: SearchResult;
  rrfScore: number;
  providers: string[];
}

const DEFAULT_K = 60;

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString().toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export function reciprocalRankFusion(
  providerResults: ProviderResults[],
  maxResults: number,
  k: number = DEFAULT_K,
): FusedResult[] {
  const urlMap = new Map<
    string,
    { rrfScore: number; result: SearchResult; providers: string[] }
  >();

  for (const { providerName, results } of providerResults) {
    for (let rank = 0; rank < results.length; rank++) {
      const r = results[rank];
      const key = normalizeUrl(r.url);
      const rrfContribution = 1 / (k + rank + 1);

      const existing = urlMap.get(key);
      if (existing) {
        existing.rrfScore += rrfContribution;
        existing.providers.push(providerName);
        // Keep result with longer snippet
        const existingLen = existing.result.snippet.length;
        const newLen = r.snippet.length;
        if (newLen > existingLen) {
          existing.result = r;
        }
      } else {
        urlMap.set(key, {
          rrfScore: rrfContribution,
          result: r,
          providers: [providerName],
        });
      }
    }
  }

  return Array.from(urlMap.values())
    .sort((a, b) => {
      if (b.rrfScore !== a.rrfScore) return b.rrfScore - a.rrfScore;
      return b.providers.length - a.providers.length;
    })
    .slice(0, maxResults);
}
