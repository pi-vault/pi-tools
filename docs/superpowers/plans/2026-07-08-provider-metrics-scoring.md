# Provider Metrics Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance `ProviderRegistry` metrics with a 60-second rolling window for success rate and a result-ratio quality score, so `selectSearchByPerformance` responds faster to provider degradation and accounts for result quality.

**Architecture:** Modify the existing `ProviderMetrics` interface in `registry.ts` to use windowed metrics with running averages. Add `recordResultQuality` method. Update `selectSearchByPerformance` composite formula to use quality score instead of tier score. Extend `createWebSearchTool` with an `onResult` callback to feed result counts back to the registry.

**Tech Stack:** TypeScript, Vitest, existing pi-tools infrastructure (`ProviderRegistry`, `executeWithFallback`).

**Spec:** `docs/superpowers/specs/2026-07-08-provider-metrics-scoring-design.md`

---

## Phases

This plan is split into 3 atomic phases. Each produces a working, testable result.

| Phase | Deliverable                                         | Depends On |
| ----- | --------------------------------------------------- | ---------- |
| 1     | Rolling window + running average in ProviderMetrics | Nothing    |
| 2     | Quality score in composite formula                  | Phase 1    |
| 3     | Result count callback from web_search tool          | Phase 2    |

---

## File Map

| Action | File                               | Responsibility                                                 |
| ------ | ---------------------------------- | -------------------------------------------------------------- |
| Modify | `src/providers/registry.ts`        | ProviderMetrics interface, rolling window, recordResultQuality |
| Modify | `src/tools/web-search.ts`          | Add onResult callback, call after executeWithFallback          |
| Modify | `src/index.ts`                     | Wire onResult callback to registry.recordResultQuality         |
| Modify | `tests/providers/registry.test.ts` | Update metrics tests, add window + quality tests               |
| Modify | `tests/tools/web-search.test.ts`   | Add onResult callback tests                                    |

---

## Phase 1: Rolling Window + Running Average

### Task 1.1: Update ProviderMetrics interface and recording logic

**Files:**

- Modify: `src/providers/registry.ts`
- Modify: `tests/providers/registry.test.ts`

- [ ] **Step 1: Write failing tests for rolling window behavior**

Append to `tests/providers/registry.test.ts` inside the `"session metrics"` describe block:

```typescript
it("resets metrics after the rolling window expires", () => {
  const registry = mem();
  const brave = mockProvider("brave", "Brave");
  registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

  registry.recordOutcome("brave", { success: true, latencyMs: 200 });
  registry.recordOutcome("brave", { success: false });

  const before = registry.getMetrics("brave");
  expect(before!.successes).toBe(1);
  expect(before!.failures).toBe(1);

  // Simulate window expiry by advancing the windowStart
  // We need to use a testable mechanism; see implementation step
  registry.expireMetricsWindow("brave");
  registry.recordOutcome("brave", { success: true, latencyMs: 100 });

  const after = registry.getMetrics("brave");
  expect(after!.successes).toBe(1); // Reset: only the new call
  expect(after!.failures).toBe(0); // Reset: old failure gone
});

it("computes running average for latency", () => {
  const registry = mem();
  const brave = mockProvider("brave", "Brave");
  registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

  registry.recordOutcome("brave", { success: true, latencyMs: 200 });
  registry.recordOutcome("brave", { success: true, latencyMs: 400 });

  const metrics = registry.getMetrics("brave");
  expect(metrics!.avgLatency).toBe(300); // Running average of 200 and 400
  expect(metrics!.latencySamples).toBe(2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/providers/registry.test.ts`
Expected: FAIL (avgLatency, latencySamples, expireMetricsWindow not defined)

- [ ] **Step 3: Update ProviderMetrics interface**

In `src/providers/registry.ts`, replace the `ProviderMetrics` interface:

```typescript
// Before
export interface ProviderMetrics {
  successes: number;
  failures: number;
  totalLatencyMs: number;
}

// After
export interface ProviderMetrics {
  successes: number;
  failures: number;
  avgLatency: number;
  latencySamples: number;
  avgResultRatio: number;
  resultSamples: number;
  windowStart: number;
}
```

