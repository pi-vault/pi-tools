# Pi Tools Phase 3: Capability-Aware Provider Operation Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make provider selection, budgets, activity logging, fallback, fusion, and outcome metrics follow one capability-aware policy for search, fetch, code search, docs, and research.

**Architecture:** Keep provider registration and budget ownership in `ProviderRegistry`. Store tier metadata for every registered capability, including research. Add one shared attempt runner for activity and outcome hooks. Route every provider-backed operation through registry wrappers and the shared runner. Research becomes a first-class registered capability backed by the existing `ProviderOperation` cost model; it is not a special direct Exa client path.

**Tech stack:** TypeScript, native `AbortSignal`, existing activity monitor and budget registry, Vitest.

## Readiness decision

The original plan was not ready to implement. This revision resolves the following issues found against the clean Phase 3 branch at commit `4e35d6e`:

- `fetch`, `code-search`, and `docs` registrations discard tier metadata, so automatic selection still depends on registration order.
- Explicit search and docs selections can bypass budget eligibility.
- `best-performing` exists only for search; fetch, code search, docs, and research cannot use the configured strategy.
- Fallback and fusion duplicate activity/timing/outcome instrumentation.
- `web_fetch`, code search, and docs tools bypass the shared attempt path.
- Research already has a `ProviderOperation` cost model, but the tool bypasses the registry and reserves through `beforeResearch`.
- Fusion does not define cancellation propagation when concurrent attempts are active.
- The previous file map omitted `tests/tools/web-search.test.ts` and the Exa research/provider tests needed for the new registration contract.
- The documented baseline was stale. The current clean branch passes 89 test files and 1,427 tests; the environment is Node 23.11.0 while the package requires Node >=24.15.0.

## Atomic result

After this phase:

- `auto` selects eligible providers in tier order for search, fetch, code search, docs, and research.
- `best-performing` ranks eligible providers for every capability with active provider metrics; providers without samples retain the existing neutral score and stable registration order.
- An explicit provider name wins only when that registered capability exists and is budget-eligible; an exhausted explicit provider returns no candidate instead of bypassing the budget or silently selecting another provider.
- Hard budgets are consumed by the registered wrapper before delegation for search, fetch, code search, docs, and research.
- One shared attempt runner owns API activity start/completion/error logging and success/failure hooks for sequential fallback, fusion, direct capability tools, and research.
- Budget rejections are not failure metrics. Caller cancellation is rethrown and is not a provider failure.
- Search fusion retains its targeted/all batching, concurrency, provider-used/failed semantics, and RRF output.
- Research keeps its query deduplication, mode defaults, report rendering, output files, trust/key gating, and response shape while using registered research candidates.

No tool is re-registered dynamically in this phase; that remains Phase 4.

## Locked boundaries

This phase may change:

- provider capability types and registry wrappers;
- provider selection helpers and their budget eligibility;
- shared execution instrumentation;
- provider-backed tool factory seams and strategy routing;
- Exa research registration.

This phase must not change:

- ConfigManager refresh/listener behavior or tool re-registration;
- extraction fallback routing or the Phase 5 extraction seam;
- search filter support and post-filtering introduced in Phase 1;
- search fusion batching, target calculation, RRF scoring, or output formatting;
- result/error shapes, error sanitization, trust gating, credential resolution, or hard-budget rollback behavior;
- package dependencies, Node engine requirements, or unrelated lint warnings.

Research budgeting is intentionally moved from the tool-local `beforeResearch` callback into the first-class registry wrapper. Adding a new research provider later will use the same `ResearchProvider` interface and selection path.

## File map

Modify:

- `src/providers/types.ts` — add `ResearchProvider`, extend `ProviderMeta.create`, and define the shared capability alias.
- `src/providers/exa-deep-research.ts` — implement the registered research-provider shape without changing the HTTP request/response behavior.
- `src/providers/exa.ts` — return the Exa research client from the Exa metadata factory.
- `src/providers/registry.ts` — retain tier metadata for every capability map, add research registration/wrapping, centralize selection, expose execution hooks, and preserve budget semantics.
- `src/providers/execute.ts` — export fallback candidates/hooks, add `executeAttempt`, and use it in `executeWithFallback`.
- `src/providers/fusion.ts` — use `executeAttempt`, add signal propagation, and preserve concurrent fusion behavior.
- `src/tools/web-search.ts` — pass shared hooks to fallback/fusion while preserving Phase 1 filter eligibility.
- `src/tools/web-fetch.ts` — pass shared hooks through the existing registered-provider fallback.
- `src/tools/code-search.ts` — execute through `executeAttempt`.
- `src/tools/web-docs-search.ts` — execute through `executeAttempt`.
- `src/tools/web-docs-fetch.ts` — execute through `executeAttempt`.
- `src/tools/web-research.ts` — resolve registered research candidates and execute each unique query through shared fallback/hooks.
- `src/index.ts` — construct one registry hook set, pass it to all provider-backed tools, and route fetch/code/docs/research selection through the current strategy.
- `tests/providers/registry.test.ts` — cover all capability maps, selection order, explicit eligibility, research operation metadata, and budgets.
- `tests/providers/execute.test.ts` — cover the shared attempt contract and fallback delegation.
- `tests/providers/fusion.test.ts` — cover shared hooks, activity behavior, cancellation, and existing fusion semantics.
- `tests/providers/exa.test.ts` — verify the Exa factory exposes the research capability without changing search/fetch/code behavior.
- `tests/providers/exa-deep-research.test.ts` — preserve the research client HTTP contract and assert it satisfies the provider shape.
- `tests/tools/web-search.test.ts` — verify shared-hook injection remains compatible with filter and fusion behavior.
- `tests/tools/web-fetch.test.ts` — cover shared hooks through provider fallback.
- `tests/tools/code-search.test.ts` — cover attempt success/failure and unchanged rendered error output.
- `tests/tools/web-docs-search.test.ts` — cover attempt execution and unchanged propagated provider errors.
- `tests/tools/web-docs-fetch.test.ts` — cover attempt execution and unchanged propagated provider errors.
- `tests/tools/web-research.test.ts` — cover registered candidates, fallback, operation budget metadata, cancellation, and unchanged reports.
- `tests/index.test.ts` — verify tool construction remains unchanged and conditional research registration still follows current availability.
- `tests/index-strategy.test.ts` — verify the configured strategy reaches every capability resolver.

Create: None.

Delete: None.

## Contracts to implement

### Capability and registered provider contracts

In `src/providers/types.ts`:

```ts
import type {
  DeepResearchParams,
  DeepResearchResponse,
  ExaDeepType,
} from "../research/types.ts";

export interface ResearchProvider {
  readonly name: string;
  readonly label: string;
  deepResearch(
    params: DeepResearchParams,
    signal?: AbortSignal,
  ): Promise<DeepResearchResponse>;
}

export type ProviderCapability = ProviderOperation["capability"];
```

Extend the return type of `ProviderMeta.create()` with `research?: ResearchProvider`. Keep `ProviderOperation` discriminated and unchanged in meaning. `DeepResearchParams.numResults` is resolved by `web_research` before delegation, so the registry can derive the exact existing cost operation from the request:

```ts
{
  capability: "research",
  type: params.type,
  maxResults: params.numResults ?? 10,
  contentTypes: 2 + (params.summaryQuery ? 1 : 0),
}
```

In `src/providers/exa-deep-research.ts`, add `name = "exa"` and `label = "Exa"` and keep `deepResearch()` behavior unchanged. In `src/providers/exa.ts`, return one `ExaDeepResearchClient` as `research` from the metadata factory alongside the existing `ExaProvider` capabilities. The factory still receives the resolved key from ConfigManager; it must not resolve credentials itself.

### Registry selection contract

Replace the search-only tier registration shape with one internal reusable shape:

```ts
interface RegisteredProvider<T> {
  provider: T;
  tier: ProviderTier;
}
```

Use it for search, fetch, code-search, docs, and research maps. Every registered capability must retain the `options.tier` supplied by `registerProvider()`. Preserve Phase 1 search `filterSupport` metadata on the wrapped search provider.

