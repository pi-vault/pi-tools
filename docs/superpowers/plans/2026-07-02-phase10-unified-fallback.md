# Phase 10: Unified Provider Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the provider fallback pattern (try candidates in order, collect errors, throw AggregateProviderError) into a single `executeWithFallback` module. Web-search and web-fetch delegate to it.

**Architecture:** New module `src/providers/execute.ts` owns iteration, timing, callbacks, and error aggregation. Tools pass a list of candidates (each with a name and an execute function) plus optional callbacks for success/failure. The module returns the result from the first successful provider.

**Tech Stack:** TypeScript 6, Vitest 4, Node 24+

---

## Context

Current duplication:
- `src/tools/web-search.ts` lines 119-152: for-loop over candidates, try/catch, AggregateProviderError
- `src/tools/web-fetch.ts` lines 113-157: same pattern with slightly different error collection (seeds errors with initial HTTP pipeline error)

Both share: iterate candidates, time each attempt, call onSuccess/onFailure, collect errors, throw aggregate.

---

### Task 1: Create executeWithFallback module with tests

**Files:**
- Create: `src/providers/execute.ts`
- Create: `tests/providers/execute.test.ts`

- [ ] **Step 1: Write failing tests for executeWithFallback**

Create `tests/providers/execute.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { executeWithFallback } from "../../src/providers/execute.ts";

describe("executeWithFallback", () => {
  it("returns result from first successful candidate", async () => {
    const result = await executeWithFallback({
      candidates: [
        { name: "provider-a", execute: async () => "result-a" },
        { name: "provider-b", execute: async () => "result-b" },
      ],
      operation: "search",
    });
    expect(result.result).toBe("result-a");
    expect(result.providerName).toBe("provider-a");
  });

  it("falls back to second candidate when first fails", async () => {
    const result = await executeWithFallback({
      candidates: [
        { name: "failing", execute: async () => { throw new Error("timeout"); } },
        { name: "working", execute: async () => "fallback-result" },
      ],
      operation: "search",
    });
    expect(result.result).toBe("fallback-result");
    expect(result.providerName).toBe("working");
  });

  it("throws AggregateProviderError when all candidates fail", async () => {
    await expect(
      executeWithFallback({
        candidates: [
          { name: "a", execute: async () => { throw new Error("err-a"); } },
          { name: "b", execute: async () => { throw new Error("err-b"); } },
        ],
        operation: "fetch",
      }),
    ).rejects.toThrow("All fetch providers failed");
  });

  it("calls onSuccess with provider name and latency on success", async () => {
    const onSuccess = vi.fn();
    await executeWithFallback({
      candidates: [{ name: "fast", execute: async () => "ok" }],
      operation: "search",
      onSuccess,
    });
    expect(onSuccess).toHaveBeenCalledWith("fast", expect.any(Number));
  });

  it("calls onFailure for each failed candidate", async () => {
    const onFailure = vi.fn();
    await executeWithFallback({
      candidates: [
        { name: "bad", execute: async () => { throw new Error("x"); } },
        { name: "good", execute: async () => "ok" },
      ],
      operation: "search",
      onFailure,
    });
    expect(onFailure).toHaveBeenCalledWith("bad");
    expect(onFailure).not.toHaveBeenCalledWith("good");
  });

  it("throws when candidates array is empty", async () => {
    await expect(
      executeWithFallback({
        candidates: [],
        operation: "search",
      }),
    ).rejects.toThrow("No search providers available");
  });

  it("includes initialErrors in aggregate when all candidates fail", async () => {
    await expect(
      executeWithFallback({
        candidates: [
          { name: "exa", execute: async () => { throw new Error("Exa unavailable"); } },
        ],
        operation: "fetch",
        initialErrors: [{ provider: "http", error: "500 Server Error" }],
      }),
    ).rejects.toThrow("http: 500 Server Error");
  });

  it("includes initialErrors in aggregate when candidates is empty", async () => {
    await expect(
      executeWithFallback({
        candidates: [],
        operation: "fetch",
        initialErrors: [{ provider: "http", error: "500 Server Error" }],
      }),
    ).rejects.toThrow("http: 500 Server Error");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/providers/execute.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Implement executeWithFallback**

Create `src/providers/execute.ts`:

```ts
import { AggregateProviderError } from "../utils/errors.ts";

