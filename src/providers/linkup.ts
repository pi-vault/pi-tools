import { createHttpSearchProvider } from "./http-adapter.ts";
import { parseLinkupResults } from "./parsers.ts";
import type { ProviderMeta } from "./types.ts";

export const providerMeta: ProviderMeta = {
  name: "linkup",
  tier: 2,
  monthlyQuota: null,
  requiresKey: true,
  create: (key, providerConfig) => ({
    search: createHttpSearchProvider(key!, {
      name: "linkup",
      label: "Linkup",
      endpoint: "https://api.linkup.so/v1/search",
      method: "POST",
      authPrefix: "Bearer ",
      buildBody: (query) => ({
        query,
        outputType: "searchResults",
        depth: (providerConfig as any)?.depth ?? "standard",
      }),
      extractResults: parseLinkupResults,
    }),
  }),
};
