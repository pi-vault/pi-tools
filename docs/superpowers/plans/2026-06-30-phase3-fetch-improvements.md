# Phase 3: Fetch Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-URL fetch, raw HTML mode, and in-memory LRU content caching to web_fetch.

**Architecture:** New `ContentCache` LRU module, extended extraction pipeline with `raw` option, multi-URL concurrent orchestration in web_fetch tool with aggregate sizing, `fresh` flag for cache bypass.

**Tech Stack:** TypeScript, Vitest, existing pi-tools extraction pipeline.

---

### Task 1: Create `ContentCache` LRU module (`src/cache.ts`)

**Files:**
- Create: `src/cache.ts`
- Create: `tests/cache.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/cache.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentCache } from "../src/cache.ts";
import type { ExtractedContent } from "../src/extract/pipeline.ts";

function makeContent(url: string, text?: string): ExtractedContent {
  const t = text ?? `Content for ${url}`;
  return {
    text: t,
    title: `Title for ${url}`,
    url,
    extractionChain: ["http:200", "readability"],
    chars: t.length,
    truncated: false,
  };
}

describe("ContentCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns undefined for cache miss", () => {
    const cache = new ContentCache(100, 300_000);
    expect(cache.get("https://example.com/miss")).toBeUndefined();
  });

  it("stores and retrieves content", () => {
    const cache = new ContentCache(100, 300_000);
    const content = makeContent("https://example.com/page");
    cache.set("https://example.com/page", content);
    const hit = cache.get("https://example.com/page");
    expect(hit).toBeDefined();
    expect(hit!.text).toBe("Content for https://example.com/page");
    expect(hit!.title).toBe("Title for https://example.com/page");
  });

  it("evicts oldest entry when maxSize is exceeded", () => {
    const cache = new ContentCache(3, 300_000);
    cache.set("https://a.com", makeContent("https://a.com"));
    cache.set("https://b.com", makeContent("https://b.com"));
    cache.set("https://c.com", makeContent("https://c.com"));

    // Adding a 4th should evict "a" (oldest)
    cache.set("https://d.com", makeContent("https://d.com"));
    expect(cache.get("https://a.com")).toBeUndefined();
    expect(cache.get("https://b.com")).toBeDefined();
    expect(cache.get("https://c.com")).toBeDefined();
    expect(cache.get("https://d.com")).toBeDefined();
  });

  it("expires entries after TTL", () => {
    const cache = new ContentCache(100, 5_000); // 5 second TTL
    cache.set("https://example.com/ttl", makeContent("https://example.com/ttl"));

    // Before TTL: hit
    vi.advanceTimersByTime(4_999);
    expect(cache.get("https://example.com/ttl")).toBeDefined();

    // After TTL: miss
    vi.advanceTimersByTime(2);
    expect(cache.get("https://example.com/ttl")).toBeUndefined();
  });

  it("refreshes insertion order when overwriting an existing key", () => {
    const cache = new ContentCache(3, 300_000);
    cache.set("https://a.com", makeContent("https://a.com"));
    cache.set("https://b.com", makeContent("https://b.com"));
    cache.set("https://c.com", makeContent("https://c.com"));

    // Overwrite "a" — it becomes the newest
    cache.set("https://a.com", makeContent("https://a.com", "Updated"));
    // Adding a 4th should now evict "b" (the oldest remaining)
    cache.set("https://d.com", makeContent("https://d.com"));
    expect(cache.get("https://a.com")).toBeDefined();
    expect(cache.get("https://a.com")!.text).toBe("Updated");
    expect(cache.get("https://b.com")).toBeUndefined();
  });

  it("clear() removes all entries", () => {
    const cache = new ContentCache(100, 300_000);
    cache.set("https://a.com", makeContent("https://a.com"));
    cache.set("https://b.com", makeContent("https://b.com"));
    cache.clear();
    expect(cache.get("https://a.com")).toBeUndefined();
    expect(cache.get("https://b.com")).toBeUndefined();
  });

  it("handles zero maxSize gracefully (never stores)", () => {
    const cache = new ContentCache(0, 300_000);
    cache.set("https://a.com", makeContent("https://a.com"));
    expect(cache.get("https://a.com")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/cache.test.ts`
Expected: FAIL — `src/cache.ts` does not exist

