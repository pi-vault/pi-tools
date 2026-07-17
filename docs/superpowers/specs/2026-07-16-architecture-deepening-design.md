# Architecture Deepening Spec: 5 Assessed Candidates

**Date:** 2026-07-16
**Status:** In progress -- Phases 1-3 and the Phase 5 lifecycle correction implemented; Phase 4 planned
**Delivery:** One branch and PR per implemented phase

---

## Overview

This document records five assessed architecture candidates. Phases 1-3 have landed, Phase 4 is the next approved change, and the proposed Phase 5 absorption was replaced by a session-lifecycle correction. Implemented phases preserve external interfaces. Phase 4 gives multi-URL fetches the provider fallback already used by single-URL fetches.

### Phase Summary

| Phase | Candidate                                  | Status      | Depends on | Outcome                                  |
| ----- | ------------------------------------------ | ----------- | ---------- | ---------------------------------------- |
| 1     | Consolidate shallow HTTP search providers  | Implemented | None       | Deleted 9 shallow provider files         |
| 2     | Extract session lifecycle from index.ts    | Implemented | None       | Lifecycle logic is tested independently  |
| 3     | Extraction config self-resolution          | Implemented | None       | `ExtractOptions` dropped 4 config fields |
| 4     | Collapse web-fetch-multi into web-fetch    | Planned     | Phase 3    | Unify per-URL provider fallback           |
| 5     | Initialize config from session context      | Implemented | Phase 2    | Keep `ConfigManager`; use trusted `ctx.cwd` |

### Vocabulary

These terms are used precisely throughout this document:

- **Module** -- anything with an interface and an implementation
- **Interface** -- everything a caller must know to use the module
- **Depth** -- leverage at the interface; deep = lots of behavior behind small interface
- **Shallow** -- interface nearly as complex as the implementation
- **Seam** -- where an interface lives; a place behavior can be altered without editing in place
- **Locality** -- change, bugs, knowledge concentrated in one place
- **Leverage** -- what callers get from depth; one interface, N call sites
- **Deletion test** -- if deleting a module makes complexity vanish, it was a pass-through

### Pi compatibility review

The design was checked against the clean local Pi checkout at commit `8479bd84`, whose `@earendil-works/pi-coding-agent` package is version `0.80.6`. That exactly matches this package's installed dependency.

Relevant contracts:

- `session_start` fires for startup, reload, new session, resume, and fork, after the replacement extension instance is bound.
- `session_shutdown` is the cleanup hook before quit, reload, or session replacement.
- `before_provider_request` handlers return the replacement payload directly; `undefined` preserves the current payload.
- `ToolDefinition.execute()` receives `ExtensionContext`, and runtime tool registration is supported.
- `ctx.cwd` and `ctx.isProjectTrusted()` are the authoritative project context. They are available in event/tool contexts, not in the extension factory.

---

## Phase 1: Consolidate Shallow HTTP Search Providers -- Implemented

### Problem

Before this phase, 9 provider modules were shallow -- their interface (file, export, import in all.ts, test file) was nearly as complex as their implementation (a few config properties passed to http-adapter). Each failed the deletion test because deleting it did not cause complexity to reappear across callers. All 9 already used `createHttpSearchProvider` from http-adapter.ts.

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

The landed change replaced 9 individual provider files with `src/providers/http-providers.ts`, which exports an array of `ProviderMeta` definitions. Each definition uses `createHttpSearchProvider` and references its centralized parser.

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

**brave.ts:** Its `buildFreshness` date-filter mapping moved into `http-providers.ts`.

**serper.ts:** Remained separate because its `isoToMDY` and `buildTbs` date conversion is non-trivial provider-specific behavior.

### Test changes

- 9 individual provider test files were consolidated into `tests/providers/http-providers.test.ts`.
- The consolidated tests cover metadata, request construction, headers, and response parsing through each factory output.
- Parser functions remain covered in `tests/providers/parsers.test.ts`.

### Verification

- `pnpm run typecheck` passes
- `pnpm run test` passes -- all existing provider tests pass (deep providers unchanged) and consolidated tests cover the 9 migrated providers
- `pnpm run lint` passes

---

## Phase 2: Extract Session Lifecycle from index.ts -- Implemented

### Problem

