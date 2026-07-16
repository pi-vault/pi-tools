# Phase 4: Collapse web-fetch-multi into web-fetch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Absorb `src/tools/web-fetch-multi.ts` (170 lines) into `src/tools/web-fetch.ts`, giving multi-URL fetches per-URL provider fallback on `RetryableExtractionError` to match single-URL behavior.

**Architecture:** After Phase 3 removed config threading from `MultiUrlOptions` and `ExtractOptions`, the multi-URL module shares all dependencies with `web-fetch.ts`. Collapsing eliminates the asymmetry where single-URL fetches fall back to `FetchProvider` but multi-URL fetches do not.

**Tech Stack:** TypeScript, Vitest, native `fetch`, `fetchWithConcurrencyLimit` from `src/utils/concurrency.ts`

**Spec:** `docs/superpowers/specs/2026-07-16-architecture-deepening-design.md` (Phase 4)

**Depends on:** Phase 3 (config fields already removed from `MultiUrlOptions` and `ExtractOptions`)

---

## Task 1: Move multi-URL types and functions into web-fetch.ts

**Files:**
- Modify: `src/tools/web-fetch.ts`

- [ ] **Step 1: Add the `fetchWithConcurrencyLimit` import to `src/tools/web-fetch.ts`**

In `src/tools/web-fetch.ts`, replace the import line:

```typescript
import { executeMultiUrl, type UrlResult } from "./web-fetch-multi.ts";
```

with:

```typescript
import { fetchWithConcurrencyLimit } from "../utils/concurrency.ts";
```

- [ ] **Step 2: Add multi-URL constants after the existing `INLINE_LIMIT` constant**

In `src/tools/web-fetch.ts`, after line `const INLINE_LIMIT = 15_000;`, add:

```typescript
const MANIFEST_PREVIEW_CHARS = 512;
const MAX_CONCURRENT = 5;
```

- [ ] **Step 3: Add `UrlResult` interface after the constants**

In `src/tools/web-fetch.ts`, after the new constants block (after `const MAX_CONCURRENT = 5;`), add:

```typescript
export interface UrlResult {
  url: string;
  title?: string;
  chars: number;
  contentId?: string;
  error?: string;
}
```

- [ ] **Step 4: Add `perUrlCap` helper function after `UrlResult`**

In `src/tools/web-fetch.ts`, after the `UrlResult` interface, add:

```typescript
function perUrlCap(count: number): number {
  return count <= 1
    ? INLINE_LIMIT
    : count <= 5
      ? Math.floor(INLINE_LIMIT / count)
      : MANIFEST_PREVIEW_CHARS;
}
```

- [ ] **Step 5: Add `MultiUrlOptions` interface after `perUrlCap`**

In `src/tools/web-fetch.ts`, after the `perUrlCap` function, add:

```typescript
interface MultiUrlOptions {
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
  resolveFetchCandidates?: () => FetchProvider[];
}
```

Note: `MultiUrlOptions` is no longer exported (it is only used within this file). It no longer carries `githubConfig`, `ssrfAllowRanges`, `pdfConfig`, or `geminiConfig` because Phase 3 moved config resolution into `extractContent`. It now includes `resolveFetchCandidates` for per-URL provider fallback.

- [ ] **Step 6: Add `executeMultiUrl` function after `MultiUrlOptions`**

In `src/tools/web-fetch.ts`, after the `MultiUrlOptions` interface, add the `executeMultiUrl` function. This version includes per-URL provider fallback when `extractContent` throws `RetryableExtractionError`:

```typescript
async function executeMultiUrl(options: MultiUrlOptions): Promise<{
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
    resolveFetchCandidates,
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

    try {
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
    } catch (pipelineError) {
      // Only fall back to providers for retryable errors
      if (!(pipelineError instanceof RetryableExtractionError)) {
        throw pipelineError;
      }

      // Try each registered FetchProvider as fallback (same as single-URL path)
      const candidates = resolveFetchCandidates?.() ?? [];
      if (candidates.length === 0) {
        throw pipelineError;
      }

      const { result: fetchResult, providerName } = await executeWithFallback({
        candidates: candidates.map((provider) => ({
          name: provider.name,
          execute: () => provider.fetch(u, signal),
        })),
        operation: "fetch",
      });

      const extracted: ExtractedContent = {
        text: fetchResult.text,
        title: fetchResult.title,
        url: u,
        extractionChain: [`fetch-provider:${providerName}`],
        chars: fetchResult.text.length,
        truncated: false,
      };

      cache?.set(u, extracted);
      return extracted;
    }
  });

  const settled = await fetchWithConcurrencyLimit(tasks, MAX_CONCURRENT);

  // Build a map from unique URL -> result for O(1) lookup by duplicates
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
```

