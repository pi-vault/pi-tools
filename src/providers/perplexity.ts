import { createHttpSearchProvider } from "./http-adapter.ts";
import { parsePerplexityResults } from "./parsers.ts";
import type { ProviderMeta } from "./types.ts";

export const providerMeta: ProviderMeta = {
  name: "perplexity",
  tier: 2,
  monthlyQuota: null,
  requiresKey: true,
  create: (key, providerConfig) => ({
    search: createHttpSearchProvider(key!, {
      name: "perplexity",
      label: "Perplexity Sonar",
      endpoint: "https://api.perplexity.ai/chat/completions",
      method: "POST",
      authPrefix: "Bearer ",
      buildBody: (query) => ({
        model: providerConfig?.model ?? "sonar",
        messages: [{ role: "user", content: query }],
      }),
      extractResults: parsePerplexityResults,
    }),
  }),
};
