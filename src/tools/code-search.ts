import { Type } from "typebox";
import type { Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { CodeSearchProvider, CodeSearchResult } from "../providers/types.ts";
import { sanitizeError } from "../utils/errors.ts";
import type { GuidanceOverride } from "../config.ts";

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
  guidance?: GuidanceOverride,
): ToolDefinition<typeof CodeSearchParams, CodeSearchDetails> {
  return {
    name: "code_search",
    label: "Code Search",
    description:
      "Search code, library APIs, and technical documentation across the web.",
    promptSnippet: guidance?.promptSnippet ??
      "Search code, library APIs, and technical documentation across the web.",
    promptGuidelines: guidance?.promptGuidelines ?? [
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
    renderCall(args, theme: Theme, context) {
      const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
      if (!context.argsComplete) {
        text.setText(theme.fg("warning", "Searching code..."));
        return text;
      }
      const q = args.query.length > 70 ? `${args.query.slice(0, 67)}...` : args.query;
      text.setText(
        `${theme.fg("toolTitle", theme.bold("code_search"))} ${theme.fg("accent", `"${q}"`)}`,
      );
      return text;
    },
    renderResult(result, options, theme: Theme, context) {
      const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
      if (context.isPartial) {
        text.setText(theme.fg("warning", "Searching code..."));
        return text;
      }
      const count = result.details?.resultCount ?? 0;
      if (options.expanded) {
        const raw =
          result.content[0] && "text" in result.content[0] ? result.content[0].text : "";
        const lines = raw.split("\n").slice(0, 15);
        text.setText(lines.map((l) => theme.fg("toolOutput", l)).join("\n"));
      } else {
        text.setText(theme.fg("toolOutput", `${count} code results`));
      }
      return text;
    },
  };
}
