# Pi Tools Phase 5: Single Content Extraction Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make registered fetch providers part of one content-extraction fallback seam and remove the duplicate direct Jina Reader implementation.

**Architecture:** Keep routing and trust-sensitive HTTP handling in `src/extract/pipeline.ts`. Move shared result types into `src/extract/types.ts`. Add `src/extract/fallbacks.ts` as the seam that adapts registered `FetchProvider`s and Gemini extractors to the ordered extraction chain. `web_fetch` supplies the already registered, budget-wrapped fetch candidates and phase 3 execution hooks. The Jina transport remains only in `src/providers/jina.ts`.

**Tech Stack:** TypeScript, native `fetch`, existing `executeWithFallback`, SSRF utilities, Gemini extractors, Vitest.

---

## Atomic result

After this phase, the normal HTML path is:

```text
validated HTTP response
  → Readability
  → RSC
  → registered fetch-provider fallback
  → Gemini URL context
  → Gemini Web
  → raw text
```

The structured routes (GitHub, PDF, YouTube, local video, raw mode), SSRF validation, per-hop redirect validation, cancellation, cache/storage behavior, and retryable transport errors remain intact. A provider fallback is budgeted and instrumented through the registry wrapper and shared execution policy. `src/extract/jina-reader.ts` and its duplicate tests are removed.

## File map

Create:

- `src/extract/types.ts` — shared `ExtractedContent`, `VideoFrame`, and `ImageBlock` types.
- `src/extract/fallbacks.ts` — ordered extraction fallback adapter and registered-fetch adapter.
- `tests/extract/fallbacks.test.ts` — fallback ordering, empty-result, cancellation, and provider-adapter tests.

Modify:

- `src/extract/pipeline.ts` — use shared types and fallback seam; remove direct Jina Reader call.
- `src/providers/jina.ts` — keep one Jina Reader transport and normalize empty/short content for the provider seam.
- `src/tools/web-fetch.ts` — pass registered fetch candidates and execution hooks into `extractContent`; remove the outer duplicate fallback.
- `tests/extract/pipeline.test.ts` — preserve normal, retryable, raw, PDF, and HTTP behavior with the new options.
- `tests/extract/pipeline-routing.test.ts` — replace direct Jina markers with registered-fetch seam markers and test ordering.
- `tests/extract/pipeline-ssrf.test.ts` — verify provider fallback is reached only after original URL validation.
- `tests/extract/cloudflare-retry.test.ts` — preserve challenge retry behavior.
- `tests/providers/jina.test.ts` — test the single Jina provider fetch path.
- `tests/tools/web-fetch.test.ts` — verify provider fallback, ordering, hooks, and error behavior through the pipeline.

Delete:

- `src/extract/jina-reader.ts` — duplicate direct Jina Reader transport.
- `tests/extract/jina-reader.test.ts` — tests for the deleted duplicate module; equivalent coverage moves to `fallbacks.test.ts` and `providers/jina.test.ts`.

## Tasks

### Task 1: Define the extraction fallback seam without changing routing

**Files:**

- Create: `src/extract/types.ts`
- Create: `src/extract/fallbacks.ts`
- Create: `tests/extract/fallbacks.test.ts`
- Modify: `src/extract/pipeline.ts`
- Modify: `src/tools/web-fetch.ts`

- [ ] **Step 1: Move shared extraction result types.**

Create `src/extract/types.ts` with the data currently declared in `pipeline.ts`:

```ts
import type { PdfPageImage } from "./pdf-ocr.ts";

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
  images?: PdfPageImage[];
  duration?: number;
}

export type ImageBlock = { type: "image"; data: string; mimeType: string };
```

In `pipeline.ts`, import these types and re-export them:

```ts
export type { ExtractedContent, ImageBlock, VideoFrame } from "./types.ts";
```

This keeps existing tool/test imports working while allowing the new fallback module to depend on the result contract without importing pipeline runtime code.

- [ ] **Step 2: Define an ordered fallback adapter.**

Create `src/extract/fallbacks.ts`:

```ts
import type { ExecutionHooks } from "../providers/execute.ts";
import { executeWithFallback } from "../providers/execute.ts";
import type { FetchProvider } from "../providers/types.ts";
import type { ExtractedContent } from "./types.ts";

export interface ExtractionFallback {
  name: string;
  run(): Promise<ExtractedContent | null>;
}

export function createFetchProviderFallback(
  providers: readonly FetchProvider[],
  url: string,
  signal: AbortSignal | undefined,
  hooks?: ExecutionHooks,
): ExtractionFallback | undefined {
  if (providers.length === 0) return undefined;

  return {
    name: "fetch-provider",
    async run() {
      const { result, providerName } = await executeWithFallback({
        candidates: providers.map((provider) => ({
          name: provider.name,
          execute: async () => {
            const fetched = await provider.fetch(url, signal);
            const text = fetched.text.trim();
            if (text.length === 0) throw new Error(`${provider.name} returned empty content`);
            return { fetched, providerName: provider.name };
          },
        })),
        operation: "fetch",
        signal,
        ...hooks,
      });

      const text = result.fetched.text.trim();
      return {
        text,
        title: result.fetched.title,
        url,
        extractionChain: [`fetch-provider:${result.providerName}`],
        chars: text.length,
        truncated: false,
      };
    },
  };
}

export async function runExtractionFallbacks(
  fallbacks: readonly ExtractionFallback[],
  chain: string[],
  signal?: AbortSignal,
): Promise<ExtractedContent | undefined> {
  for (const fallback of fallbacks) {
    signal?.throwIfAborted();
    try {
      const result = await fallback.run();
      signal?.throwIfAborted();
      if (!result) {
        chain.push(`${fallback.name}:fail`);
        continue;
      }

      chain.push(result.extractionChain[0] ?? fallback.name);
      return { ...result, extractionChain: chain };
    } catch (error) {
      signal?.throwIfAborted();
      chain.push(`${fallback.name}:error`);
      // The next adapter gets a chance. executeWithFallback has already
      // aggregated and instrumented individual registered provider failures.
    }
  }
  return undefined;
}
```

The implementation may use a narrower internal return type, but it must preserve these rules:

- empty provider text advances to the next provider;
- `AbortError`/caller cancellation is rethrown, never converted into a fallback failure;
- registered provider attempts use `executeWithFallback` so budgets, activity, metrics, and aggregate errors remain centralized; and
- a failed adapter adds a chain marker but does not expose raw provider credentials or unsanitized errors.

- [ ] **Step 3: Add seam tests before pipeline wiring.**

In `tests/extract/fallbacks.test.ts`, add tests that prove:

1. providers are tried in the supplied order;
2. an empty first result advances to the second provider;
3. a successful provider returns `fetch-provider:<name>` and preserves title/chars/url;
4. all provider failures allow the next Gemini-style adapter to run;
5. a caller abort rejects with the abort error and does not call later adapters; and
6. execution hooks receive provider success/failure while `BudgetExceededError` remains excluded from failure metrics.

Mock `executeWithFallback` only if needed for deterministic adapter tests; retain at least one test with real registered-style provider functions so the budget/execution boundary is exercised by the phase gate.

- [ ] **Step 4: Add provider candidates and hooks to `ExtractOptions`.**

Extend the existing options in `pipeline.ts`:

```ts
import type { ExecutionHooks } from "../providers/execute.ts";
import type { FetchProvider } from "../providers/types.ts";

export interface ExtractOptions {
  // existing fields...
  fetchProviders?: readonly FetchProvider[];
  executionHooks?: ExecutionHooks;
}
```

Do not make the extraction module select raw provider registry entries. It receives already selected, registry-wrapped candidates from `web_fetch`.

- [ ] **Step 5: Pass the seam inputs from `web_fetch`.**

In `src/tools/web-fetch.ts`:

- keep `resolveFetchCandidates` as the existing resolver boundary;
- resolve candidates immediately before calling `extractContent`;
- pass `fetchProviders: resolveFetchCandidates?.() ?? []` and the phase 3 execution hooks; and
- remove the `RetryableExtractionError` catch that separately calls `executeWithFallback`.

The `fetchUrl()` body should have one extraction call and one cache write. Keep the current cache key, content store writes, multi-URL concurrency, image blocks, and sanitized `errorResult` behavior.

Run:

```bash
pnpm exec vitest run tests/extract/fallbacks.test.ts tests/tools/web-fetch.test.ts
```

Expected: the new seam and existing provider fallback tests pass after the initial pipeline integration.

### Task 2: Wire the ordered seam into the pipeline and remove duplicate Jina

**Files:**

