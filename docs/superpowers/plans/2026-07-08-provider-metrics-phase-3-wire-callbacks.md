# Provider Metrics — Phase 3: Wire Result Counts from web_search Tool

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pass result counts from the `web_search` tool back to `ProviderRegistry.recordResultQuality`, so the quality score in `selectSearchByPerformance` is actually populated with real data.

**Architecture:** `createWebSearchTool` gains an optional `onResult` callback parameter. After `executeWithFallback` returns successfully, the tool calls `onResult(providerName, results.length, maxResults)`. In `src/index.ts`, the callback is wired to `registry.recordResultQuality`.

**Tech Stack:** TypeScript, Vitest, existing pi-tools infrastructure.

**Spec:** `docs/superpowers/specs/2026-07-08-provider-metrics-scoring-design.md`
**Main plan:** `docs/superpowers/plans/2026-07-08-provider-metrics-scoring.md`

**Depends on:** Phase 2 (recordResultQuality method exists on ProviderRegistry)
**Produces:** End-to-end quality data flow from web_search results to provider scoring.

---

## Context for the Engineer

### How web_search callbacks work today

`src/tools/web-search.ts` exports `createWebSearchTool`, a factory that takes callback functions:

```typescript
export function createWebSearchTool(
  resolveCandidates: (name?: string) => SearchProvider[],
  onSuccess?: (providerName: string, latencyMs: number) => void,
  guidance?: GuidanceOverride,
  onFailure?: (providerName: string) => void,
): ToolDefinition<typeof WebSearchParams, WebSearchDetails>;
```

Inside the returned tool's `execute` method, it calls `executeWithFallback` from `src/providers/execute.ts`. That function iterates providers, calling each one until one succeeds. `onSuccess` is called inside `executeWithFallback` with `(providerName, latencyMs)`. `onFailure` is called for each provider that throws.

After `executeWithFallback` returns, the tool has access to `results` (the search results array) and `providerName` (which provider succeeded). This is where we call `onResult`.

### Wiring in index.ts

`src/index.ts` (lines 83-91) creates the tool and passes lambdas that call `registry.recordOutcome`:

```typescript
pi.registerTool(
  createWebSearchTool(
    resolveCandidates,
    (providerName, latencyMs) => {
      registry.recordOutcome(providerName, { success: true, latencyMs });
    },
    config.guidance?.web_search,
    (providerName) => registry.recordOutcome(providerName, { success: false }),
  ),
);
```

### Test helpers

`tests/tools/web-search.test.ts` uses:

- `makeProvider(name, results)` — returns a `SearchProvider` with a mock `search` that returns the given results (sliced to `maxResults`).
- `makeFailingProvider(name, message)` — returns a `SearchProvider` that always throws.
- `makeCtx()` — from `tests/helpers.ts`, creates a minimal tool execution context.
- `sampleResults` — a 2-element array of `SearchResult` objects.

Note: `sampleResults` is defined locally in several describe blocks. The `"web_search metrics callbacks"` block defines its own `sampleResults` with 1 element at line 383-385:

```typescript
const sampleResults: SearchResult[] = [
  { title: "Result", url: "https://example.com", snippet: "Test" },
];
```

New tests in this describe block must use this 1-element version.

### Files this phase touches

| Action | File                             | What changes                                         |
| ------ | -------------------------------- | ---------------------------------------------------- |
| Modify | `src/tools/web-search.ts`        | Add onResult parameter, call it after search success |
| Modify | `src/index.ts`                   | Wire onResult to registry.recordResultQuality        |
| Modify | `tests/tools/web-search.test.ts` | Add tests for onResult callback behavior             |

---

### Task 3.1: Write failing tests for onResult callback

**Files:**

- Modify: `tests/tools/web-search.test.ts`

- [ ] **Step 1: Add onResult callback tests**

Append inside the `"web_search metrics callbacks"` describe block (after the `"does not call onFailure for a successful provider"` test, around line 436):

