# Multi-Provider Fusion (RRF) Design

**Date:** 2026-07-08
**Status:** Approved
**Reference:** ronnieops-pi-search-hub `extensions/dispatch.ts`

## Problem

pi-tools uses sequential fallback for web search: it tries providers one at a time until one succeeds. Results always come from a single provider. This leaves quality on the table -- different providers have different index coverage, and combining results from multiple providers produces better, more diverse results.

## Solution

Add Reciprocal Rank Fusion (RRF) as an opt-in capability. When enabled, pi-tools queries multiple search providers in parallel and merges their results using RRF scoring with URL deduplication. The feature is adapted from the battle-tested implementation in ronnieops-pi-search-hub.

## Design Decisions

- **Orthogonal to selection strategy.** `combine` is a separate config toggle, not a new `selectionStrategy` value. The existing strategy (`auto` or `best-performing`) determines how providers are ordered; `combine` determines whether they're used for sequential fallback or parallel fusion.
- **Two combine modes.** `"targeted"` queries providers in batches until N usable backends respond (default 3). `"all"` queries every enabled provider in parallel. Both configurable.
- **Per-call override.** The `web_search` tool accepts an optional `combine` boolean parameter so the LLM can override the global setting per search.
- **Attribution: summary + expanded.** Normal output shows a summary line (`"8 results fused from brave, exa, tavily"`). Per-result provider tags appear only in the expanded render view.
- **Quota-aware with warnings.** Providers with exhausted quotas are excluded from the fusion pool. When fewer providers respond than the target, a degraded warning surfaces in the output.
- **Opt-in, disabled by default.** Existing behavior unchanged until the user enables fusion in config.

## Config Schema

New `CombineConfig` on `PiToolsConfig`:

```typescript
export interface CombineConfig {
  enabled: boolean; // default: false
  mode: "targeted" | "all"; // default: "targeted"
  targetBackends: number; // default: 3, only used in targeted mode
  k: number; // RRF constant, default: 60
}

export interface PiToolsConfig {
  // ... existing fields ...
  combine: CombineConfig;
}
```

Default config:

```json
{
  "combine": {
    "enabled": false,
    "mode": "targeted",
    "targetBackends": 3,
    "k": 60
  }
}
```

## Core Fusion Module (`src/providers/fusion.ts`)

Two exports:

### `reciprocalRankFusion()`

Pure function. Takes ranked result lists from multiple providers, returns a merged, deduplicated, scored list.

```typescript
interface ProviderResults {
  providerName: string;
  results: SearchResult[];
}

interface FusedResult {
  result: SearchResult;
  rrfScore: number;
  providers: string[];
}

function reciprocalRankFusion(
  providerResults: ProviderResults[],
  maxResults: number,
  k?: number,
): FusedResult[];
```

Algorithm:

- URL normalization for dedup: strip hash, normalize trailing slash, lowercase.
- Score per result: `sum(1 / (k + rank + 1))` across all providers that returned it.
- Content-aware merge: when the same URL appears from multiple providers, keep the result with the longer snippet. (Note: pi-tools' `SearchResult` has only `snippet`, not `content`. If `content` is added later, prefer it over `snippet` for length comparison, matching search-hub behavior.)
- Sort by RRF score descending, tiebreak by provider count.

URL normalization is a private function inside `fusion.ts`.

### `executeWithFusion()`

Orchestration function that runs providers in parallel and fuses results.

```typescript
interface FusionCandidate {
  name: string;
  execute: (numResults: number) => Promise<SearchResult[]>;
}

interface FusionOptions {
  candidates: FusionCandidate[];
  maxResults: number;
  mode: "targeted" | "all";
  targetBackends: number;
  k: number;
  onSuccess?: (providerName: string, latencyMs: number) => void;
  onFailure?: (providerName: string) => void;
}

interface FusionResult {
  results: FusedResult[];
  providersUsed: string[];
  providersFailed: string[];
  degraded: boolean;
}

async function executeWithFusion(options: FusionOptions): Promise<FusionResult>;
```

**Result count distribution:** `executeWithFusion` calculates `perProvider = Math.ceil(maxResults / providerCount)` and passes it into each candidate's `execute(perProvider)` call. This avoids over-fetching while ensuring enough results for meaningful fusion after dedup. RRF then slices the fused output to `maxResults`.

This means the `FusionCandidate.execute` signature takes a `numResults` argument:

```typescript
interface FusionCandidate {
  name: string;
  execute: (numResults: number) => Promise<SearchResult[]>;
}
```

**Targeted mode:** Batches providers in groups of `needed` (target minus usable so far). Runs each batch in parallel. Stops when `targetBackends` usable providers respond or candidates exhausted. Does not abort in-flight requests when target is reached; allows the current batch to complete naturally. If only 1 usable provider, skips RRF and returns results directly. Each provider in a batch is asked for `Math.ceil(maxResults / targetBackends)` results.

**All mode:** Runs all candidates in parallel via `Promise.all` with internal try/catch per provider (not `Promise.allSettled`). Failures are caught and recorded; successes are fused. Each provider is asked for `Math.ceil(maxResults / candidates.length)` results.

The `degraded` flag is set when fewer providers responded than `targetBackends`.

The existing `executeWithFallback` in `execute.ts` stays untouched.

## Registry Changes

New method on `ProviderRegistry`:

```typescript
selectSearchForFusion(
  strategy: SelectionStrategy,
  name?: string,
): SearchProvider[]
```

- If `name` is set and not `"auto"`, returns just that provider.
- If strategy is `"auto"`: delegates to existing `selectSearchCandidates()` (tier-sorted, quota-filtered).
- If strategy is `"best-performing"`: returns all eligible providers sorted by composite score descending (new `selectSearchByPerformanceAll()` method).

New private method:

```typescript
selectSearchByPerformanceAll(): SearchProvider[]
```

Same scoring logic as `selectSearchByPerformance()` but returns the full sorted array instead of just the top provider.

## web_search Tool Changes

### New parameter

```typescript
combine: Type.Optional(
  Type.Boolean({
    description: "Override fusion setting: true to fuse multiple providers, false for single-provider fallback",
  }),
),
```

### Execution branching

```
1. Resolve candidates (existing logic, adapted for fusion)
2. Determine combine: params.combine ?? combineConfig.enabled
3. If combine=true:
   -> executeWithFusion() with candidates, mode, targetBackends, k
   -> Record metrics per-provider (onSuccess/onFailure fire individually)
   -> Record result quality for each provider that responded
   -> If degraded, prepend warning to output
4. If combine=false:
   -> Existing executeWithFallback path (unchanged)
```

### Factory signature change

`createWebSearchTool` gains a `combineConfig` parameter:

```typescript
export function createWebSearchTool(
  resolveCandidates: (name?: string, combine?: boolean) => SearchProvider[],
  onSuccess?: ...,
  guidance?: ...,
  onFailure?: ...,
  onResult?: ...,
  combineConfig?: CombineConfig,
): ToolDefinition<typeof WebSearchParams, WebSearchDetails>
```

### Output formatting

Normal mode with fusion:

```
8 results fused from brave, exa, tavily
```

Degraded:

```
Warning: Only 2 of 3 target providers responded (quota exhaustion)
5 results fused from brave, exa
```

### Details type

```typescript
interface WebSearchDetails {
  provider: string; // "fusion" when fused, provider name otherwise
  resultCount: number;
  fusionMeta?: {
    providersUsed: string[];
    degraded: boolean;
    results: Array<{ url: string; providers: string[] }>;
  };
}
```

### Expanded rendering

When fusion data is available, each result gets a provider tag in expanded view:

```
1. [Result Title](https://example.com)  [brave, exa]
   Result snippet here...
```

## Integration & Wiring (index.ts)

The `resolveCandidates` closure branches based on whether fusion is active:

```typescript
const resolveCandidates = (name?: string, combine?: boolean) => {
  configManager.refresh();
  const resolved = name ?? configManager.current.defaultProvider;
  const combineActive = combine ?? configManager.current.combine.enabled;

  if (combineActive) {
    return registry.selectSearchForFusion(
      configManager.current.selectionStrategy,
      resolved,
    );
  }

  // Existing paths unchanged
  if (configManager.current.selectionStrategy === "best-performing") {
    const provider = registry.selectSearchByPerformance(resolved);
    return provider ? [provider] : [];
  }
  return registry.selectSearchCandidates(resolved);
};
```

`createWebSearchTool` receives `configManager.current.combine` as its new parameter.

The `combine` argument on `resolveCandidates` controls provider _selection_ (how many providers to return). The `combineConfig` on the tool factory controls _execution_ behavior (mode, targetBackends, k). The tool reads `params.combine` to determine the effective combine flag, passes it to `resolveCandidates` for selection, and uses `combineConfig` for orchestration.

`ConfigManager.diffConfig()` detects changes to `combine.*` fields. Since combine doesn't affect which providers are registered (only how they're used at search time), the existing `configManager.refresh()` call before every search picks up the latest config.

