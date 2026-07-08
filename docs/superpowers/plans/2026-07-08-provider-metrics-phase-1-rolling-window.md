# Provider Metrics — Phase 1: Rolling Window + Running Average

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace lifetime `ProviderMetrics` counters with a 60-second rolling window and running-average latency, so scoring responds faster when providers degrade.

**Architecture:** The `ProviderMetrics` interface in `src/providers/registry.ts` gains `windowStart`, `avgLatency`, `latencySamples`, `avgResultRatio`, and `resultSamples` fields (replacing `totalLatencyMs`). A private `getOrCreateMetrics` helper lazily resets metrics when the 60-second window expires. `recordOutcome` uses an incremental running-average formula for latency instead of accumulating totals.

**Tech Stack:** TypeScript, Vitest, existing pi-tools infrastructure.

**Spec:** `docs/superpowers/specs/2026-07-08-provider-metrics-scoring-design.md`
**Main plan:** `docs/superpowers/plans/2026-07-08-provider-metrics-scoring.md`

**Depends on:** Nothing (first phase)
**Produces:** Window-scoped `ProviderMetrics` with running-average latency, ready for quality scoring in Phase 2.

---

## Context for the Engineer

### Provider metrics system

`src/providers/registry.ts` contains `ProviderRegistry`, which manages search/fetch/codeSearch/docs providers and tracks per-provider performance metrics.

**Current metrics interface (line 20-24):**

```typescript
export interface ProviderMetrics {
  successes: number;
  failures: number;
  totalLatencyMs: number;
}
```

**How metrics are recorded (`recordOutcome`, lines 94-108):**

Called by the `onSuccess`/`onFailure` callbacks wired in `src/index.ts` (lines 86-91). Every tool call that completes (success or failure) increments a monthly usage count (persisted to disk) and updates in-memory performance metrics.

**How metrics are consumed:**

1. `selectSearchByPerformance()` (lines 149-197) — computes a composite score per provider and picks the best one. Currently uses `m.totalLatencyMs / m.successes` to derive average latency.
2. `getMetrics()` (lines 220-222) — read-only accessor used by the `/tools --status` command.
3. `src/commands/tools.ts` (line 39) — the status table displays average latency as `Math.round(metrics.totalLatencyMs / metrics.successes)`.

### What changes

1. `totalLatencyMs` (a sum) becomes `avgLatency` (a running average) + `latencySamples` (count).
2. New fields `avgResultRatio` + `resultSamples` are added now but not populated until Phase 2.
3. New field `windowStart` tracks when the current window opened. When `Date.now() - windowStart > 60_000`, the next `recordOutcome` call resets all fields.
4. An `expireMetricsWindow()` method is added for test-only use (avoids flaky time-dependent tests).

### Files this phase touches

| Action | File                               | What changes                                                                      |
| ------ | ---------------------------------- | --------------------------------------------------------------------------------- |
| Modify | `src/providers/registry.ts`        | ProviderMetrics interface, getOrCreateMetrics, recordOutcome, expireMetricsWindow |
| Modify | `src/commands/tools.ts`            | Update totalLatencyMs reference to avgLatency                                     |
| Modify | `tests/providers/registry.test.ts` | Update totalLatencyMs assertions, add window + running-avg tests                  |

---

### Task 1.1: Write failing tests for rolling window and running average

**Files:**

- Modify: `tests/providers/registry.test.ts`

- [ ] **Step 1: Add rolling window and running average tests**

Append inside the `"session metrics"` describe block (after the `"tracks metrics independently per provider"` test, around line 425):

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

  // Simulate window expiry
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
  expect(metrics!.avgLatency).toBe(300);
  expect(metrics!.latencySamples).toBe(2);
});

