import { createHttpSearchProvider } from "./http-adapter.ts";
import { applyDomainFilters } from "../utils/filters.ts";
import type { ProviderMeta, SearchFilters } from "./types.ts";

function buildFreshness(filters?: SearchFilters): string | null {
  if (!filters) return null;
  if (!filters.startDate && !filters.endDate) return null;
  return `${filters.startDate ?? ""}to${filters.endDate ?? ""}`;
}

export const providerMeta: ProviderMeta = {
  name: "brave",
  tier: 1,
  monthlyQuota: 2000,
  requiresKey: true,
  create: (key) => ({
    search: createHttpSearchProvider(key!, {
      name: "brave",
      label: "Brave Search",
      endpoint: (query, maxResults, filters) => {
        const params = new URLSearchParams({
          q: applyDomainFilters(query, filters),
          count: String(maxResults),
        });
        const freshness = buildFreshness(filters);
        if (freshness) params.set("freshness", freshness);
        return `https://api.search.brave.com/res/v1/web/search?${params.toString()}`;
      },
      method: "GET",
      buildHeaders: (apiKey) => ({
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      }),
      extractResults: (data) => {
        const d = data as {
          web?: { results: Array<{ title: string; url: string; description: string }> };
        };
        return (d.web?.results ?? []).map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.description,
        }));
      },
    }),
  }),
};
