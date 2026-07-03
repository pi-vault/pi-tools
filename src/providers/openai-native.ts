import { createHttpSearchProvider } from "./http-adapter.ts";
import type { ProviderMeta } from "./types.ts";

interface UrlCitation {
  type: "url_citation";
  url: string;
  title: string;
}

interface OutputText {
  type: "output_text";
  text: string;
  annotations?: UrlCitation[];
}

interface MessageOutput {
  type: "message";
  role: string;
  content: OutputText[];
}

type OutputItem = MessageOutput | { type: string };

interface OpenAIResponsesResult {
  id: string;
  output: OutputItem[];
}

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
      authHeader: "Authorization",
      authPrefix: "Bearer ",
      buildBody: (query) => ({
        model: "gpt-4.1-nano",
        tools: [{ type: "web_search" }],
        tool_choice: "required",
        input: `Search the web for: ${query}`,
      }),
      extractResults: (raw) => {
        const data = raw as OpenAIResponsesResult;
        const messageOutput = data.output.find(
          (item): item is MessageOutput => item.type === "message",
        );
        if (!messageOutput) return [];
        const textContent = messageOutput.content?.find(
          (c): c is OutputText => c.type === "output_text",
        );
        if (!textContent?.annotations?.length) return [];

        // Deduplicate by URL, preserving order
        const seen = new Set<string>();
        const results: Array<{ title: string; url: string; snippet: string }> = [];
        for (const ann of textContent.annotations) {
          if (ann.type !== "url_citation") continue;
          if (seen.has(ann.url)) continue;
          seen.add(ann.url);
          results.push({ title: ann.title, url: ann.url, snippet: "" });
        }
        return results;
      },
    }),
  }),
};