it("does not update latency when latencyMs is omitted", () => {
  const registry = mem();
  const brave = mockProvider("brave", "Brave");
  registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

  registry.recordOutcome("brave", { success: true });

  const metrics = registry.getMetrics("brave");
  expect(metrics!.successes).toBe(1);
  expect(metrics!.avgLatency).toBe(0);
  expect(metrics!.latencySamples).toBe(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/providers/registry.test.ts`
Expected: FAIL — `avgLatency`, `latencySamples`, and `expireMetricsWindow` do not exist on the current types.

---

### Task 1.2: Update ProviderMetrics interface and recording logic

**Files:**

- Modify: `src/providers/registry.ts`

- [ ] **Step 3: Replace the ProviderMetrics interface**

In `src/providers/registry.ts`, replace lines 20-24:

```typescript
export interface ProviderMetrics {
  successes: number;
  failures: number;
  totalLatencyMs: number;
}
```

with:

```typescript
export interface ProviderMetrics {
  successes: number;
  failures: number;
  avgLatency: number;
  latencySamples: number;
  avgResultRatio: number;
  resultSamples: number;
  windowStart: number;
}

const METRICS_WINDOW_MS = 60_000;
```

- [ ] **Step 4: Add getOrCreateMetrics private method**

Add this private method to the `ProviderRegistry` class, right after the constructor (after line 55):

```typescript
private getOrCreateMetrics(providerName: string): ProviderMetrics {
  const now = Date.now();
  const existing = this.metrics.get(providerName);
  if (existing && now - existing.windowStart <= METRICS_WINDOW_MS) {
    return existing;
  }
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

- [ ] **Step 5: Replace the recordOutcome method**

Replace the existing `recordOutcome` method (lines 94-108):

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

- [ ] **Step 6: Update selectSearchByPerformance field reference**

In `selectSearchByPerformance`, find line 174:

```typescript
const avgLatency = m.successes > 0 ? m.totalLatencyMs / m.successes : Infinity;
```

Replace with:

```typescript
const avgLatency = m.latencySamples > 0 ? m.avgLatency : Infinity;
```

- [ ] **Step 7: Add expireMetricsWindow method**

Add after `getMetrics` (after line 222):

```typescript
/** @internal Exposed for tests to simulate window expiry without time mocking. */
expireMetricsWindow(providerName: string): void {
  const m = this.metrics.get(providerName);
  if (m) {
    m.windowStart = 0;
  }
}
```

- [ ] **Step 8: Run typecheck**

Run: `pnpm typecheck`
Expected: FAIL — `src/commands/tools.ts` still references `totalLatencyMs`.

---

### Task 1.3: Fix totalLatencyMs reference in tools command

**Files:**

- Modify: `src/commands/tools.ts`

- [ ] **Step 9: Update the status table latency display**

In `src/commands/tools.ts`, replace lines 38-39:

```typescript
    if (metrics && metrics.successes > 0) {
      const avgMs = Math.round(metrics.totalLatencyMs / metrics.successes);
```

with:

```typescript
    if (metrics && metrics.latencySamples > 0) {
      const avgMs = Math.round(metrics.avgLatency);
```

(The condition changes from `successes > 0` to `latencySamples > 0` because a success recorded without `latencyMs` — e.g., code-search — should show `--` rather than `0ms`.)

- [ ] **Step 10: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

---

### Task 1.4: Update existing test assertions

**Files:**

- Modify: `tests/providers/registry.test.ts`

- [ ] **Step 11: Update "records latency for performance scoring on success" test**

Find the test at approximately line 346. Replace:

```typescript
expect(metrics?.totalLatencyMs).toBe(300);
```

with:

```typescript
expect(metrics?.avgLatency).toBe(300);
expect(metrics?.latencySamples).toBe(1);
```

- [ ] **Step 12: Update "records success with latency" test**

Find the test at approximately line 370. Replace:

```typescript
expect(metrics!.totalLatencyMs).toBe(840);
```

with:

```typescript
expect(metrics!.avgLatency).toBe(420);
expect(metrics!.latencySamples).toBe(2);
```

(Running average of 340 and 500: first sample sets avg to 340, second sample `340 + (500 - 340) / 2 = 420`.)

- [ ] **Step 13: Update "records failure" test**

Find the test at approximately line 386. Replace:

```typescript
expect(metrics!.totalLatencyMs).toBe(0);
```

with:

```typescript
expect(metrics!.avgLatency).toBe(0);
expect(metrics!.latencySamples).toBe(0);
```

- [ ] **Step 14: Update "tracks metrics independently per provider" test**

Find the test at approximately line 406. Replace:

```typescript
expect(exaMetrics.totalLatencyMs).toBe(600);
```

with:

```typescript
expect(exaMetrics.avgLatency).toBe(600);
expect(exaMetrics.latencySamples).toBe(1);
```

- [ ] **Step 15: Run all tests**

Run: `pnpm test -- tests/providers/registry.test.ts`
Expected: PASS (all tests green, including the new window + running average tests)

- [ ] **Step 16: Run full check**

Run: `pnpm check`
Expected: PASS (lint + typecheck + test)

- [ ] **Step 17: Commit**

```bash
git add src/providers/registry.ts src/commands/tools.ts tests/providers/registry.test.ts
git commit -m "feat(registry): add rolling window and running averages to ProviderMetrics"
```
