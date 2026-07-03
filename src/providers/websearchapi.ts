import { createHttpSearchProvider } from "./http-adapter.ts";
import type { ProviderMeta } from "./types.ts";

export const providerMeta: ProviderMeta = {
  name: "websearchapi",
  tier: 1,
  monthlyQuota: null,
  requiresKey: true,
  create: (key) => ({
    search: createHttpSearchProvider(key!, {
      name: "websearchapi",
      label: "WebSearchAPI",
      endpoint: "https://api.websearchapi.ai/ai-search",
      method: "POST",
      authPrefix: "Bearer ",
      buildBody: (query, maxResults) => ({ query, maxResults }),
      extractResults: (data) => {
        const d = data as { organic?: Array<{ title: string; url: string; description: string }> };
        return (d.organic ?? []).map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.description,
        }));
      },
    }),
  }),
};