export interface FallbackCandidate<T> {
  name: string;
  execute: () => Promise<T>;
}

export interface ExecuteOptions<T> {
  candidates: FallbackCandidate<T>[];
  operation: string;
  /** Errors to seed the aggregate with (e.g. the initial HTTP pipeline error). */
  initialErrors?: Array<{ provider: string; error: string }>;
  onSuccess?: (providerName: string, latencyMs: number) => void;
  onFailure?: (providerName: string) => void;
}

export interface ExecuteResult<T> {
  result: T;
  providerName: string;
}

export async function executeWithFallback<T>(
  options: ExecuteOptions<T>,
): Promise<ExecuteResult<T>> {
  const { candidates, operation, initialErrors, onSuccess, onFailure } = options;

  if (candidates.length === 0) {
    throw new AggregateProviderError(operation, [
      ...(initialErrors ?? []),
      { provider: "none", error: `No ${operation} providers available` },
    ]);
  }

  const errors: Array<{ provider: string; error: string }> = [
    ...(initialErrors ?? []),
  ];

  for (const candidate of candidates) {
    const startMs = Date.now();
    try {
      const result = await candidate.execute();
      onSuccess?.(candidate.name, Date.now() - startMs);
      return { result, providerName: candidate.name };
    } catch (error) {
      onFailure?.(candidate.name);
      errors.push({
        provider: candidate.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  throw new AggregateProviderError(operation, errors);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/providers/execute.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/providers/execute.ts tests/providers/execute.test.ts
git commit -m "feat: add executeWithFallback module for provider fallback"
```

---

### Task 2: Refactor web-search.ts to use executeWithFallback

**Files:**
- Modify: `src/tools/web-search.ts`
- Test: `tests/tools/web-search.test.ts`

- [ ] **Step 1: Replace the fallback loop in web-search.ts**

In `src/tools/web-search.ts`, update the `execute` function inside `createWebSearchTool`. Replace lines 119-152 (the error array init, candidate for-loop, and AggregateProviderError throw):

```ts
import { executeWithFallback } from "../providers/execute.ts";

// Inside execute():
async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
  const candidates = resolveCandidates(params.provider);

  if (candidates.length === 0) {
    return {
      content: [{ type: "text" as const, text: "Search error: No search providers available" }],
      details: { provider: "none", resultCount: 0 },
    };
  }

  const maxResults = params.numResults ?? 5;
  const filters = buildFilters(params);

  try {
    const { result: results, providerName } = await executeWithFallback({
      candidates: candidates.map((provider) => ({
        name: provider.name,
        execute: () => provider.search(params.query, maxResults, signal ?? undefined, filters),
      })),
      operation: "search",
      onSuccess,
      onFailure,
    });

    const text = params.compact
      ? formatResultsCompact(results)
      : formatResults(results);

    return {
      content: [{ type: "text" as const, text }],
      details: { provider: providerName, resultCount: results.length },
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text" as const, text: `Search error: ${msg}` }],
      details: { provider: "none", resultCount: 0 },
    };
  }
},
```

Also remove the `AggregateProviderError` import since it's no longer used directly:

```ts
// Remove: import { AggregateProviderError } from "../utils/errors.ts";
```

- [ ] **Step 2: Run web-search tests**

Run: `pnpm vitest run tests/tools/web-search.test.ts`
Expected: PASS (behavior unchanged)

- [ ] **Step 3: Commit**

```bash
git add src/tools/web-search.ts
git commit -m "refactor: web-search delegates fallback to executeWithFallback"
```

---

### Task 3: Refactor web-fetch.ts to use executeWithFallback

**Files:**
- Modify: `src/tools/web-fetch.ts`
- Test: `tests/tools/web-fetch.test.ts`

- [ ] **Step 1: Replace the provider fallback loop in web-fetch.ts**

In `src/tools/web-fetch.ts`, add the import and replace the `catch (pipelineError)` block (lines 113-157) inside `executeSingleUrl`:

```ts
import { executeWithFallback } from "../providers/execute.ts";

// Inside executeSingleUrl, replace the catch block:
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

  try {
    const { result: fetchResult, providerName } = await executeWithFallback({
      candidates: candidates.map((provider) => ({
        name: provider.name,
        execute: () => provider.fetch(url, signal),
      })),
      operation: "fetch",
      initialErrors: [{ provider: "http", error: pipelineError.message }],
    });

    const extracted: ExtractedContent = {
      text: fetchResult.text,
      title: fetchResult.title,
      url,
      extractionChain: [`fetch-provider:${providerName}`],
      chars: fetchResult.text.length,
      truncated: false,
    };

    cache?.set(url, extracted);
    return buildResult(extracted, url, store);
  } catch (fallbackError) {
    const msg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
    return errorResult(url, `Fetch error: ${msg}`);
  }
}
```

Update the `AggregateProviderError` import — it's no longer used directly, but `sanitizeError` is still needed:

```ts
// Before: import { AggregateProviderError, sanitizeError } from "../utils/errors.ts";
// After:
import { sanitizeError } from "../utils/errors.ts";
```

- [ ] **Step 2: Run web-fetch tests**

Run: `pnpm vitest run tests/tools/web-fetch.test.ts`
Expected: PASS (behavior unchanged)

- [ ] **Step 3: Run full test suite**

Run: `pnpm vitest run`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add src/tools/web-fetch.ts
git commit -m "refactor: web-fetch delegates provider fallback to executeWithFallback"
```

---

### Task 4: Simplify truncateContent return type (audit shrink)

**Files:**
- Modify: `src/utils/truncate.ts`
- Modify: `src/tools/web-fetch.ts`
- Test: `tests/utils/truncate.test.ts`

- [ ] **Step 1: Simplify truncateContent to return just a string**

Replace `src/utils/truncate.ts`:

```ts
export function truncateContent(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const notice = `\n\n[truncated] showing ${limit} of ${text.length} chars`;
  return text.slice(0, limit - notice.length) + notice;
}
```

- [ ] **Step 2: Update web-fetch.ts usages**

In `src/tools/web-fetch.ts`, update line 251:

```ts
// Before: ? truncateContent(extracted.text, cap).text
// After:
? truncateContent(extracted.text, cap)
```

And line 347:

```ts
// Before: const trunc = truncateContent(extracted.text, INLINE_LIMIT);
//         outputText = trunc.text;
// After:
outputText = truncateContent(extracted.text, INLINE_LIMIT);
```

- [ ] **Step 3: Update truncate tests**

In `tests/utils/truncate.test.ts`, update assertions that use `.text`, `.truncated`, or `.originalChars`:

```ts
it("returns original text when under limit", () => {
  const result = truncateContent("short", 100);
  expect(result).toBe("short");
});

it("truncates and appends notice when over limit", () => {
  const long = "x".repeat(200);
  const result = truncateContent(long, 100);
  expect(result.length).toBeLessThanOrEqual(100);
  expect(result).toContain("[truncated]");
  expect(result).toContain("200 chars");
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/utils/truncate.test.ts tests/tools/web-fetch.test.ts`
Expected: PASS

- [ ] **Step 5: Remove TruncateResult export references**

Check if anything else imports `TruncateResult`:
```bash
grep -rn "TruncateResult" src/ tests/
```

Remove any remaining imports.

- [ ] **Step 6: Run full verification**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/utils/truncate.ts src/tools/web-fetch.ts tests/utils/truncate.test.ts
git commit -m "refactor: simplify truncateContent to return string directly"
```
