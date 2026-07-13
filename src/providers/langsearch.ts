import { createHttpSearchProvider } from "./http-adapter.ts";
import { parseLangSearchResults } from "./parsers.ts";
import type { ProviderMeta } from "./types.ts";

export const providerMeta: ProviderMeta = {
  name: "langsearch",
  tier: 2,
  monthlyQuota: null,
  requiresKey: true,
  create: (key) => ({
    search: createHttpSearchProvider(key!, {
      name: "langsearch",
      label: "LangSearch",
      endpoint: "https://api.langsearch.com/v1/web-search",
      method: "POST",
      authPrefix: "Bearer ",
      buildBody: (query, maxResults) => ({
        query,
        max_results: Math.min(maxResults, 20),
      }),
      extractResults: parseLangSearchResults,
    }),
  }),
};