Before this phase, `index.ts` mixed dependency wiring with content restoration, trust recording, and OpenAI request rewriting. Testing those lifecycle paths required mocking the full Pi `ExtensionAPI`.

### Solution

The landed change extracted the non-trivial lifecycle behavior into `src/session.ts`. `index.ts` retains dependency wiring, tool/command registration, and two trivial event handlers.

### Files created

- `src/session.ts` exports two focused handlers:
  - `handleSessionStart(event, ctx, store, refresh)` restores valid `pi-tools-content` entries, records Pi's current trust state, and refreshes configuration.
  - `handleProviderRequest(event, ctx, configGetter)` records trust and returns a rewritten OpenAI provider payload only when native web search applies.
- Stored-content validation and restoration remain private implementation details.

### Files modified

- `src/index.ts` wires both handlers to Pi events. The one-line `model_select` trust update and `session_shutdown` monitor reset stay inline; extracting them would add indirection without isolating meaningful behavior.

### What stays unchanged

- All tool files, provider files, config files, extraction files
- The Pi extension API contract -- same events and tools remain registered

### Test changes

- `tests/session.test.ts` covers valid/corrupt content restoration, refresh invocation, OpenAI payload replacement, disabled native search, and non-OpenAI requests.
- `tests/index.test.ts` retains wiring coverage while lifecycle behavior is tested through `session.ts`.

### Design rationale

Pi reloads and rebinds extensions before emitting `session_start` for new, resumed, forked, and reloaded sessions. Restoring session-backed content there matches the framework lifecycle. Entry-point wiring stays shallow; only behavior with a useful test seam moved to `session.ts`.

### Verification

- `pnpm run typecheck` passes
- `pnpm run test` passes -- session.test.ts covers lifecycle, index.test.ts covers wiring
- `pnpm run lint` passes

---

## Phase 3: Extraction Pipeline Config Self-Resolution -- Implemented

### Problem

Before this phase, config leaked across the seam between the tool and extraction layers. `web-fetch.ts` received extraction config at factory creation and passed it through to `extractContent()`, while `web-fetch-multi.ts` duplicated the threading. Every new extractor option required editing three files.

The extraction submodules already resolved config internally, leaving the pipeline in a mixed state.

### Solution

The extraction pipeline now resolves its own config internally via `loadMergedConfig(process.cwd())`, matching the pattern its submodules already use. Tools pass only user-facing options plus Pi's runtime context.

### Files modified

**`src/extract/pipeline.ts`:**

