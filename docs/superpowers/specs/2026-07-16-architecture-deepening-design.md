# Architecture Deepening Spec: 5 Refactoring Candidates

**Date:** 2026-07-16
**Status:** Draft
**Branch:** 20260716-improve-codebase-architecture

---

## Overview

Five refactoring candidates that turn shallow modules into deep ones, improving locality, leverage, and testability. Each candidate gets its own PR, ordered simplest to most complex. All refactors preserve existing external interfaces. Phase 4 is the one exception: it adds provider fallback to multi-URL fetches, which is a behavioral improvement (multi-URL becomes more resilient).

### Phase Summary

| Phase | Candidate                                          | Complexity | Depends on | Key metric                        |
| ----- | -------------------------------------------------- | ---------- | ---------- | --------------------------------- |
| 1     | Consolidate shallow HTTP search providers          | Easy       | None       | Delete 9 shallow provider files   |
| 2     | Extract session lifecycle from index.ts            | Easy       | None       | Lifecycle testable independently  |
| 3     | Extraction pipeline config self-resolution         | Medium     | None       | ExtractOptions drops 4 fields     |
| 4     | Collapse web-fetch-multi into web-fetch            | Medium     | Phase 3    | Fix multi-URL fallback asymmetry  |
| 5     | Absorb ConfigManager into ProviderRegistry         | Complex    | Phase 2    | Delete config-manager.ts          |

### Vocabulary

These terms are used precisely throughout (see LANGUAGE.md):

- **Module** -- anything with an interface and an implementation
- **Interface** -- everything a caller must know to use the module
- **Depth** -- leverage at the interface; deep = lots of behavior behind small interface
- **Shallow** -- interface nearly as complex as the implementation
- **Seam** -- where an interface lives; a place behavior can be altered without editing in place
- **Locality** -- change, bugs, knowledge concentrated in one place
- **Leverage** -- what callers get from depth; one interface, N call sites
- **Deletion test** -- if deleting a module makes complexity vanish, it was a pass-through

---

## Phase 1: Consolidate Shallow HTTP Search Providers

### Problem

9 provider modules are shallow -- their interface (file, export, import in all.ts, test file) is nearly as complex as their implementation (a few config properties passed to http-adapter). Each fails the deletion test: deleting any one would not cause complexity to reappear across callers because the implementation is trivial. All 9 already use `createHttpSearchProvider` from http-adapter.ts.

| Provider     | Lines | Unique logic |
| ------------ | ----- | ------------ |
| marginalia   | 29    | 0%           |
| langsearch   | 24    | 0%           |
| linkup       | 25    | 0%           |
| fastcrw      | 24    | 0%           |
| youcom       | 26    | 0%           |
| websearchapi | 21    | 0%           |
| perplexity   | 24    | 0%           |
| brave        | 38    | ~16%         |
| brave-llm    | 29    | 0%           |

### Solution

Replace 9 individual provider files with a single `src/providers/http-providers.ts` that exports an array of `ProviderMeta` definitions. Each definition uses `createHttpSearchProvider` from http-adapter.ts and references its parser from parsers.ts.

### Files deleted

- `src/providers/marginalia.ts`
- `src/providers/langsearch.ts`
- `src/providers/linkup.ts`
- `src/providers/fastcrw.ts`
- `src/providers/youcom.ts`
- `src/providers/websearchapi.ts`
- `src/providers/perplexity.ts`
- `src/providers/brave.ts`
- `src/providers/brave-llm.ts`

### Files created

- `src/providers/http-providers.ts` -- array of `ProviderMeta` definitions for all 9 providers

### Files modified

- `src/providers/all.ts` -- imports from `http-providers.ts` instead of 9 individual files

### What stays unchanged

- `src/providers/http-adapter.ts` -- already supports `SearchFilters` in endpoint/buildBody callbacks; no changes needed
- `src/providers/parsers.ts` -- stays centralized, all parser functions remain
- Deep provider files: duckduckgo, exa, exa-mcp, openai-codex, ollama, context7, openai-web-search, tavily, firecrawl, jina, sofya, searxng, serper, parallel
- All deep provider tests

### Provider definition shape

Each entry in the array is a `ProviderMeta`:

