# Phase 4: Collapse web-fetch-multi into web-fetch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse multi-URL fetching into `web-fetch.ts` and give every URL the same cache, extraction, and retryable provider-fallback behavior as a single-URL fetch.

**Architecture:** Add one private `fetchUrl()` closure inside `createWebFetchTool()` that returns `ExtractedContent` or throws. Both single- and multi-URL execution call it, and both sanitize failures before returning them. Move the existing multi-URL orchestration into the same factory, preserve its concurrency, deduplication, ordering, previews, storage, images, and partial failures, then delete the now-empty module boundary.

**Tech Stack:** TypeScript, TypeBox, Vitest, native `fetch`, `fetchWithConcurrencyLimit`

**Spec:** `docs/superpowers/specs/2026-07-16-architecture-deepening-design.md` (Phase 4)

---

## File structure

| Action | File                            | Responsibility                                                          |
| ------ | ------------------------------- | ----------------------------------------------------------------------- |
| Modify | `tests/tools/web-fetch.test.ts` | Add two public-behavior regressions for per-URL fallback                |
| Modify | `src/tools/web-fetch.ts`        | Own single- and multi-URL fetching behind one private `fetchUrl()` path |
| Delete | `src/tools/web-fetch-multi.ts`  | Remove the redundant module after its orchestration moves               |

No new files, exported types, dependencies, or configuration are needed.

### Task 1: Lock multi-URL fallback behavior with two tests

**Files:**

- Modify: `tests/tools/web-fetch.test.ts`
- Test: `tests/tools/web-fetch.test.ts`

- [ ] **Step 1: Add the mixed-result regression test**

Insert this test inside the existing `describe("web_fetch multi-URL", ...)` block, before its closing `});`:

```typescript
it("uses provider fallback independently for each retryable URL", async () => {
  fetchStub.addResponse("example.com/ok", {
    body: GOOD_HTML,
    headers: { "content-type": "text/html" },
  });
  fetchStub.addResponse("example.com/recovered", {
    status: 500,
    body: "Server Error",
    headers: { "content-type": "text/html" },
  });
  fetchStub.addResponse("example.com/failed", {
    status: 503,
    body: "Unavailable",
    headers: { "content-type": "text/html" },
  });

  const provider: FetchProvider = {
    name: "exa",
    fetch: vi.fn(async (url: string) => {
      if (url.endsWith("/recovered")) {
        return { text: "Recovered by provider", title: "Recovered" };
      }
      throw new Error("Provider unavailable");
    }),
  };

  const tool = createWebFetchTool(new ContentStore(() => {}), () => [provider]);
  const result = await tool.execute(
    "call-m-fallback",
    {
      urls: [
        "https://example.com/ok",
        "https://example.com/recovered",
        "https://example.com/failed",
      ],
    },
    undefined,
    undefined,
    makeCtx(),
  );
  const text = (result.content[0] as { type: "text"; text: string }).text;
  const urlResults = result.details.urlResults ?? [];
  const recovered = urlResults.find((item) => item.url.endsWith("/recovered"));
  const failed = urlResults.find((item) => item.url.endsWith("/failed"));

  expect(text).toContain("Article Title");
  expect(text).toContain("Recovered by provider");
  expect(text).toContain("2/3");
  expect(text).toContain("1 failed");
  expect(provider.fetch).toHaveBeenCalledTimes(2);
  expect(recovered).toBeDefined();
  expect(recovered?.error).toBeUndefined();
  expect(failed?.error).toContain("HTTP 503");
  expect(failed?.error).toContain("Provider unavailable");
});
```

- [ ] **Step 2: Run the mixed-result test and confirm the missing behavior**

Run:

```bash
pnpm vitest run tests/tools/web-fetch.test.ts -t "uses provider fallback independently"
```

Expected: FAIL because `web-fetch-multi.ts` never calls the provider, so the output does not contain `Recovered by provider` and reports only one successful URL.

- [ ] **Step 3: Add the non-retryable regression test**

Add this test immediately after the mixed-result test:

```typescript
it("does not use provider fallback for a non-retryable URL", async () => {
  fetchStub.addResponse("example.com/not-found", {
    status: 404,
    body: "Not Found",
    headers: { "content-type": "text/html" },
  });

  const provider = mockFetchProvider("exa", {
    text: "Must not be used",
    title: "Unexpected",
  });
  const tool = createWebFetchTool(new ContentStore(() => {}), () => [provider]);
  const result = await tool.execute(
    "call-m-non-retryable",
    { urls: ["https://example.com/not-found"] },
    undefined,
    undefined,
    makeCtx(),
  );

  expect(provider.fetch).not.toHaveBeenCalled();
  expect(result.details.urlResults?.[0]?.error).toBeDefined();
});
```

