# Pi Tools Phase 3: Capability-Aware Provider Operation Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make provider selection, budgets, activity logging, fallback, fusion, and outcome metrics follow one capability-aware policy.

**Architecture:** Keep provider registration and budget ownership in `ProviderRegistry`. Store tier metadata for every registered capability, not only search. Give fetch, code-search, and docs selection the same tier/performance policy as search. Extract one attempt runner from `executeWithFallback`; use it for fallback, fusion, code-search, docs, and research so activity and outcome hooks cannot drift between tools.

**Tech Stack:** TypeScript, native `AbortSignal`, existing activity monitor and budget registry, Vitest.

---

## Atomic result

After this phase:

- `auto` selects eligible providers in tier order for search, fetch, code-search, and docs.
- `best-performing` ranks every capability that has active metrics; explicit provider selection still wins when requested and eligible.
- Hard budgets are consumed by the registered wrapper before delegation for every capability.
- A successful attempt, ordinary provider failure, budget rejection, cancellation, and activity record have the same semantics in fallback, fusion, and direct capability tools.
- Search fusion keeps its targeted/all batching and RRF output unchanged.

No tool is re-registered dynamically in this phase; that is phase 4.

## File map

Create:

- None. Reuse `ProviderRegistry`, `execute.ts`, and `fusion.ts` as the operation-policy seam.

Modify:

- `src/providers/types.ts` — define the capability type used by selection helpers.
- `src/providers/registry.ts` — retain tier metadata for all capability maps, centralize eligible/performance selection, and expose execution hooks.
- `src/providers/execute.ts` — add the shared single-attempt runner and use it in fallback execution.
- `src/providers/fusion.ts` — use the shared attempt runner without changing fusion batching.
- `src/tools/web-search.ts` — accept the shared execution hooks while preserving filter behavior from phase 1.
- `src/tools/web-fetch.ts` — pass hooks through provider fallback.
- `src/tools/code-search.ts` — execute through the shared attempt runner.
- `src/tools/web-docs-search.ts` — execute through the shared attempt runner.
- `src/tools/web-docs-fetch.ts` — execute through the shared attempt runner.
- `src/tools/web-research.ts` — execute each Exa request through the shared attempt runner while preserving the budget callback.
- `src/index.ts` — construct one registry hook set and pass it to every tool factory.
- `tests/providers/registry.test.ts` — test selection order and metrics for every capability.
- `tests/providers/execute.test.ts` — test the shared attempt runner and fallback delegation.
- `tests/providers/fusion.test.ts` — test shared activity/outcome behavior in fusion.
- `tests/tools/web-fetch.test.ts`, `tests/tools/code-search.test.ts`, `tests/tools/web-docs-search.test.ts`, `tests/tools/web-docs-fetch.test.ts`, `tests/tools/web-research.test.ts` — cover direct capability execution.
- `tests/index.test.ts`, `tests/index-strategy.test.ts` — verify one hook set and strategy routing.

## Tasks

### Task 1: Give every registered capability a common selection policy

**Files:**

- Modify: `src/providers/types.ts`
- Modify: `src/providers/registry.ts`
- Modify: `tests/providers/registry.test.ts`

- [ ] **Step 1: Define the capability union once.**

Add this type beside `ProviderOperation` in `src/providers/types.ts`:

```ts
export type ProviderCapability = ProviderOperation["capability"];
```

Use it for selection helpers and hook operation labels. Do not replace the discriminated `ProviderOperation`; its operation-specific fields still drive usage-cost calculation.

- [ ] **Step 2: Store tier metadata for every capability map.**

Replace the search-only registration shape with a reusable internal shape:

```ts
interface RegisteredProvider<T> {
  provider: T;
  tier: ProviderTier;
}

private searchProviders = new Map<string, RegisteredProvider<SearchProvider>>();
private fetchProviders = new Map<string, RegisteredProvider<FetchProvider>>();
private codeSearchProviders = new Map<string, RegisteredProvider<CodeSearchProvider>>();
private docsProviders = new Map<string, RegisteredProvider<DocsProvider>>();
```

When `registerProvider()` stores fetch, code-search, or docs instances, store `{ provider, tier: options.tier }`. Keep the existing wrapper functions and their `consume()` calls. Phase 1’s `filterSupport` metadata must remain on wrapped search providers.