```typescript
{
  name: "marginalia",
  tier: 3 as ProviderTier,
  monthlyQuota: null,
  requiresKey: false,
  create: () => ({
    search: createHttpSearchProvider("", {
      name: "marginalia",
      label: "Marginalia",
      endpoint: (q, n) =>
        `https://api2.marginalia-search.com/search?query=${encodeURIComponent(q)}&count=${n}`,
      method: "GET",
      extractResults: parseMarginaliaResults,
    }),
  }),
}
```

### Special cases

**brave.ts:** Has a `buildFreshness` helper that maps date filters to Brave's freshness parameter. This logic moves into the provider definition's `endpoint` or `buildBody` function as an inline helper.

**serper.ts:** Stays as its own file (48 lines). Has complex date filtering logic (`isoToMDY`, `buildTbs`) that is provider-specific enough to justify a separate module. Borderline shallow but the date conversion is non-trivial.

### Test changes

- 9 individual provider test files get consolidated. Tests verify that each definition in `http-providers.ts` produces a working SearchProvider with correct metadata (name, tier, quota).
- Parser functions remain tested in `tests/providers/parsers.test.ts`.
- Per-provider HTTP behavior (correct URL construction, header injection, response parsing) can be tested via the factory output's `search()` method with stubbed fetch.

### Verification

- `pnpm run typecheck` passes
- `pnpm run test` passes -- all existing provider tests pass (deep providers unchanged) and consolidated tests cover the 9 migrated providers
- `pnpm run lint` passes

---

## Phase 2: Extract Session Lifecycle from index.ts

### Problem

index.ts has 6 responsibilities in a single `createExtension()` function: dependency wiring, session lifecycle management (restore content, record trust, detect capabilities, apply guidance), OpenAI native rewriting, tool registration (7 tools), command registration, and strategy resolution. Testing any lifecycle logic requires mocking the full Pi ExtensionAPI.

### Solution

Extract session lifecycle logic into `src/session.ts`. index.ts becomes thin wiring -- its job is to connect deep modules, not to contain logic.

### Files created

- `src/session.ts` -- exports functions for each lifecycle concern. Each function accepts the Pi event + context plus its dependencies, so index.ts wires them as `pi.on("event", (event, ctx) => handleX(event, ctx, ...deps))`.
  - `restoreContent(entries, store)` -- filters stored content entries, calls `store.restore()`
  - `handleSessionStart(event: SessionStartEvent, ctx: ExtensionContext, store, refresh: () => void, registry)` -- orchestrates session_start: restore content, record trust, detect capabilities, apply guidance, refresh config. Takes a `refresh: () => void` callback rather than ConfigManager directly, so Phase 5 can swap the implementation without changing session.ts
  - `handleModelSelect(event: ModelSelectEvent, ctx: ExtensionContext, registry)` -- resolves selection strategy from model
  - `handleProviderRequest(event: BeforeProviderRequestEvent, ctx: ExtensionContext, rewrite): BeforeProviderRequestEventResult | void` -- OpenAI native web search rewriting. Returns the event result type expected by the Pi framework.
  - `handleSessionShutdown(event: SessionShutdownEvent, ctx: ExtensionContext, registry)` -- cleanup

### Files modified

- `src/index.ts` -- shrinks to ~80 lines of wiring. Creates dependencies, calls `pi.on('session_start', ...)` with handlers from session.ts, registers tools and commands. No business logic remains.

### What stays unchanged

- All tool files, provider files, config files, extraction files
- The Pi extension API contract -- same events, same tools registered

### Test changes

- New `tests/session.test.ts` -- tests lifecycle functions through their own interface. Can test `restoreContent()` with a mock store without needing to mock tool registration. Can test `handleProviderRequest()` with a mock request without the full Pi API.
- `tests/index.test.ts` -- simplifies. Tests verify that event handlers are registered and tools are registered. Lifecycle behavior is tested in session.test.ts.

### Design rationale

index.ts is intentionally shallow after this change. Entry points should be thin wiring. The depth moves to session.ts where it is testable through a focused interface.

### Verification

- `pnpm run typecheck` passes
- `pnpm run test` passes -- session.test.ts covers lifecycle, index.test.ts covers wiring
- `pnpm run lint` passes

---

## Phase 3: Extraction Pipeline Config Self-Resolution

### Problem

Config leaks across the seam between the tool layer and the extraction layer. `web-fetch.ts` receives 5 config options (`githubConfig`, `ssrfAllowRanges`, `pdfConfig`, `geminiConfig`, `guidance`) at factory creation time and passes them through to `extractContent()`. `web-fetch-multi.ts` duplicates this config threading. Every new extractor config option requires editing 3 files.

The extraction submodules (youtube.ts, gemini-api.ts, video.ts) already resolve config internally via direct import. The pipeline is in a mixed state.

### Solution

The extraction pipeline resolves its own config internally via `loadMergedConfig()`, matching the pattern its submodules already use. Tools pass only user-facing options.

### Files modified

**`src/extract/pipeline.ts`:**

`ExtractOptions` drops 4 config fields:

```typescript
// Before
interface ExtractOptions {
  raw?: boolean;
  github?: GitHubConfig;      // removed
  allowRanges?: string[];     // removed
  prompt?: string;
  timestamp?: string;
  frames?: number;
  model?: string;
  pdf?: PdfConfig;            // removed
  gemini?: GeminiConfig;      // removed
  ctx?: ExtensionContext;
}

