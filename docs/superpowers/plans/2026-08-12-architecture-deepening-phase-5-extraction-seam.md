# Pi Tools Phase 5: Single Content Extraction Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Readiness decision

The previous plan was not ready against the clean post-Phase-4 repository. The current branch is `20260814-architecture-deepening-phase-5-extraction-seam` at `74d988c`; `pnpm check` passes 89 test files and 1,465 tests. The environment still reports Node 23.11.0 versus the package requirement of Node >=24.15.0, and the repository has its existing Biome warnings.

The gaps were:

- `pipeline.ts` has no registered-provider options, while `web-fetch.ts` owns a second fallback path only for retryable transport failures. The plan did not specify how the shared adapter handles network/429/5xx failures without accidentally entering Gemini/raw extraction.
- The current pipeline wraps caller cancellation as `RetryableExtractionError`; the plan only described cancellation inside the new adapter. The GET, probe, Cloudflare retry, and transport-fallback boundaries need explicit cancellation checks.
- The draft chain behavior omitted the no-provider marker and claimed to record per-provider failure plus success labels even though `executeWithFallback` returns only the winning provider. Attempt details already belong in activity/metrics; the extraction chain will record only tier-level failure and the winning provider.
- Moving result types without updating type-only consumers would leave the new seam coupled to `pipeline.ts`. The type-only imports need to move while `pipeline.ts` keeps compatibility re-exports.
- Existing Jina tests use content shorter than the planned 100-character provider contract, and existing web-fetch fallback tests cover the old outer path rather than the new in-pipeline path.

## Goal

Make registered fetch providers part of one content-extraction fallback seam and remove the duplicate direct Jina Reader implementation.

## Atomic result

For a validated HTML response, the normal path is:

```text
validated HTTP response
  → Readability
  → RSC
  → registered fetch-provider fallback
  → Gemini URL context, then Gemini Web
  → raw text
```

For a retryable direct transport failure (network error, 429, or 5xx), the pipeline tries only the registered fetch-provider fallback and then preserves `RetryableExtractionError` if no provider succeeds. It never enters the Gemini/raw HTML path without a response body.

Structured routes (GitHub, PDF, YouTube, local video, raw mode), SSRF validation, per-hop redirect validation, cancellation, cache/storage behavior, and sanitized tool errors remain intact. `src/extract/jina-reader.ts` and its duplicate tests are deleted; `src/providers/jina.ts` owns the only `r.jina.ai` request.

## Locked contracts

### Fallback seam

Create `src/extract/fallbacks.ts` with the smallest reusable interface:

```ts
export interface ExtractionFallback {
  name: string;
  run(): Promise<ExtractedContent | null>;
}
```

`createFetchProviderFallback()` adapts the already selected, registry-wrapped `FetchProvider[]`. It must:

- call providers in supplied order through `executeWithFallback({ operation: "fetch" })`;
- trim provider text and treat empty text as a failed attempt;
- return normalized `ExtractedContent` with `fetch-provider:<providerName>`, the original URL, title, chars, and `truncated: false`;
- pass the supplied `AbortSignal` and `ExecutionHooks` to the shared executor; and
- keep provider errors out of the returned content and extraction chain.

`runExtractionFallbacks()` checks the caller signal before and after each adapter. A caller-aborted signal is rethrown and never converted into a fallback failure or sent to a later adapter. Ordinary adapter errors advance the chain:

- `null` result: `<name>:fail`;
- thrown result: `<name>:error`; and
- successful result: append the result’s first extraction-chain marker and return.

When no fetch providers are supplied, `pipeline.ts` appends `fetch-provider:skipped` and does not create an adapter. When providers are supplied but all fail, the chain contains `fetch-provider:error`; individual attempt failures remain in shared activity/metrics. A first-provider failure followed by a successful second provider records only `fetch-provider:<second>` in the extraction chain.

Gemini URL context and Gemini Web are one `gemini-html` adapter that tries URL context first and Web second. This preserves the existing high-level markers: the successful adapter contributes `html:gemini-url-context` or `html:gemini-web`, and an all-null result contributes `gemini-html:fail`.

### Pipeline and transport behavior

In `extractContent()`:

1. Check `signal?.throwIfAborted()` before routing and retain the existing frame, video, YouTube, original-URL SSRF, GitHub, probe, direct HTTP, Cloudflare retry, binary, PDF, raw, Readability, and RSC ordering.
2. After original `validateUrl()` succeeds, create the fetch adapter from `options.fetchProviders` but do not invoke it before validation.
3. On a network error from the GET or Cloudflare retry, check caller cancellation, then run only the fetch adapter. On 429/5xx, do the same after the status is known. A successful transport fallback returns its provider-normalized result with its provider-only chain marker, matching the former `web_fetch` fallback result.
4. If no provider succeeds, throw `RetryableExtractionError` based on the original transport failure. An optional provider summary must use `sanitizeError`; it must not expose credentials or raw provider errors. A provider budget rejection is not a failure metric and must not replace the original retryable classification.
5. For a successful non-PDF response whose Readability and RSC tiers fail, run the registered fetch adapter, then the combined Gemini adapter, then raw text. Do not invoke registered providers for raw mode, binary/oversized responses, PDFs, GitHub structured results, YouTube, or local video results.

