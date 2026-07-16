import { Type } from "typebox";
import type { Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { ContentStore } from "../storage.ts";
import type { FetchProvider } from "../providers/types.ts";
import {
  extractContent,
  RetryableExtractionError,
  type ExtractedContent,
} from "../extract/pipeline.ts";
import { truncateContent } from "../utils/truncate.ts";
import { sanitizeError } from "../utils/errors.ts";
import { executeWithFallback } from "../providers/execute.ts";
import type { ContentCache } from "../cache.ts";
import type { GitHubConfig, GuidanceOverride, PdfConfig, GeminiConfig } from "../config.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { executeMultiUrl, type UrlResult } from "./web-fetch-multi.ts";

const INLINE_LIMIT = 15_000;

const WebFetchParams = Type.Object({
  url: Type.Optional(Type.String({ description: "HTTP(S) URL to fetch" })),
  urls: Type.Optional(
    Type.Array(Type.String(), {
      maxItems: 20,
      description: "Multiple URLs to fetch concurrently",
    }),
  ),
  raw: Type.Optional(
    Type.Boolean({ default: false, description: "Return raw HTTP body without extraction" }),
  ),
  fresh: Type.Optional(Type.Boolean({ default: false, description: "Bypass content cache" })),
  // Video/YouTube parameters
  prompt: Type.Optional(
    Type.String({ description: "Question or instruction for video/YouTube analysis." }),
  ),
  timestamp: Type.Optional(
    Type.String({ description: "Extract frame(s): '1:23:45' (single), '23:41-25:00' (range)." }),
  ),
  frames: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 12, description: "Number of frames to extract." }),
  ),
  model: Type.Optional(
    Type.String({ description: "Override Gemini model for video/YouTube analysis." }),
  ),
});

interface WebFetchDetails {
  url: string;
  title?: string;
  chars: number;
  truncated: boolean;
  contentId?: string;
  extractionChain: string[];
  urlResults?: UrlResult[];
}