- [ ] **Step 4: Add METRICS_WINDOW_MS constant and getOrCreateMetrics helper**

Add after the `ProviderMetrics` interface:

```typescript
const METRICS_WINDOW_MS = 60_000;
```

Add a private method to `ProviderRegistry`:

```typescript
private getOrCreateMetrics(providerName: string): ProviderMetrics {
  const now = Date.now();
  const existing = this.metrics.get(providerName);
  if (existing && now - existing.windowStart <= METRICS_WINDOW_MS) {
    return existing;
  }
  // Window expired or no metrics yet — start fresh
  const fresh: ProviderMetrics = {
    successes: 0,
    failures: 0,
    avgLatency: 0,
    latencySamples: 0,
    avgResultRatio: 0,
    resultSamples: 0,
    windowStart: now,
  };
  this.metrics.set(providerName, fresh);
  return fresh;
}
```

- [ ] **Step 5: Update recordOutcome to use running averages**

Replace the current `recordOutcome` method:

```typescript
recordOutcome(providerName: string, result: { success: boolean; latencyMs?: number }): void {
  // Increment usage count (both success and failure count as a "use")
  this.counts[providerName] = (this.counts[providerName] ?? 0) + 1;
  this.saveUsage();

  // Update performance metrics (with rolling window)
  const m = this.getOrCreateMetrics(providerName);
  if (result.success) {
    m.successes += 1;
    if (result.latencyMs !== undefined) {
      m.latencySamples += 1;
      m.avgLatency += (result.latencyMs - m.avgLatency) / m.latencySamples;
    }
  } else {
    m.failures += 1;
  }
}
```

- [ ] **Step 6: Add expireMetricsWindow for testing**

Add a method to `ProviderRegistry` (used only in tests but keeps the class testable without time mocking):

```typescript
/** @internal — exposed for tests to simulate window expiry. */
expireMetricsWindow(providerName: string): void {
  const m = this.metrics.get(providerName);
  if (m) {
    m.windowStart = 0; // Force window to appear expired
  }
}
```

- [ ] **Step 7: Update existing tests that reference totalLatencyMs**

In `tests/providers/registry.test.ts`, find all references to `totalLatencyMs` and update:

Change:

```typescript
expect(metrics!.totalLatencyMs).toBe(300);
```

To:

```typescript
expect(metrics!.avgLatency).toBe(300);
expect(metrics!.latencySamples).toBe(1);
```

Change:

```typescript
expect(metrics!.totalLatencyMs).toBe(840);
```

To:

```typescript
expect(metrics!.avgLatency).toBe(420); // Running average of 340 and 500
expect(metrics!.latencySamples).toBe(2);
```

Change:

```typescript
expect(metrics!.totalLatencyMs).toBe(0);
```

To:

```typescript
expect(metrics!.avgLatency).toBe(0);
expect(metrics!.latencySamples).toBe(0);
```

Change:

```typescript
expect(exaMetrics.totalLatencyMs).toBe(600);
```

To:

```typescript
expect(exaMetrics.avgLatency).toBe(600);
expect(exaMetrics.latencySamples).toBe(1);
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm test -- tests/providers/registry.test.ts`
Expected: PASS (all tests green)

- [ ] **Step 9: Run full check**

Run: `pnpm check`
Expected: PASS (lint + typecheck + test)

- [ ] **Step 10: Commit**

```bash
git add src/providers/registry.ts tests/providers/registry.test.ts
git commit -m "feat(registry): add rolling window and running averages to ProviderMetrics"
```

---

## Phase 2: Quality Score in Composite Formula

### Task 2.1: Add recordResultQuality and update selectSearchByPerformance

**Files:**

- Modify: `src/providers/registry.ts`
- Modify: `tests/providers/registry.test.ts`

- [ ] **Step 1: Write failing tests for result quality recording**

Append to `tests/providers/registry.test.ts`:

```typescript
describe("result quality tracking", () => {
  it("recordResultQuality updates avgResultRatio", () => {
    const registry = mem();
    const brave = mockProvider("brave", "Brave");
    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

    registry.recordOutcome("brave", { success: true, latencyMs: 200 });
    registry.recordResultQuality("brave", 5, 5); // 100% ratio

    const metrics = registry.getMetrics("brave");
    expect(metrics!.avgResultRatio).toBe(1.0);
    expect(metrics!.resultSamples).toBe(1);
  });

  it("avgResultRatio converges to running average", () => {
    const registry = mem();
    const brave = mockProvider("brave", "Brave");
    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

    registry.recordOutcome("brave", { success: true, latencyMs: 200 });
    registry.recordResultQuality("brave", 5, 5); // ratio = 1.0
    registry.recordResultQuality("brave", 2, 5); // ratio = 0.4
    // Running average: (1.0 + 0.4) / 2 = 0.7

    const metrics = registry.getMetrics("brave");
    expect(metrics!.avgResultRatio).toBeCloseTo(0.7);
    expect(metrics!.resultSamples).toBe(2);
  });

  it("recordResultQuality does nothing when requestedCount is 0", () => {
    const registry = mem();
    const brave = mockProvider("brave", "Brave");
    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

    registry.recordOutcome("brave", { success: true, latencyMs: 200 });
    registry.recordResultQuality("brave", 0, 0);

    const metrics = registry.getMetrics("brave");
    expect(metrics!.resultSamples).toBe(0);
  });
});
```

- [ ] **Step 2: Write failing test for quality score in selectSearchByPerformance**

Append to `tests/providers/registry.test.ts` inside `"best-performing selection strategy"`:

```typescript
it("selectSearchByPerformance prefers provider with better result quality", () => {
  const registry = mem();
  const brave = mockProvider("brave", "Brave");
  const exa = mockProvider("exa", "Exa");

  registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
  registry.registerSearch(exa, { tier: 1, monthlyQuota: 1000 });

  // Both: 100% success, same latency
  registry.recordOutcome("brave", { success: true, latencyMs: 300 });
  registry.recordOutcome("exa", { success: true, latencyMs: 300 });

  // brave: poor result quality (1/5)
  registry.recordResultQuality("brave", 1, 5);
  // exa: excellent result quality (5/5)
  registry.recordResultQuality("exa", 5, 5);

  const selected = registry.selectSearchByPerformance();
  // exa should win due to much better result quality
  expect(selected?.name).toBe("exa");
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test -- tests/providers/registry.test.ts`
Expected: FAIL (recordResultQuality not defined, selectSearchByPerformance still uses tier score)

- [ ] **Step 4: Add recordResultQuality method**

Add to `ProviderRegistry`:

```typescript
recordResultQuality(providerName: string, resultCount: number, requestedCount: number): void {
  if (requestedCount <= 0) return;
  const m = this.getOrCreateMetrics(providerName);
  m.resultSamples += 1;
  const ratio = resultCount / requestedCount;
  m.avgResultRatio += (ratio - m.avgResultRatio) / m.resultSamples;
}
```

- [ ] **Step 5: Update selectSearchByPerformance to use quality score**

Replace the scoring logic in `selectSearchByPerformance`. The key change: replace `tierScore` with `qualityScore`:

```typescript
// Before (in the scored.map callback):
const tierScore = TIER_SCORES[r.tier] ?? 0.3;
if (!m || m.successes + m.failures === 0) {
  return { provider: r.provider, score: tierScore * 0.2 };
}
// ... later:
s.score = s.successRate * 0.5 + speedScore * 0.3 + s.tierScore! * 0.2;

// After:
if (!m || m.successes + m.failures === 0) {
  return { provider: r.provider, score: 0.5 }; // Neutral default
}

const total = m.successes + m.failures;
const successRate = m.successes / total;
const avgLatency = m.latencySamples > 0 ? m.avgLatency : Infinity;
const qualityScore = m.resultSamples > 0 ? m.avgResultRatio : 0.5;

return {
  provider: r.provider,
  score: 0,
  avgLatency,
  successRate,
  qualityScore,
};
```