The registry must have these capability maps:

```ts
private searchProviders = new Map<string, RegisteredProvider<SearchProvider>>();
private fetchProviders = new Map<string, RegisteredProvider<FetchProvider>>();
private codeSearchProviders = new Map<string, RegisteredProvider<CodeSearchProvider>>();
private docsProviders = new Map<string, RegisteredProvider<DocsProvider>>();
private researchProviders = new Map<string, RegisteredProvider<ResearchProvider>>();
```

Generalize eligibility and performance selection over a capability map keyed by the registered policy name. Use the existing score exactly:

```text
successRate * 0.5 + speed * 0.3 + quality * 0.2
```

Use the registry key, not `provider.name`, to look up metrics and budgets. A capability is scored only when its registered map contains that key. Providers without active samples receive the existing neutral score of `0.5`; stable map order breaks ties. All automatic and performance selections filter through `isEligible()`.

Keep these search methods as compatibility wrappers:

```ts
selectSearchCandidates(name?: string): SearchProvider[];
selectSearchByPerformance(name?: string): SearchProvider | undefined;
selectSearchByPerformanceAll(): SearchProvider[];
selectSearchForFusion(strategy: SelectionStrategy, name?: string): SearchProvider[];
```

Their explicit-name behavior must now return a provider only if it exists in the search map and is budget-eligible. Automatic search retains tier order; best-performing search retains the current score formula.

Add strategy-aware methods:

```ts
selectFetchCandidates(strategy: SelectionStrategy = "auto"): FetchProvider[];
selectCodeSearch(strategy: SelectionStrategy = "auto"): CodeSearchProvider | undefined;
selectDocs(name?: string): DocsProvider | undefined;
selectDocsByStrategy(
  strategy: SelectionStrategy,
  name?: string,
): DocsProvider | undefined;
selectResearchCandidates(
  strategy: SelectionStrategy = "auto",
  name?: string,
): ResearchProvider[];
```

`auto` returns all eligible candidates in tier order for fetch and research, and the first eligible candidate for code search and docs. `best-performing` returns all scored eligible fetch/research candidates, and the first scored eligible code/docs candidate. Explicit names return only the named eligible provider. `selectDocs(name?)` remains the existing auto/name compatibility wrapper.

### Budget wrapper contract

Keep each wrapper’s existing `consume()` call before provider delegation. Add the research wrapper with the exact operation derivation above. `unregisterAll()` must delete research registrations as well as the other capability maps, while leaving usage counters available for re-registration.

The wrapper must preserve:

- hard-budget persistence before delegation;
- rollback when persistence fails;
- `BudgetExceededError` identity and message;
- managed/unlimited behavior; and
- shared pool counters.

### Shared attempt contract

In `src/providers/execute.ts`, export:

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

export async function executeAttempt<T>(
  options: ExecuteAttemptOptions<T>,
): Promise<T>;
```

`executeAttempt()` must:

1. call `signal?.throwIfAborted()` before logging or delegating;
2. log one API activity start with `activityQuery ?? operation`;
3. measure latency around the candidate;
4. check cancellation after the candidate resolves and before calling `onSuccess`;
5. call `onSuccess` and log status 200 only for a completed, non-cancelled result;
6. log a sanitized error with `sanitizeError()` for a rejected attempt;
7. call `onFailure` only for ordinary provider errors, never for `BudgetExceededError` or caller cancellation; and
8. rethrow the original error so the caller controls fallback, aggregation, or tool rendering.

Do not convert cancellation into an `AggregateProviderError`. A pre-attempt cancellation produces no activity entry, matching the current fallback behavior. An in-flight cancellation may complete its activity entry as an error but must not call the failure hook.

Reduce `executeWithFallback()` to candidate iteration, `executeAttempt()` delegation, and its existing empty-candidate/final `AggregateProviderError` behavior. Keep the existing operation names and error aggregation shape.

### Fusion contract

Add `signal?: AbortSignal` to `FusionOptions`. Check it before each batch and pass it to every `executeAttempt()` call. Use `activityQuery: \`fusion:${candidate.name}\``. Keep batches concurrent with `Promise.all`; do not route fusion through sequential fallback.

