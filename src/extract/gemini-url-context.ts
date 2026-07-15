import { getApiKey, getVersionedApiBase } from "./gemini-api.ts";
import { isGeminiWebAvailable, queryWithCookies } from "./gemini-web.ts";
import type { ExtractedContent } from "./pipeline.ts";

const EXTRACTION_PROMPT = `Extract the complete readable content from this URL as clean markdown.
Include the page title, all text content, code blocks, and tables.
Do not summarize — extract the full content.

URL: `;

interface UrlContextResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    url_context_metadata?: {
      url_metadata?: Array<{
        retrieved_url?: string;
        url_retrieval_status?: string;
      }>;
    };
  }>;
}

/**
 * Extract page content using Gemini API's url_context tool.
 * Gemini fetches the URL itself and returns extracted content.
 * Returns null if API is unavailable or extraction fails.
 */
export async function extractWithUrlContext(
  url: string,
  signal?: AbortSignal,
): Promise<ExtractedContent | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    const body = {
      contents: [{ role: "user", parts: [{ text: EXTRACTION_PROMPT + url }] }],
      tools: [{ url_context: {} }],
    };

    const effectiveSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(60_000)])
      : AbortSignal.timeout(60_000);

    const res = await fetch(
      `${getVersionedApiBase()}/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: effectiveSignal,
      },
    );

    if (!res.ok) return null;

    const data = (await res.json()) as UrlContextResponse;

    // Check URL retrieval status
    const metadata = data.candidates?.[0]?.url_context_metadata;
    if (metadata?.url_metadata?.length) {
      const status = metadata.url_metadata[0].url_retrieval_status;
      if (status === "URL_RETRIEVAL_STATUS_UNSAFE" || status === "URL_RETRIEVAL_STATUS_ERROR") {
        return null;
      }
    }

    const text = data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text)
      .filter(Boolean)
      .join("\n") ?? "";

    if (!text || text.length < 100) return null;

    const title = extractTitle(text, url);
    return {
      text,
      title,
      url,
      extractionChain: ["html:gemini-url-context"],
      chars: text.length,
      truncated: false,
    };
  } catch {
    return null;
  }
}

/**
 * Extract page content using Gemini Web (cookie-authenticated).
 * Appends the URL to the prompt — Gemini Web can browse URLs given in text.
 * Returns null if cookies are unavailable or extraction fails.
 */
export async function extractWithGeminiWeb(
  url: string,
  signal?: AbortSignal,
): Promise<ExtractedContent | null> {
  const cookies = await isGeminiWebAvailable();
  if (!cookies) return null;

  try {
    const text = await queryWithCookies(EXTRACTION_PROMPT + url, cookies, {
      model: "gemini-3-flash-preview",
      signal,
      timeoutMs: 60_000,
    });

    if (!text || text.length < 100) return null;

    const title = extractTitle(text, url);
    return {
      text,
      title,
      url,
      extractionChain: ["html:gemini-web"],
      chars: text.length,
      truncated: false,
    };
  } catch {
    return null;
  }
}

function extractTitle(text: string, url: string): string {
  const match = text.match(/^#\s+(.+)$/m);
  if (match) return match[1].trim();
  try {
    return new URL(url).pathname.split("/").pop() || url;
  } catch {
    return url;
  }
}
