# Provider Metrics — Phase 2: Quality Score in Composite Formula

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `recordResultQuality` method and replace tier-based scoring with result-ratio quality scoring in `selectSearchByPerformance`, so providers returning more of the requested results are ranked higher.

**Architecture:** A new `recordResultQuality(providerName, resultCount, requestedCount)` method updates `avgResultRatio` using the same running-average formula as latency. A private `getActiveMetrics` helper returns `undefined` for expired windows, so `selectSearchByPerformance` treats stale metrics as no-data. The composite formula changes its 20% weight from `tierScore` to `qualityScore` (the result ratio).

**Tech Stack:** TypeScript, Vitest, existing pi-tools infrastructure.

**Spec:** `docs/superpowers/specs/2026-07-08-provider-metrics-scoring-design.md`
**Main plan:** `docs/superpowers/plans/2026-07-08-provider-metrics-scoring.md`

**Depends on:** Phase 1 (rolling window + running average in ProviderMetrics)
**Produces:** Quality-aware provider scoring, ready for callback wiring in Phase 3.

---

## Context for the Engineer

### What Phase 1 produced

After Phase 1, `ProviderMetrics` looks like this:

```typescript
export interface ProviderMetrics {
  successes: number;
  failures: number;
  avgLatency: number;
  latencySamples: number;
  avgResultRatio: number; // Always 0 — nothing populates it yet
  resultSamples: number; // Always 0 — nothing populates it yet
  windowStart: number;
}
```

`recordOutcome` creates/resets metrics per window and updates `successes`, `failures`, and `avgLatency` with running averages. The `avgResultRatio` and `resultSamples` fields exist in the struct but are never written.

### Current composite scoring formula

`selectSearchByPerformance` (in `src/providers/registry.ts`) scores each provider:

```
score = (successRate * 0.5) + (speedScore * 0.3) + (tierScore * 0.2)
```

Where `tierScore` is a static lookup: `{ 1: 1.0, 2: 0.6, 3: 0.3 }`. This means tier-1 providers get a permanent 20% bonus even if they return poor results.

### What this phase changes

1. **`recordResultQuality(providerName, resultCount, requestedCount)`** — populates `avgResultRatio` with a running average of `resultCount / requestedCount`. Called separately from `recordOutcome` so it doesn't double-count successes.
2. **`getActiveMetrics(providerName)`** — returns `undefined` for expired windows, so `selectSearchByPerformance` treats stale metrics the same as no metrics.
3. **Composite formula** — `tierScore` replaced by `qualityScore` (`avgResultRatio`). Providers with no result data default to 0.5 (neutral). The `TIER_SCORES` constant is removed.

### Files this phase touches

| Action | File                               | What changes                                                                 |
| ------ | ---------------------------------- | ---------------------------------------------------------------------------- |
| Modify | `src/providers/registry.ts`        | Add recordResultQuality, getActiveMetrics; rewrite selectSearchByPerformance |
| Modify | `tests/providers/registry.test.ts` | Add quality tests; update scoring tests that assumed tier-based behavior     |

---

### Task 2.1: Write failing tests for recordResultQuality

**Files:**

- Modify: `tests/providers/registry.test.ts`

- [ ] **Step 1: Add result quality tracking tests**

Append a new describe block after the `"session metrics"` describe block (around line 426, after the closing `});`):

```typescript
describe("result quality tracking", () => {
  it("recordResultQuality updates avgResultRatio", () => {
    const registry = mem();
    const brave = mockProvider("brave", "Brave");
    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

    registry.recordOutcome("brave", { success: true, latencyMs: 200 });
    registry.recordResultQuality("brave", 5, 5);

    const metrics = registry.getMetrics("brave");
    expect(metrics!.avgResultRatio).toBe(1.0);
    expect(metrics!.resultSamples).toBe(1);
  });

  it("avgResultRatio converges to running average", () => {
    const registry = mem();
    const brave = mockProvider("brave", "Brave");
    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

    registry.recordOutcome("brave", { success: true, latencyMs: 200 });
    registry.recordResultQuality("brave", 5, 5);
    registry.recordResultQuality("brave", 2, 5);

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
    expect(metrics!.avgResultRatio).toBe(0);
  });

  it("does not increment successes or failures", () => {
    const registry = mem();
    const brave = mockProvider("brave", "Brave");
    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

    registry.recordOutcome("brave", { success: true, latencyMs: 200 });
    registry.recordResultQuality("brave", 3, 5);

    const metrics = registry.getMetrics("brave");
    expect(metrics!.successes).toBe(1);
    expect(metrics!.failures).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/providers/registry.test.ts -t "result quality"`
