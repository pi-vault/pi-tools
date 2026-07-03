import { createHttpSearchProvider } from "./http-adapter.ts";
import type { ProviderMeta } from "./types.ts";

export const providerMeta: ProviderMeta = {
  name: "perplexity",
  tier: 2,
  monthlyQuota: null,
  requiresKey: true,
  create: (key) => ({
    search: createHttpSearchProvider(key!, {
      name: "perplexity",
      label: "Perplexity Sonar",
      endpoint: "https://api.perplexity.ai/chat/completions",
      method: "POST",
      authPrefix: "Bearer ",
      buildBody: (query) => ({
        model: "sonar",
        messages: [{ role: "user", content: query }],
      }),
      extractResults: (data) => {
        const d = data as {
          choices?: Array<{ message?: { content?: string } }>;
          citations?: string[];
        };
        const answer = d.choices?.[0]?.message?.content ?? "";
        const citations = d.citations ?? [];
        if (!answer) return [];
        return [
          { title: "Perplexity Answer", url: "", snippet: answer },
          ...citations.map((url) => ({ title: url, url, snippet: "" })),
        ];
      },
    }),
  }),
};
