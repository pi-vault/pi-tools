// src/tools/web-fetch-multi.ts
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ContentStore } from "../storage.ts";
import {
  extractContent,
  collectImageBlocks,
  type ExtractedContent,
  type ImageBlock,
} from "../extract/pipeline.ts";
import { truncateContent } from "../utils/truncate.ts";
import { fetchWithConcurrencyLimit } from "../utils/concurrency.ts";
import type { ContentCache } from "../cache.ts";

const INLINE_LIMIT = 15_000;
const MANIFEST_PREVIEW_CHARS = 512;
const MAX_CONCURRENT = 5;

export interface UrlResult {
  url: string;
  title?: string;
  chars: number;
  contentId?: string;
  error?: string;
}

function perUrlCap(count: number): number {
  return count <= 1
    ? INLINE_LIMIT
    : count <= 5
      ? Math.floor(INLINE_LIMIT / count)
      : MANIFEST_PREVIEW_CHARS;
}

export interface MultiUrlOptions {
  urls: string[];
  params: {
    raw?: boolean;
    fresh?: boolean;
    prompt?: string;
    timestamp?: string;
    frames?: number;
    model?: string;
  };
  signal: AbortSignal | undefined;
  store: ContentStore;
  cache?: ContentCache;
  ctx?: ExtensionContext;
}

export async function executeMultiUrl(options: MultiUrlOptions): Promise<{
  content: Array<{ type: "text"; text: string } | ImageBlock>;
  details: {
    url: string;
    chars: number;
    truncated: boolean;
    extractionChain: string[];
    urlResults: UrlResult[];
  };
}> {
  const {
    urls,
    params,
    signal,
    store,
    cache,
    ctx,
  } = options;
  const cap = perUrlCap(urls.length);
  const isManifest = urls.length >= 6;

  // Deduplicate URLs — fetch each unique URL once, reuse results
  const uniqueUrls = [...new Set(urls)];
  const tasks = uniqueUrls.map((u) => async () => {
    if (!params.fresh) {
      const cached = cache?.get(u);
      if (cached) return cached;
    }

    const extracted = await extractContent(u, signal ?? undefined, {
      raw: params.raw,
      prompt: params.prompt,
      timestamp: params.timestamp,
      frames: params.frames,
      model: params.model,
      ctx,
    });

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
  const imageBlocks: ImageBlock[] = [];

  for (const u of urls) {
    const outcome = resultByUrl.get(u)!;
    if (outcome.status === "rejected") {
      const errMsg =
        outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
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

    const preview =
      extracted.chars > cap ? truncateContent(extracted.text, cap) : extracted.text;

    urlResults.push({
      url: extracted.url,
      title: extracted.title,
      chars: extracted.chars,
      contentId,
    });

    const header = extracted.title ? `## ${extracted.title}` : `## ${extracted.url}`;
    const meta = `Source: ${extracted.url} | ${extracted.chars} chars | contentId: ${contentId}`;
    outputParts.push(`${header}\n${meta}\n\n${preview}\n`);
    imageBlocks.push(...collectImageBlocks(extracted));
  }

  const failed = urlResults.filter((r) => r.error).length;
  const succeeded = urls.length - failed;
  const summary = `Fetched ${succeeded}/${urls.length} URLs successfully${failed > 0 ? ` (${failed} failed)` : ""}${isManifest ? ". Use web_read with contentId for full text." : ""}\n\n`;

  return {
    content: [
      { type: "text" as const, text: summary + outputParts.join("\n---\n\n") },
      ...imageBlocks,
    ],
    details: {
      url: urls[0],
      chars: urlResults.reduce((sum, r) => sum + r.chars, 0),
      truncated: urlResults.some((r) => !r.error && r.chars > cap),
      extractionChain: ["multi-url"],
      urlResults,
    },
  };
}