- [ ] **Step 4: Run the focused file and preserve the red test output**

Run:

```bash
pnpm vitest run tests/tools/web-fetch.test.ts
```

Expected: 1 new failure in `uses provider fallback independently for each retryable URL`; the pre-existing tests and the non-retryable regression pass.

### Task 2: Unify single- and multi-URL execution in web-fetch.ts

**Files:**

- Modify: `src/tools/web-fetch.ts`
- Test: `tests/tools/web-fetch.test.ts`

- [ ] **Step 1: Replace the multi-module import with the concurrency helper and private shared types**

At the top of `src/tools/web-fetch.ts`, merge `ExtensionContext` into the existing coding-agent type import, remove the later duplicate import, remove the `./web-fetch-multi.ts` import, and add the concurrency import:

```typescript
import type {
  ExtensionContext,
  Theme,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { fetchWithConcurrencyLimit } from "../utils/concurrency.ts";
```

Replace the existing `INLINE_LIMIT` declaration with this private constants/types block:

```typescript
const INLINE_LIMIT = 15_000;
const MANIFEST_PREVIEW_CHARS = 512;
const MAX_CONCURRENT = 5;

interface FetchParams {
  raw?: boolean;
  fresh?: boolean;
  prompt?: string;
  timestamp?: string;
  frames?: number;
  model?: string;
}

interface UrlResult {
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
```

Keep `UrlResult` private; only `WebFetchDetails` uses it.

- [ ] **Step 2: Replace executeSingleUrl with one shared fetch path**

Inside `createWebFetchTool()`, replace the current `executeSingleUrl()` function with both functions below:

```typescript
async function fetchUrl(
  url: string,
  params: FetchParams,
  signal: AbortSignal | undefined,
  ctx?: ExtensionContext,
): Promise<ExtractedContent> {
  if (!params.fresh) {
    const cached = cache?.get(url);
    if (cached) return cached;
  }

  let extracted: ExtractedContent;
  try {
    extracted = await extractContent(url, signal, {
      raw: params.raw,
      prompt: params.prompt,
      timestamp: params.timestamp,
      frames: params.frames,
      model: params.model,
      ctx,
    });
  } catch (pipelineError) {
    if (!(pipelineError instanceof RetryableExtractionError)) {
      throw pipelineError;
    }

    const candidates = resolveFetchCandidates?.() ?? [];
    if (candidates.length === 0) {
      throw pipelineError;
    }

    try {
      const { result, providerName } = await executeWithFallback({
        candidates: candidates.map((provider) => ({
          name: provider.name,
          execute: () => provider.fetch(url, signal),
        })),
        operation: "fetch",
      });
      extracted = {
        text: result.text,
        title: result.title,
        url,
        extractionChain: [`fetch-provider:${providerName}`],
        chars: result.text.length,
        truncated: false,
      };
    } catch (fallbackError) {
      const pipelineMessage = sanitizeError(pipelineError).slice(0, 120);
      const fallbackMessage = sanitizeError(fallbackError).slice(0, 120);
      throw new Error(
        `Pipeline failed: ${pipelineMessage}; provider fallback failed: ${fallbackMessage}`,
      );
    }
  }

  cache?.set(url, extracted);
  return extracted;
}

async function executeSingleUrl(
  url: string,
  params: FetchParams,
  signal: AbortSignal | undefined,
  ctx?: ExtensionContext,
) {
  try {
    return buildResult(await fetchUrl(url, params, signal, ctx), url, store);
  } catch (error) {
    return errorResult(url, `Fetch error: ${sanitizeError(error)}`);
  }
}
```

This is the only function that performs cache lookup, extraction, provider fallback, and cache writes.

- [ ] **Step 3: Move multi-URL orchestration into the factory**

Insert this function after `executeSingleUrl()` and before the returned tool definition:

