import { createHttpSearchProvider } from "./http-adapter.ts";
import { parseOpenAINativeResults } from "./parsers.ts";
import type { ProviderMeta } from "./types.ts";

export const providerMeta: ProviderMeta = {
  name: "openai-native",
  tier: 1,
  monthlyQuota: null,
  requiresKey: true,
  create: (key) => ({
    search: createHttpSearchProvider(key!, {
      name: "openai-native",
      label: "OpenAI Web Search",
      endpoint: "https://api.openai.com/v1/responses",
      method: "POST",
      authPrefix: "Bearer ",
      buildBody: (query) => ({
        model: "gpt-4.1-nano",
        tools: [{ type: "web_search" }],
        tool_choice: "required",
        input: `Search the web for: ${query}`,
      }),
      extractResults: parseOpenAINativeResults,
    }),
  }),
};
