import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { CodeSearchProvider, CodeSearchResult } from "../providers/types.ts";
import { sanitizeError } from "../utils/errors.ts";

const CodeSearchParams = Type.Object({
  query: Type.String({ description: "Code or technical documentation search query" }),
  numResults: Type.Optional(
    Type.Number({ minimum: 1, maximum: 10, default: 5, description: "Number of results (1-10, default 5)" }),
  ),
});

interface CodeSearchDetails {
  provider: string;
  resultCount: number;
}

function formatCodeResults(results: CodeSearchResult[]): string {
  if (results.length === 0) return "No code results found.";
  return results
    .map(
      (r, i) =>
        `${i + 1}. [${r.title}](${r.url})${r.language ? ` (${r.language})` : ""}\n   ${r.snippet}`,
    )
    .join("\n\n");
}

export function createCodeSearchTool(
  resolveProvider: () => CodeSearchProvider | undefined,
  onSuccess?: (providerName: string) => void,
): ToolDefinition<typeof CodeSearchParams, CodeSearchDetails> {
  return {
    name: "code_search",
    label: "Code Search",
    description:
      "Search code, library APIs, and technical documentation across the web.",
    promptSnippet:
      "Search code, library APIs, and technical documentation across the web.",
    promptGuidelines: [
      "Use code_search for finding code examples, library documentation, and API references.",
      "Prefer code_search over web_search for programming-related queries.",
    ],
    parameters: CodeSearchParams,
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const provider = resolveProvider();
      if (!provider) {
        return {
          content: [
            {
              type: "text" as const,
              text: "code_search requires an Exa API key. Set the EXA_API_KEY environment variable or configure it in ~/.pi/agent/extensions/pi-tools.json.",
            },
          ],
          details: { provider: "none", resultCount: 0 },
        };
      }

      try {
        const maxResults = params.numResults ?? 5;
        const results = await provider.codeSearch(params.query, maxResults, signal ?? undefined);
        const text = formatCodeResults(results);

        onSuccess?.(provider.name);

        return {
          content: [{ type: "text" as const, text }],
          details: { provider: provider.name, resultCount: results.length },
        };
      } catch (error) {
        const msg = sanitizeError(error);
        return {
          content: [{ type: "text" as const, text: `Code search error: ${msg}` }],
          details: { provider: provider.name, resultCount: 0 },
        };
      }
    },
  };
}