// After
interface ExtractOptions {
  raw?: boolean;
  prompt?: string;
  timestamp?: string;
  frames?: number;
  model?: string;
  ctx?: ExtensionContext;     // stays -- runtime context, not config
}
```

Inside `extractContent()`, config is read once at the top:

```typescript
const config = loadMergedConfig();
const githubConfig = config.github ?? DEFAULT_GITHUB_CONFIG;
const allowRanges = config.ssrf?.allowRanges ?? [];
const pdfConfig = config.pdf;
const geminiConfig = config.gemini;
```

**`src/tools/web-fetch.ts`:**

`createWebFetchTool()` factory drops `githubConfig`, `ssrfAllowRanges`, `pdfConfig`, `geminiConfig` parameters. Tool calls `extractContent(url, signal, { raw, prompt, model })` without threading config.

**`src/tools/web-fetch-multi.ts`:**

`MultiUrlOptions` drops `github`, `allowRanges`, `pdf`, `gemini` fields. `executeMultiUrl()` calls `extractContent(url, signal, options)` with user-facing options only.

**`src/index.ts`:**

`createWebFetchTool()` call simplifies -- no longer passes `config.github`, `config.ssrf?.allowRanges`, etc.

### What stays unchanged

- All extraction submodules (youtube.ts, gemini-api.ts, etc.) -- they already resolve config internally
- `src/config.ts` -- no changes needed
- extractContent() behavior -- same extraction chain, same fallbacks

### Test changes

- `tests/extract/pipeline.test.ts` -- tests that currently pass config via `ExtractOptions` switch to mocking `loadMergedConfig` via `vi.mock("../config.ts")`. This matches the existing test pattern used by youtube.test.ts and gemini-api.test.ts.
- `tests/tools/web-fetch.test.ts` -- simplifies. Factory call drops 4 parameters.
- `tests/tools/web-fetch-multi.test.ts` -- same simplification.

### Risk

The pipeline currently receives config per-call, meaning different calls could theoretically get different config. After this change, config is read from `loadMergedConfig()` which has 30-second TTL caching. In practice this is the same behavior since config does not change mid-call.

### Verification

- `pnpm run typecheck` passes
- `pnpm run test` passes
- `pnpm run lint` passes

---

## Phase 4: Collapse web-fetch-multi into web-fetch

**Depends on:** Phase 3 (config threading is already gone)

### Problem

Single-URL fetches can fall back to FetchProvider on `RetryableExtractionError`; multi-URL fetches cannot. This asymmetry means multi-URL fetches fail silently where single-URL would succeed. The two modules also duplicate config threading (eliminated by Phase 3) and share the same dependencies (extraction pipeline, cache, storage).

### Solution

Absorb `web-fetch-multi.ts` (170 lines) into `web-fetch.ts`. One deep module handles both single and multi-URL paths with consistent provider fallback.

### Files deleted

- `src/tools/web-fetch-multi.ts`

### Files modified

**`src/tools/web-fetch.ts`:**

- `executeMultiUrl()` becomes a private function inside the module
- `UrlResult` and `MultiUrlOptions` types move in (simplified since config fields are gone from Phase 3)
- Multi-URL path gains the same `RetryableExtractionError` -> FetchProvider fallback that single-URL already has

The resulting module will be ~400 lines. This is appropriate depth for a module that handles single-URL fetch, multi-URL fetch, caching, storage, truncation, provider fallback, and result formatting -- all behind one `web_fetch` tool interface.

### Multi-URL fallback design

Per-URL fallback, matching single-URL behavior:

1. For each URL (within concurrency limit), try `extractContent(url)`
2. If `RetryableExtractionError` for that URL, try FetchProvider fallback for that specific URL
3. Collect results -- some URLs may succeed via extraction, others via provider fallback, others may fail
4. Format combined output as before

This is a behavioral improvement: multi-URL fetches become more resilient.

### What stays unchanged

- The `web_fetch` tool interface -- same parameters, same behavior for callers
- `src/utils/concurrency.ts` -- still used for `fetchWithConcurrencyLimit`
- All other tool files

### Test changes

- Tests from `tests/tools/web-fetch-multi.test.ts` move into `tests/tools/web-fetch.test.ts` as a describe block.
- New tests added for multi-URL provider fallback on `RetryableExtractionError`. Verify that if extraction fails for a URL in a multi-URL request, the FetchProvider fallback is attempted before returning an error.

### Verification

- `pnpm run typecheck` passes
- `pnpm run test` passes -- all existing web-fetch tests pass plus new fallback tests
- `pnpm run lint` passes

---

## Phase 5: Absorb ConfigManager into ProviderRegistry

**Depends on:** Phase 2 (both touch index.ts; Phase 2 should land first)

### Problem

ConfigManager (172 lines) tightly couples config change detection with provider registration. It calls `registry.registerSearch()`, `registry.registerFetch()`, `registry.unregisterAll()` directly. Callers must understand both ProviderRegistry and ProviderMeta to use ConfigManager. It exposes a test-only method (`expireTtlForTest`).

### Solution

ProviderRegistry absorbs config-driven provider lifecycle. ConfigManager disappears.

### Files deleted

- `src/config-manager.ts`

### Files modified

**`src/providers/registry.ts`:**

Gains:

- `loadFromConfig(config, providerMetas)` method that replaces the initial registration loop from ConfigManager's constructor
- `refresh(force?: boolean)` method with TTL-cached config reloading (absorbs ConfigManager's 30-second TTL logic)
- Internal change detection via `diffConfig()` -- on refresh, the registry diffs previous and current config, then registers/unregisters/re-registers providers as needed
- `ProviderMeta[]` array and config state become internal to the registry
- Provider alias resolution (`openai-native` -> `openai-codex`) moves in

Constructor changes:

```typescript
// Before
constructor(persistence: PersistenceAdapter)

