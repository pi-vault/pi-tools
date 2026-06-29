import { validateUrl } from "../utils/ssrf.ts";
import { extractHtml } from "./html.ts";

export interface ExtractedContent {
  text: string;
  title?: string;
  url: string;
  extractionChain: string[];
  chars: number;
  truncated: boolean;
  contentId?: string;
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

export async function extractContent(
  url: string,
  signal?: AbortSignal,
): Promise<ExtractedContent> {
  validateUrl(url);

  const chain: string[] = [];

  const response = await fetch(url, {
    headers: BROWSER_HEADERS,
    signal,
    redirect: "follow",
  });

  chain.push(`http:${response.status}`);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") ?? "";

  // Block binary content
  for (const prefix of BINARY_CONTENT_TYPES) {
    if (contentType.startsWith(prefix)) {
      throw new Error(`Unsupported binary content type: ${contentType}`);
    }
  }

  const body = await response.text();

  // Tier 1: Readability
  const htmlResult = extractHtml(body, url);
  if (htmlResult && htmlResult.text.length >= 500) {
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

  // Fallback: return raw text (stripped of HTML if possible)
  chain.push("raw-text");
  const rawText = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (rawText.length === 0) {
    throw new Error(
      `Could not extract content from ${url}. Tried: ${chain.join(" -> ")}`,
    );
  }
  return {
    text: rawText,
    title: undefined,
    url,
    extractionChain: chain,
    chars: rawText.length,
    truncated: false,
  };
}