```typescript
it("calls onResult with provider name, result count, and requested count", async () => {
  const onResult = vi.fn();
  const tool = createWebSearchTool(
    () => [makeProvider("brave", sampleResults)],
    vi.fn(),
    undefined,
    undefined,
    onResult,
  );
  const ctx = makeCtx();
  await tool.execute(
    "id",
    { query: "test", numResults: 10 },
    undefined,
    undefined,
    ctx,
  );

  expect(onResult).toHaveBeenCalledOnce();
  expect(onResult).toHaveBeenCalledWith("brave", 1, 10);
});

it("does not call onResult when all providers fail", async () => {
  const onResult = vi.fn();
  const tool = createWebSearchTool(
    () => [makeFailingProvider("brave", "API error")],
    undefined,
    undefined,
    undefined,
    onResult,
  );
  const ctx = makeCtx();
  await tool.execute("id", { query: "test" }, undefined, undefined, ctx);

  expect(onResult).not.toHaveBeenCalled();
});

it("calls onResult with default numResults when not specified", async () => {
  const onResult = vi.fn();
  const tool = createWebSearchTool(
    () => [makeProvider("brave", sampleResults)],
    vi.fn(),
    undefined,
    undefined,
    onResult,
  );
  const ctx = makeCtx();
  await tool.execute("id", { query: "test" }, undefined, undefined, ctx);

  expect(onResult).toHaveBeenCalledWith("brave", 1, 5);
});

it("calls onResult with zero result count when provider returns empty", async () => {
  const onResult = vi.fn();
  const tool = createWebSearchTool(
    () => [makeProvider("brave", [])],
    vi.fn(),
    undefined,
    undefined,
    onResult,
  );
  const ctx = makeCtx();
  await tool.execute("id", { query: "test" }, undefined, undefined, ctx);

  expect(onResult).toHaveBeenCalledWith("brave", 0, 5);
});
```

Note: `sampleResults` in this describe block has 1 result, so `results.length` is 1. The default `numResults` is 5.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/tools/web-search.test.ts -t "onResult"`
Expected: FAIL — `createWebSearchTool` does not accept a 5th argument (TypeScript error or the argument is silently ignored and `onResult` is never called).

---

### Task 3.2: Add onResult parameter to createWebSearchTool

**Files:**

- Modify: `src/tools/web-search.ts`

- [ ] **Step 3: Update the factory signature**

In `src/tools/web-search.ts`, find the `createWebSearchTool` function signature (line 90-94):

```typescript
export function createWebSearchTool(
  resolveCandidates: (name?: string) => SearchProvider[],
  onSuccess?: (providerName: string, latencyMs: number) => void,
  guidance?: GuidanceOverride,
  onFailure?: (providerName: string) => void,
): ToolDefinition<typeof WebSearchParams, WebSearchDetails> {
```

Replace with:

```typescript
export function createWebSearchTool(
  resolveCandidates: (name?: string) => SearchProvider[],
  onSuccess?: (providerName: string, latencyMs: number) => void,
  guidance?: GuidanceOverride,
  onFailure?: (providerName: string) => void,
  onResult?: (providerName: string, resultCount: number, requestedCount: number) => void,
): ToolDefinition<typeof WebSearchParams, WebSearchDetails> {
```

- [ ] **Step 4: Call onResult after successful search**

In the `execute` method, find the try block where `executeWithFallback` returns (around line 121-138). Add the `onResult` call after the `executeWithFallback` call and before formatting:

```typescript
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

        onResult?.(providerName, results.length, maxResults);

        const text = params.compact
          ? formatResultsCompact(results)
          : formatResults(results);
```

The `onResult?.()` line is the only addition. It goes right after the `const { result: results, providerName }` destructuring, before formatting.

- [ ] **Step 5: Run the onResult tests**

Run: `pnpm test -- tests/tools/web-search.test.ts -t "onResult"`
Expected: PASS

- [ ] **Step 6: Run all web-search tests**

Run: `pnpm test -- tests/tools/web-search.test.ts`
Expected: PASS (existing tests unaffected — `onResult` is optional)

---

### Task 3.3: Wire onResult in index.ts

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 7: Add the onResult callback**

In `src/index.ts`, find the `createWebSearchTool` call (lines 83-92):

```typescript
pi.registerTool(
  createWebSearchTool(
    resolveCandidates,
    (providerName, latencyMs) => {
      registry.recordOutcome(providerName, { success: true, latencyMs });
    },
    config.guidance?.web_search,
    (providerName) => registry.recordOutcome(providerName, { success: false }),
  ),
);
```

Replace with:

```typescript
pi.registerTool(
  createWebSearchTool(
    resolveCandidates,
    (providerName, latencyMs) => {
      registry.recordOutcome(providerName, { success: true, latencyMs });
    },
    config.guidance?.web_search,
    (providerName) => registry.recordOutcome(providerName, { success: false }),
    (providerName, resultCount, requestedCount) => {
      registry.recordResultQuality(providerName, resultCount, requestedCount);
    },
  ),
);
```

- [ ] **Step 8: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 9: Run full check**

Run: `pnpm check`
Expected: PASS (lint + typecheck + test)

- [ ] **Step 10: Commit**

```bash
git add src/tools/web-search.ts src/index.ts tests/tools/web-search.test.ts
git commit -m "feat(web-search): wire result quality callback to provider scoring"
```
