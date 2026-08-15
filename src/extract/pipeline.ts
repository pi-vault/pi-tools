import { basename } from "node:path";
import { loadMergedConfig, resolveApiKey } from "../config.ts";
import { SSRFError, validateUrl, validateUrlResolved } from "../utils/ssrf.ts";
import { extractGitHub, parseGitHubUrl } from "./github.ts";
import { extractHtml } from "./html.ts";
import { extractPdf } from "./pdf.ts";
import {
  looksLikeScannedPdf,
  rasterizePdfPages,
  modelSupportsImages,
  extractTextWithGeminiVision,
} from "./pdf-ocr.ts";
import { collectImageBlocks, type ExtractedContent, type ImageBlock } from "./types.ts";
import { createFetchProviderFallback, runExtractionFallbacks } from "./fallbacks.ts";
import type { FetchProvider } from "../providers/types.ts";
import type { ExecutionHooks } from "../providers/execute.ts";
import { sanitizeError } from "../utils/errors.ts";

export type { ExtractedContent, ImageBlock, VideoFrame } from "./types.ts";
export { collectImageBlocks } from "./types.ts";
import { getApiKey as getGeminiApiKey } from "./gemini-api.ts";
import { extractRsc } from "./rsc.ts";
import { isYouTubeURL, extractYouTube, isYouTubeEnabled } from "./youtube.ts";
import { isVideoFile, extractVideo, isVideoEnabled } from "./video.ts";
import {
  parseTimestampParam,
  extractYouTubeFrames,
  extractLocalFrames,
  getLocalVideoDuration,
  getYouTubeStreamInfo,
} from "./frames.ts";
import { extractWithUrlContext, extractWithGeminiWeb } from "./gemini-url-context.ts";
import { activityMonitor } from "../monitor/activity-monitor.ts";
/**
 * Error thrown when the HTTP fetch fails in a way that a different fetch
 * provider might succeed (network errors, 5xx, 429).
 */
export class RetryableExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableExtractionError";
  }
}
const BINARY_CONTENT_TYPES = [
  "image/",
  "audio/",
  "video/",
  "application/zip",
  "application/gzip",
  "application/octet-stream",
];

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
};

const HONEST_USER_AGENT = "pi-tools/0.3.0 (content extraction)";

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB for non-PDF
const MAX_PDF_SIZE_BYTES = 50 * 1024 * 1024; // 50MB for PDF
const HEAD_TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 10;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

async function tryRegisteredFallback(
  adapter: ReturnType<typeof createFetchProviderFallback>[],
  chain: string[],
  signal: AbortSignal | undefined,
): Promise<ExtractedContent | null> {
  if (adapter.length === 0) return null;
  signal?.throwIfAborted();
  return runExtractionFallbacks(adapter, chain, signal);
}

function throwRetryableFromTransport(originalError: unknown): never {
  throw new RetryableExtractionError(sanitizeError(originalError).slice(0, 120));
}

async function fetchValidated(
  url: string,
  init: RequestInit,
  allowRanges?: string[],
): Promise<Response> {
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await validateUrlResolved(current, { allowRanges });
    const response = await fetch(current, { ...init, redirect: "manual" });
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get("location");
    if (!location) return response;
    if (hop === MAX_REDIRECTS) {
      throw new SSRFError(`Too many redirects for ${url}`);
    }

    try {
      current = new URL(location, current).toString();
    } catch {
      throw new SSRFError(`Invalid redirect location: ${location}`);
    }
  }

  throw new SSRFError(`Too many redirects for ${url}`);
}

export interface ProbeResult {
  skip: boolean;
  reason?: string;
}