Preserve these existing rules:

- successful empty results call `onSuccess`, complete activity with status 200, and are not added to `providersUsed`;
- ordinary errors are added to `providersFailed` and the aggregate error list;
- budget rejections are added to the aggregate error list but not `providersFailed` and do not call `onFailure`;
- cancellation rejects the fusion operation instead of becoming a provider failure;
- targeted/all batch sizing, provider order, `degraded`, and RRF output do not change; and
- a run with no usable results throws `AggregateProviderError("search", errors)` with the existing messages.

### Tool factory contracts

Use one production `ExecutionHooks` object from `registry.getExecutionHooks()`. The registry method returns fresh closures:

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

Add an optional `ExecutionHooks` argument to provider-backed factories without removing their existing callback arguments unless the current factory has no compatibility value. Production code must pass the shared object, while existing direct factory tests may keep their legacy callback arguments. The factory behavior must be:

- `web_search`: pass the shared hooks to both `executeWithFallback()` and `executeWithFusion()`; keep the existing result-quality callback separate; retain filter eligibility before candidate execution.
- `web_fetch`: pass the shared hooks into the existing registered-provider `executeWithFallback()` path; do not move fallback into extraction before Phase 5.
- `code_search`: wrap the one selected provider with `executeAttempt(operation: "code-search")`; retain its sanitized error-as-text result and missing-provider message.
- `web_docs_search`: wrap `searchLibrary()` with `executeAttempt(operation: "docs-search")`; retain provider errors as thrown tool failures.
- `web_docs_fetch`: wrap `getContext()` with `executeAttempt(operation: "docs-fetch")`; retain provider errors as thrown tool failures.
- `web_research`: accept research candidates, not an API-key resolver or `beforeResearch`; wrap each unique query with `executeWithFallback(operation: "research")` and the shared hooks.

`web_research` must keep the existing request construction, query deduplication, mode defaults, response merge, source deduplication, report formats, file writes, append-entry record, and output text. A missing candidate list continues to produce the existing disabled/unavailable error. Budget reservation occurs inside the selected registry wrapper immediately before the Exa client call.

In `src/index.ts`:

1. construct `const executionHooks = registry.getExecutionHooks()` once after the registry;
2. pass that object to web search, web fetch, code search, docs search, docs fetch, and web research;
3. pass `configManager.current.selectionStrategy` to fetch, code-search, docs, and research resolvers;
4. keep search’s current default-provider, explicit-provider, combine, filter, and fusion behavior;
5. keep current session-start conditional registration for docs and research; and
6. remove the direct research `resolveApiKey`/`beforeResearch` wiring from the tool factory while preserving current key/trust gating through the registered Exa capability.

## Tasks

### Task 1: Register and select every provider capability

**Files:**

- Modify: `src/providers/types.ts`
- Modify: `src/providers/exa-deep-research.ts`
- Modify: `src/providers/exa.ts`
- Modify: `src/providers/registry.ts`
- Modify: `tests/providers/registry.test.ts`
- Modify: `tests/providers/exa.test.ts`
- Modify: `tests/providers/exa-deep-research.test.ts`

- [ ] **Step 1: Add the research provider interface and Exa registration.**

Add `ResearchProvider`, extend `ProviderMeta.create()`, and make `ExaDeepResearchClient` satisfy the interface. Return the client from Exa’s metadata factory. Do not change the Exa request body, headers, response normalization, or error behavior.

- [ ] **Step 2: Generalize registered capability storage.**

Replace the search-only tier shape with `RegisteredProvider<T>` for all five maps. Add the research map, wrapper, unregister behavior, and the research operation derivation. Keep all existing wrapper method signatures and budget semantics.

- [ ] **Step 3: Generalize tier and performance selection.**

Factor the existing eligibility and score calculation over a capability map. Preserve the score weights, neutral score, stable tie order, and search compatibility methods. Make every explicit selection budget-aware.