// After
constructor(persistence: PersistenceAdapter, providerMetas: ProviderMeta[], cwd: string)
```

The registry reads config via `loadMergedConfig(cwd)` (direct import, matching Phase 3's established pattern). Initial provider registration happens in the constructor.

**`src/index.ts` (already thinned in Phase 2):**

- No more `ConfigManager` import or instantiation
- Creates `ProviderRegistry` with persistence, provider metas, and cwd
- Calls `registry.refresh()` where it previously called `configManager.refresh()`
- The `onReload` callback for the `/tools` command becomes `() => registry.refresh(true)`

**`src/commands/tools.ts`:** `onReload` callback type unchanged (still `() => void`)

### Where does diffConfig live?

`diffConfig` is currently in `config-manager.ts`. When config-manager.ts is deleted, `diffConfig` moves to `src/config.ts` alongside `loadMergedConfig` and `resolveApiKey` -- it's a pure function over `PiToolsConfig` and belongs with the config module. The `ConfigChangeSet` type it returns also moves to config.ts.

### What stays unchanged

- `src/providers/types.ts` -- `ProviderMeta` interface unchanged
- All provider files, tool files, extraction files

### Test changes

- Tests from `tests/config-manager.test.ts` move to `tests/providers/registry.test.ts`. Registry tests gain: TTL refresh behavior, config change detection triggering re-registration, provider alias resolution.
- `diffConfig` tests move to `tests/config.test.ts` alongside the function.
- The `expireTtlForTest()` leak disappears. Tests use `registry.refresh(force: true)` which bypasses TTL, or `vi.useFakeTimers()` to advance past the TTL window.

### Size impact

ProviderRegistry grows from ~373 to ~450-480 lines. This is acceptable -- it absorbs a real responsibility (config-driven lifecycle) that was previously scattered. The module gets deeper, not wider: same external interface with more behavior behind it.

### Verification

- `pnpm run typecheck` passes
- `pnpm run test` passes
- `pnpm run lint` passes