export async function probeUrl(
  url: string,
  signal?: AbortSignal,
  allowRanges?: string[],
): Promise<ProbeResult> {
  let response: Response;
  try {
    response = await fetchValidated(
      url,
      {
        method: "HEAD",
        headers: BROWSER_HEADERS,
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(HEAD_TIMEOUT_MS)])
          : AbortSignal.timeout(HEAD_TIMEOUT_MS),
      },
      allowRanges,
    );
  } catch (error) {
    if (error instanceof SSRFError) throw error;
    signal?.throwIfAborted();
    return { skip: false };
  }

  // HEAD not supported or error — fall through to GET
  if (!response.ok) return { skip: false };

  const contentType = response.headers.get("content-type") ?? "";
  const contentLengthStr = response.headers.get("content-length");
  const contentLength = contentLengthStr ? Number.parseInt(contentLengthStr, 10) : undefined;

  // Block binary content (except PDF)
  if (!contentType.includes("application/pdf")) {
    for (const prefix of BINARY_CONTENT_TYPES) {
      if (contentType.startsWith(prefix)) {
        return { skip: true, reason: "binary content type" };
      }
    }
  }

  // Size limits
  if (contentLength !== undefined && !Number.isNaN(contentLength)) {
    const isPdf = contentType.includes("application/pdf");
    const limit = isPdf ? MAX_PDF_SIZE_BYTES : MAX_SIZE_BYTES;
    if (contentLength > limit) {
      return { skip: true, reason: isPdf ? "PDF too large" : "response too large" };
    }
  }

  return { skip: false };
}

export interface ExtractOptions {
  raw?: boolean;
  prompt?: string;
  timestamp?: string;
  frames?: number;
  model?: string;
  ctx?: import("@earendil-works/pi-coding-agent").ExtensionContext;
  fetchProviders?: readonly FetchProvider[];
  executionHooks?: ExecutionHooks;
}

