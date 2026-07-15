import { basename } from "node:path";
import { DEFAULT_GITHUB_CONFIG, type GitHubConfig } from "../config.ts";
import { validateUrl } from "../utils/ssrf.ts";
import { extractGitHub, parseGitHubUrl } from "./github.ts";
import { extractHtml } from "./html.ts";
import { extractPdf } from "./pdf.ts";
import { extractRsc } from "./rsc.ts";
import { extractViaJinaReader } from "./jina-reader.ts";
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

export interface VideoFrame {
  data: string;
  mimeType: string;
  timestamp: string;
}

export interface ExtractedContent {
  text: string;
  title?: string;
  url: string;
  extractionChain: string[];
  chars: number;
  truncated: boolean;
  contentId?: string;
  thumbnail?: { data: string; mimeType: string };
  frames?: VideoFrame[];
  duration?: number;
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

export interface ExtractOptions {
  raw?: boolean;
  github?: GitHubConfig;
  allowRanges?: string[];
  prompt?: string;
  timestamp?: string;
  frames?: number;
  model?: string;
}

export async function extractContent(
  url: string,
  signal?: AbortSignal,
  options?: ExtractOptions,
): Promise<ExtractedContent> {
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
    // Not YouTube or local video — fall through to normal pipeline
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
  validateUrl(url, { allowRanges: options?.allowRanges });

  // GitHub interception: try structured extraction before HTML scraping.
  // Only fires for content URLs (blob, tree, root, raw).
  // Returns null for non-content URLs (issues, PRs, etc.) -> falls through.
  const ghParsed = parseGitHubUrl(url);
  if (ghParsed && ghParsed.type !== "unknown") {
    const githubConfig = options?.github ?? DEFAULT_GITHUB_CONFIG;
    if (githubConfig.enabled) {
      const ghResult = await extractGitHub(ghParsed, signal, githubConfig);
      if (ghResult) return ghResult;
    }
  }

  const chain: string[] = [];

  let response: Response;
  try {
    response = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal,
      redirect: "follow",
    });
  } catch (err) {
    throw new RetryableExtractionError(err instanceof Error ? err.message : String(err));
  }

  chain.push(`http:${response.status}`);

  if (!response.ok) {
    const status = response.status;
    // 429 and 5xx are retryable — a different provider might succeed
    if (status === 429 || status >= 500) {
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
    try {
      const buffer = new Uint8Array(await response.arrayBuffer());
      const text = await extractPdf(buffer);
      if (text.length > 0) {
        return {
          text,
          title: undefined,
          url,
          extractionChain: chain,
          chars: text.length,
          truncated: false,
        };
      }
    } catch {
      // fall through
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

  // Tier 3: Jina Reader
  const jinaText = await extractViaJinaReader(url, signal);
  if (jinaText) {
    chain.push("jina-reader");
    return {
      text: jinaText,
      title: undefined,
      url,
      extractionChain: chain,
      chars: jinaText.length,
      truncated: false,
    };
  }
  chain.push("jina-reader:fail");

  // Tier 4: Gemini HTML fallback
  const geminiResult =
    (await extractWithUrlContext(url, signal)) ?? (await extractWithGeminiWeb(url, signal));
  if (geminiResult) {
    chain.push(geminiResult.extractionChain[0]);
    return {
      ...geminiResult,
      extractionChain: chain,
    };
  }
  chain.push("gemini-html:fail");

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