And the final scoring loop:

```typescript
for (const s of scored) {
  if ("successRate" in s && s.successRate !== undefined) {
    const speedScore =
      s.avgLatency === Infinity
        ? 0
        : Math.max(0, 1 - s.avgLatency / (maxLatency || 1));
    s.score = s.successRate * 0.5 + speedScore * 0.3 + s.qualityScore! * 0.2;
  }
}
```

- [ ] **Step 6: Update existing selectSearchByPerformance tests**

The test "selectSearchByPerformance falls back to tier-based when no metrics exist" needs updating. With the new formula, providers with no metrics get score `0.5` (neutral) regardless of tier, so both brave (tier 1) and ddg (tier 3) score the same. The winner depends on Map insertion order. Update to:

```typescript
it("selectSearchByPerformance assigns neutral score when no metrics exist", () => {
  const registry = mem();
  const brave = mockProvider("brave", "Brave");
  const ddg = mockProvider("duckduckgo", "DuckDuckGo");

  registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
  registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

  // No metrics — both get 0.5 neutral score
  const selected = registry.selectSearchByPerformance();
  expect(selected).toBeDefined();
});
```

Review all other `selectSearchByPerformance` tests and adjust expectations that depend on tier score. The test "prefers fast provider with good success rate over slow tier-1" should still pass since the fast provider has better success + speed metrics.

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm test -- tests/providers/registry.test.ts`
Expected: PASS

- [ ] **Step 8: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/providers/registry.ts tests/providers/registry.test.ts
git commit -m "feat(registry): add result quality tracking and update composite scoring formula"
```

---

## Phase 3: Wire Result Counts from web_search Tool

### Task 3.1: Add onResult callback to createWebSearchTool

**Files:**

- Modify: `src/tools/web-search.ts`
- Modify: `src/index.ts`
- Modify: `tests/tools/web-search.test.ts`

- [ ] **Step 1: Write failing tests for onResult callback**

Append to `tests/tools/web-search.test.ts` inside `"web_search metrics callbacks"`:

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
  expect(onResult).toHaveBeenCalledWith("brave", sampleResults.length, 10);
});

it("does not call onResult when search fails", async () => {
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

  expect(onResult).toHaveBeenCalledWith("brave", sampleResults.length, 5);
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

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/tools/web-search.test.ts`
Expected: FAIL (createWebSearchTool doesn't accept 5th argument)

- [ ] **Step 3: Add onResult parameter to createWebSearchTool**

In `src/tools/web-search.ts`, update the factory signature:

```typescript
export function createWebSearchTool(
  resolveCandidates: (name?: string) => SearchProvider[],
  onSuccess?: (providerName: string, latencyMs: number) => void,
  guidance?: GuidanceOverride,
  onFailure?: (providerName: string) => void,
  onResult?: (providerName: string, resultCount: number, requestedCount: number) => void,
): ToolDefinition<typeof WebSearchParams, WebSearchDetails> {
```

- [ ] **Step 4: Call onResult after successful executeWithFallback**

In the `execute` function, after `executeWithFallback` returns, add the `onResult` call:

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

  // Record result quality for scoring
  onResult?.(providerName, results.length, maxResults);

  const text = params.compact
    ? formatResultsCompact(results)
    : formatResults(results);
  // ... rest unchanged
```

- [ ] **Step 5: Wire onResult in index.ts**

In `src/index.ts`, update the `createWebSearchTool` call:

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

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test -- tests/tools/web-search.test.ts`
Expected: PASS

- [ ] **Step 7: Run full check**

Run: `pnpm check`
Expected: PASS (lint + typecheck + test)

- [ ] **Step 8: Commit**

```bash
git add src/tools/web-search.ts src/index.ts tests/tools/web-search.test.ts
git commit -m "feat(web-search): wire result quality callback to provider scoring"
```