`ExtractOptions` dropped 4 config fields:

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
const { github, ssrf, pdf, gemini } = loadMergedConfig(process.cwd());
```

**`src/tools/web-fetch.ts`:**

`createWebFetchTool()` dropped the `githubConfig`, `ssrfAllowRanges`, `pdfConfig`, and `geminiConfig` parameters. It calls `extractContent()` without threading config.

**`src/tools/web-fetch-multi.ts`:**

`MultiUrlOptions` dropped the `github`, `allowRanges`, `pdf`, and `gemini` fields. `executeMultiUrl()` calls `extractContent()` with user-facing options and `ExtensionContext` only.

**`src/index.ts`:**

The `createWebFetchTool()` call no longer passes extraction configuration.

### What stays unchanged

- All extraction submodules (youtube.ts, gemini-api.ts, etc.) -- they already resolve config internally
- `src/config.ts` -- no changes needed
- extractContent() behavior -- same extraction chain, same fallbacks

### Test changes

- `tests/extract/pipeline.test.ts` and `tests/extract/pipeline-ssrf.test.ts` mock `loadMergedConfig()` instead of passing config through `ExtractOptions`.
- Existing tool tests verify the simplified factory and extraction call sites through their public behavior.

### Risk

Pi identifies `ctx.cwd` as the authoritative session directory. The landed code uses `process.cwd()` while retaining `ctx` in `ExtractOptions`; a future correction should prefer `options?.ctx?.cwd ?? process.cwd()`. That compatibility correction is independent of Phase 4.

### Verification

- `pnpm run typecheck` passes
- `pnpm run test` passes
- `pnpm run lint` passes

---

## Phase 4: Collapse web-fetch-multi into web-fetch -- Planned

**Depends on:** Phase 3 (config threading is already gone)

The existing Phase 4 implementation plan predates the shared-helper design and must be rewritten from this section before implementation.

### Problem

Single-URL fetches can fall back to FetchProvider on `RetryableExtractionError`; multi-URL fetches cannot. This asymmetry means a multi-URL item reports an error where the same URL fetched alone could succeed. After Phase 3 removed config threading, the two modules share the same extraction, cache, storage, and provider dependencies, so the extra module boundary no longer buys isolation.

### Solution

Absorb `web-fetch-multi.ts` into `web-fetch.ts`. Inside `createWebFetchTool`, add one private `fetchUrl()` helper that owns cache lookup, extraction, retryable provider fallback, and cache writes. Both single- and multi-URL execution call this helper, so fallback behavior cannot drift between the two paths.

### Files deleted

- `src/tools/web-fetch-multi.ts`

### Files modified

**`src/tools/web-fetch.ts`:**

- `executeMultiUrl()` becomes a private function inside `createWebFetchTool` and captures the tool dependencies it already needs
- `UrlResult` and the moved helpers remain private; `MultiUrlOptions` is removed because the factory closure supplies its dependencies
- `fetchUrl()` becomes the single path for cache lookup, `extractContent()`, `RetryableExtractionError` -> FetchProvider fallback, and cache writes
- Single-URL execution formats the returned content as before; multi-URL execution keeps its existing concurrency, deduplication, ordering, preview, storage, image, and partial-failure behavior
- Errors are sanitized consistently before being returned, including pipeline and provider context when both fail; exact error wording is not part of the compatibility contract

The resulting module handles single-URL fetch, multi-URL fetch, caching, storage, truncation, provider fallback, and result formatting behind one `web_fetch` tool interface.

### Multi-URL fallback design

Per-URL fallback, matching single-URL behavior:

1. For each unique URL (within the existing concurrency limit), call `fetchUrl(url)`
2. Return a cached value unless `fresh` is set
3. Otherwise try `extractContent(url)`
4. On `RetryableExtractionError`, try the registered FetchProviders for that URL
5. Cache successful extraction and provider results
6. Collect results in input order -- some URLs may succeed via extraction, others via provider fallback, and others may fail
7. Format combined output as before

This is a behavioral improvement: multi-URL fetches become more resilient.

### What stays unchanged

- The `web_fetch` parameters and result shape
- `src/utils/concurrency.ts` -- still used for `fetchWithConcurrencyLimit`
- All other tool files

### Test changes

- Keep the existing multi-URL coverage in `tests/tools/web-fetch.test.ts`.
- Add one mixed-result regression test covering normal extraction, provider recovery after a retryable error, and failure after provider fallback.
- Add one regression test proving that non-retryable extraction errors do not call FetchProviders.
- Existing single-URL fallback tests continue to cover provider ordering and no-provider behavior because both execution modes now share `fetchUrl()`.

### Verification

- `pnpm run typecheck` passes
- `pnpm run test` passes -- all existing web-fetch tests pass plus new fallback tests
- `pnpm run lint` passes

---

## Phase 5: Initialize Config from Session Context -- Implemented

### Original proposal

Delete `ConfigManager` and move TTL refresh, config diffing, provider construction, aliases, and filesystem config loading into `ProviderRegistry`.

### Decision

Keep `ConfigManager` as the config-driven provider lifecycle coordinator. The rejected absorption plan was replaced by `docs/superpowers/plans/2026-07-16-phase-5-config-lifecycle.md`.

### Rationale

- `ConfigManager` passes the deletion test: removing it does not remove its complexity, it moves that complexity into `ProviderRegistry`.
- `ProviderRegistry` currently owns provider registration, selection, metrics, quotas, and persistence without depending on filesystem config or Pi lifecycle state. Absorbing the manager would widen that responsibility.
- Pi defines `ctx.cwd` and `ctx.isProjectTrusted()` as authoritative runtime state, available in event and tool contexts rather than the extension factory. A registry constructor that loads config from `process.cwd()` would hide the wrong dependency.
- A test-only TTL helper is not sufficient reason to merge modules; it can be replaced with fake timers independently if maintenance cost justifies it.

### Pi lifecycle follow-up

The extension now records trust during `session_start`, constructs `ConfigManager` with the authoritative `ctx.cwd`, and registers config-dependent tools from that initialized state. This keeps the correction at the Pi lifecycle boundary instead of smuggling config loading into `ProviderRegistry`.