- [ ] **Step 4: Add strategy-aware capability selectors.**

Implement the fetch, code-search, docs, and research methods with the exact contracts above. Automatic fetch/research candidates must be tier ordered even when registration order differs. Performance selection must exclude exhausted providers.

- [ ] **Step 5: Add registry and Exa tests.**

Use at least three providers at tiers 1, 2, and 3 with intentionally different registration order. Assert:

1. auto search/fetch/research order is tier 1 → 2 → 3;
2. best-performing fetch/research order follows existing metrics;
3. best-performing code/docs return the highest-scored eligible provider;
4. explicit exhausted providers return no candidate for every capability;
5. `selectDocs("named")` remains compatible when the named provider is eligible;
6. the research wrapper calls `usageCost` with the exact type/result/content-count operation before delegation;
7. Exa metadata returns search, fetch, code-search, and research instances; and
8. existing search filter support, search ordering, and budget tests remain valid.

Run:

```bash
pnpm exec vitest run tests/providers/registry.test.ts tests/providers/exa.test.ts tests/providers/exa-deep-research.test.ts
```

### Task 2: Centralize one provider-attempt execution path

**Files:**

- Modify: `src/providers/execute.ts`
- Modify: `src/providers/fusion.ts`
- Modify: `src/providers/registry.ts`
- Modify: `tests/providers/execute.test.ts`
- Modify: `tests/providers/fusion.test.ts`

- [ ] **Step 1: Implement `executeAttempt()`.**

Move the current fallback activity/timing/hook logic into the shared function. Add sanitized activity errors, budget exclusion, and cancellation propagation without changing the aggregate error text.

- [ ] **Step 2: Delegate sequential fallback to the shared attempt.**

Keep `executeWithFallback()` responsible only for empty-candidate validation, iteration, error collection, and returning the first successful result/provider name.

- [ ] **Step 3: Delegate fusion attempts to the shared attempt.**

Replace the duplicated fusion instrumentation with `executeAttempt()`, pass the signal, and preserve concurrent batches and budget/provider-failure semantics.

- [ ] **Step 4: Expose registry outcome hooks.**

Add `getExecutionHooks()` with fresh closures. Keep `recordResultQuality()` separate because it remains search-specific.

- [ ] **Step 5: Test the attempt lifecycle.**

Prove:

1. success creates one activity start/completion pair and one success hook;
2. failure then success creates one error and one completion, with one failure and one success hook;
3. budget rejection is aggregated without a failure hook;
4. pre-attempt and in-flight cancellation are rethrown without a failure hook;
5. activity errors are sanitized; and
6. fusion uses the same hooks while retaining concurrent batching, empty-result success, budget rejection, and `providersFailed` behavior.

Run:

```bash
pnpm exec vitest run tests/providers/execute.test.ts tests/providers/fusion.test.ts
```

### Task 3: Route direct capability tools through the policy

**Files:**

- Modify: `src/tools/web-search.ts`
- Modify: `src/tools/web-fetch.ts`
- Modify: `src/tools/code-search.ts`
- Modify: `src/tools/web-docs-search.ts`
- Modify: `src/tools/web-docs-fetch.ts`
- Modify: `src/tools/web-research.ts`
- Modify: `src/index.ts`
- Modify: `tests/tools/web-search.test.ts`
- Modify: `tests/tools/web-fetch.test.ts`
- Modify: `tests/tools/code-search.test.ts`
- Modify: `tests/tools/web-docs-search.test.ts`
- Modify: `tests/tools/web-docs-fetch.test.ts`
- Modify: `tests/tools/web-research.test.ts`
- Modify: `tests/index.test.ts`
- Modify: `tests/index-strategy.test.ts`

- [ ] **Step 1: Add shared hook seams to tool factories.**

Pass one registry hook set from `src/index.ts` to all provider-backed factories. Preserve direct factory-test compatibility where the existing callback arguments are part of the current test/API seam.

- [ ] **Step 2: Update search and fetch.**

