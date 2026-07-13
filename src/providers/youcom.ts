import { createHttpSearchProvider } from "./http-adapter.ts";
import { parseYouComResults } from "./parsers.ts";
import type { ProviderMeta } from "./types.ts";

export const providerMeta: ProviderMeta = {
  name: "youcom",
  tier: 2,
  monthlyQuota: null,
  requiresKey: true,
  create: (key) => ({
    search: createHttpSearchProvider(key!, {
      name: "youcom",
      label: "You.com",
      endpoint: (query, maxResults) => {
        const params = new URLSearchParams({
          query,
          num_web_results: String(Math.min(maxResults, 100)),
        });
        return `https://api.you.com/v1/search?${params}`;
      },
      method: "GET",
      buildHeaders: (apiKey) => ({ "X-API-Key": apiKey }),
      extractResults: parseYouComResults,
    }),
  }),
};