- Modify: `src/extract/pipeline.ts`
- Modify: `src/providers/jina.ts`
- Delete: `src/extract/jina-reader.ts`
- Delete: `tests/extract/jina-reader.test.ts`
- Modify: `tests/extract/pipeline.test.ts`
- Modify: `tests/extract/pipeline-routing.test.ts`
- Modify: `tests/providers/jina.test.ts`

- [ ] **Step 1: Preserve all pre-fallback validation and direct routes.**

Keep these pipeline sections in their current order and behavior:

1. frame extraction options;
2. local video routing;
3. YouTube routing;
4. original URL SSRF validation;
5. GitHub structured extraction;
6. HEAD probe and binary/size checks;
7. validated HTTP GET with per-hop redirect validation;
8. Cloudflare retry; and
9. raw/PDF/direct HTML/RSC extraction.

Do not pass unvalidated URLs to a registered fetch provider. The original `validateUrl()` must still run before any provider fallback, and `fetchValidated()` must continue validating every redirect hop for direct HTTP requests.

- [ ] **Step 2: Replace the direct Jina tier with registered adapters.**

After `chain.push("rsc:no-match")`, construct the fallback list:

```ts
const fallbacks = [
  createFetchProviderFallback(
    options?.fetchProviders ?? [],
    url,
    signal,
    options?.executionHooks,
  ),
  {
    name: "gemini-url-context",
    run: () => extractWithUrlContext(url, signal),
  },
  {
    name: "gemini-web",
    run: () => extractWithGeminiWeb(url, signal),
  },
].filter((fallback): fallback is NonNullable<typeof fallback> => Boolean(fallback));

const fallbackResult = await runExtractionFallbacks(fallbacks, chain, signal);
if (fallbackResult) return fallbackResult;
```

Then keep the existing raw-text fallback and final error, using the accumulated `chain`. Remove `extractViaJinaReader` import and all `jina-reader` chain markers. For a call with no registered providers, the chain should identify the skipped provider group consistently (for example `fetch-provider:skipped`) before Gemini; choose one marker and update tests to assert that exact contract.

- [ ] **Step 3: Preserve retryable transport fallback semantics.**

When the initial validated GET or Cloudflare retry fails with a network error, 429, or 5xx, call only the registered fetch-provider fallback with the original URL before throwing. If a provider succeeds, return its normalized `ExtractedContent`. If all providers fail, throw a `RetryableExtractionError` so callers and tests can still distinguish retryable transport failure from a permanent HTTP error.

Do not use the raw/Gemini HTML path when there is no response body. Preserve SSRF errors as `SSRFError`, preserve caller cancellation, and do not turn `BudgetExceededError` into a retryable network error. The error message may include a short sanitized fallback summary, but the error class and URL redaction rules must remain intact.

- [ ] **Step 4: Make the provider own Jina Reader transport.**

Keep `JinaProvider.fetch()` as the only `r.jina.ai` request. Normalize its text before returning:

```ts
const text = (await response.text()).trim();
if (text.length < 100) {
  throw new Error("Jina reader returned insufficient content");
}
return { text };
```

Retain its authorization header behavior and existing search behavior. Do not add a second direct fetch helper in the extraction module. The provider is already wrapped by `ProviderRegistry`, so its fetch budget and outcome hooks apply automatically.

- [ ] **Step 5: Update extraction-chain and Jina tests.**

Replace direct Jina-reader unit tests with:

- fallback seam tests for adapter ordering and normalized `fetch-provider:<name>` output;
- provider tests for Jina success, non-2xx error, short-content rejection, and authorization; and
- pipeline routing tests that inject a mock registered fetch provider and assert it runs before Gemini.

Keep the existing thin HTML, Gemini URL context, Gemini Web, raw text, 4xx, 429, 5xx, and cancellation assertions. Only change assertions that named the deleted direct `jina-reader` implementation.

Run:

```bash
pnpm exec vitest run tests/extract/fallbacks.test.ts tests/extract/pipeline.test.ts tests/extract/pipeline-routing.test.ts tests/providers/jina.test.ts tests/tools/web-fetch.test.ts
```

Expected: focused extraction and provider tests pass, with no import or request path left for `src/extract/jina-reader.ts`.

### Task 3: Prove security, structured-route, and multi-URL invariants

**Files:**