Pass hooks to both search execution paths and the registered fetch fallback. Preserve Phase 1 filter filtering, result quality recording, current fetch pipeline fallback boundary, sanitized combined errors, cache behavior, multi-URL concurrency, and result shapes.

- [ ] **Step 3: Update code search and docs tools.**

Use `executeAttempt()` with operation names `code-search`, `docs-search`, and `docs-fetch`. Preserve missing-provider messages, code-search error-as-text behavior, docs thrown-error behavior, progress updates, truncation, storage, and signal forwarding.

- [ ] **Step 4: Make research first-class at the tool boundary.**

Resolve registered research candidates from the registry, construct the same `DeepResearchParams` as today, and run each unique query through shared sequential fallback. Remove `resolveExaApiKey` and `beforeResearch` from the research factory. Do not instantiate `ExaDeepResearchClient` in the tool.

- [ ] **Step 5: Route all non-search strategies and test integration.**

Use the current `selectionStrategy` for fetch, code-search, docs, and research. Add index tests that spy on each selector under `auto` and `best-performing`; use configured Exa/Context7 availability where necessary so the conditional tools are exercised. Add tool tests for hook invocation, research fallback, cancellation, and unchanged output/error contracts.

Run:

```bash
pnpm exec vitest run tests/tools/web-search.test.ts tests/tools/web-fetch.test.ts tests/tools/code-search.test.ts tests/tools/web-docs-search.test.ts tests/tools/web-docs-fetch.test.ts tests/tools/web-research.test.ts tests/index.test.ts tests/index-strategy.test.ts
```

### Task 4: Complete the phase gate and commit

- [ ] **Step 1: Search for stale direct or duplicate paths.**

Run:

```bash
rg -n "activityMonitor\\.log(Start|Complete|Error)|recordOutcome\\(|beforeResearch|resolveExaApiKey|new ExaDeepResearchClient|selectFetchCandidates\\(|selectCodeSearch\\(|selectDocs\\(" src/providers src/tools src/index.ts
```

Expected:

- provider attempt activity lifecycle is implemented in `executeAttempt()`;
- production tools receive registry hooks rather than recording outcomes themselves;
- `beforeResearch` and direct `ExaDeepResearchClient` construction are absent from `web-research.ts` and `index.ts`;
- registry selectors are called with the configured strategy where applicable; and
- fusion contains no second timing/callback implementation.

- [ ] **Step 2: Run the focused phase gate.**

```bash
pnpm exec vitest run tests/providers/registry.test.ts tests/providers/execute.test.ts tests/providers/fusion.test.ts tests/providers/exa.test.ts tests/providers/exa-deep-research.test.ts tests/tools/web-search.test.ts tests/tools/web-fetch.test.ts tests/tools/code-search.test.ts tests/tools/web-docs-search.test.ts tests/tools/web-docs-fetch.test.ts tests/tools/web-research.test.ts tests/index.test.ts tests/index-strategy.test.ts
```

- [ ] **Step 3: Run repository verification.**

```bash
pnpm check
git diff --check
git status --short
```

Expected in the current environment: 89 test files and 1,427 tests pass; Node 23.11.0 emits the existing package-engine warning; Biome reports only documented pre-existing warnings. Do not fix unrelated warnings or change the engine declaration.

- [ ] **Step 4: Commit the atomic phase.**

```bash
git add src/providers src/tools src/index.ts tests
git commit -m "refactor: unify provider operation policy"
```

The commit must not include ConfigManager listeners, tool re-registration, extraction fallback changes, new dependencies, or unrelated formatting/lint cleanup.

## Phase completion gate

- Tier and performance selection is capability-aware and budget-aware for search, fetch, code search, docs, and research.
- Research is a registered, resolved-key, budget-wrapped provider capability; no tool-local reservation callback remains.
- Fallback, fusion, direct capability calls, and research share one attempt lifecycle.
- Budget rejections and cancellations preserve their non-failure semantics.
- Search fusion concurrency and output behavior are unchanged.
- Existing tool output/error, trust, credential, cache, and storage contracts remain intact.
- Focused tests, `pnpm check`, `git diff --check`, and intended-file status pass.