- [ ] **Step 3: Implement `ContentCache`**

Create `src/cache.ts`:

```ts
import type { ExtractedContent } from "./extract/pipeline.ts";

interface CacheEntry {
  content: ExtractedContent;
  storedAt: number;
}

export class ContentCache {
  private entries = new Map<string, CacheEntry>();
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize: number, ttlMs: number) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(url: string): ExtractedContent | undefined {
    const entry = this.entries.get(url);
    if (!entry) return undefined;

    // Check TTL expiry
    if (Date.now() - entry.storedAt > this.ttlMs) {
      this.entries.delete(url);
      return undefined;
    }

    return entry.content;
  }

  set(url: string, content: ExtractedContent): void {
    if (this.maxSize <= 0) return;

    // Delete first so re-insert moves to end of insertion order
    if (this.entries.has(url)) {
      this.entries.delete(url);
    }

    // Evict oldest entry if at capacity
    while (this.entries.size >= this.maxSize) {
      const oldest = this.entries.keys().next().value!;
      this.entries.delete(oldest);
    }

    this.entries.set(url, { content, storedAt: Date.now() });
  }

  clear(): void {
    this.entries.clear();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/cache.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cache.ts tests/cache.test.ts
git commit -m "feat: add ContentCache LRU module with TTL expiry"
```

---

### Task 2: Add `raw` option to extraction pipeline

**Files:**
- Modify: `src/extract/pipeline.ts`
- Modify: `tests/extract/pipeline.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/extract/pipeline.test.ts` inside the existing `describe` block (or as a new top-level `describe`):

```ts
import { extractContent } from "../../src/extract/pipeline.ts";

describe("extractContent raw mode", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("returns raw HTML body without parsing when raw is true", async () => {
    const rawHtml = `<!DOCTYPE html><html><head><title>Raw</title></head><body>
<div class="sidebar">Nav</div>
<article><h1>Title</h1><p>Content</p></article>
</body></html>`;

    fetchStub.addResponse("example.com/raw", {
      body: rawHtml,
      headers: { "content-type": "text/html" },
    });

    const result = await extractContent(
      "https://example.com/raw",
      undefined,
      { raw: true },
    );
    expect(result.text).toBe(rawHtml);
    expect(result.extractionChain).toContain("raw");
    expect(result.chars).toBe(rawHtml.length);
  });

  it("raw mode still blocks SSRF URLs", async () => {
    await expect(
      extractContent("http://127.0.0.1/admin", undefined, { raw: true }),
    ).rejects.toThrow(/blocked/i);
  });

  it("raw mode still blocks binary content types", async () => {
    fetchStub.addResponse("example.com/image", {
      body: "binary-data",
      headers: { "content-type": "image/png" },
    });

    await expect(
      extractContent("https://example.com/image", undefined, { raw: true }),
    ).rejects.toThrow(/unsupported binary/i);
  });

  it("raw mode returns body for non-HTML content types", async () => {
    const jsonBody = '{"key": "value", "items": [1, 2, 3]}';
    fetchStub.addResponse("example.com/api", {
      body: jsonBody,
      headers: { "content-type": "application/json" },
    });

    const result = await extractContent(
      "https://example.com/api",
      undefined,
      { raw: true },
    );
    expect(result.text).toBe(jsonBody);
    expect(result.extractionChain).toContain("raw");
  });

  it("raw mode propagates HTTP errors normally", async () => {
    fetchStub.addResponse("example.com/err", {
      status: 404,
      body: "Not Found",
      headers: { "content-type": "text/html" },
    });

    await expect(
      extractContent("https://example.com/err", undefined, { raw: true }),
    ).rejects.toThrow(/404/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/extract/pipeline.test.ts`
Expected: FAIL — `extractContent` does not accept a third argument

- [ ] **Step 3: Implement the `raw` option**

In `src/extract/pipeline.ts`, update the `extractContent` signature and add an early return for raw mode.

Replace the existing function signature:

```ts
export async function extractContent(
  url: string,
  signal?: AbortSignal,
): Promise<ExtractedContent> {
```

With:

```ts
export interface ExtractOptions {
  raw?: boolean;
}

export async function extractContent(
  url: string,
  signal?: AbortSignal,
  options?: ExtractOptions,
): Promise<ExtractedContent> {
```

