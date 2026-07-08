import { Type } from "typebox";
import type { Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { DocsProvider } from "../providers/types.ts";
import type { ContentStore } from "../storage.ts";
import { truncateContent } from "../utils/truncate.ts";
import type { GuidanceOverride } from "../config.ts";

const INLINE_LIMIT = 15_000;

const WebDocsFetchParams = Type.Object({
  libraryId: Type.String({
    description:
      "Context7 library ID (e.g. '/facebook/react', '/vercel/next.js@v15.1.8')",
  }),
  query: Type.String({
    description:
      "Specific question about the library (drives relevance ranking)",
  }),
});

interface WebDocsFetchDetails {
  provider: string;
  libraryId: string;
  chars: number;
  truncated: boolean;
  contentId?: string;
}

export function createWebDocsFetchTool(
  resolveProvider: () => DocsProvider | undefined,
  store: ContentStore,
  guidance?: GuidanceOverride,
): ToolDefinition<typeof WebDocsFetchParams, WebDocsFetchDetails> {
  return {
    name: "web_docs_fetch",
    label: "Docs Fetch",
    description:
      "Retrieve up-to-date documentation for a specific library via Context7.",
    promptSnippet:
      guidance?.promptSnippet ??
      "Retrieve focused documentation for a library. Use web_docs_search first to find the library ID.",
    promptGuidelines: guidance?.promptGuidelines ?? [
      "Use web_docs_fetch after web_docs_search to get documentation for a specific library.",
      "Always provide a specific question in the query parameter for best results.",
      "Pin a version with /owner/repo@version for consistent results.",
    ],
    parameters: WebDocsFetchParams,
    async execute(_toolCallId, params, signal, onUpdate, _ctx) {
      const libraryId = params.libraryId?.trim();
      const query = params.query?.trim();

      if (!libraryId) throw new Error("'libraryId' parameter is required");
      if (!query) throw new Error("'query' parameter is required");

      const provider = resolveProvider();
      if (!provider) {
        return {
          content: [
            {
              type: "text" as const,
              text: "web_docs_fetch requires a Context7 API key. Set the CONTEXT7_API_KEY environment variable or configure it in ~/.pi/agent/extensions/tools.json under providers.context7.apiKey.",
            },
          ],
          details: {
            provider: "none",
            libraryId,
            chars: 0,
            truncated: false,
          },
        };
      }

      onUpdate?.({
        content: [{ type: "text" as const, text: `Fetching Context7 docs for ${libraryId}...` }],
        details: { provider: provider.name, libraryId, chars: 0, truncated: false },
      });

      const text = await provider.getContext(libraryId, query, signal ?? undefined);
      const chars = text.length;
      let outputText: string;
      let contentId: string | undefined;
      let truncated = false;

      if (chars > INLINE_LIMIT) {
        contentId = store.store({
          url: `context7://${libraryId}`,
          title: `Docs: ${libraryId}`,
          text,
          source: "web_docs_fetch",
        });
        outputText = truncateContent(text, INLINE_LIMIT);
        truncated = true;
      } else {
        outputText = text;
      }

      const header = truncated
        ? `Docs: ${libraryId} (${chars} chars, truncated — use web_read with contentId "${contentId}" for full text)\n\n`
        : "";

      return {
        content: [{ type: "text" as const, text: header + outputText }],
        details: {
          provider: provider.name,
          libraryId,
          chars,
          truncated,
          contentId,
        },
      };
    },
    renderCall(args, theme: Theme, context) {
      const text =
        context.lastComponent instanceof Text
          ? context.lastComponent
          : new Text("", 0, 0);
      if (!context.argsComplete) {
        text.setText(theme.fg("warning", "Fetching docs..."));
        return text;
      }
      const lib =
        args.libraryId.length > 30
          ? `${args.libraryId.slice(0, 27)}...`
          : args.libraryId;
      const q =
        args.query.length > 40 ? `${args.query.slice(0, 37)}...` : args.query;
      text.setText(
        `${theme.fg("toolTitle", theme.bold("web_docs_fetch"))} ${theme.fg("accent", lib)} ${theme.fg("dim", `"${q}"`)}`,
      );
      return text;
    },
    renderResult(result, options, theme: Theme, context) {
      const text =
        context.lastComponent instanceof Text
          ? context.lastComponent
          : new Text("", 0, 0);
      if (context.isPartial) {
        text.setText(theme.fg("warning", "Fetching docs..."));
        return text;
      }
      const chars = result.details?.chars ?? 0;
      if (options.expanded) {
        const raw =
          result.content[0] && "text" in result.content[0]
            ? result.content[0].text
            : "";
        const lines = raw.split("\n").slice(0, 15);
        text.setText(lines.map((l) => theme.fg("toolOutput", l)).join("\n"));
      } else {
        const suffix = result.details?.truncated ? " (truncated)" : "";
        text.setText(theme.fg("toolOutput", `${chars} chars of docs${suffix}`));
      }
      return text;
    },
  };
}