- Modify: `tests/extract/pipeline-ssrf.test.ts`
- Modify: `tests/extract/cloudflare-retry.test.ts`
- Modify: `tests/tools/web-fetch.test.ts`
- Modify: `tests/tools/web-fetch-video.test.ts`
- Modify: `tests/extract/pipeline.test.ts`

- [ ] **Step 1: Test SSRF and redirect boundaries with provider candidates.**

Add a test that supplies a mock fetch provider while requesting a private, link-local, or disallowed URL. Assert `extractContent` rejects with `SSRFError` before the provider’s `fetch` function is called. Keep the existing tests for redirect-to-private-IP and redirect-loop rejection; direct HTTP requests must still validate every hop.

- [ ] **Step 2: Test fallback ordering and no duplicate Jina request.**

For thin HTML, provide a mock provider and mocked Gemini adapters. Assert:

1. Readability and RSC are attempted first;
2. the registered provider is called before either Gemini adapter;
3. Gemini is not called after a successful provider; and
4. there is no direct `r.jina.ai` request outside the Jina provider mock.

For a provider failure, assert the next provider/Gemini adapter runs and the final extraction chain records the failure and success labels in order.

- [ ] **Step 3: Test retryable HTTP and budget behavior.**

For 429/5xx/network failure, assert a successful registered provider result is returned. When all registered providers fail, assert `RetryableExtractionError`. When the registry wrapper throws `BudgetExceededError`, assert no provider failure metric is recorded and the retryable class remains intact where no provider can serve the request.

- [ ] **Step 4: Test structured routes bypass generic fallbacks.**

Keep tests proving provider candidates are not called for successful YouTube, local video, GitHub, PDF, and raw-mode routes. Existing video frame and PDF OCR behavior must remain unchanged. Do not make provider fetch adapters handle binary content, frames, or PDFs.

- [ ] **Step 5: Test cache and multi-URL behavior.**

Keep the existing `web_fetch` tests for cache hits, `fresh`, duplicate URLs, concurrency limit, content IDs, image blocks, and partial failures. Assert the resolver is called for each actual uncached URL and the provider fallback result is stored exactly like direct extraction content.

Run:

```bash
pnpm exec vitest run tests/extract/pipeline-ssrf.test.ts tests/extract/cloudflare-retry.test.ts tests/extract/pipeline.test.ts tests/tools/web-fetch.test.ts tests/tools/web-fetch-video.test.ts
```

Expected: security and structured-route tests pass without weakening validation or changing cache/storage contracts.

### Task 4: Complete the phase gate and commit

- [ ] **Step 1: Search for duplicate Jina and outer fallback paths.**

Run:

```bash
rg -n "extractViaJinaReader|jina-reader|r\.jina\.ai|executeWithFallback|RetryableExtractionError" src/extract src/tools/web-fetch.ts
```

Expected: `r.jina.ai` appears only in `src/providers/jina.ts` and its provider tests; `web-fetch.ts` no longer owns a second provider fallback; `executeWithFallback` appears in the shared extraction adapter and provider execution policy.

- [ ] **Step 2: Run the complete phase gate.**

```bash
pnpm exec vitest run tests/extract/fallbacks.test.ts tests/extract/pipeline.test.ts tests/extract/pipeline-routing.test.ts tests/extract/pipeline-ssrf.test.ts tests/extract/cloudflare-retry.test.ts tests/providers/jina.test.ts tests/tools/web-fetch.test.ts tests/tools/web-fetch-video.test.ts
pnpm check
git diff --check
```

Expected: focused tests and the full suite pass with only the documented pre-existing Biome and Node-engine warnings.

- [ ] **Step 3: Commit the atomic phase.**

```bash
git add src/extract src/providers/jina.ts src/tools/web-fetch.ts tests
git commit -m "refactor: unify content extraction fallbacks"
```

The commit may delete `src/extract/jina-reader.ts` and its test, but must not change provider catalog, configuration lifecycle, or unrelated extraction routes.

## Phase completion gate

- Registered fetch providers are the only provider-backed extraction adapters.
- Direct Jina Reader transport is deleted from `src/extract`.
- Fallback order, retryable error class, budgets, activity, cancellation, SSRF, and structured routes are covered by tests.
- Cache, content storage, multi-URL, and rendering behavior remain intact.
- Focused tests, `pnpm check`, and `git diff --check` pass.