## Error Handling & Edge Cases

- **Fewer providers than target:** `degraded` flag set. If 1+ providers returned results, fusion proceeds with warning. If 0 providers returned results, throws `AggregateProviderError`.
- **Single provider responds:** RRF skipped, results pass through directly. Output indicates fusion was attempted but degraded.
- **Provider timeout / abort:** Each provider call respects `AbortSignal`. In targeted mode, if the signal fires, in-flight batch requests abort. In all mode, each provider runs in parallel with try/catch; failures are recorded, successes are fused.
- **Empty results from a provider:** Counts as "not usable" in targeted mode (keeps querying). Success still recorded in metrics.
- **Quota exhaustion mid-fusion:** Providers filtered by remaining quota before becoming candidates. Natural failures recorded if quota runs out between refresh and execution.
- **URL normalization edge cases:** Missing protocols fall back to lowercase string comparison. Identical normalized URLs merge with longer snippet winning.

## Caching

Individual provider results are NOT cached at the fusion layer. Pi-tools does not currently cache search results (only fetch results via `ContentCache`). Adding search result caching is out of scope for this feature. If search caching is added later, it should cache per-provider results (keyed by provider+query+numResults) so that repeated fusion queries reuse cached provider responses while RRF re-runs to produce fresh merged output.

## Design Differences from search-hub

- **Metrics recording:** Search-hub records metrics inside `runBackend` (registry layer). Pi-tools uses `onSuccess`/`onFailure` callbacks passed into the orchestration function, consistent with the existing `executeWithFallback` pattern. Functionally equivalent; different wiring location.
- **SearchResult type:** Pi-tools has `snippet` only (no `content` field). Search-hub has both `snippet` and `content`. Content-aware merge in pi-tools compares `snippet` length only.
- **Config structure:** Search-hub uses `combine: boolean` + `combineMode`. Pi-tools uses a nested `combine: CombineConfig` object. Same expressiveness, different shape.

## Testing Strategy

### Unit tests for `fusion.ts`

`reciprocalRankFusion()` pure function tests:

- Merges results from 2-3 providers, verifies score ordering
- Deduplicates by normalized URL (trailing slash, hash, case)
- Content-aware merge: keeps longer snippet on dedup
- Respects `maxResults` limit
- Single provider input: returns results without RRF
- Empty provider results: handled gracefully
- Custom `k` parameter changes scoring

`executeWithFusion()` orchestration tests:

- Targeted mode: stops after N usable providers
- Targeted mode: batches correctly when first batch has failures
- All mode: runs all candidates in parallel
- Sets `degraded` flag when fewer than target respond
- Calls `onSuccess`/`onFailure` per provider
- Propagates `AbortSignal` to candidates
- Throws `AggregateProviderError` when 0 providers succeed

### Unit tests for registry changes

- `selectSearchForFusion()`: returns full sorted list for both strategies
- `selectSearchByPerformanceAll()`: returns all eligible providers sorted by score

### Integration tests for web_search with fusion

- `combine: true` param triggers fusion path
- `combine: false` param forces fallback when config has `combine.enabled: true`
- Config-driven fusion (no param override)
- Output format includes provider summary
- Degraded warning appears when fewer providers than target
- Expanded render shows per-result attribution

All tests use Vitest with mock providers (no real API calls).

## Files Changed

New files:

- `src/providers/fusion.ts` -- RRF algorithm + fusion orchestration
- `tests/fusion.test.ts` -- fusion unit tests

Modified files:

- `src/config.ts` -- `CombineConfig` type, defaults, parsing
- `src/providers/registry.ts` -- `selectSearchForFusion()`, `selectSearchByPerformanceAll()`
- `src/tools/web-search.ts` -- `combine` param, fusion execution branch, output formatting
- `src/index.ts` -- wiring: updated `resolveCandidates`, pass combine config
- `tests/registry.test.ts` -- new registry method tests
- `tests/web-search.test.ts` -- fusion integration tests
