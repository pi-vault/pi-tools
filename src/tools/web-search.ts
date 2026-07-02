import { Type } from "typebox";
import type { Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { SearchProvider, SearchResult } from "../providers/types.ts";
import { AggregateProviderError } from "../utils/errors.ts";

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
  resolveCandidates: (name?: string) => SearchProvider[],
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
      const candidates = resolveCandidates(params.provider);

      if (candidates.length === 0) {
        return {
          content: [{ type: "text" as const, text: "Search error: No search providers available" }],
          details: { provider: "none", resultCount: 0 },
        };
      }

      const maxResults = params.numResults ?? 5;
      const errors: Array<{ provider: string; error: string }> = [];

      for (const provider of candidates) {
        try {
          const results = await provider.search(
            params.query,
            maxResults,
            signal ?? undefined,
          );
          const text = formatResults(results);
          onSuccess?.(provider.name);

          return {
            content: [{ type: "text" as const, text }],
            details: { provider: provider.name, resultCount: results.length },
          };
        } catch (error) {
          errors.push({
            provider: provider.name,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const aggregate = new AggregateProviderError("search", errors);
      return {
        content: [{ type: "text" as const, text: `Search error: ${aggregate.message}` }],
        details: { provider: "none", resultCount: 0 },
      };
    },
    renderCall(args, theme: Theme, context) {
      const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
      if (!context.argsComplete) {
        text.setText(theme.fg("warning", "Searching..."));
        return text;
      }
      const q = args.query.length > 70 ? `${args.query.slice(0, 67)}...` : args.query;
      text.setText(
        `${theme.fg("toolTitle", theme.bold("web_search"))} ${theme.fg("accent", `"${q}"`)}`,
      );
      return text;
    },
    renderResult(result, options, theme: Theme, context) {
      const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
      if (context.isPartial) {
        text.setText(theme.fg("warning", "Searching..."));
        return text;
      }
      const count = result.details?.resultCount ?? 0;
      const provider = result.details?.provider ?? "unknown";
      if (options.expanded) {
        const raw =
          result.content[0] && "text" in result.content[0] ? result.content[0].text : "";
        const lines = raw.split("\n").slice(0, 15);
        text.setText(lines.map((l) => theme.fg("toolOutput", l)).join("\n"));
      } else {
        text.setText(theme.fg("toolOutput", `${count} results via ${provider}`));
      }
      return text;
    },
  };
}


