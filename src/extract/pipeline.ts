import { DEFAULT_GITHUB_CONFIG, type GitHubConfig } from "../config.ts";
import { validateUrl } from "../utils/ssrf.ts";
import { extractGitHub, parseGitHubUrl } from "./github.ts";
import { extractHtml } from "./html.ts";
import { extractPdf } from "./pdf.ts";
import { extractRsc } from "./rsc.ts";
import { extractViaJinaReader } from "./jina-reader.ts";

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

export interface ExtractOptions {
  raw?: boolean;
  github?: GitHubConfig;
  allowRanges?: string[];
}

export async function extractContent(
  url: string,
  signal?: AbortSignal,
  options?: ExtractOptions,
): Promise<ExtractedContent> {
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