Expected: FAIL — `recordResultQuality` is not a function on `ProviderRegistry`.

---

### Task 2.2: Implement recordResultQuality

**Files:**

- Modify: `src/providers/registry.ts`

- [ ] **Step 3: Add recordResultQuality method**

Add this method to `ProviderRegistry`, right after `recordOutcome`:

```typescript
recordResultQuality(providerName: string, resultCount: number, requestedCount: number): void {
  if (requestedCount <= 0) return;
  const m = this.getOrCreateMetrics(providerName);
  m.resultSamples += 1;
  const ratio = resultCount / requestedCount;
  m.avgResultRatio += (ratio - m.avgResultRatio) / m.resultSamples;
}
```

- [ ] **Step 4: Run the quality tests**

Run: `pnpm test -- tests/providers/registry.test.ts -t "result quality"`
Expected: PASS

---

### Task 2.3: Write failing test for quality-based provider selection

**Files:**

- Modify: `tests/providers/registry.test.ts`

- [ ] **Step 5: Add quality score selection test**

Append inside the `"best-performing selection strategy"` describe block (after the last `it(...)` in that block):

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

  // brave: poor result quality (1/5 = 0.2)
  registry.recordResultQuality("brave", 1, 5);
  // exa: excellent result quality (5/5 = 1.0)
  registry.recordResultQuality("exa", 5, 5);

  const selected = registry.selectSearchByPerformance();
  expect(selected?.name).toBe("exa");
});
```

- [ ] **Step 6: Run the new test to verify it fails**

Run: `pnpm test -- tests/providers/registry.test.ts -t "prefers provider with better result quality"`
Expected: FAIL — the current formula uses tier score (both tier 1), so brave and exa tie on tier and the quality difference is ignored.

---

### Task 2.4: Rewrite selectSearchByPerformance with quality score

**Files:**

- Modify: `src/providers/registry.ts`

- [ ] **Step 7: Add getActiveMetrics private method**

Add this method right after `getOrCreateMetrics` in the `ProviderRegistry` class:

```typescript
/** Returns metrics only if within the active window, undefined otherwise. */
private getActiveMetrics(providerName: string): ProviderMetrics | undefined {
  const m = this.metrics.get(providerName);
  if (!m) return undefined;
  if (Date.now() - m.windowStart > METRICS_WINDOW_MS) return undefined;
  return m;
}
```

- [ ] **Step 8: Replace selectSearchByPerformance**

Replace the entire `selectSearchByPerformance` method body (lines 149-197 after Phase 1 edits). The full replacement:

```typescript
/**
 * Select the best search provider based on session performance metrics.
 *
 * Score = (success_rate * 0.5) + (speed_score * 0.3) + (quality_score * 0.2)
 *
 * Where:
 *   success_rate  = successes / (successes + failures)  (within rolling window)
 *   speed_score   = max(0, 1 - avg_latency / max_avg_latency)
 *   quality_score = avg_result_ratio  (results received / results requested)
 *
 * Providers with no active metrics get a neutral score of 0.5.
 */