Then, after the binary content-type blocking check (the `for (const prefix of BINARY_CONTENT_TYPES)` block) but **before** the PDF handling block, add the raw-mode early return:

```ts
  // Raw mode: return HTTP body as-is after SSRF + binary-type validation
  if (options?.raw) {
    // PDF in raw mode: return as text (will be garbled, but user asked for raw)
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
```

The full function after modification should be:

```ts
export interface ExtractOptions {
  raw?: boolean;
}

export async function extractContent(
  url: string,
  signal?: AbortSignal,
  options?: ExtractOptions,
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
    const status = response.status;
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
    // ... (existing PDF handling unchanged)
  }

  // ... (rest of pipeline unchanged: Readability, RSC, Jina, raw-text fallback)
}
```

**Note:** The `RetryableExtractionError` class is already present from Phase 1. If Phase 1 has not been applied yet, the `!response.ok` block will still use plain `Error` for all statuses — in that case, leave it as-is. The raw-mode insertion point is the same regardless.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/extract/pipeline.test.ts`
Expected: All tests PASS (both existing and new)

- [ ] **Step 5: Commit**

```bash
git add src/extract/pipeline.ts tests/extract/pipeline.test.ts
git commit -m "feat: add raw option to extractContent pipeline"
```

---

### Task 3: Integrate cache into web_fetch (single-URL path)

**Files:**
- Modify: `src/tools/web-fetch.ts`
- Modify: `tests/tools/web-fetch.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/tools/web-fetch.test.ts`:

```ts
import { ContentCache } from "../../src/cache.ts";

