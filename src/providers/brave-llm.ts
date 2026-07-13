import { createHttpSearchProvider } from "./http-adapter.ts";
import { parseBraveLlmResults } from "./parsers.ts";
import type { ProviderMeta } from "./types.ts";

export const providerMeta: ProviderMeta = {
  name: "brave-llm",
  tier: 1,
  monthlyQuota: 2000,
  requiresKey: true,
  create: (key, providerConfig) => ({
    search: createHttpSearchProvider(key!, {
      name: "brave-llm",
      label: "Brave LLM Context",
      endpoint: "https://api.search.brave.com/res/v1/llm/context",
      method: "POST",
      buildHeaders: (apiKey) => ({
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      }),
      buildBody: (query) => {
        const body: Record<string, unknown> = { q: query };
        if (providerConfig?.tokenBudget !== undefined)
          body.maximum_number_of_tokens = providerConfig.tokenBudget;
        return body;
      },
      extractResults: parseBraveLlmResults,
    }),
  }),
};
