import { Type } from "typebox";
import type { Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { SearchFilters, SearchProvider, SearchResult } from "../providers/types.ts";
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
  includeDomains: Type.Optional(
    Type.Array(Type.String(), {
      description: "Only return results from these domains",
    }),
  ),
  excludeDomains: Type.Optional(
    Type.Array(Type.String(), {
      description: "Exclude results from these domains",
    }),
  ),
  startDate: Type.Optional(
    Type.String({
      description: "Only return results published after this date (ISO 8601, e.g. 2025-01-01)",
    }),
  ),
  endDate: Type.Optional(
    Type.String({
      description: "Only return results published before this date (ISO 8601, e.g. 2025-12-31)",
    }),
  ),
  compact: Type.Optional(
    Type.Boolean({
      description: "When true, return results in compact single-line format (title -- URL, no snippets)",
    }),
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

function formatResultsCompact(results: SearchResult[]): string {
  if (results.length === 0) return "No results found.";
  return results
    .map((r, i) => `${i + 1}. ${r.title} -- ${r.url}`)
    .join("\n");
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function buildFilters(params: {
  includeDomains?: string[];
  excludeDomains?: string[];
  startDate?: string;
  endDate?: string;
}): SearchFilters | undefined {
  const includeDomains = params.includeDomains?.filter((d) => d.trim().length > 0);
  const excludeDomains = params.excludeDomains?.filter((d) => d.trim().length > 0);
  const startDate = params.startDate && ISO_DATE_RE.test(params.startDate) ? params.startDate : undefined;
  const endDate = params.endDate && ISO_DATE_RE.test(params.endDate) ? params.endDate : undefined;

  if (!includeDomains?.length && !excludeDomains?.length && !startDate && !endDate) return undefined;

  return {
    includeDomains: includeDomains?.length ? includeDomains : undefined,
    excludeDomains: excludeDomains?.length ? excludeDomains : undefined,
    startDate,
    endDate,
  };
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
      const filters = buildFilters(params);
      const errors: Array<{ provider: string; error: string }> = [];

      for (const provider of candidates) {
        try {
          const results = await provider.search(
            params.query,
            maxResults,
            signal ?? undefined,
            filters,
          );
          const text = params.compact
            ? formatResultsCompact(results)
            : formatResults(results);
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
