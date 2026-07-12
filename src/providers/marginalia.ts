import { createHttpSearchProvider } from "./http-adapter.ts";
import { parseMarginaliaResults } from "./parsers.ts";
import type { ProviderMeta } from "./types.ts";

export const providerMeta: ProviderMeta = {
  name: "marginalia",
  tier: 3,
  monthlyQuota: null,
  requiresKey: false,
  create: (key) => ({
    search: createHttpSearchProvider(key ?? "public", {
      name: "marginalia",
      label: "Marginalia Search",
      endpoint: (query, maxResults) => {
        const params = new URLSearchParams({
          query,
          count: String(Math.min(maxResults, 100)),
        });
        return `https://api2.marginalia-search.com/search?${params}`;
      },
      method: "GET",
      buildHeaders: (apiKey) => ({
        Accept: "application/json",
        "API-Key": apiKey,
      }),
      extractResults: parseMarginaliaResults,
    }),
  }),
};
