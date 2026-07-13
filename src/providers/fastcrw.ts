import { createHttpSearchProvider } from "./http-adapter.ts";
import { parseFastcrwResults } from "./parsers.ts";
import type { ProviderMeta } from "./types.ts";

export const providerMeta: ProviderMeta = {
  name: "fastcrw",
  tier: 2,
  monthlyQuota: 500,
  requiresKey: true,
  create: (key, providerConfig) => ({
    search: createHttpSearchProvider(key!, {
      name: "fastcrw",
      label: "fastCRW",
      endpoint: `${providerConfig?.baseUrl ?? "https://api.fastcrw.com"}/v1/search`,
      method: "POST",
      authPrefix: "Bearer ",
      buildBody: (query, maxResults) => ({
        query,
        limit: Math.min(maxResults, 20),
      }),
      extractResults: parseFastcrwResults,
    }),
  }),
};