```typescript
async function executeMultiUrl(
  urls: string[],
  params: FetchParams,
  signal: AbortSignal | undefined,
  ctx?: ExtensionContext,
) {
  const cap = perUrlCap(urls.length);
  const isManifest = urls.length >= 6;
  const uniqueUrls = [...new Set(urls)];
  const tasks = uniqueUrls.map(
    (url) => () => fetchUrl(url, params, signal, ctx),
  );
  const settled = await fetchWithConcurrencyLimit(tasks, MAX_CONCURRENT);

  const resultByUrl = new Map<string, PromiseSettledResult<ExtractedContent>>();
  for (let index = 0; index < uniqueUrls.length; index++) {
    resultByUrl.set(uniqueUrls[index], settled[index]);
  }

  const urlResults: UrlResult[] = [];
  const outputParts: string[] = [];
  const imageBlocks: ImageBlock[] = [];

  for (const url of urls) {
    const outcome = resultByUrl.get(url)!;
    if (outcome.status === "rejected") {
      const message = sanitizeError(outcome.reason);
      urlResults.push({ url, chars: 0, error: message });
      outputParts.push(`## ${url}\n\nError: ${message}\n`);
      continue;
    }

    const extracted = outcome.value;
    const contentId = store.store({
      url: extracted.url,
      title: extracted.title,
      text: extracted.text,
      source: "web_fetch",
    });
    const preview =
      extracted.chars > cap
        ? truncateContent(extracted.text, cap)
        : extracted.text;

    urlResults.push({
      url: extracted.url,
      title: extracted.title,
      chars: extracted.chars,
      contentId,
    });

    const header = extracted.title
      ? `## ${extracted.title}`
      : `## ${extracted.url}`;
    const meta = `Source: ${extracted.url} | ${extracted.chars} chars | contentId: ${contentId}`;
    outputParts.push(`${header}\n${meta}\n\n${preview}\n`);
    imageBlocks.push(...collectImageBlocks(extracted));
  }

  const failed = urlResults.filter((result) => result.error).length;
  const succeeded = urls.length - failed;
  const summary = `Fetched ${succeeded}/${urls.length} URLs successfully${failed > 0 ? ` (${failed} failed)` : ""}${isManifest ? ". Use web_read with contentId for full text." : ""}\n\n`;

  return {
    content: [
      { type: "text" as const, text: summary + outputParts.join("\n---\n\n") },
      ...imageBlocks,
    ],
    details: {
      url: urls[0],
      chars: urlResults.reduce((sum, result) => sum + result.chars, 0),
      truncated: urlResults.some(
        (result) => !result.error && result.chars > cap,
      ),
      extractionChain: ["multi-url"],
      urlResults,
    },
  };
}
```

- [ ] **Step 4: Route the tool's multi-URL branch through the local function**

Replace the existing object-style `executeMultiUrl({...})` call with:

```typescript
return executeMultiUrl(params.urls!, params, signal, ctx);
```

The single-URL call can likewise pass `signal` directly:

```typescript
return executeSingleUrl(params.url!, params, signal, ctx);
```

- [ ] **Step 5: Run formatting and the focused tests**

Run:

```bash
pnpm exec biome format --write src/tools/web-fetch.ts tests/tools/web-fetch.test.ts
pnpm vitest run tests/tools/web-fetch.test.ts
```

Expected: formatting succeeds and all 28 tests pass, including the two new regressions.

- [ ] **Step 6: Run type checking before deleting the old file**

Run:

```bash
pnpm run typecheck
```

Expected: PASS. `src/tools/web-fetch-multi.ts` is now unreferenced but still present.

### Task 3: Delete the redundant module and verify the phase

**Files:**

- Delete: `src/tools/web-fetch-multi.ts`
- Verify: `src/tools/web-fetch.ts`
- Verify: `tests/tools/web-fetch.test.ts`

- [ ] **Step 1: Verify no TypeScript file still references web-fetch-multi**

Use the FFF grep tool with query `web-fetch-multi` and constraint `*.ts`.

Expected: zero matches.

- [ ] **Step 2: Delete the unreferenced module**

Run:

```bash
rm src/tools/web-fetch-multi.ts
```

- [ ] **Step 3: Run focused verification**

Run:

```bash
pnpm run typecheck
pnpm vitest run tests/tools/web-fetch.test.ts
```

Expected: both commands pass; the focused file reports 28 passing tests.

- [ ] **Step 4: Run repository verification**

Run:

```bash
pnpm test
pnpm run lint
git diff --check
```

Expected:

- The full Vitest suite passes.
- Biome exits successfully. Existing repository warnings may remain, but the touched files introduce no new diagnostics.
- `git diff --check` prints nothing.

- [ ] **Step 5: Review the final scope**

Run:

```bash
git status --short
git diff --stat
git diff -- src/tools/web-fetch.ts tests/tools/web-fetch.test.ts src/tools/web-fetch-multi.ts
```

Expected: the implementation changes only the two surviving files and deletes `src/tools/web-fetch-multi.ts`. The plan/spec documentation commits are already separate.

- [ ] **Step 6: Commit the cohesive implementation**

```bash
git add src/tools/web-fetch.ts tests/tools/web-fetch.test.ts src/tools/web-fetch-multi.ts
git commit -m "refactor: unify single and multi URL fetching"
```

The commit must include the regressions, shared helper, moved orchestration, and deletion together.
