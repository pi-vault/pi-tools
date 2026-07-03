import { Type } from "typebox";
import type { Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { ContentStore } from "../storage.ts";
import type { FetchProvider } from "../providers/types.ts";
import { extractContent, RetryableExtractionError, type ExtractedContent } from "../extract/pipeline.ts";
import { truncateContent } from "../utils/truncate.ts";
import { sanitizeError } from "../utils/errors.ts";
import { executeWithFallback } from "../providers/execute.ts";
import type { ContentCache } from "../cache.ts";
import type { GitHubConfig, GuidanceOverride } from "../config.ts";

const INLINE_LIMIT = 15_000;
const MANIFEST_PREVIEW_CHARS = 512;
const MAX_CONCURRENT = 5;

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
  fresh: Type.Optional(
    Type.Boolean({ default: false, description: "Bypass content cache" }),
  ),
});

interface UrlResult {
  url: string;
  title?: string;
  chars: number;
  contentId?: string;
  error?: string;
}

interface WebFetchDetails {
  url: string;
  title?: string;
  chars: number;
  truncated: boolean;
  contentId?: string;
  extractionChain: string[];
  urlResults?: UrlResult[];
}

function perUrlCap(count: number): number {
  return count <= 1 ? INLINE_LIMIT : count <= 5 ? Math.floor(INLINE_LIMIT / count) : MANIFEST_PREVIEW_CHARS;
}

async function fetchWithConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  maxConcurrent: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      try {
        const value = await tasks[index]();
        results[index] = { status: "fulfilled", value };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(maxConcurrent, tasks.length) },
    () => runNext(),
  );
  await Promise.all(workers);
  return results;
}

export function createWebFetchTool(
  store: ContentStore,
  resolveFetchCandidates?: () => FetchProvider[],
  cache?: ContentCache,
  guidance?: GuidanceOverride,
  githubConfig?: GitHubConfig,
): ToolDefinition<typeof WebFetchParams, WebFetchDetails> {

  async function executeSingleUrl(
    url: string,
    params: { raw?: boolean; fresh?: boolean },
    signal: AbortSignal | undefined,
  ) {
    try {
      // Check cache first (unless fresh)
      if (!params.fresh) {
        const cached = cache?.get(url);
        if (cached) {
          return buildResult(cached, url, store);
        }
      }

      const extracted = await extractContent(
        url,
        signal,
        { raw: params.raw, github: githubConfig },
      );

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
          initialErrors: [{ provider: "http", error: pipelineError.message }],
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
        const msg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        return errorResult(url, `Fetch error: ${msg}`);
      }
    }
  }

  return {
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch a URL and extract readable content as markdown. Supports HTML pages.",
    promptSnippet: guidance?.promptSnippet ??
      "Fetch a URL and extract readable content as markdown. Supports HTML pages.",
    promptGuidelines: guidance?.promptGuidelines ?? [
      "Use web_fetch when you have a specific URL to read.",
      "For large pages, use web_read with the returned contentId to retrieve the full text.",
    ],
    parameters: WebFetchParams,
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
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
        return errorResult(
          "",
          "Fetch error: `urls` accepts at most 20 URLs.",
        );
      }

      // Single-URL path
      if (hasUrl) {
        return executeSingleUrl(params.url!, params, signal ?? undefined);
      }

      // Multi-URL path
      const urls = params.urls!;
      const cap = perUrlCap(urls.length);
      const isManifest = urls.length >= 6;

      // Deduplicate URLs — fetch each unique URL once, reuse results
      const uniqueUrls = [...new Set(urls)];
      const tasks = uniqueUrls.map((u) => async () => {
        if (!params.fresh) {
          const cached = cache?.get(u);
          if (cached) return cached;
        }

        const extracted = await extractContent(
          u,
          signal ?? undefined,
          { raw: params.raw, github: githubConfig },
        );

        cache?.set(u, extracted);
        return extracted;
      });

      const settled = await fetchWithConcurrencyLimit(tasks, MAX_CONCURRENT);

      // Build a map from unique URL → result for O(1) lookup by duplicates
      const resultByUrl = new Map<string, PromiseSettledResult<ExtractedContent>>();
      for (let i = 0; i < uniqueUrls.length; i++) {
        resultByUrl.set(uniqueUrls[i], settled[i]);
      }

      const urlResults: UrlResult[] = [];
      const outputParts: string[] = [];

      for (const u of urls) {
        const outcome = resultByUrl.get(u)!;
        if (outcome.status === "rejected") {
          const errMsg = outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason);
          urlResults.push({ url: u, chars: 0, error: errMsg });
          outputParts.push(`## ${u}\n\nError: ${errMsg}\n`);
          continue;
        }

        const extracted = outcome.value;

        // Always store full content for retrieval via web_read
        const contentId = store.store({
          url: extracted.url,
          title: extracted.title,
          text: extracted.text,
          source: "web_fetch",
        });

        const preview = extracted.chars > cap
          ? truncateContent(extracted.text, cap)
          : extracted.text;

        urlResults.push({
          url: extracted.url,
          title: extracted.title,
          chars: extracted.chars,
          contentId,
        });

        const header = extracted.title ? `## ${extracted.title}` : `## ${extracted.url}`;
        const meta = `Source: ${extracted.url} | ${extracted.chars} chars | contentId: ${contentId}`;
        outputParts.push(`${header}\n${meta}\n\n${preview}\n`);
      }

      const failed = urlResults.filter((r) => r.error).length;
      const succeeded = urls.length - failed;
      const summary = `Fetched ${succeeded}/${urls.length} URLs successfully${failed > 0 ? ` (${failed} failed)` : ""}${isManifest ? ". Use web_read with contentId for full text." : ""}\n\n`;

      return {
        content: [{ type: "text" as const, text: summary + outputParts.join("\n---\n\n") }],
        details: {
          url: urls[0],
          chars: urlResults.reduce((sum, r) => sum + r.chars, 0),
          truncated: urlResults.some((r) => !r.error && r.chars > cap),
          extractionChain: ["multi-url"],
          urlResults,
        },
      };
    },
    renderCall(args, theme: Theme, context) {
      const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
      if (!context.argsComplete) {
        text.setText(theme.fg("warning", "Fetching..."));
        return text;
      }
      if (args.urls && args.urls.length > 0) {
        text.setText(
          `${theme.fg("toolTitle", theme.bold("web_fetch"))} ${theme.fg("accent", `${args.urls.length} URLs`)}`,
        );
      } else {
        const u = (args.url ?? "").length > 70 ? `${(args.url ?? "").slice(0, 67)}...` : (args.url ?? "");
        text.setText(
          `${theme.fg("toolTitle", theme.bold("web_fetch"))} ${theme.fg("accent", `"${u}"`)}`,
        );
      }
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
    outputText = truncateContent(extracted.text, INLINE_LIMIT);
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