- [ ] **Step 3: Factor eligibility and scoring without changing the search formula.**

Keep `isEligible()` and the existing score weights (`successRate * 0.5 + speed * 0.3 + quality * 0.2`). Generalize the implementation over a map of `RegisteredProvider<T>` and the provider-name key:

```ts
private selectByTier<T>(
  entries: Map<string, RegisteredProvider<T>>,
  name?: string,
): T[] {
  if (name && name !== "auto") {
    const entry = entries.get(name);
    return entry && this.isEligible(name) ? [entry.provider] : [];
  }

  return ([1, 2, 3] as const).flatMap((tier) =>
    [...entries].flatMap(([providerName, entry]) =>
      entry.tier === tier && this.isEligible(providerName) ? [entry.provider] : [],
    ),
  );
}
```

Add a generic performance sorter that uses the map key for metrics and returns only budget-eligible entries. Providers without active samples retain the existing neutral score and stable map order. Do not score a provider from metrics belonging to a different capability operation if the registered provider name is absent from the capability map.

- [ ] **Step 4: Preserve existing search APIs and extend other capabilities.**

Keep these existing methods as compatibility wrappers:

```ts
selectSearchCandidates(name?: string): SearchProvider[];
selectSearchByPerformance(name?: string): SearchProvider | undefined;
selectSearchByPerformanceAll(): SearchProvider[];
selectSearchForFusion(strategy: SelectionStrategy, name?: string): SearchProvider[];
```

Update them to use the generalized helpers. Add strategy-aware methods for the other registered capabilities:

```ts
selectFetchCandidates(strategy: SelectionStrategy = "auto"): FetchProvider[];
selectCodeSearch(strategy: SelectionStrategy = "auto"): CodeSearchProvider | undefined;
selectDocs(name?: string): DocsProvider | undefined;
selectDocsByStrategy(
  strategy: SelectionStrategy,
  name?: string,
): DocsProvider | undefined;
```

For `best-performing`, `selectFetchCandidates()` returns all scored eligible fetch providers, while `selectCodeSearch()` and `selectDocsByStrategy()` return the first scored eligible provider. For `auto`, all methods use tier order. `selectDocs(name?)` remains the compatibility wrapper for the current auto/name API, and an explicit docs name is returned only when that provider is eligible. No new strategy is added.

- [ ] **Step 5: Test capability selection and budget eligibility.**

Add registry tests with three providers at tiers 1, 2, and 3, each exposing search/fetch/code/docs. Assert:

1. `auto` returns `1 → 2 → 3` for fetch and search even when registration order differs.
2. `best-performing` returns the provider with the highest existing metrics for fetch and code-search.
3. An over-budget provider is absent from every capability selection, including an explicit name.
4. `selectDocsByStrategy("best-performing")` uses metrics and `selectDocsByStrategy("auto", "named")` retains the explicit provider only when eligible; the old `selectDocs("named")` call remains compatible.
5. Existing search fusion strategy tests still return the same candidate order.

Run:

```bash
pnpm exec vitest run tests/providers/registry.test.ts
```

Expected: focused registry tests pass with the existing selection behavior preserved for search.

### Task 2: Centralize one provider-attempt execution path

**Files:**

- Modify: `src/providers/execute.ts`
- Modify: `src/providers/fusion.ts`
- Modify: `src/providers/registry.ts`
- Modify: `tests/providers/execute.test.ts`
- Modify: `tests/providers/fusion.test.ts`

- [ ] **Step 1: Extract the single-attempt contract.**

Export the existing candidate shape and add an execution hook type:

```ts
export interface FallbackCandidate<T> {
  name: string;
  execute: () => Promise<T>;
}

export interface ExecutionHooks {
  onSuccess?: (providerName: string, latencyMs: number) => void;
  onFailure?: (providerName: string) => void;
}

export interface ExecuteAttemptOptions<T> extends ExecutionHooks {
  candidate: FallbackCandidate<T>;
  operation: string;
  signal?: AbortSignal;
  activityQuery?: string;
}
```

Implement `executeAttempt()` so it:

1. checks `signal.throwIfAborted()` before work;
2. logs one API activity entry using `activityQuery ?? operation`;
3. measures latency and calls `onSuccess` only after the result and post-result abort check succeed;
4. logs completion with status 200 on success;
5. logs the sanitized activity error and calls `onFailure` for ordinary errors;
6. never calls `onFailure` for `BudgetExceededError`; and
7. rethrows the original error so the caller decides whether to continue, aggregate, or render it.

The implementation must not catch and convert cancellation into a provider failure. Keep `BudgetExceededError` imported from the registry and preserve the existing `AggregateProviderError` messages.

- [ ] **Step 2: Make fallback use the shared attempt.**

Reduce `executeWithFallback()` to candidate iteration and aggregation:

```ts
for (const candidate of candidates) {
  try {
    const result = await executeAttempt({
      candidate,
      operation,
      signal,
      onSuccess,
      onFailure,
    });
    return { result, providerName: candidate.name };
  } catch (error) {
    errors.push({
      provider: candidate.name,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
```

Leave the empty-candidate `AggregateProviderError` and final aggregation unchanged.

- [ ] **Step 3: Make fusion use the shared attempt.**

Add an optional `signal?: AbortSignal` to `FusionOptions`, pass it through `executeWithFusion()` to `executeTargeted()`, and check it before each batch. Replace the duplicated activity/timing/try-catch wrapper with `executeAttempt({ candidate: { name: candidate.name, execute: () => candidate.execute(perProvider) }, operation: "search", activityQuery: `fusion:${candidate.name}`, signal, onSuccess, onFailure })`.

Preserve fusion’s existing behavior: batches run concurrently, empty results are successful but not usable, budget rejections are recorded in errors but not `providersFailed`, and a no-usable-result batch throws `AggregateProviderError("search", errors)`. Do not route fusion through sequential `executeWithFallback`; concurrency is part of the fusion contract.

- [ ] **Step 4: Expose registry hooks instead of repeating outcome wiring.**

Import `ExecutionHooks` as a type in `registry.ts` and add:

```ts
getExecutionHooks(): ExecutionHooks {
  return {
    onSuccess: (providerName, latencyMs) =>
      this.recordOutcome(providerName, { success: true, latencyMs }),
    onFailure: (providerName) =>
      this.recordOutcome(providerName, { success: false }),
  };
}
```

Return fresh closures so tests can replace registry instances without sharing state. Keep `recordResultQuality()` separate because it is search-result-specific, not generic provider execution.

- [ ] **Step 5: Test one activity/outcome event per attempt.**

Add tests that prove:

1. fallback success logs one start/complete pair and one success hook;
2. fallback failure then success logs one error and one success, with one failure hook;
3. `BudgetExceededError` is aggregated without a failure hook;
4. cancellation is rethrown and does not call a failure hook; and
5. fusion uses the same hooks while preserving concurrent batch behavior and `providersFailed` semantics.

Run:

```bash
pnpm exec vitest run tests/providers/execute.test.ts tests/providers/fusion.test.ts
```

Expected: the focused execution tests pass with no duplicate activity entries.

### Task 3: Route direct capability tools through the policy

**Files:**

- Modify: `src/tools/web-search.ts`
- Modify: `src/tools/web-fetch.ts`
- Modify: `src/tools/code-search.ts`
- Modify: `src/tools/web-docs-search.ts`
- Modify: `src/tools/web-docs-fetch.ts`
- Modify: `src/tools/web-research.ts`
- Modify: `src/index.ts`
- Modify: `tests/tools/web-fetch.test.ts`
- Modify: `tests/tools/code-search.test.ts`
- Modify: `tests/tools/web-docs-search.test.ts`
- Modify: `tests/tools/web-docs-fetch.test.ts`
- Modify: `tests/tools/web-research.test.ts`
- Modify: `tests/index.test.ts`
- Modify: `tests/index-strategy.test.ts`

- [ ] **Step 1: Pass one hook set to tool factories.**

Update factories that execute providers to accept `ExecutionHooks` as an optional argument. Keep existing argument order where possible and update tests at the call site. In `src/index.ts`, create the hooks once after the registry:

```ts
const executionHooks = registry.getExecutionHooks();
```

Pass it to web search, web fetch, code search, docs search, docs fetch, and web research. Keep the existing result-quality callback only on web search.

- [ ] **Step 2: Use shared attempts in `web_search` and `web_fetch`.**

