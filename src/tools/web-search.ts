import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { SearchProvider, SearchResult } from "../providers/types.ts";
import { sanitizeError } from "../utils/errors.ts";

const WebSearchParams = Type.Object({
  query: Type.String({ description: "Search query" }),
  numResults: Type.Optional(
    Type.Number({
      minimum: 1,
      maximum: 20,
      default: 5,
      description: "Number of results (1-20, default 5)",
    }),
  ),
  provider: Type.Optional(
    Type.String({ description: "Provider name or 'auto' (default)" }),
  ),
});

interface WebSearchDetails {
  provider: string;
  resultCount: number;
}

function formatResults(results: SearchResult[]): string {
  if (results.length === 0) return "No results found.";
  return results
    .map((r, i) => `${i + 1}. [${r.title}](${r.url})\n   ${r.snippet}`)
    .join("\n\n");
}

export function createWebSearchTool(
  resolveProvider: (name?: string) => SearchProvider,
  onSuccess?: (providerName: string) => void,
): ToolDefinition<typeof WebSearchParams, WebSearchDetails> {
  return {
    name: "web_search",
    label: "Web Search",
    description: "Search the web for up-to-date information.",
    promptSnippet: "Search the web for up-to-date information.",
    promptGuidelines: [
      "Use web_search for information beyond training data -- recent events, current library versions, live API docs.",
      "After answering, include a Sources: section listing relevant URLs as markdown hyperlinks.",
      "Use one web_search call per search angle rather than batching multiple queries.",
    ],
    parameters: WebSearchParams,
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      try {
        const provider = resolveProvider(params.provider);
        const maxResults = params.numResults ?? 5;
        const results = await provider.search(
          params.query,
          maxResults,
          signal ?? undefined,
        );
        const text = formatResults(results);

        // Record successful usage for quota tracking (increment on success only)
        onSuccess?.(provider.name);

        return {
          content: [{ type: "text" as const, text }],
          details: { provider: provider.name, resultCount: results.length },
        };
      } catch (error) {
        const msg = sanitizeError(error);
        return {
          content: [{ type: "text" as const, text: `Search error: ${msg}` }],
          details: { provider: "unknown", resultCount: 0 },
        };
      }
    },
  };
}