- [ ] **Step 7: Remove unused imports from `src/tools/web-fetch.ts`**

After moving the code in, remove these imports that are no longer needed (they were only used by the old `web-fetch-multi.ts` import path):

Remove from the import of `../config.ts`:
```typescript
import type { GitHubConfig, GuidanceOverride, PdfConfig, GeminiConfig } from "../config.ts";
```

Replace with:
```typescript
import type { GuidanceOverride } from "../config.ts";
```

The `GitHubConfig`, `PdfConfig`, and `GeminiConfig` types are no longer needed in `web-fetch.ts` because Phase 3 moved config resolution into `extractContent`. The `createWebFetchTool` function signature will also be simplified in Task 3.

- [ ] **Step 8: Verify TypeScript compiles**

```bash
pnpm run typecheck
```

Expected: passes (the new code uses the same types and imports already available in web-fetch.ts).

---

## Task 2: Wire up the multi-URL path in execute() and simplify createWebFetchTool

**Files:**
- Modify: `src/tools/web-fetch.ts`

- [ ] **Step 1: Simplify the `createWebFetchTool` function signature**

In `src/tools/web-fetch.ts`, replace the existing function signature:

```typescript
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
```

with:

```typescript
export function createWebFetchTool(
  store: ContentStore,
  resolveFetchCandidates?: () => FetchProvider[],
  cache?: ContentCache,
  guidance?: GuidanceOverride,
): ToolDefinition<typeof WebFetchParams, WebFetchDetails> {
```

Note: `githubConfig`, `ssrfAllowRanges`, `pdfConfig`, and `geminiConfig` are removed because Phase 3 moved config resolution into `extractContent`. If Phase 3 has not yet removed these from `executeSingleUrl`, that must be done first. If Phase 3 is complete and `executeSingleUrl` already calls `extractContent` without these config params, this simplification is safe.

- [ ] **Step 2: Simplify the `executeSingleUrl` extractContent call**

In `src/tools/web-fetch.ts`, inside `executeSingleUrl`, replace the `extractContent` call:

```typescript
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
```

with:

```typescript
      const extracted = await extractContent(url, signal, {
        raw: params.raw,
        prompt: params.prompt,
        timestamp: params.timestamp,
        frames: params.frames,
        model: params.model,
        ctx,
      });
```

- [ ] **Step 3: Update the multi-URL call in `execute()` to pass `resolveFetchCandidates`**

In `src/tools/web-fetch.ts`, replace the multi-URL call block:

```typescript
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
```

with:

```typescript
      // Multi-URL path
      return executeMultiUrl({
        urls: params.urls!,
        params,
        signal: signal ?? undefined,
        store,
        cache,
        ctx,
        resolveFetchCandidates,
      });
```

- [ ] **Step 4: Update callers of `createWebFetchTool` if needed**

Search for all callers of `createWebFetchTool` and remove the `githubConfig`, `ssrfAllowRanges`, `pdfConfig`, and `geminiConfig` arguments:

```bash
grep -rn "createWebFetchTool" src/ tests/
```

If Phase 3 already removed these arguments from all call sites, no changes are needed. If any call sites still pass these arguments, remove them.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
pnpm run typecheck
```

Expected: passes.

- [ ] **Step 6: Run existing tests**

```bash
pnpm vitest run tests/tools/web-fetch.test.ts
```

Expected: all existing tests pass. The multi-URL tests continue to work because `executeMultiUrl` is now defined locally in the same file.

---

## Task 3: Delete web-fetch-multi.ts

**Files:**
- Delete: `src/tools/web-fetch-multi.ts`

- [ ] **Step 1: Verify no remaining imports of web-fetch-multi.ts**

```bash
grep -rn "web-fetch-multi" src/ tests/
```

Expected: zero matches (the only import was in `web-fetch.ts`, removed in Task 1 Step 1).

- [ ] **Step 2: Delete the file**

```bash
rm src/tools/web-fetch-multi.ts
```

- [ ] **Step 3: Verify TypeScript still compiles**

```bash
pnpm run typecheck
```

Expected: passes.

- [ ] **Step 4: Run full test suite**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit the collapse**

```bash
git add -A
git commit -m "refactor: collapse web-fetch-multi.ts into web-fetch.ts