selectSearchByPerformance(name?: string): SearchProvider | undefined {
  if (name && name !== "auto") {
    return this.searchProviders.get(name)?.provider;
  }

  const eligible = [...this.searchProviders.values()].filter((r) => {
    if (r.monthlyQuota === null) return true;
    return (this.counts[r.provider.name] ?? 0) < r.monthlyQuota;
  });

  if (eligible.length === 0) return undefined;

  const scored = eligible.map((r) => {
    const m = this.getActiveMetrics(r.provider.name);

    if (!m || (m.successes + m.failures) === 0) {
      return { provider: r.provider, score: 0.5 };
    }

    const total = m.successes + m.failures;
    const successRate = m.successes / total;
    const avgLatency = m.latencySamples > 0 ? m.avgLatency : Infinity;
    const qualityScore = m.resultSamples > 0 ? m.avgResultRatio : 0.5;

    return { provider: r.provider, score: 0, avgLatency, successRate, qualityScore };
  });

  const latencies = scored
    .filter((s): s is typeof s & { avgLatency: number } =>
      "avgLatency" in s && s.avgLatency !== Infinity,
    )
    .map((s) => s.avgLatency);
  const maxLatency = latencies.length > 0 ? Math.max(...latencies) : 1;

  for (const s of scored) {
    if ("successRate" in s && s.successRate !== undefined) {
      const speedScore = s.avgLatency === Infinity
        ? 0
        : Math.max(0, 1 - s.avgLatency / (maxLatency || 1));
      s.score = (s.successRate * 0.5) + (speedScore * 0.3) + (s.qualityScore! * 0.2);
    }
  }

  scored.sort((a, b) => b.score - a.score);

  return scored[0]?.provider;
}
```

- [ ] **Step 9: Run the quality selection test**

Run: `pnpm test -- tests/providers/registry.test.ts -t "prefers provider with better result quality"`
Expected: PASS

---

### Task 2.5: Update existing scoring tests

**Files:**

- Modify: `tests/providers/registry.test.ts`

The following existing tests reference tier-based scoring behavior. They need updating to match the new formula.

- [ ] **Step 10: Update "scores providers by success rate, speed, and tier" test**

Find the test with description `"selectSearchByPerformance scores providers by success rate, speed, and tier"` (around line 230). Change the description and comment:

```typescript
it("selectSearchByPerformance scores providers by success rate, speed, and quality", () => {
  const registry = mem();
  const brave = mockProvider("brave", "Brave");
  const exa = mockProvider("exa", "Exa");
  const ddg = mockProvider("duckduckgo", "DuckDuckGo");

  registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
  registry.registerSearch(exa, { tier: 1, monthlyQuota: 1000 });
  registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

  // brave: 100% success, fast
  registry.recordOutcome("brave", { success: true, latencyMs: 200 });
  registry.recordOutcome("brave", { success: true, latencyMs: 200 });

  // exa: 50% success, slower
  registry.recordOutcome("exa", { success: true, latencyMs: 600 });
  registry.recordOutcome("exa", { success: false });

  // ddg: 100% success, very slow
  registry.recordOutcome("duckduckgo", { success: true, latencyMs: 1000 });

  const selected = registry.selectSearchByPerformance();
  // brave should win: perfect success rate, fast, default quality
  expect(selected?.name).toBe("brave");
});
```

(The test body is unchanged — only the description and comment change. The brave provider still wins under the new formula because 100% success + fastest latency dominates.)

- [ ] **Step 11: Update "falls back to tier-based when no metrics exist" test**

Find the test with description `"selectSearchByPerformance falls back to tier-based when no metrics exist"` (around line 256). Replace the entire test:

```typescript
it("selectSearchByPerformance assigns neutral score when no metrics exist", () => {
  const registry = mem();
  const brave = mockProvider("brave", "Brave");
  const ddg = mockProvider("duckduckgo", "DuckDuckGo");

  registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
  registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

  // No metrics recorded — all providers get score 0.5 (neutral)
  const selected = registry.selectSearchByPerformance();
  expect(selected).toBeDefined();
});
```

(Without metrics, all providers score 0.5. The test no longer asserts a specific winner because selection among equally-scored providers depends on iteration order, not tier.)

- [ ] **Step 12: Run all registry tests**

Run: `pnpm test -- tests/providers/registry.test.ts`
Expected: PASS (all tests green)

- [ ] **Step 13: Run full check**

Run: `pnpm check`
Expected: PASS (lint + typecheck + test)

- [ ] **Step 14: Commit**

```bash
git add src/providers/registry.ts tests/providers/registry.test.ts
git commit -m "feat(registry): add result quality tracking and quality-based composite scoring"
```
