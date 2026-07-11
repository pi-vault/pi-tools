import { Type } from "typebox";
import type { Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { SearchFilters, SearchProvider, SearchResult } from "../providers/types.ts";
import { executeWithFallback } from "../providers/execute.ts";
import type { GuidanceOverride, CombineConfig } from "../config.ts";
import { executeWithFusion } from "../providers/fusion.ts";
import type { FusedResult } from "../providers/fusion.ts";

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
  combine: Type.Optional(
    Type.Boolean({
      description:
        "Override fusion setting: true to fuse multiple providers, false for single-provider fallback",
    }),
  ),
});

interface WebSearchDetails {
  provider: string;
  resultCount: number;
  fusionMeta?: {
    providersUsed: string[];
    degraded: boolean;
    results: Array<{ url: string; providers: string[] }>;
  };
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

function formatFusionOutput(
  results: SearchResult[],
  fusionResult: { providersUsed: string[]; degraded: boolean; results: FusedResult[] },
  compact: boolean,
): string {
  const lines: string[] = [];
  if (fusionResult.degraded) {
    lines.push(
      `Warning: Only ${fusionResult.providersUsed.length} of target providers responded (quota exhaustion)`,
    );
  }
  if (results.length === 0) {
    lines.push("No results found.");
    return lines.join("\n");
  }
  lines.push(compact ? formatResultsCompact(results) : formatResults(results));
  return lines.join("\n");
}

export function createWebSearchTool(
  resolveCandidates: (name?: string, combine?: boolean) => SearchProvider[],
  onSuccess?: (providerName: string, latencyMs: number) => void,
  guidance?: GuidanceOverride,
  onFailure?: (providerName: string) => void,
  onResult?: (providerName: string, resultCount: number, requestedCount: number) => void,
  combineConfig?: CombineConfig,
): ToolDefinition<typeof WebSearchParams, WebSearchDetails> {
  return {
    name: "web_search",
    label: "Web Search",
    description: "Search the web for up-to-date information.",
    promptSnippet: guidance?.promptSnippet ?? "Search the web for up-to-date information.",
    promptGuidelines: guidance?.promptGuidelines ?? [
      "Use web_search for information beyond training data -- recent events, current library versions, live API docs.",
      "After answering, include a Sources: section listing relevant URLs as markdown hyperlinks.",
      "Use one web_search call per search angle rather than batching multiple queries.",
    ],
    parameters: WebSearchParams,
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const combineActive = params.combine ?? (combineConfig?.enabled === true);
      const candidates = resolveCandidates(params.provider, combineActive);

      if (candidates.length === 0) {
        return {
          content: [{ type: "text" as const, text: "Search error: No search providers available" }],
          details: { provider: "none", resultCount: 0 },
        };
      }

      const maxResults = params.numResults ?? 5;
      const filters = buildFilters(params);

      // Fusion path
      if (combineActive && candidates.length > 1 && combineConfig) {
        try {
          const fusionResult = await executeWithFusion({
            candidates: candidates.map((provider) => ({
              name: provider.name,
              execute: (n: number) =>
                provider.search(params.query, n, signal ?? undefined, filters),
            })),
            maxResults,
            mode: combineConfig.mode,
            targetBackends: combineConfig.targetBackends,
            k: combineConfig.k,
            onSuccess,
            onFailure,
          });

          for (const pr of fusionResult.providersUsed) {
            const providerResultCount = fusionResult.results.filter((f) =>
              f.providers.includes(pr),
            ).length;
            onResult?.(pr, providerResultCount, maxResults);
          }

          const searchResults = fusionResult.results.map((f) => f.result);
          const text = formatFusionOutput(searchResults, fusionResult, params.compact ?? false);

          return {
            content: [{ type: "text" as const, text }],
            details: {
              provider: "fusion",
              resultCount: fusionResult.results.length,
              fusionMeta: {
                providersUsed: fusionResult.providersUsed,
                degraded: fusionResult.degraded,
                results: fusionResult.results.map((f) => ({
                  url: f.result.url,
                  providers: f.providers,
                })),
              },
            },
          };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text" as const, text: `Search error: ${msg}` }],
            details: { provider: "none", resultCount: 0 },
          };
        }
      }

      // Fallback path
      try {
        const { result: results, providerName } = await executeWithFallback({
          candidates: candidates.map((provider) => ({
            name: provider.name,
            execute: () => provider.search(params.query, maxResults, signal ?? undefined, filters),
          })),
          operation: "search",
          onSuccess,
          onFailure,
        });

        onResult?.(providerName, results.length, maxResults);

        const text = params.compact
          ? formatResultsCompact(results)
          : formatResults(results);

        return {
          content: [{ type: "text" as const, text }],
          details: { provider: providerName, resultCount: results.length },
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Search error: ${msg}` }],
          details: { provider: "none", resultCount: 0 },
        };
      }
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

        if (result.details?.fusionMeta) {
          const meta = result.details.fusionMeta;
          const header = meta.degraded
            ? theme.fg("warning", `${count} results fused (degraded) from ${meta.providersUsed.join(", ")}`)
            : theme.fg("toolOutput", `${count} results fused from ${meta.providersUsed.join(", ")}`);
          const resultLines = raw.split("\n").slice(0, 15).map((line) => {
            const match = meta.results.find((r) => line.includes(r.url));
            if (match) return theme.fg("toolOutput", `${line}  [${match.providers.join(", ")}]`);
            return theme.fg("toolOutput", line);
          });
          text.setText([header, ...resultLines].join("\n"));
        } else {
          const lines = raw.split("\n").slice(0, 15);
          text.setText(lines.map((l) => theme.fg("toolOutput", l)).join("\n"));
        }
      } else {
        if (result.details?.fusionMeta) {
          const meta = result.details.fusionMeta;
          const status = meta.degraded
            ? `${count} results fused (degraded) from ${meta.providersUsed.join(", ")}`
            : `${count} results fused from ${meta.providersUsed.join(", ")}`;
          text.setText(theme.fg("toolOutput", status));
        } else {
          text.setText(theme.fg("toolOutput", `${count} results via ${provider}`));
        }
      }
      return text;
    },
  };
}