Pass `executionHooks` to both `executeWithFallback()` and `executeWithFusion()` in `web-search.ts`. Keep phase 1 filter eligibility/post-filtering before the candidate’s `execute` function.

In `web-fetch.ts`, pass `executionHooks` into the existing provider fallback. Do not move provider fallback into the extraction pipeline yet; phase 5 owns that seam. The current retryable pipeline error and sanitized combined error remain unchanged.

- [ ] **Step 3: Wrap code-search and docs calls.**

Replace direct provider calls with `executeAttempt()`:

```ts
const results = await executeAttempt({
  candidate: {
    name: provider.name,
    execute: () => provider.codeSearch(params.query, maxResults, signal ?? undefined),
  },
  operation: "code-search",
  signal: signal ?? undefined,
  ...executionHooks,
});
```

Use operation names `docs-search` and `docs-fetch` for Context7. Preserve each tool’s current error contract: code-search renders a sanitized error result, docs tools allow the provider error to propagate as a failed tool result, and missing-provider messages remain unchanged.

- [ ] **Step 4: Wrap each Exa research request.**

Keep `beforeResearch` as the budget reservation callback, but place it inside the candidate execution passed to `executeAttempt()`:

```ts
responses.push(
  await executeAttempt({
    candidate: {
      name: "exa",
      execute: () => {
        beforeResearch?.({
          capability: "research",
          type: mode.type,
          maxResults: mode.numResults,
          contentTypes: 2 + (mode.summaryQuery ? 1 : 0),
        });
        return client.deepResearch(request, signal ?? undefined);
      },
    },
    operation: "research",
    signal: signal ?? undefined,
    ...executionHooks,
  }),
);
```

Preserve the existing query deduplication, output paths, report rendering, and Exa key checks. A budget rejection must remain a budget rejection rather than becoming a provider failure metric.

- [ ] **Step 5: Use strategy-aware selection for non-search tools.**

Update resolver callbacks in `src/index.ts` to pass `configManager.current.selectionStrategy` to fetch, code-search, and `selectDocsByStrategy`. Keep the compatibility `selectDocs()` wrapper for callers that do not need an explicit strategy. Keep search’s existing explicit/default/combine behavior, and pass the tool `signal` through `executeWithFusion`. Add tests proving a runtime strategy of `best-performing` reaches each capability resolver.

Run:

```bash
pnpm exec vitest run tests/tools/web-fetch.test.ts tests/tools/code-search.test.ts tests/tools/web-docs-search.test.ts tests/tools/web-docs-fetch.test.ts tests/tools/web-research.test.ts tests/index.test.ts tests/index-strategy.test.ts
```

Expected: direct tools retain their result/error shapes while recording outcomes through the same hooks.

### Task 4: Complete the phase gate and commit

- [ ] **Step 1: Search for duplicate execution instrumentation.**

Run:

```bash
rg -n "activityMonitor\.log(Start|Complete|Error)|recordOutcome\(" src/providers src/tools src/index.ts
```

Expected: attempt lifecycle logging is implemented in `executeAttempt()`; tool code only supplies hooks or search quality recording. The fusion module contains no second timing/callback implementation.

- [ ] **Step 2: Run the complete phase gate.**

```bash
pnpm exec vitest run tests/providers/registry.test.ts tests/providers/execute.test.ts tests/providers/fusion.test.ts tests/tools/web-search.test.ts tests/tools/web-fetch.test.ts tests/tools/code-search.test.ts tests/tools/web-docs-search.test.ts tests/tools/web-docs-fetch.test.ts tests/tools/web-research.test.ts tests/index.test.ts tests/index-strategy.test.ts
pnpm check
git diff --check
```

Expected: focused tests and the full suite pass with only the documented pre-existing Biome and Node-engine warnings.

- [ ] **Step 3: Commit the atomic phase.**

```bash
git add src/providers src/tools src/index.ts tests
git commit -m "refactor: unify provider operation policy"
```

The commit must not include ConfigManager listeners, tool re-registration, or extraction fallback changes.

## Phase completion gate

- Tier and performance selection is capability-aware and budget-aware.
- Fallback, fusion, direct capability calls, and research share one attempt lifecycle.
- Budget rejections and cancellations preserve their existing non-failure semantics.
- Search fusion concurrency and output behavior are unchanged.
- Focused tests, `pnpm check`, and `git diff --check` pass.
