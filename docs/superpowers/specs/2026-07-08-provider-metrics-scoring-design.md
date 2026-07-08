# Provider Metrics Enhancement: Rolling Window + Quality Scoring

Enhance `ProviderRegistry` metrics with a rolling time window for success rate and a result-ratio quality score, so `selectSearchByPerformance` responds faster to provider degradation and accounts for result quality.

## Motivation

The current `ProviderMetrics` in `registry.ts` tracks lifetime counters (`successes`, `failures`, `totalLatencyMs`). Two problems:

1. **Stale history**: A provider that was fast and reliable for the first 50 calls but then starts failing still looks good because 50 successes dominate 2 recent failures. There's no time decay.
2. **No quality signal**: The composite score uses tier as a proxy for quality (20% weight). A tier-3 provider returning 5/5 requested results scores lower than a tier-1 provider returning 1/5, even though the tier-3 provider is delivering better results.

The `ronnieops-pi-search-hub` extension solves both with a 60-second rolling window and a result-ratio quality metric. This spec adapts those ideas to pi-tools' existing architecture.

## Changes

### 1. ProviderMetrics with Rolling Window

Replace the current lifetime counters with window-scoped metrics:

```typescript
export interface ProviderMetrics {
  successes: number;
  failures: number;
  avgLatency: number; // Running average (ms) for successful calls
  latencySamples: number; // Count of latency observations
  avgResultRatio: number; // Running average of (resultCount / requestedCount)
  resultSamples: number; // Count of result ratio observations
  windowStart: number; // Timestamp (ms) when this window opened
}
```

**Window behavior:** When `recordOutcome` is called and `Date.now() - windowStart > METRICS_WINDOW_MS` (60 seconds), the metrics reset to a fresh window. This means scores always reflect recent behavior.

**Running averages:** Latency and result ratio use Welford's incremental formula (`avg += (value - avg) / count`) instead of accumulating totals. This avoids overflow and naturally handles the window reset.

### 2. recordOutcome Signature Extension

Current:

```typescript
recordOutcome(providerName: string, result: { success: boolean; latencyMs?: number }): void
```

New:

```typescript
recordOutcome(providerName: string, result: {
  success: boolean;
  latencyMs?: number;
  resultCount?: number;      // NEW: how many results were returned
  requestedCount?: number;   // NEW: how many results were requested
}): void
```

The new fields are optional for backward compatibility. When both are provided on a successful call, `avgResultRatio` is updated.

### 3. Composite Score Formula Update

Current formula in `selectSearchByPerformance`:

```
score = (successRate * 0.5) + (speedScore * 0.3) + (tierScore * 0.2)
```

New formula:

```
score = (successRate * 0.5) + (speedScore * 0.3) + (qualityScore * 0.2)
```

Where:

- `successRate` = `successes / (successes + failures)` (within rolling window)
- `speedScore` = `max(0, 1 - avgLatency / MAX_LATENCY)` where `MAX_LATENCY = 5000ms`
- `qualityScore` = `avgResultRatio` (replaces `tierScore`)

**Default for providers with no metrics:** `compositeScore = 0.5` (neutral). This is unchanged from current behavior for unknown providers but removes the tier bias, letting all untested providers start equal.

### 4. getMetrics Return Type

`getMetrics()` returns the new `ProviderMetrics` shape. Tests that inspect `totalLatencyMs` must be updated to use `avgLatency` and `latencySamples`.

### 5. Caller Updates

In `index.ts`, the `onSuccess` callback for `web_search` currently passes `(providerName, latencyMs)`. To supply result counts, two options:

**Option A: Extend onSuccess callback** (chosen for simplicity)

The `createWebSearchTool` factory gains an `onResult` callback alongside `onSuccess`. After `executeWithFallback` returns successfully, the tool calls `onResult(providerName, results.length, maxResults)`.

```typescript
export function createWebSearchTool(
  resolveCandidates: (name?: string) => SearchProvider[],
  onSuccess?: (providerName: string, latencyMs: number) => void,
  guidance?: GuidanceOverride,
  onFailure?: (providerName: string) => void,
  onResult?: (providerName: string, resultCount: number, requestedCount: number) => void,  // NEW
): ToolDefinition<typeof WebSearchParams, WebSearchDetails> {
```

In `index.ts`:

```typescript
createWebSearchTool(
  resolveCandidates,
  (name, latencyMs) => registry.recordOutcome(name, { success: true, latencyMs }),
  config.guidance?.web_search,
  (name) => registry.recordOutcome(name, { success: false }),
  (name, resultCount, requestedCount) =>
    registry.recordOutcome(name, { success: true, resultCount, requestedCount }),
),
```

Note: The second `recordOutcome` call for result quality reuses `success: true` but doesn't provide `latencyMs`, so the latency average is unaffected. The `successes` counter increments again, but since the window tracks event frequency (not exact call count), this is acceptable. Alternatively, a dedicated `recordResultQuality` method could be added, but the simpler approach keeps the interface small.

**Correction:** Actually, double-incrementing `successes` is not acceptable. We should add a separate `recordResultQuality` method that only updates `avgResultRatio` and `resultSamples` without touching success/failure counters:

```typescript
recordResultQuality(providerName: string, resultCount: number, requestedCount: number): void {
  const m = this.getOrCreateMetrics(providerName);
  if (requestedCount > 0) {
    m.resultSamples++;
    const ratio = resultCount / requestedCount;
    m.avgResultRatio += (ratio - m.avgResultRatio) / m.resultSamples;
  }
}
```

## File Changes

| Action   | File                               | Change                                                      |
| -------- | ---------------------------------- | ----------------------------------------------------------- |
| Modified | `src/providers/registry.ts`        | ProviderMetrics interface, rolling window, quality tracking |
| Modified | `src/tools/web-search.ts`          | Add onResult callback, call after executeWithFallback       |
| Modified | `src/index.ts`                     | Wire onResult callback to registry.recordResultQuality      |
| Modified | `tests/providers/registry.test.ts` | Update metrics tests, add rolling window + quality tests    |
| Modified | `tests/tools/web-search.test.ts`   | Verify onResult callback is called with result counts       |

## Dependencies

None. No new npm packages required.

## Testing Strategy

### tests/providers/registry.test.ts

**Rolling window tests:**

- Metrics within window accumulate correctly
- Metrics reset when window expires (simulate with time manipulation)
- Window reset preserves independent behavior per provider

**Result quality tests:**

- `recordResultQuality` updates avgResultRatio
- Quality score used in selectSearchByPerformance composite
- Provider with better result ratio preferred when other scores equal

**Running average tests:**

- `avgLatency` computes running average correctly
- Multiple samples converge to expected average

**Composite score formula tests:**

- Existing tests updated to use avgLatency instead of totalLatencyMs
- New test: quality score influences provider selection

### tests/tools/web-search.test.ts

- `onResult` callback called with correct (providerName, resultCount, requestedCount)
- `onResult` not called on failure
- `onResult` called even when results are empty (resultCount=0)

## Out of Scope

- Configurable window duration (60s is hardcoded, same as source)
- Persisting metrics across sessions (metrics are session-scoped, same as current behavior)
- Exposing raw scores in `/tools` command output (could be added later)
- Changing `executeWithFallback` to score mid-fallback (current sequential fallback is kept)