The direct GET/Cloudflare catches and the probe catch must rethrow caller cancellation before wrapping ordinary transport errors. SSRF errors remain `SSRFError`; redirect hops remain validated by `fetchValidated()`.

### Type ownership

`src/extract/types.ts` owns `ExtractedContent`, `VideoFrame`, and `ImageBlock`. `pipeline.ts` re-exports those types so existing imports remain valid. Type-only consumers move to the new module: `gemini-url-context.ts`, `cache.ts`, `youtube.ts`, `video.ts`, and `frames.ts`. `ExtractOptions` stays in `pipeline.ts` because it describes pipeline routing inputs rather than the extracted result contract.

### Jina provider

`JinaProvider.fetch()` remains the only `r.jina.ai` transport. It trims its response and throws `Jina reader returned insufficient content` when the result is shorter than 100 characters. Authorization and search behavior remain unchanged.

## File map

Create:

- `src/extract/types.ts` — shared result types.
- `src/extract/fallbacks.ts` — registered-fetch adapter and ordered fallback runner.
- `tests/extract/fallbacks.test.ts` — seam ordering, normalization, cancellation, hooks, and budget behavior.

Modify:

- `src/extract/pipeline.ts` — shared types/options, transport fallback, ordered HTML seam, and cancellation checks.
- `src/extract/gemini-url-context.ts` — import result types from `types.ts`.
- `src/extract/youtube.ts` — import result types from `types.ts`; retain `ExtractOptions` from `pipeline.ts`.
- `src/extract/video.ts` — import result types from `types.ts`; retain `ExtractOptions` from `pipeline.ts`.
- `src/extract/frames.ts` — import `VideoFrame` from `types.ts`.
- `src/cache.ts` — import `ExtractedContent` from `extract/types.ts`.
- `src/providers/jina.ts` — normalize and reject insufficient fetch content.
- `src/tools/web-fetch.ts` — pass candidates/hooks into `extractContent` and remove the outer fallback.
- `tests/extract/pipeline.test.ts` — transport fallback, cancellation, and chain contracts.
- `tests/extract/pipeline-routing.test.ts` — registered-provider ordering before Gemini.
- `tests/extract/pipeline-ssrf.test.ts` — provider never runs before original URL validation.
- `tests/extract/cloudflare-retry.test.ts` — preserve challenge/retry and retryable fallback behavior.
- `tests/providers/jina.test.ts` — fetch success, short-content, non-2xx, and authorization behavior.
- `tests/tools/web-fetch.test.ts` — one pipeline fallback path, hooks, errors, cache, and multi-URL behavior.
- `tests/tools/web-fetch-video.test.ts` — preserve extraction options while passing seam inputs.

Delete:

- `src/extract/jina-reader.ts` — duplicate direct Jina transport.
- `tests/extract/jina-reader.test.ts` — tests for the deleted module.

No changes are required in `src/index.ts` or `tests/helpers.ts`: Phase 3 already supplies registry-wrapped fetch candidates and hooks, and Phase 4’s mock host already replaces same-name tools.

## Tasks

### Task 1: Move result types and build the fallback seam

Files: `src/extract/types.ts`, `src/extract/fallbacks.ts`, `tests/extract/fallbacks.test.ts`, plus the listed type-only consumers.

- [ ] **Step 1: Move and re-export result types.** Create `types.ts` with the current `ExtractedContent`, `VideoFrame`, and `ImageBlock` definitions. Remove their definitions from `pipeline.ts`, import them there, and re-export them. Update the type-only consumers listed in the file map.
- [ ] **Step 2: Implement the registered-fetch adapter.** Use `executeWithFallback` for every registered attempt. Trim text, reject empty results, preserve title/URL/chars, and pass signal/hooks.
- [ ] **Step 3: Implement the ordered runner.** Enforce signal checks and the `fail`/`error`/success chain contract. Do not expose aggregate provider messages through extraction content.
- [ ] **Step 4: Add seam tests.** Prove supplied ordering, empty-result advancement, normalization, title/chars/url, second-provider success, all-provider failure, caller cancellation stopping later adapters, success/failure hooks, and `BudgetExceededError` exclusion from failure hooks.

Run:

```bash
pnpm exec vitest run tests/extract/fallbacks.test.ts
```

### Task 2: Wire the seam into the pipeline and remove duplicate Jina

Files: `src/extract/pipeline.ts`, `src/providers/jina.ts`, `src/extract/jina-reader.ts`, `tests/extract/jina-reader.test.ts`, and the focused pipeline/provider tests.