export function createWebFetchTool(
  store: ContentStore,
  resolveFetchCandidates?: () => FetchProvider[],
  cache?: ContentCache,
  guidance?: GuidanceOverride,
  githubConfig?: GitHubConfig,
  ssrfAllowRanges?: string[],
  pdfConfig?: PdfConfig,
  geminiConfig?: GeminiConfig,
): ToolDefinition<typeof WebFetchParams, WebFetchDetails> {
  async function executeSingleUrl(
    url: string,
    params: {
      raw?: boolean;
      fresh?: boolean;
      prompt?: string;
      timestamp?: string;
      frames?: number;
      model?: string;
    },
    signal: AbortSignal | undefined,
    ctx?: ExtensionContext,
  ) {
    try {
      // Check cache first (unless fresh)
      if (!params.fresh) {
        const cached = cache?.get(url);
        if (cached) {
          return buildResult(cached, url, store);
        }
      }

      const extracted = await extractContent(url, signal, {
        raw: params.raw,
        github: githubConfig,
        allowRanges: ssrfAllowRanges,
        prompt: params.prompt,
        timestamp: params.timestamp,
        frames: params.frames,
        model: params.model,
        pdf: pdfConfig,
        gemini: geminiConfig,
        ctx,
      });

      // Write to cache
      cache?.set(url, extracted);

      return buildResult(extracted, url, store);
    } catch (pipelineError) {
      // Only fall back to providers for retryable errors
      if (!(pipelineError instanceof RetryableExtractionError)) {
        const msg = sanitizeError(pipelineError);
        return errorResult(url, `Fetch error: ${msg}`);
      }

      // Try each registered FetchProvider as fallback
      const candidates = resolveFetchCandidates?.() ?? [];
      if (candidates.length === 0) {
        const msg = sanitizeError(pipelineError);
        return errorResult(url, `Fetch error: ${msg}`);
      }

      try {
        const { result: fetchResult, providerName } = await executeWithFallback({
          candidates: candidates.map((provider) => ({
            name: provider.name,
            execute: () => provider.fetch(url, signal),
          })),
          operation: "fetch",
        });

        const extracted: ExtractedContent = {
          text: fetchResult.text,
          title: fetchResult.title,
          url,
          extractionChain: [`fetch-provider:${providerName}`],
          chars: fetchResult.text.length,
          truncated: false,
        };

        cache?.set(url, extracted);
        return buildResult(extracted, url, store);
      } catch (fallbackError) {
        const providerMsg =
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        return errorResult(url, `Fetch error (pipeline: ${pipelineError.message}): ${providerMsg}`);
      }
    }
  }

  return {
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch a URL and extract readable content as markdown. Supports HTML pages, YouTube videos (transcript + thumbnail), and local video files (Gemini analysis).",
    promptSnippet:
      guidance?.promptSnippet ??
      "Fetch a URL and extract readable content as markdown. Supports HTML pages, YouTube videos (transcript + thumbnail), and local video files (Gemini analysis).",
    promptGuidelines: guidance?.promptGuidelines ?? [
      "Use web_fetch when you have a specific URL to read.",
      "For large pages, use web_read with the returned contentId to retrieve the full text.",
    ],
    parameters: WebFetchParams,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const hasUrl = params.url !== undefined && params.url.trim() !== "";
      const hasUrls = params.urls !== undefined && params.urls.length > 0;

      // Validation: exactly one of url or urls
      if (hasUrl === hasUrls) {
        return errorResult(
          params.url ?? "",
          "Fetch error: Provide exactly one of `url` or `urls`, not both or neither.",
        );
      }

      if (hasUrls && params.urls!.length > 20) {
        return errorResult("", "Fetch error: `urls` accepts at most 20 URLs.");
      }

      // Single-URL path
      if (hasUrl) {
        return executeSingleUrl(params.url!, params, signal ?? undefined, ctx);
      }

      // Multi-URL path
      return executeMultiUrl({
        urls: params.urls!,
        params,
        signal: signal ?? undefined,
        store,
        cache,
        githubConfig,
        ssrfAllowRanges,
        pdfConfig,
        geminiConfig,
        ctx,
      });
    },
    renderCall(args, theme: Theme, context) {
      const text =
        context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
      if (!context.argsComplete) {
        text.setText(theme.fg("warning", "Fetching..."));
        return text;
      }
      if (args.urls && args.urls.length > 0) {
        text.setText(
          `${theme.fg("toolTitle", theme.bold("web_fetch"))} ${theme.fg("accent", `${args.urls.length} URLs`)}`,
        );
      } else {
        const u =
          (args.url ?? "").length > 70 ? `${(args.url ?? "").slice(0, 67)}...` : (args.url ?? "");
        text.setText(
          `${theme.fg("toolTitle", theme.bold("web_fetch"))} ${theme.fg("accent", `"${u}"`)}`,
        );
      }
      return text;
    },
    renderResult(result, options, theme: Theme, context) {
      const text =
        context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
      if (context.isPartial) {
        text.setText(theme.fg("warning", "Fetching..."));
        return text;
      }
      const details = result.details;
      const imageCount = result.content.filter((c: { type: string }) => c.type === "image").length;
      if (!details || details.chars === 0) {
        if (imageCount > 0) {
          text.setText(theme.fg("toolOutput", `${imageCount} frame(s) extracted`));
          return text;
        }
        text.setText(theme.fg("error", "fetch error"));
        return text;
      }
      if (options.expanded) {
        const raw = result.content[0] && "text" in result.content[0] ? result.content[0].text : "";
        const lines = raw.split("\n").slice(0, 20);
        text.setText(lines.map((l: string) => theme.fg("toolOutput", l)).join("\n"));
      } else {
        const imageSuffix = imageCount > 0 ? ` + ${imageCount} image(s)` : "";
        const truncNote = details.truncated ? theme.fg("warning", " (truncated)") : "";
        text.setText(theme.fg("toolOutput", `${details.chars} chars${imageSuffix}`) + truncNote);
      }
      return text;
    },
  };
}

type ImageBlock = { type: "image"; data: string; mimeType: string };

function collectImageBlocks(extracted: ExtractedContent): ImageBlock[] {
  const blocks: ImageBlock[] = [];
  if (extracted.thumbnail) {
    blocks.push({ type: "image", data: extracted.thumbnail.data, mimeType: extracted.thumbnail.mimeType });
  }
  if (extracted.frames) {
    for (const frame of extracted.frames) {
      blocks.push({ type: "image", data: frame.data, mimeType: frame.mimeType });
    }
  }
  if (extracted.images) {
    for (const img of extracted.images) {
      blocks.push({ type: "image", data: img.data, mimeType: img.mimeType });
    }
  }
  return blocks;
}

type ToolResult = {
  content: Array<{ type: "text"; text: string } | ImageBlock>;
  details: {
    url: string;
    title?: string;
    chars: number;
    truncated: boolean;
    contentId?: string;
    extractionChain: string[];
  };
};

function buildResult(
  extracted: ExtractedContent,
  originalUrl: string,
  store: ContentStore,
): ToolResult {
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
    outputText = truncateContent(extracted.text, INLINE_LIMIT);
    truncated = true;
  } else {
    outputText = extracted.text;
  }

  const header = [
    extracted.title ? `# ${extracted.title}` : `# ${extracted.url}`,
    `Source: ${extracted.url}`,
    `Chars: ${extracted.chars}${truncated ? ` (truncated, use web_read with contentId "${contentId}" for full text)` : ""}`,
    extracted.duration !== undefined ? `Duration: ${extracted.duration}s` : "",
    "",
  ]
    .filter(Boolean)
    .join("\n");

  const content: ToolResult["content"] = [
    { type: "text" as const, text: header + outputText },
    ...collectImageBlocks(extracted),
  ];

  return {
    content,
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