describe("web_fetch caching", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("returns cached content on second call without re-fetching", async () => {
    fetchStub.addResponse("example.com/cached", {
      body: GOOD_HTML,
      headers: { "content-type": "text/html" },
    });

    const store = new ContentStore(() => {});
    const cache = new ContentCache(100, 300_000);
    const tool = createWebFetchTool(store, undefined, cache);
    const ctx = makeCtx();

    // First call — fetches from network
    const result1 = await tool.execute(
      "call-c1",
      { url: "https://example.com/cached" },
      undefined,
      undefined,
      ctx,
    );
    expect((result1.content[0] as { type: "text"; text: string }).text).toContain("Article Title");

    // Clear fetch routes to prove second call doesn't fetch
    fetchStub.restore();
    const emptyFetch = stubFetch();

    const result2 = await tool.execute(
      "call-c2",
      { url: "https://example.com/cached" },
      undefined,
      undefined,
      ctx,
    );
    expect((result2.content[0] as { type: "text"; text: string }).text).toContain("Article Title");

    emptyFetch.restore();
  });

  it("works without a cache (backward compatible)", async () => {
    fetchStub.addResponse("example.com/nocache", {
      body: GOOD_HTML,
      headers: { "content-type": "text/html" },
    });

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    const ctx = makeCtx();

    const result = await tool.execute(
      "call-c3",
      { url: "https://example.com/nocache" },
      undefined,
      undefined,
      ctx,
    );
    expect((result.content[0] as { type: "text"; text: string }).text).toContain("Article Title");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tools/web-fetch.test.ts`
Expected: FAIL — `createWebFetchTool` does not accept a third argument

- [ ] **Step 3: Implement cache integration**

In `src/tools/web-fetch.ts`, add the cache parameter and wire it into the single-URL fetch path.

Add the import at the top:

```ts
import type { ContentCache } from "../cache.ts";
```

Update the function signature:

```ts
export function createWebFetchTool(
  store: ContentStore,
  resolveFetchCandidates?: () => FetchProvider[],
  cache?: ContentCache,
): ToolDefinition<typeof WebFetchParams, WebFetchDetails> {
```

In the `execute` method, add cache lookup before `extractContent` and cache write after successful extraction. Replace the try block inside `execute` (the single-URL direct path):

```ts
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      try {
        // Check cache first
        const cached = cache?.get(params.url);
        if (cached) {
          return buildResult(cached, params.url, store);
        }

        const extracted = await extractContent(params.url, signal ?? undefined);

        // Write to cache
        cache?.set(params.url, extracted);

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
            const extracted: ExtractedContent = {
              text: fetchResult.text,
              title: fetchResult.title,
              url: params.url,
              extractionChain: [`fetch-provider:${provider.name}`],
              chars: fetchResult.text.length,
              truncated: false,
            };

            // Write provider result to cache too
            cache?.set(params.url, extracted);

            return buildResult(extracted, params.url, store);
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
```

Also add the `ExtractedContent` import at the top of the file:

```ts
import type { ExtractedContent } from "../extract/pipeline.ts";
```

Update the existing import from `../extract/pipeline.ts` to include `ExtractedContent`:

```ts
import { extractContent, RetryableExtractionError } from "../extract/pipeline.ts";
```

becomes:

```ts
import { extractContent, RetryableExtractionError, type ExtractedContent } from "../extract/pipeline.ts";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/tools/web-fetch.test.ts`
Expected: All tests PASS (existing + new cache tests)

- [ ] **Step 5: Commit**

```bash
git add src/tools/web-fetch.ts tests/tools/web-fetch.test.ts
git commit -m "feat: integrate ContentCache into web_fetch single-URL path"
```

---

### Task 4: Add multi-URL support to web_fetch

**Files:**
- Modify: `src/tools/web-fetch.ts`
- Modify: `tests/tools/web-fetch.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/tools/web-fetch.test.ts`:

```ts
describe("web_fetch multi-URL", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("rejects when both url and urls are provided", async () => {
    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-m1",
      { url: "https://a.com", urls: ["https://b.com"] } as any,
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text.toLowerCase()).toContain("error");
    expect(text).toContain("exactly one");
  });

  it("rejects when neither url nor urls is provided", async () => {
    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-m2",
      {} as any,
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text.toLowerCase()).toContain("error");
    expect(text).toContain("exactly one");
  });

  it("rejects urls array longer than 20", async () => {
    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    const ctx = makeCtx();
    const urls = Array.from({ length: 21 }, (_, i) => `https://example.com/${i}`);
    const result = await tool.execute(
      "call-m3",
      { urls } as any,
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text.toLowerCase()).toContain("error");
    expect(text).toContain("20");
  });

  it("fetches 2 URLs concurrently with split budget", async () => {
    const html1 = `<!DOCTYPE html><html><head><title>Page One</title></head><body>
<article><h1>Page One</h1><p>${"First page content. ".repeat(30)}</p></article></body></html>`;
    const html2 = `<!DOCTYPE html><html><head><title>Page Two</title></head><body>
<article><h1>Page Two</h1><p>${"Second page content. ".repeat(30)}</p></article></body></html>`;

    fetchStub.addResponse("example.com/one", {
      body: html1,
      headers: { "content-type": "text/html" },
    });
    fetchStub.addResponse("example.com/two", {
      body: html2,
      headers: { "content-type": "text/html" },
    });

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-m4",
      { urls: ["https://example.com/one", "https://example.com/two"] },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Page One");
    expect(text).toContain("Page Two");
    expect(result.details.urlResults).toHaveLength(2);
  });

  it("stores full content for multi-URL via ContentStore", async () => {
    const html1 = `<!DOCTYPE html><html><head><title>Stored</title></head><body>
<article><h1>Stored Page</h1><p>${"Stored content. ".repeat(30)}</p></article></body></html>`;

    fetchStub.addResponse("example.com/stored", {
      body: html1,
      headers: { "content-type": "text/html" },
    });

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-m5",
      { urls: ["https://example.com/stored"] },
      undefined,
      undefined,
      ctx,
    );
    // Single URL in urls array still gets full INLINE_LIMIT budget
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Stored Page");
  });

  it("handles partial failures in multi-URL mode", async () => {
    fetchStub.addResponse("example.com/ok", {
      body: GOOD_HTML,
      headers: { "content-type": "text/html" },
    });
    fetchStub.addResponse("example.com/fail", {
      status: 500,
      body: "Server Error",
      headers: { "content-type": "text/html" },
    });

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-m6",
      { urls: ["https://example.com/ok", "https://example.com/fail"] },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Article Title");
    expect(result.details.urlResults).toHaveLength(2);
    const failResult = result.details.urlResults!.find(
      (r: any) => r.url === "https://example.com/fail",
    );
    expect(failResult!.error).toBeDefined();
  });

  it("uses manifest mode (512 char preview) for 6+ URLs", async () => {
    const urls: string[] = [];
    for (let i = 0; i < 6; i++) {
      const domain = `site${i}.com`;
      urls.push(`https://${domain}/page`);
      fetchStub.addResponse(`${domain}/page`, {
        body: `<!DOCTYPE html><html><head><title>Site ${i}</title></head><body>
<article><h1>Site ${i}</h1><p>${"Content for this site. ".repeat(50)}</p></article></body></html>`,
        headers: { "content-type": "text/html" },
      });
    }

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-m7",
      { urls },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    // Each preview should be capped at 512 chars
    expect(result.details.urlResults).toHaveLength(6);
    // All should have contentIds for full retrieval
    for (const ur of result.details.urlResults!) {
      if (!(ur as any).error) {
        expect((ur as any).contentId).toBeDefined();
      }
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tools/web-fetch.test.ts`
Expected: FAIL — `urls` parameter not recognized, `urlResults` not in details

- [ ] **Step 3: Update the parameter schema**

In `src/tools/web-fetch.ts`, replace the `WebFetchParams` definition:

```ts
const WebFetchParams = Type.Object({
  url: Type.Optional(Type.String({ description: "HTTP(S) URL to fetch" })),
  urls: Type.Optional(
    Type.Array(Type.String(), {
      maxItems: 20,
      description: "Multiple URLs to fetch concurrently",
    }),
  ),
  raw: Type.Optional(
    Type.Boolean({ default: false, description: "Return raw HTML without extraction" }),
  ),
  fresh: Type.Optional(
    Type.Boolean({ default: false, description: "Bypass content cache" }),
  ),
});
```

Update the `WebFetchDetails` interface to support multi-URL results:

```ts
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
```

- [ ] **Step 4: Implement multi-URL orchestration**

Add a concurrency-limited multi-fetch helper inside `src/tools/web-fetch.ts`, after the imports and before `createWebFetchTool`:

```ts
const MANIFEST_PREVIEW_CHARS = 512;
const MAX_CONCURRENT = 5;

function computePerUrlCap(count: number): number {
  if (count <= 1) return INLINE_LIMIT;
  if (count <= 5) return Math.floor(INLINE_LIMIT / count);
  return MANIFEST_PREVIEW_CHARS;
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
```

- [ ] **Step 5: Implement the multi-URL execute path**

Replace the `execute` method in the tool definition with a version that handles both single-URL and multi-URL. The full `execute` method:

```ts
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const hasUrl = params.url !== undefined && params.url !== "";
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

      // --- Single-URL path ---
      if (hasUrl) {
        return this.executeSingleUrl(params.url!, params, signal, store, cache);
      }

      // --- Multi-URL path ---
      const urls = params.urls!;
      const perUrlCap = computePerUrlCap(urls.length);
      const isManifest = urls.length >= 6;

      const tasks = urls.map((u) => async () => {
        // Check cache first (unless fresh)
        if (!params.fresh) {
          const cached = cache?.get(u);
          if (cached) return cached;
        }

        const extracted = await extractContent(
          u,
          signal ?? undefined,
          params.raw ? { raw: true } : undefined,
        );

        // Write to cache
        cache?.set(u, extracted);

        return extracted;
      });

      const settled = await fetchWithConcurrencyLimit(tasks, MAX_CONCURRENT);

      const urlResults: UrlResult[] = [];
      const outputParts: string[] = [];

      for (let i = 0; i < urls.length; i++) {
        const outcome = settled[i];
        if (outcome.status === "rejected") {
          const errMsg = outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason);
          urlResults.push({
            url: urls[i],
            chars: 0,
            error: errMsg,
          });
          outputParts.push(`## ${urls[i]}\n\nError: ${errMsg}\n`);
          continue;
        }

        const extracted = outcome.value;

        // Always store full content for multi-URL retrieval via web_read
        const contentId = store.store({
          url: extracted.url,
          title: extracted.title,
          text: extracted.text,
          source: "web_fetch",
        });

        // Build preview text with per-URL cap
        const preview = extracted.chars > perUrlCap
          ? truncateContent(extracted.text, perUrlCap).text
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

      const succeeded = urlResults.filter((r) => !r.error).length;
      const failed = urlResults.filter((r) => r.error).length;
      const summary = `Fetched ${succeeded}/${urls.length} URLs successfully${failed > 0 ? ` (${failed} failed)` : ""}${isManifest ? ". Use web_read with contentId for full text." : ""}\n\n`;

      return {
        content: [{ type: "text" as const, text: summary + outputParts.join("\n---\n\n") }],
        details: {
          url: urls[0],
          chars: urlResults.reduce((sum, r) => sum + r.chars, 0),
          truncated: urlResults.some((r) => !r.error && r.chars > perUrlCap),
          extractionChain: ["multi-url"],
          urlResults,
        },
      };
    },
```

To keep the single-URL path clean, extract it into a private helper. Since we're inside an object literal, use a local function defined before the return statement in `createWebFetchTool`:

```ts
export function createWebFetchTool(
  store: ContentStore,
  resolveFetchCandidates?: () => FetchProvider[],
  cache?: ContentCache,
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
        signal ?? undefined,
        params.raw ? { raw: true } : undefined,
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

      const errors: Array<{ provider: string; error: string }> = [
        { provider: "http", error: pipelineError.message },
      ];

      for (const provider of candidates) {
        try {
          const fetchResult = await provider.fetch(url, signal ?? undefined);
          const extracted: ExtractedContent = {
            text: fetchResult.text,
            title: fetchResult.title,
            url,
            extractionChain: [`fetch-provider:${provider.name}`],
            chars: fetchResult.text.length,
            truncated: false,
          };

          // Write provider result to cache
          cache?.set(url, extracted);

          return buildResult(extracted, url, store);
        } catch (providerError) {
          errors.push({
            provider: provider.name,
            error: providerError instanceof Error ? providerError.message : String(providerError),
          });
        }
      }

      const aggregate = new AggregateProviderError("fetch", errors);
      return errorResult(url, `Fetch error: ${aggregate.message}`);
    }
  }

  return {
    name: "web_fetch",
    // ... rest of tool definition
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const hasUrl = params.url !== undefined && params.url !== "";
      const hasUrls = params.urls !== undefined && params.urls.length > 0;

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
      const perUrlCap = computePerUrlCap(urls.length);
      const isManifest = urls.length >= 6;

      const tasks = urls.map((u) => async () => {
        if (!params.fresh) {
          const cached = cache?.get(u);
          if (cached) return cached;
        }

        const extracted = await extractContent(
          u,
          signal ?? undefined,
          params.raw ? { raw: true } : undefined,
        );

        cache?.set(u, extracted);
        return extracted;
      });

      const settled = await fetchWithConcurrencyLimit(tasks, MAX_CONCURRENT);

      const urlResults: UrlResult[] = [];
      const outputParts: string[] = [];

      for (let i = 0; i < urls.length; i++) {
        const outcome = settled[i];
        if (outcome.status === "rejected") {
          const errMsg = outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason);
          urlResults.push({ url: urls[i], chars: 0, error: errMsg });
          outputParts.push(`## ${urls[i]}\n\nError: ${errMsg}\n`);
          continue;
        }

        const extracted = outcome.value;
        const contentId = store.store({
          url: extracted.url,
          title: extracted.title,
          text: extracted.text,
          source: "web_fetch",
        });

        const preview = extracted.chars > perUrlCap
          ? truncateContent(extracted.text, perUrlCap).text
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

      const succeeded = urlResults.filter((r) => !r.error).length;
      const failed = urlResults.filter((r) => r.error).length;
      const summary = `Fetched ${succeeded}/${urls.length} URLs successfully${failed > 0 ? ` (${failed} failed)` : ""}${isManifest ? ". Use web_read with contentId for full text." : ""}\n\n`;

      return {
        content: [{ type: "text" as const, text: summary + outputParts.join("\n---\n\n") }],
        details: {
          url: urls[0],
          chars: urlResults.reduce((sum, r) => sum + r.chars, 0),
          truncated: urlResults.some((r) => !r.error && r.chars > perUrlCap),
          extractionChain: ["multi-url"],
          urlResults,
        },
      };
    },
    // ... renderCall, renderResult unchanged
  };
}
```

- [ ] **Step 6: Update `renderCall` to handle `urls` parameter**

The existing `renderCall` references `args.url`. Update it to handle both:

```ts
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
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/tools/web-fetch.test.ts`
Expected: All tests PASS (existing single-URL + new multi-URL tests)

- [ ] **Step 8: Commit**

```bash
git add src/tools/web-fetch.ts tests/tools/web-fetch.test.ts
git commit -m "feat: add multi-URL concurrent fetch with aggregate sizing"
```

---

### Task 5: Add `fresh` parameter for cache bypass

**Files:**
- Modify: `src/tools/web-fetch.ts` (already has `fresh` in schema from Task 4)
- Modify: `tests/tools/web-fetch.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/tools/web-fetch.test.ts`:

```ts
describe("web_fetch fresh parameter", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("bypasses cache when fresh is true", async () => {
    const html1 = `<!DOCTYPE html><html><head><title>V1</title></head><body>
<article><h1>Version 1</h1><p>${"First version content. ".repeat(30)}</p></article></body></html>`;
    const html2 = `<!DOCTYPE html><html><head><title>V2</title></head><body>
<article><h1>Version 2</h1><p>${"Second version content. ".repeat(30)}</p></article></body></html>`;

    fetchStub.addResponse("example.com/changing", {
      body: html1,
      headers: { "content-type": "text/html" },
    });

    const store = new ContentStore(() => {});
    const cache = new ContentCache(100, 300_000);
    const tool = createWebFetchTool(store, undefined, cache);
    const ctx = makeCtx();

    // First fetch — populates cache with V1
    const result1 = await tool.execute(
      "call-f1",
      { url: "https://example.com/changing" },
      undefined,
      undefined,
      ctx,
    );
    expect((result1.content[0] as { type: "text"; text: string }).text).toContain("Version 1");

    // Update the response to V2
    fetchStub.restore();
    const freshStub = stubFetch();
    freshStub.addResponse("example.com/changing", {
      body: html2,
      headers: { "content-type": "text/html" },
    });

    // Without fresh: still gets V1 from cache
    const result2 = await tool.execute(
      "call-f2",
      { url: "https://example.com/changing" },
      undefined,
      undefined,
      ctx,
    );
    expect((result2.content[0] as { type: "text"; text: string }).text).toContain("Version 1");

    // With fresh: bypasses cache, gets V2
    const result3 = await tool.execute(
      "call-f3",
      { url: "https://example.com/changing", fresh: true },
      undefined,
      undefined,
      ctx,
    );
    expect((result3.content[0] as { type: "text"; text: string }).text).toContain("Version 2");

    // Cache now has V2 — subsequent non-fresh call returns V2
    const result4 = await tool.execute(
      "call-f4",
      { url: "https://example.com/changing" },
      undefined,
      undefined,
      ctx,
    );
    expect((result4.content[0] as { type: "text"; text: string }).text).toContain("Version 2");

    freshStub.restore();
  });

  it("fresh still writes back to cache", async () => {
    fetchStub.addResponse("example.com/writeback", {
      body: GOOD_HTML,
      headers: { "content-type": "text/html" },
    });

    const store = new ContentStore(() => {});
    const cache = new ContentCache(100, 300_000);
    const tool = createWebFetchTool(store, undefined, cache);
    const ctx = makeCtx();

    // Fresh fetch — should write to cache
    await tool.execute(
      "call-f5",
      { url: "https://example.com/writeback", fresh: true },
      undefined,
      undefined,
      ctx,
    );

    // Second call without fresh — should hit cache
    fetchStub.restore();
    const emptyStub = stubFetch();

    const result = await tool.execute(
      "call-f6",
      { url: "https://example.com/writeback" },
      undefined,
      undefined,
      ctx,
    );
    expect((result.content[0] as { type: "text"; text: string }).text).toContain("Article Title");

    emptyStub.restore();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tools/web-fetch.test.ts`
Expected: FAIL — The `fresh` parameter is in the schema (from Task 4) but the `executeSingleUrl` function does not check `params.fresh` to skip the cache lookup. The code from Task 3 checks `cache?.get()` unconditionally.

If Task 4 was implemented correctly with the `params.fresh` guard already in place, the tests should PASS. In that case, skip to Step 4.

- [ ] **Step 3: Implement fresh bypass in `executeSingleUrl`**

This should already be implemented in Task 4's `executeSingleUrl`. Verify that the cache lookup is guarded:

```ts
      // Check cache first (unless fresh)
      if (!params.fresh) {
        const cached = cache?.get(url);
        if (cached) {
          return buildResult(cached, url, store);
        }
      }
```

If the guard is missing from Task 3's implementation, add it now. The cache write-back after fetch should remain unconditional (always write, even when `fresh` is true).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/tools/web-fetch.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/web-fetch.ts tests/tools/web-fetch.test.ts
git commit -m "feat: add fresh parameter for cache bypass in web_fetch"
```

---

### Task 6: Add `raw` mode test for web_fetch tool level

**Files:**
- Modify: `tests/tools/web-fetch.test.ts`

- [ ] **Step 1: Write the tests**

Add to `tests/tools/web-fetch.test.ts`:

```ts
describe("web_fetch raw mode", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("returns raw HTML when raw is true", async () => {
    const rawHtml = `<!DOCTYPE html><html><head><title>Raw</title></head><body>
<div class="sidebar">Sidebar nav content</div>
<article><h1>Article</h1><p>Article text</p></article>
</body></html>`;

    fetchStub.addResponse("example.com/raw", {
      body: rawHtml,
      headers: { "content-type": "text/html" },
    });

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    const ctx = makeCtx();

    const result = await tool.execute(
      "call-r1",
      { url: "https://example.com/raw", raw: true },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    // Raw mode preserves HTML tags that would normally be stripped
    expect(text).toContain("<div class=\"sidebar\">");
    expect(text).toContain("Sidebar nav content");
  });

  it("returns extracted content when raw is false (default)", async () => {
    const htmlWithSidebar = `<!DOCTYPE html><html><head><title>Normal</title></head><body>
<div class="sidebar">Nav stuff</div>
<article><h1>Article</h1><p>${"Meaningful paragraph. ".repeat(30)}</p></article>
</body></html>`;

    fetchStub.addResponse("example.com/normal", {
      body: htmlWithSidebar,
      headers: { "content-type": "text/html" },
    });

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    const ctx = makeCtx();

    const result = await tool.execute(
      "call-r2",
      { url: "https://example.com/normal" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    // Normal mode strips nav/sidebar via Readability
    expect(text).toContain("Article");
    expect(text).not.toContain("<div class=\"sidebar\">");
  });

  it("raw mode works with multi-URL", async () => {
    fetchStub.addResponse("example.com/raw1", {
      body: "<html><body><p>Raw 1</p></body></html>",
      headers: { "content-type": "text/html" },
    });
    fetchStub.addResponse("example.com/raw2", {
      body: "<html><body><p>Raw 2</p></body></html>",
      headers: { "content-type": "text/html" },
    });

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    const ctx = makeCtx();

    const result = await tool.execute(
      "call-r3",
      {
        urls: ["https://example.com/raw1", "https://example.com/raw2"],
        raw: true,
      },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("<p>Raw 1</p>");
    expect(text).toContain("<p>Raw 2</p>");
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/tools/web-fetch.test.ts`
Expected: All tests PASS (raw option was wired through in Tasks 2 and 4)

- [ ] **Step 3: Commit**

```bash
git add tests/tools/web-fetch.test.ts
git commit -m "test: add web_fetch raw mode integration tests"
```

---

### Task 7: Full regression test

**Files:** None (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: All tests PASS across all test files

- [ ] **Step 2: Run type checking**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Verify the complete file structure**

Confirm these files were created or modified:

| File | Action |
| --- | --- |
| `src/cache.ts` | Created |
| `src/extract/pipeline.ts` | Modified (added `ExtractOptions`, `raw` early-return) |
| `src/tools/web-fetch.ts` | Modified (new params, cache, multi-URL, raw, fresh) |
| `tests/cache.test.ts` | Created |
| `tests/extract/pipeline.test.ts` | Modified (added raw mode tests) |
| `tests/tools/web-fetch.test.ts` | Modified (added cache, multi-URL, fresh, raw tests) |

- [ ] **Step 4: Verify no unused imports or dead code**

Scan modified files for:
- Unused imports in `src/tools/web-fetch.ts` (especially the old single-param `WebFetchParams`)
- Unused imports in `src/extract/pipeline.ts`
- Any leftover `TODO` or `FIXME` comments

- [ ] **Step 5: Final commit if any cleanup was needed**

```bash
git add -A
git commit -m "chore: phase 3 cleanup and regression verification"
```