- [ ] **Step 1: Add options and a single fetch adapter instance.** Extend `ExtractOptions` with `fetchProviders?: readonly FetchProvider[]` and `executionHooks?: ExecutionHooks`. Create the adapter only after original URL validation so transport and HTML paths share the same registry-wrapped candidates.
- [ ] **Step 2: Preserve direct routes and validation.** Keep the existing route order, HEAD probe, binary/size checks, manual redirect validation, PDF/OCR, raw mode, and Cloudflare retry. Add caller-signal checks at pipeline entry, probe error handling, and GET/Cloudflare catches.
- [ ] **Step 3: Handle retryable transport failures.** On network errors, 429, and 5xx, invoke only the registered fetch adapter. Return its normalized result on success; otherwise preserve `RetryableExtractionError` based on the original failure and sanitize any provider summary.
- [ ] **Step 4: Replace direct Jina/Gemini calls for thin HTML.** After `rsc:no-match`, append `fetch-provider:skipped` when appropriate, run registered providers, then the combined Gemini adapter, then raw text. Remove the `jina-reader` import and markers.
- [ ] **Step 5: Move Jina ownership.** Delete the duplicate extraction module and test. Keep `JinaProvider.fetch()` as the only Reader request, trim successful content, and reject content shorter than 100 characters.

### Task 3: Update extraction and tool tests around the new boundary

Files: `tests/extract/pipeline.test.ts`, `tests/extract/pipeline-routing.test.ts`, `tests/extract/pipeline-ssrf.test.ts`, `tests/extract/cloudflare-retry.test.ts`, `tests/providers/jina.test.ts`, `tests/tools/web-fetch.test.ts`, and `tests/tools/web-fetch-video.test.ts`.

- [ ] **Step 1: Test normal HTML ordering.** With thin HTML and mocked Gemini adapters, assert Readability/RSC precede registered providers, providers precede Gemini, a successful provider stops the chain, and all-failure markers are sanitized/high-level only.
- [ ] **Step 2: Test retryable transport behavior.** Cover network, 429, and 5xx success through a registered provider; all-provider failure as `RetryableExtractionError`; no Gemini/raw attempt without a response body; and budget rejection without a failure metric.
- [ ] **Step 3: Test cancellation.** Abort before and during direct transport and during provider fallback. Assert the caller’s abort is preserved, no later provider runs, and no provider failure hook records cancellation.
- [ ] **Step 4: Test security and structured routes.** Verify the provider is not called for an invalid original URL, redirect-to-private-IP, binary/oversized response, PDF, GitHub, YouTube, local video, or raw mode. Keep per-hop redirect validation assertions.
- [ ] **Step 5: Preserve web-fetch behavior.** Verify the single extraction call receives resolved candidates/hooks, provider fallback results use the same cache/content-store/rendering path, and multi-URL deduplication, concurrency, partial failures, fresh mode, image blocks, and sanitized errors remain unchanged.
- [ ] **Step 6: Update Jina tests.** Use a valid long fetch fixture, assert trim and title-independent text, short-content rejection, non-2xx errors, and authorization headers for both search and Reader fetches.

Run:

```bash
pnpm exec vitest run \
  tests/extract/fallbacks.test.ts \
  tests/extract/pipeline.test.ts \
  tests/extract/pipeline-routing.test.ts \
  tests/extract/pipeline-ssrf.test.ts \
  tests/extract/cloudflare-retry.test.ts \
  tests/providers/jina.test.ts \
  tests/tools/web-fetch.test.ts \
  tests/tools/web-fetch-video.test.ts
```

### Task 4: Complete the phase gate

- [ ] **Step 1: Confirm no duplicate transport/outer fallback remains.** Search `src` and tests for `extractViaJinaReader`, `jina-reader`, `r.jina.ai`, and `executeWithFallback`. `r.jina.ai` must remain only in `src/providers/jina.ts` and its provider tests; `web-fetch.ts` must not execute a second fetch fallback.
- [ ] **Step 2: Run the full gate.**

```bash
pnpm check
git diff --check
git status --short
```

Expected: the focused tests and full suite pass with only the documented Biome and Node-engine warnings. `git status --short` contains only the intended Phase 5 files.

- [ ] **Step 3: Commit the atomic phase.**

```bash
git add \
  src/cache.ts \
  src/extract/types.ts src/extract/fallbacks.ts src/extract/pipeline.ts \
  src/extract/gemini-url-context.ts src/extract/youtube.ts src/extract/video.ts src/extract/frames.ts \
  src/extract/jina-reader.ts src/providers/jina.ts src/tools/web-fetch.ts \
  tests/extract/fallbacks.test.ts tests/extract/pipeline.test.ts tests/extract/pipeline-routing.test.ts \
  tests/extract/pipeline-ssrf.test.ts tests/extract/cloudflare-retry.test.ts tests/extract/jina-reader.test.ts \
  tests/providers/jina.test.ts tests/tools/web-fetch.test.ts tests/tools/web-fetch-video.test.ts
git commit -m "refactor: unify content extraction fallbacks"
```

## Phase completion gate

- Registered fetch providers are the only provider-backed extraction adapters.
- Direct Jina Reader transport is deleted from `src/extract`.
- Fallback order, retryable transport behavior, budgets, hooks, cancellation, SSRF, redirects, and structured routes are covered by tests.
- Cache, content storage, multi-URL, image, and rendering behavior remain intact.
- Focused tests, `pnpm check`, and `git diff --check` pass.