Move UrlResult, perUrlCap, MultiUrlOptions, and executeMultiUrl into
web-fetch.ts as private functions. executeMultiUrl now has per-URL
provider fallback on RetryableExtractionError, matching single-URL
behavior. Delete web-fetch-multi.ts (170 lines removed).

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

## Task 4: Add tests for multi-URL provider fallback

**Files:**
- Modify: `tests/tools/web-fetch.test.ts`

- [ ] **Step 1: Add a new describe block for multi-URL fallback tests**

In `tests/tools/web-fetch.test.ts`, add the following describe block after the existing `describe("web_fetch multi-URL", ...)` block (after line 518):

```typescript
describe("web_fetch multi-URL provider fallback", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("falls back to FetchProvider for a failing URL in multi-URL mode", async () => {
    fetchStub.addResponse("example.com/ok", {
      body: GOOD_HTML,
      headers: { "content-type": "text/html" },
    });
    fetchStub.addResponse("example.com/broken", {
      status: 500,
      body: "Internal Server Error",
      headers: { "content-type": "text/html" },
    });

    const provider: FetchProvider = {
      name: "exa",
      fetch: vi.fn().mockResolvedValue({
        text: "Recovered via Exa",
        title: "Exa Recovery",
      } satisfies FetchResult),
    };

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store, () => [provider]);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-mfb-1",
      { urls: ["https://example.com/ok", "https://example.com/broken"] },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;

    // Both URLs should succeed — one via extraction, one via provider fallback
    expect(text).toContain("Article Title");
    expect(text).toContain("Recovered via Exa");
    expect(result.details.urlResults).toHaveLength(2);
    expect(result.details.urlResults!.every((r: any) => !r.error)).toBe(true);

    // Provider should only be called for the broken URL
    expect(provider.fetch).toHaveBeenCalledTimes(1);
    expect(provider.fetch).toHaveBeenCalledWith("https://example.com/broken", undefined);
  });

  it("tries second provider when first provider also fails in multi-URL mode", async () => {
    fetchStub.addResponse("example.com/broken", {
      status: 503,
      body: "Service Unavailable",
      headers: { "content-type": "text/html" },
    });

    const failProvider: FetchProvider = {
      name: "jina",
      fetch: vi.fn().mockRejectedValue(new Error("Jina timeout")),
    };
    const workProvider: FetchProvider = {
      name: "exa",
      fetch: vi.fn().mockResolvedValue({
        text: "Content from Exa fallback",
        title: "Exa Title",
      } satisfies FetchResult),
    };

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store, () => [failProvider, workProvider]);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-mfb-2",
      { urls: ["https://example.com/broken"] },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Content from Exa fallback");
    expect(result.details.urlResults).toHaveLength(1);
    expect(result.details.urlResults![0].error).toBeUndefined();
  });

  it("reports error when pipeline and all providers fail in multi-URL mode", async () => {
    fetchStub.addResponse("example.com/broken", {
      status: 500,
      body: "Server Error",
      headers: { "content-type": "text/html" },
    });

    const failProvider: FetchProvider = {
      name: "exa",
      fetch: vi.fn().mockRejectedValue(new Error("Exa unavailable")),
    };

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store, () => [failProvider]);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-mfb-3",
      { urls: ["https://example.com/broken"] },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text.toLowerCase()).toContain("error");
    expect(result.details.urlResults).toHaveLength(1);
    expect(result.details.urlResults![0].error).toBeDefined();
  });

  it("does not fall back on non-retryable errors in multi-URL mode", async () => {
    fetchStub.addResponse("example.com/notfound", {
      status: 404,
      body: "Not Found",
      headers: { "content-type": "text/html" },
    });

    const provider: FetchProvider = {
      name: "exa",
      fetch: vi.fn().mockResolvedValue({
        text: "Should not reach this",
        title: "Exa",
      } satisfies FetchResult),
    };

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store, () => [provider]);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-mfb-4",
      { urls: ["https://example.com/notfound"] },
      undefined,
      undefined,
      ctx,
    );
    // 404 is not retryable — should fail without calling provider
    expect(provider.fetch).not.toHaveBeenCalled();
    expect(result.details.urlResults).toHaveLength(1);
    expect(result.details.urlResults![0].error).toBeDefined();
  });

  it("falls back on 429 rate limit in multi-URL mode", async () => {
    fetchStub.addResponse("example.com/limited", {
      status: 429,
      body: "Rate Limited",
      headers: { "content-type": "text/html" },
    });

    const provider: FetchProvider = {
      name: "exa",
      fetch: vi.fn().mockResolvedValue({
        text: "Rate limit bypassed via provider",
        title: "Recovered",
      } satisfies FetchResult),
    };

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store, () => [provider]);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-mfb-5",
      { urls: ["https://example.com/limited"] },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Rate limit bypassed via provider");
    expect(result.details.urlResults).toHaveLength(1);
    expect(result.details.urlResults![0].error).toBeUndefined();
  });

  it("handles mixed success/fallback/failure across multiple URLs", async () => {
    // URL 1: succeeds via extraction
    fetchStub.addResponse("example.com/good", {
      body: GOOD_HTML,
      headers: { "content-type": "text/html" },
    });
    // URL 2: fails extraction (500), recovered via provider
    fetchStub.addResponse("example.com/server-error", {
      status: 500,
      body: "Internal Server Error",
      headers: { "content-type": "text/html" },
    });
    // URL 3: fails extraction (500), provider also fails
    fetchStub.addResponse("example.com/total-fail", {
      status: 500,
      body: "Server Error",
      headers: { "content-type": "text/html" },
    });

    const provider: FetchProvider = {
      name: "exa",
      fetch: vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("server-error")) {
          return { text: "Exa recovered server-error", title: "Recovered" };
        }
        throw new Error("Exa cannot handle this URL either");
      }),
    };

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store, () => [provider]);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-mfb-6",
      {
        urls: [
          "https://example.com/good",
          "https://example.com/server-error",
          "https://example.com/total-fail",
        ],
      },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;

    // URL 1: extracted normally
    expect(text).toContain("Article Title");
    // URL 2: recovered via provider
    expect(text).toContain("Exa recovered server-error");
    // Summary: 2 succeeded, 1 failed
    expect(text).toContain("2/3");
    expect(text).toContain("1 failed");

    expect(result.details.urlResults).toHaveLength(3);
    const failedResults = result.details.urlResults!.filter((r: any) => r.error);
    expect(failedResults).toHaveLength(1);
    expect(failedResults[0].url).toBe("https://example.com/total-fail");
  });

  it("multi-URL fallback works without any providers (graceful degradation)", async () => {
    fetchStub.addResponse("example.com/broken", {
      status: 500,
      body: "Server Error",
      headers: { "content-type": "text/html" },
    });

    const store = new ContentStore(() => {});
    // No resolveFetchCandidates passed at all
    const tool = createWebFetchTool(store);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-mfb-7",
      { urls: ["https://example.com/broken"] },
      undefined,
      undefined,
      ctx,
    );
    expect(result.details.urlResults).toHaveLength(1);
    expect(result.details.urlResults![0].error).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the new tests**

```bash
pnpm vitest run tests/tools/web-fetch.test.ts
```

Expected: all tests pass, including the new multi-URL fallback tests.

---

## Task 5: Verify and commit

**Files:** None (verification only)

- [ ] **Step 1: Run TypeScript type checking**

```bash
pnpm run typecheck
```

Expected: passes with zero errors.

- [ ] **Step 2: Run the full test suite**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 3: Run linting**

```bash
pnpm run lint
```

Expected: passes with zero errors.

- [ ] **Step 4: Verify web-fetch-multi.ts is deleted**

```bash
ls src/tools/web-fetch-multi.ts 2>&1
```

Expected: `No such file or directory`.

- [ ] **Step 5: Verify no remaining references to web-fetch-multi**

```bash
grep -rn "web-fetch-multi" src/ tests/
```

Expected: zero matches.

- [ ] **Step 6: Verify the final web-fetch.ts file structure**

```bash
grep -n "^export\|^async function\|^function\|^interface\|^const " src/tools/web-fetch.ts
```

Expected output should show (in order):
1. `INLINE_LIMIT`, `MANIFEST_PREVIEW_CHARS`, `MAX_CONCURRENT` constants
2. `UrlResult` interface (exported)
3. `perUrlCap` function (private)
4. `MultiUrlOptions` interface (private)
5. `executeMultiUrl` function (private)
6. `WebFetchParams` constant
7. `WebFetchDetails` interface
8. `createWebFetchTool` function (exported)
9. `buildResult` function (private)
10. `errorResult` function (private)

- [ ] **Step 7: Final commit with tests**

```bash
git add -A
git commit -m "test: add multi-URL provider fallback tests

Verify per-URL RetryableExtractionError -> FetchProvider fallback in
multi-URL mode: single provider, cascading providers, mixed results,
non-retryable errors skip fallback, 429 triggers fallback, graceful
degradation without providers.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```
