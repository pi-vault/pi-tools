import { Type } from "typebox";
import type { Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { DocsProvider, DocsSearchResult } from "../providers/types.ts";
import type { GuidanceOverride } from "../config.ts";

const MAX_SEARCH_RESULTS = 10;
const MAX_DESCRIPTION_CHARS = 120;
const MAX_VERSION_COUNT = 5;

const WebDocsSearchParams = Type.Object({
  libraryName: Type.String({
    description:
      "Library name to search for (e.g. 'react', 'next.js', 'express')",
  }),
  query: Type.String({
    description: "What you are trying to do — used for relevance ranking",
  }),
});

interface WebDocsSearchDetails {
  provider: string;
  resultCount: number;
  libraryName: string;
}

function escapeMd(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function truncateCell(text: string, maxChars: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, maxChars - 1).trimEnd()}…`;
}

function formatVersions(versions?: string[]): string {
  if (!versions?.length) return "";
  const visible = versions.slice(0, MAX_VERSION_COUNT);
  const hidden = versions.length - visible.length;
  return `${visible.join(", ")}${hidden > 0 ? `, +${hidden}` : ""}`;
}

function formatResultsTable(
  libraryName: string,
  results: DocsSearchResult[],
): string {
  if (results.length === 0) {
    return `No libraries found for "${libraryName}". Try a different search term.`;
  }

  const visible = results.slice(0, MAX_SEARCH_RESULTS);
  const hidden = results.length - visible.length;
  const noun = results.length === 1 ? "library" : "libraries";

  const headerLine =
    `Found ${results.length} Context7 ${noun} for "${libraryName}"` +
    (hidden > 0 ? `; showing top ${visible.length}` : "") +
    ":";

  const header = "| ID | Name | Trust | Bench | Snippets | Versions | Description |";
  const separator = "|---|---|---|---|---|---|---|";
  const rows = visible.map((r) => {
    const cells = [
      `\`${escapeMd(r.id)}\``,
      escapeMd(r.name),
      String(r.trustScore ?? ""),
      String(r.benchmarkScore ?? ""),
      String(r.totalSnippets ?? ""),
      escapeMd(formatVersions(r.versions)),
      escapeMd(truncateCell(r.description ?? "", MAX_DESCRIPTION_CHARS)),
    ];
    return `| ${cells.join(" | ")} |`;
  });

  const hiddenNote =
    hidden > 0
      ? [`_${hidden} more omitted; refine \`libraryName\` or \`query\` if needed._`, ""]
      : [];

  return [
    headerLine,
    "",
    header,
    separator,
    ...rows,
    "",
    ...hiddenNote,
    "> Use `web_docs_fetch` with the chosen ID.",
  ].join("\n");
}

export function createWebDocsSearchTool(
  resolveProvider: () => DocsProvider | undefined,
  guidance?: GuidanceOverride,
): ToolDefinition<typeof WebDocsSearchParams, WebDocsSearchDetails> {
  return {
    name: "web_docs_search",
    label: "Docs Search",
    description:
      "Search for library documentation. Returns matching libraries you can query with web_docs_fetch.",
    promptSnippet:
      guidance?.promptSnippet ??
      "Search for library documentation by name. Use the returned library ID with web_docs_fetch.",
    promptGuidelines: guidance?.promptGuidelines ?? [
      "Use web_docs_search to find library IDs before calling web_docs_fetch.",
      "Prefer web_docs_search + web_docs_fetch over web_search for library/framework documentation.",
    ],
    parameters: WebDocsSearchParams,
    async execute(_toolCallId, params, signal, onUpdate, _ctx) {
      const libraryName = params.libraryName?.trim();
      const query = params.query?.trim();

      if (!libraryName) throw new Error("'libraryName' parameter is required");
      if (!query) throw new Error("'query' parameter is required");

      const provider = resolveProvider();
      if (!provider) {
        return {
          content: [
            {
              type: "text" as const,
              text: "web_docs_search requires a Context7 API key. Set the CONTEXT7_API_KEY environment variable or configure it in ~/.pi/agent/extensions/tools.json under providers.context7.apiKey.",
            },
          ],
          details: { provider: "none", resultCount: 0, libraryName },
        };
      }

      onUpdate?.({
        content: [{ type: "text" as const, text: `Searching Context7 for "${libraryName}"...` }],
        details: { provider: provider.name, resultCount: 0, libraryName },
      });

      const results = await provider.searchLibrary(
        libraryName,
        query,
        signal ?? undefined,
      );
      const text = formatResultsTable(libraryName, results);

      return {
        content: [{ type: "text" as const, text }],
        details: { provider: provider.name, resultCount: results.length, libraryName },
      };
    },
    renderCall(args, theme: Theme, context) {
      const text =
        context.lastComponent instanceof Text
          ? context.lastComponent
          : new Text("", 0, 0);
      if (!context.argsComplete) {
        text.setText(theme.fg("warning", "Searching docs..."));
        return text;
      }
      const lib =
        args.libraryName.length > 40
          ? `${args.libraryName.slice(0, 37)}...`
          : args.libraryName;
      text.setText(
        `${theme.fg("toolTitle", theme.bold("web_docs_search"))} ${theme.fg("accent", `"${lib}"`)}`,
      );
      return text;
    },
    renderResult(result, options, theme: Theme, context) {
      const text =
        context.lastComponent instanceof Text
          ? context.lastComponent
          : new Text("", 0, 0);
      if (context.isPartial) {
        text.setText(theme.fg("warning", "Searching docs..."));
        return text;
      }
      const count = result.details?.resultCount ?? 0;
      if (options.expanded) {
        const raw =
          result.content[0] && "text" in result.content[0]
            ? result.content[0].text
            : "";
        const lines = raw.split("\n").slice(0, 12);
        text.setText(lines.map((l) => theme.fg("toolOutput", l)).join("\n"));
      } else {
        text.setText(
          theme.fg(
            "toolOutput",
            `${count} ${count === 1 ? "library" : "libraries"} found`,
          ),
        );
      }
      return text;
    },
  };
}