export async function extractContent(
  url: string,
  signal?: AbortSignal,
  options?: ExtractOptions,
): Promise<ExtractedContent> {
  signal?.throwIfAborted();
  const { github, ssrf, pdf, gemini } = loadMergedConfig(process.cwd());

  // --- Frame extraction mode (timestamp/frames params present) ---
  if (options?.timestamp || options?.frames) {
    const ytCheck = isYouTubeURL(url);
    if (ytCheck.isYouTube && ytCheck.videoId) {
      const streamInfo = await getYouTubeStreamInfo(ytCheck.videoId);
      if ("error" in streamInfo) {
        throw new Error(streamInfo.error);
      }
      const dur = typeof streamInfo.duration === "number" ? streamInfo.duration : undefined;
      const timestamps = parseTimestampParam(options.timestamp, options.frames, dur);
      const result = await extractYouTubeFrames(ytCheck.videoId, timestamps, signal);
      if (result.error && result.frames.length === 0) {
        throw new Error(result.error);
      }
      return {
        text: "",
        title: "YouTube Frames",
        url,
        extractionChain: ["frames:youtube"],
        chars: 0,
        truncated: false,
        frames: result.frames,
        duration: result.duration ?? undefined,
      };
    }
    const videoInfo = isVideoFile(url);
    if (videoInfo) {
      const durationResult = await getLocalVideoDuration(videoInfo.absolutePath);
      const dur = typeof durationResult === "number" ? durationResult : undefined;
      const timestamps = parseTimestampParam(options.timestamp, options.frames, dur);
      const result = await extractLocalFrames(videoInfo.absolutePath, timestamps, signal);
      if (result.error && result.frames.length === 0) {
        throw new Error(result.error);
      }
      return {
        text: "",
        title: basename(videoInfo.absolutePath),
        url,
        extractionChain: ["frames:local"],
        chars: 0,
        truncated: false,
        frames: result.frames,
        duration: dur,
      };
    }
    // Not YouTube or local video — timestamp/frames options are ignored,
    // fall through to normal HTML pipeline
  }

  // --- Local video file detection ---
  {
    const videoInfo = isVideoFile(url);
    if (videoInfo && isVideoEnabled()) {
      const result = await extractVideo(videoInfo, signal, options);
      if (result) return result;
    }
  }

  // --- YouTube URL detection ---
  {
    const ytParsed = isYouTubeURL(url);
    if (ytParsed.isYouTube && isYouTubeEnabled()) {
      const result = await extractYouTube(url, signal, options);
      if (result) return result;
    }
  }

  // --- SSRF validation (after video/YouTube routing, before HTTP fetch) ---
  validateUrl(url, { allowRanges: ssrf.allowRanges });

  // Built after SSRF validation so transport and HTML paths share the same
  // registry-wrapped candidates.
  const fetchAdapter =
    options?.fetchProviders && options.fetchProviders.length > 0
      ? [
          createFetchProviderFallback({
            url,
            providers: options.fetchProviders,
            signal,
            hooks: options.executionHooks,
          }),
        ]
      : [];

  // GitHub interception: try structured extraction before HTML scraping.
  // Only fires for content URLs (blob, tree, root, raw).
  // Returns null for non-content URLs (issues, PRs, etc.) -> falls through.
  const ghParsed = parseGitHubUrl(url);
  if (ghParsed && ghParsed.type !== "unknown") {
    if (github.enabled) {
      const ghResult = await extractGitHub(ghParsed, signal, github);
      if (ghResult) return ghResult;
    }
  }

  // HEAD probe: skip binary / oversized responses before full GET
  const probe = await probeUrl(url, signal, ssrf.allowRanges);
  if (probe.skip) {
    throw new Error(`Skipped: ${probe.reason} (${url})`);
  }

  const chain: string[] = [];

  const fetchEntryId = activityMonitor.logStart({ type: "fetch", url });
  let response: Response;
  try {
    response = await fetchValidated(
      url,
      {
        headers: BROWSER_HEADERS,
        signal,
      },
      ssrf.allowRanges,
    );
    activityMonitor.logComplete(fetchEntryId, response.status);
  } catch (err) {
    activityMonitor.logError(fetchEntryId, err instanceof Error ? err.message : String(err));
    if (err instanceof SSRFError) throw err;
    signal?.throwIfAborted();
    const fallback = await tryRegisteredFallback(fetchAdapter, [], signal);
    if (fallback) return fallback;
    throwRetryableFromTransport(err);
  }

  // Cloudflare bot challenge: retry once with honest User-Agent
  if (response.status === 403 && response.headers.get("cf-mitigated") === "challenge") {
    chain.push("cf-challenge");
    const retryEntryId = activityMonitor.logStart({ type: "fetch", url: `${url} (cf-retry)` });
    try {
      response = await fetchValidated(
        url,
        {
          headers: { ...BROWSER_HEADERS, "User-Agent": HONEST_USER_AGENT },
          signal,
        },
        ssrf.allowRanges,
      );
      activityMonitor.logComplete(retryEntryId, response.status);
    } catch (err) {
      activityMonitor.logError(retryEntryId, err instanceof Error ? err.message : String(err));
      if (err instanceof SSRFError) throw err;
      signal?.throwIfAborted();
      const fallback = await tryRegisteredFallback(fetchAdapter, [], signal);
      if (fallback) return fallback;
      throwRetryableFromTransport(err);
    }
  }

  chain.push(`http:${response.status}`);

  if (!response.ok) {
    const status = response.status;
    // 429 and 5xx are retryable — a different provider might succeed
    if (status === 429 || status >= 500) {
      const fallback = await tryRegisteredFallback(fetchAdapter, [], signal);
      if (fallback) return fallback;
      throw new RetryableExtractionError(`HTTP ${status}: ${response.statusText}`);
    }
    throw new Error(`HTTP ${status}: ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") ?? "";

  // Block binary content (except PDF)
  if (!contentType.includes("application/pdf")) {
    for (const prefix of BINARY_CONTENT_TYPES) {
      if (contentType.startsWith(prefix)) {
        throw new Error(`Unsupported binary content type: ${contentType}`);
      }
    }
  }

  // Raw mode: return HTTP body as-is after SSRF + binary-type validation
  if (options?.raw) {
    const body = contentType.includes("application/pdf")
      ? Buffer.from(await response.arrayBuffer()).toString("utf-8")
      : await response.text();
    chain.push("raw");
    return {
      text: body,
      title: undefined,
      url,
      extractionChain: chain,
      chars: body.length,
      truncated: false,
    };
  }

  // PDF extraction — must return or throw here since arrayBuffer() consumes
  // the response body stream (cannot call response.text() afterwards)
  if (contentType.includes("application/pdf")) {
    chain.push("pdf");
    let pdfText = "";
    const buffer = new Uint8Array(await response.arrayBuffer());

    try {
      pdfText = await extractPdf(buffer);
    } catch {
      // unpdf extraction failed — pdfText remains empty
    }

    // If text extraction succeeded with enough content, return it
    if (pdfText.length > 0 && !looksLikeScannedPdf(pdfText, buffer.byteLength)) {
      return {
        text: pdfText,
        title: undefined,
        url,
        extractionChain: chain,
        chars: pdfText.length,
        truncated: false,
      };
    }

    // OCR fallback for scanned PDFs
    if (pdf?.ocrEnabled !== false) {
      chain.push("pdf:scanned");
      try {
        const rasterResult = await rasterizePdfPages(buffer, {
          maxPages: pdf?.ocrMaxPages ?? 5,
          dpi: pdf?.ocrDpi ?? 150,
        });

        // Strategy 1: If calling model supports images, return content blocks
        if (options?.ctx && modelSupportsImages(options.ctx)) {
          chain.push("pdf-ocr:content-blocks");
          const imagesNote =
            `\n\n[${rasterResult.images.length} scanned PDF page image(s) attached for vision OCR` +
            `${rasterResult.truncated ? ` (showing ${rasterResult.images.length} of ${rasterResult.pageCount} pages)` : ""}]`;
          return {
            text: pdfText + imagesNote,
            title: undefined,
            url,
            extractionChain: chain,
            chars: pdfText.length + imagesNote.length,
            truncated: rasterResult.truncated,
            images: rasterResult.images,
          };
        }

        // Strategy 2: Call Gemini vision API directly
        const geminiKey = getGeminiApiKey() ?? resolveApiKey(gemini?.apiKey);
        if (geminiKey) {
          const ocrText = await extractTextWithGeminiVision(
            rasterResult.images,
            geminiKey,
            { geminiBaseUrl: gemini?.baseUrl },
            signal,
          );
          if (ocrText && ocrText.length > 100) {
            chain.push("pdf-ocr:gemini");
            return {
              text: ocrText,
              title: undefined,
              url,
              extractionChain: chain,
              chars: ocrText.length,
              truncated: false,
            };
          }
          chain.push("pdf-ocr:gemini-fail");
        }
      } catch {
        chain.push("pdf-ocr:error");
        // pdftoppm not installed or other rasterization failure — fall through
      }
    }

    // All PDF strategies failed
    if (pdfText.length > 0) {
      // Return the meager text we have rather than throwing
      return {
        text: pdfText,
        title: undefined,
        url,
        extractionChain: chain,
        chars: pdfText.length,
        truncated: false,
      };
    }

    chain.push("pdf:fail");
    throw new Error(`Could not extract content from ${url}. Tried: ${chain.join(" -> ")}`);
  }

  const body = await response.text();

  // Tier 1: Readability (extractHtml guarantees text.length >= MIN_CONTENT_LENGTH)
  const htmlResult = extractHtml(body, url);
  if (htmlResult) {
    chain.push("readability");
    return {
      text: htmlResult.text,
      title: htmlResult.title,
      url,
      extractionChain: chain,
      chars: htmlResult.text.length,
      truncated: false,
    };
  }
  chain.push("readability:thin");

  // Tier 2: RSC parser
  const rscText = extractRsc(body);
  if (rscText) {
    chain.push("rsc");
    return {
      text: rscText,
      title: undefined,
      url,
      extractionChain: chain,
      chars: rscText.length,
      truncated: false,
    };
  }
  chain.push("rsc:no-match");

  // Tier 3: registered fetch providers (skipped when no providers configured).
  if (fetchAdapter.length === 0) {
    chain.push("fetch-provider:skipped");
  } else {
    const providerResult = await runExtractionFallbacks(fetchAdapter, chain, signal);
    if (providerResult) {
      return { ...providerResult, extractionChain: chain };
    }
  }

  // Tier 4: combined Gemini HTML adapter (URL context, then Web).
  const geminiResult = await runExtractionFallbacks(
    [
      {
        name: "gemini-html",
        run: async () => {
          const urlContextResult = await extractWithUrlContext(url, signal);
          signal?.throwIfAborted();
          return urlContextResult ?? (await extractWithGeminiWeb(url, signal));
        },
      },
    ],
    chain,
    signal,
  );
  if (geminiResult) {
    return {
      ...geminiResult,
      extractionChain: chain,
    };
  }

  // Final fallback: raw text stripped of HTML
  const rawText = body
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (rawText.length > 0) {
    chain.push("raw-text");
    return {
      text: rawText,
      title: undefined,
      url,
      extractionChain: chain,
      chars: rawText.length,
      truncated: false,
    };
  }

  throw new Error(`Could not extract content from ${url}. Tried: ${chain.join(" -> ")}`);
}
