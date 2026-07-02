import { Type } from "typebox";
import type { Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { ContentStore } from "../storage.ts";
import type { FetchProvider } from "../providers/types.ts";
import { extractContent, RetryableExtractionError } from "../extract/pipeline.ts";
import { truncateContent } from "../utils/truncate.ts";
import { AggregateProviderError, sanitizeError } from "../utils/errors.ts";

const INLINE_LIMIT = 15_000;

const WebFetchParams = Type.Object({
  url: Type.String({ description: "HTTP(S) URL to fetch" }),
});

interface WebFetchDetails {
  url: string;
  title?: string;
  chars: number;
  truncated: boolean;
  contentId?: string;
  extractionChain: string[];
}

export function createWebFetchTool(
  store: ContentStore,
  resolveFetchCandidates?: () => FetchProvider[],
): ToolDefinition<typeof WebFetchParams, WebFetchDetails> {
  return {
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch a URL and extract readable content as markdown. Supports HTML pages.",
    promptSnippet:
      "Fetch a URL and extract readable content as markdown. Supports HTML pages.",
    promptGuidelines: [
      "Use web_fetch when you have a specific URL to read.",
      "For large pages, use web_read with the returned contentId to retrieve the full text.",
    ],
    parameters: WebFetchParams,
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      // Try the direct extraction pipeline first
      try {
        const extracted = await extractContent(params.url, signal ?? undefined);
        return buildResult(extracted, params.url, store);
      } catch (pipelineError) {
        // Only fall back to providers for retryable errors
        if (!(pipelineError instanceof RetryableExtractionError)) {
          const msg = sanitizeError(pipelineError);
          return errorResult(params.url, `Fetch error: ${msg}`);
        }

        // Try each registered FetchProvider as fallback
        const candidates = resolveFetchCandidates?.() ?? [];
        if (candidates.length === 0) {
          const msg = sanitizeError(pipelineError);
          return errorResult(params.url, `Fetch error: ${msg}`);
        }

        const errors: Array<{ provider: string; error: string }> = [
          { provider: "http", error: pipelineError.message },
        ];

        for (const provider of candidates) {
          try {
            const fetchResult = await provider.fetch(params.url, signal ?? undefined);
            return buildResult(
              {
                text: fetchResult.text,
                title: fetchResult.title,
                url: params.url,
                extractionChain: [`fetch-provider:${provider.name}`],
                chars: fetchResult.text.length,
                truncated: false,
              },
              params.url,
              store,
            );
          } catch (providerError) {
            errors.push({
              provider: provider.name,
              error: providerError instanceof Error ? providerError.message : String(providerError),
            });
          }
        }

        const aggregate = new AggregateProviderError("fetch", errors);
        return errorResult(params.url, `Fetch error: ${aggregate.message}`);
      }
    },
    renderCall(args, theme: Theme, context) {
      const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
      if (!context.argsComplete) {
        text.setText(theme.fg("warning", "Fetching..."));
        return text;
      }
      const u = args.url.length > 70 ? `${args.url.slice(0, 67)}...` : args.url;
      text.setText(
        `${theme.fg("toolTitle", theme.bold("web_fetch"))} ${theme.fg("accent", `"${u}"`)}`,
      );
      return text;
    },
    renderResult(result, options, theme: Theme, context) {
      const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
      if (context.isPartial) {
        text.setText(theme.fg("warning", "Fetching..."));
        return text;
      }
      const details = result.details;
      if (!details || details.chars === 0) {
        text.setText(theme.fg("error", "fetch error"));
        return text;
      }
      if (options.expanded) {
        const raw =
          result.content[0] && "text" in result.content[0] ? result.content[0].text : "";
        const lines = raw.split("\n").slice(0, 20);
        text.setText(lines.map((l) => theme.fg("toolOutput", l)).join("\n"));
      } else {
        const truncNote = details.truncated ? theme.fg("warning", " (truncated)") : "";
        text.setText(theme.fg("toolOutput", `${details.chars} chars`) + truncNote);
      }
      return text;
    },
  };
}

function buildResult(
  extracted: {
    text: string;
    title?: string;
    url: string;
    extractionChain: string[];
    chars: number;
    truncated: boolean;
  },
  originalUrl: string,
  store: ContentStore,
) {
  let contentId: string | undefined;
  let outputText: string;
  let truncated = extracted.truncated;

  if (extracted.chars > INLINE_LIMIT) {
    contentId = store.store({
      url: extracted.url,
      title: extracted.title,
      text: extracted.text,
      source: "web_fetch",
    });
    const trunc = truncateContent(extracted.text, INLINE_LIMIT);
    outputText = trunc.text;
    truncated = true;
  } else {
    outputText = extracted.text;
  }

  const header = [
    extracted.title ? `# ${extracted.title}` : `# ${extracted.url}`,
    `Source: ${extracted.url}`,
    `Chars: ${extracted.chars}${truncated ? ` (truncated, use web_read with contentId "${contentId}" for full text)` : ""}`,
    "",
  ].join("\n");

  return {
    content: [{ type: "text" as const, text: header + outputText }],
    details: {
      url: originalUrl,
      title: extracted.title,
      chars: extracted.chars,
      truncated,
      contentId,
      extractionChain: extracted.extractionChain,
    },
  };
}

function errorResult(url: string, message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    details: {
      url,
      chars: 0,
      truncated: false,
      extractionChain: [] as string[],
    },
  };
}
