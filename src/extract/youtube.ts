import { DEFAULT_YOUTUBE_CONFIG, loadConfig } from "../config.ts";
import { isGeminiApiAvailable, queryGeminiApi } from "./gemini-api.ts";
import { isGeminiWebAvailable, queryWithCookies } from "./gemini-web.ts";
import { isPerplexityAvailable, queryPerplexity } from "./perplexity.ts";
import type { ExtractedContent, ExtractOptions } from "./pipeline.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const YOUTUBE_REGEX =
  /(?:(?:www\.|m\.)?youtube\.com\/(?:watch\?.*v=|shorts\/|live\/|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

const YOUTUBE_PROMPT = `Extract the complete content of this YouTube video. Include:
1. Video title, channel name, and duration
2. A brief summary (2-3 sentences)
3. Full transcript with timestamps
4. Descriptions of any code, terminal commands, diagrams, slides, or UI shown on screen

Format as markdown.`;

const THUMBNAIL_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// URL Detection
// ---------------------------------------------------------------------------

/**
 * Detect whether a URL is a YouTube video URL and extract the video ID.
 * Returns { isYouTube: false, videoId: null } for non-YouTube URLs and playlist URLs.
 */
export function isYouTubeURL(url: string): {
  isYouTube: boolean;
  videoId: string | null;
} {
  try {
    const parsed = new URL(url);
    if (parsed.pathname === "/playlist") {
      return { isYouTube: false, videoId: null };
    }
  } catch {
    // Not a valid URL — still try regex match (handles bare patterns)
  }

  const match = url.match(YOUTUBE_REGEX);
  if (!match) return { isYouTube: false, videoId: null };
  return { isYouTube: true, videoId: match[1] };
}

/**
 * Check whether YouTube extraction is enabled via config.
 * Reads youtube.enabled from tools.json (defaults to true).
 */
export function isYouTubeEnabled(): boolean {
  try {
    return loadConfig().youtube?.enabled ?? DEFAULT_YOUTUBE_CONFIG.enabled;
  } catch {
    return DEFAULT_YOUTUBE_CONFIG.enabled;
  }
}

// ---------------------------------------------------------------------------
// Main Extraction
// ---------------------------------------------------------------------------

/**
 * Extract YouTube video content using a three-tier fallback chain:
 * 1. Gemini Web (cookie-auth, free)
 * 2. Gemini API (key-based, metered)
 * 3. Perplexity (text-only summary, last resort)
 *
 * Returns null if all methods fail or no extraction method is available.
 */
export async function extractYouTube(
  url: string,
  signal?: AbortSignal,
  options?: ExtractOptions,
): Promise<ExtractedContent | null> {
  const { videoId } = isYouTubeURL(url);
  const canonicalUrl = videoId
    ? `https://www.youtube.com/watch?v=${videoId}`
    : url;
  const effectivePrompt = options?.prompt ?? YOUTUBE_PROMPT;
  const effectiveModel = options?.model ?? getPreferredModel();

  // Tier 1: Gemini Web (cookie auth)
  const webResult = await tryGeminiWeb(
    canonicalUrl,
    effectivePrompt,
    effectiveModel,
    signal,
  );
  if (webResult) return finalizeResult(webResult, url, videoId);

  // Tier 2: Gemini API (key auth)
  const apiResult = await tryGeminiApi(
    canonicalUrl,
    effectivePrompt,
    effectiveModel,
    signal,
  );
  if (apiResult) return finalizeResult(apiResult, url, videoId);

  // Tier 3: Perplexity (text-only fallback)
  const perplexityResult = await tryPerplexity(url, effectivePrompt, signal);
  if (perplexityResult) return finalizeResult(perplexityResult, url, videoId);

  // All methods failed
  return null;
}

// ---------------------------------------------------------------------------
// Thumbnail
// ---------------------------------------------------------------------------

/**
 * Fetch YouTube video thumbnail as base64-encoded JPEG.
 * Returns null on any failure (non-blocking, best-effort).
 */
export async function fetchYouTubeThumbnail(
  videoId: string,
): Promise<{ data: string; mimeType: string } | null> {
  try {
    const res = await fetch(
      `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      { signal: AbortSignal.timeout(THUMBNAIL_TIMEOUT_MS) },
    );
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) return null;
    return { data: buffer.toString("base64"), mimeType: "image/jpeg" };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the first markdown heading (# Title) from text.
 */
export function extractHeadingTitle(text: string): string | null {
  const match = text.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function getPreferredModel(): string {
  try {
    return (
      loadConfig().youtube?.preferredModel ??
      DEFAULT_YOUTUBE_CONFIG.preferredModel
    );
  } catch {
    return DEFAULT_YOUTUBE_CONFIG.preferredModel;
  }
}

async function finalizeResult(
  result: { text: string; extractionChain: string[] },
  originalUrl: string,
  videoId: string | null,
): Promise<ExtractedContent> {
  const title = extractHeadingTitle(result.text) ?? "YouTube Video";

  const content: ExtractedContent = {
    text: result.text,
    title,
    url: originalUrl,
    extractionChain: result.extractionChain,
    chars: result.text.length,
    truncated: false,
  };

  if (videoId) {
    const thumbnail = await fetchYouTubeThumbnail(videoId);
    if (thumbnail) content.thumbnail = thumbnail;
  }

  return content;
}

// ---------------------------------------------------------------------------
// Fallback Tier Functions
// ---------------------------------------------------------------------------

async function tryGeminiWeb(
  url: string,
  prompt: string,
  model: string,
  signal: AbortSignal | undefined,
): Promise<{ text: string; extractionChain: string[] } | null> {
  try {
    const cookies = await isGeminiWebAvailable();
    if (!cookies) return null;

    if (signal?.aborted) return null;

    const text = await queryWithCookies(prompt, cookies, {
      youtubeUrl: url,
      model,
      signal,
      timeoutMs: 120_000,
    });

    return { text, extractionChain: ["youtube:gemini-web"] };
  } catch {
    return null;
  }
}

async function tryGeminiApi(
  url: string,
  prompt: string,
  model: string,
  signal: AbortSignal | undefined,
): Promise<{ text: string; extractionChain: string[] } | null> {
  try {
    if (!isGeminiApiAvailable()) return null;

    if (signal?.aborted) return null;

    const text = await queryGeminiApi(prompt, url, {
      model,
      signal,
      timeoutMs: 120_000,
    });

    return { text, extractionChain: ["youtube:gemini-api"] };
  } catch {
    return null;
  }
}

async function tryPerplexity(
  url: string,
  prompt: string,
  signal: AbortSignal | undefined,
): Promise<{ text: string; extractionChain: string[] } | null> {
  try {
    if (signal?.aborted || !isPerplexityAvailable()) return null;

    const perplexityQuery =
      prompt === YOUTUBE_PROMPT
        ? `Summarize this YouTube video in detail: ${url}`
        : `${prompt} YouTube video: ${url}`;

    const answer = await queryPerplexity(perplexityQuery, signal);
    if (!answer) return null;

    const text =
      `# Video Summary (via Perplexity)\n\n${answer}\n\n` +
      `*Full video understanding requires Gemini access. Set GEMINI_API_KEY or sign into Google in Chrome.*`;

    return { text, extractionChain: ["youtube:perplexity"] };
  } catch {
    return null;
  }
}
