# Architecture Deepening Plan

**Date:** 2026-07-02
**Status:** Draft
**Scope:** 6 phases — config rename, pipeline config injection, provider registration collapse, unified fallback, registry consolidation, HTTP adapter extraction.

## Context

The feature roadmap (2026-06-30) is complete. The codebase now has 13 providers, a 4-tier extraction pipeline, session metrics, and project-level config. With that surface area in place, architectural friction has emerged:

- `index.ts` imports all 13 provider implementations and maintains a 73-line factory map
- Provider fallback logic is duplicated between `web-search.ts` and `web-fetch.ts`
- `ProviderRegistry` wraps `UsageTracker` with thin pass-throughs while also maintaining its own metrics map
- `extractContent` calls `loadConfig()` internally, coupling a deep module to the filesystem
- 11 HTTP-based providers repeat identical scaffolding (headers, error handling, response mapping)

A ponytail audit confirmed the structural issues and identified ~60 lines of incidental shrink opportunities (dead fields, unused interfaces, inline-able type guards) to fold into the relevant phases.

### Guiding principle

Each phase produces an independently shippable result. Phases are ordered simplest-first so early wins reduce risk for later structural changes.

---

## Phase 1: Rename config file

### Problem

The config file is named `pi-tools.json` which is unnecessarily verbose. The extension name is already `@pi-vault/pi-tools` — the context is clear from the directory it lives in (`~/.pi/agent/extensions/`).

### Changes

Rename `pi-tools.json` to `tools.json` everywhere:

- `src/config.ts` — update `CONFIG_FILENAME` constant and `findProjectConfigPath()`
- `src/commands/tools.ts` — update path references in interactive setup
- `tests/config.test.ts` — update fixture references
- `README.md` — update documentation

Add a one-time migration: if `tools.json` doesn't exist but `pi-tools.json` does, read from the old name and log a deprecation notice. This allows existing users to migrate without breaking.

### Files touched

- `src/config.ts`
- `src/commands/tools.ts`
- `tests/config.test.ts`
- `README.md`

### Verification

- `pnpm check` passes
- Config loading still works with old name (backward compat)
- Config loading works with new name

---

## Phase 2: Inject config into extraction pipeline

### Problem

`extractContent()` calls `loadConfig()` on every invocation to check `github.enabled`. This:

- Couples a deep module to the filesystem
- Makes the pipeline untestable without a config file present
- Re-reads config on every call (minor but unnecessary)

Additionally, the GitHub config defaults (`maxRepoSizeMB: 350`, `cloneTimeoutSeconds: 30`) are duplicated — defined in both `config.ts` and `github.ts`.

### Changes

1. Add `github?: GitHubConfig` to `ExtractOptions`:

```ts
export interface ExtractOptions {
  raw?: boolean;
  github?: GitHubConfig; // new: injected from caller
}
```

2. Remove the `loadConfig()` call inside `extractContent()`. Instead, the caller (`web-fetch` via `index.ts`) passes the already-loaded config.

3. Remove the duplicate defaults from `github.ts`. The single source of truth is `config.ts`.

### Audit shrink (folded in)

- Remove `maxRepoSizeMB` and `cloneTimeoutSeconds` default constants from `github.ts` (they come from config now)

### Files touched

- `src/extract/pipeline.ts` — remove `loadConfig()` import, accept config via options
- `src/extract/github.ts` — remove duplicate default constants
- `src/tools/web-fetch.ts` — pass github config through
- `src/index.ts` — thread github config to web-fetch tool creation
- `tests/extract/pipeline.test.ts` — pass config in tests (no filesystem dependency)

### Verification

- `pnpm check` passes
- Pipeline tests work without a config file on disk
- GitHub extraction still respects config values

---

## Phase 3: Collapse provider registration into providers

### Problem

`index.ts` is a god module: it imports all 13 concrete provider implementations and maintains a 73-line `providerFactories` map encoding each provider's tier, quota, key requirement, and instantiation logic. Adding a provider requires editing the entry point.

### Changes

1. Each provider file exports a `providerMeta` object alongside its class:

```ts
// src/providers/brave.ts
export const providerMeta = {
  name: "brave",
  tier: 1 as const,
  monthlyQuota: 2000,
  requiresKey: true,
  create: (key?: string, _config?: ProviderConfigEntry) => ({
    search: new BraveProvider(key!),
  }),
};

// src/providers/searxng.ts — uses providerConfig for instanceUrl
export const providerMeta = {
  name: "searxng",
  tier: 2 as const,
  monthlyQuota: null,
  requiresKey: false,
  create: (_key?: string, config?: ProviderConfigEntry) => ({
    search: new SearXNGProvider({
      instanceUrl: config?.instanceUrl,
      apiKey: config?.apiKey ? resolveApiKey(config.apiKey) : undefined,
    }),
  }),
};
```

The `create` signature is `(key?: string, providerConfig?: ProviderConfigEntry) => ProviderInstances`. Most providers ignore `providerConfig`; SearXNG uses it for `instanceUrl`.

2. A new `src/providers/all.ts` barrel file imports and re-exports all provider metas as an array:

```ts
export const allProviders = [braveMeta, duckduckgoMeta, exaMeta /* ... */];
```

3. `index.ts` imports only `allProviders` from the barrel. The 73-line `providerFactories` map and the `ProviderFactory` interface are deleted. The registration loop iterates `allProviders` instead.

Why a barrel rather than dynamic scanning: the codebase is statically typed TypeScript with no build step beyond `tsc`. Dynamic `fs.readdirSync` + `import()` would lose type safety and complicate bundling. A barrel is the idiomatic TypeScript approach.

### Audit shrink (folded in)

- Inline `isStoredContent` type guard at its single call site
- Inline `ProviderError` interface into `AggregateProviderError` constructor

### Files touched

- `src/providers/*.ts` (13 files) — add `providerMeta` export
- `src/providers/all.ts` — new barrel
- `src/index.ts` — replace factory map with barrel import
- `src/utils/errors.ts` — inline `ProviderError`

### Verification

- `pnpm check` passes
- All provider tests still pass
- `index.ts` drops from ~219 lines to ~100 lines

---

## Phase 4: Unified provider fallback

### Problem

Provider fallback (try candidates in order, collect errors, throw `AggregateProviderError`) is implemented twice:

- `web-search.ts` lines 119-152
- `web-fetch.ts` lines 112-157

Same pattern, slightly different shapes. Bugs fixed in one don't propagate. No single place to test fallback behavior.

### Changes

1. New module `src/providers/execute.ts`:

```ts
interface ExecuteOptions<T> {
  candidates: Array<{ name: string; execute: () => Promise<T> }>;
  operation: string; // "search" | "fetch" — for error messages
  onSuccess?: (providerName: string, latencyMs: number) => void;
  onFailure?: (providerName: string) => void;
}

async function executeWithFallback<T>(options: ExecuteOptions<T>): Promise<{
  result: T;
  providerName: string;
}>;
```

2. `web-search.ts` and `web-fetch.ts` delegate their fallback loops to `executeWithFallback`.

3. The fallback module owns: iteration, timing, success/failure callbacks, error collection, and `AggregateProviderError` construction.

### Audit shrink (folded in)

- Simplify `buildFilters` in web-search.ts (20 lines → ~8 lines inline)
- Simplify `truncateContent` return type — return just the string, compute metadata at call site

### Files touched

- `src/providers/execute.ts` — new
- `src/tools/web-search.ts` — delegate fallback
- `src/tools/web-fetch.ts` — delegate fallback
- `src/utils/truncate.ts` — simplify return type
- `tests/providers/execute.test.ts` — new: focused fallback tests
- Update tool tests that mock fallback behavior

### Verification

- `pnpm check` passes
- Fallback behavior tested through one interface
- Tool tests still pass (behavior unchanged)

---

## Phase 5: Absorb UsageTracker into ProviderRegistry

### Problem

`ProviderRegistry` wraps `UsageTracker` with thin pass-throughs (`recordUsage` → `tracker.increment`, `getRemaining` → `tracker.getRemaining`). Meanwhile Registry maintains its own `metrics` map for performance scoring. Two modules track provider state; callers must reason about both.

### Changes

1. Move quota counting (monthly counts, reset logic) from `UsageTracker` into `ProviderRegistry`.

2. Move filesystem persistence into an internal seam:

```ts
// Internal to ProviderRegistry — not part of the public interface
interface PersistenceAdapter {
  load(): Record<string, { count: number; month: string }>;
  save(data: Record<string, { count: number; month: string }>): void;
}
```

Production adapter: reads/writes `~/.pi/agent/extensions/usage.json` (same location as before).
Test adapter: in-memory, no filesystem.

3. Unified method replaces three:

```ts
// Before: recordUsage(name) + recordSuccess(name, latency) or recordFailure(name)
// After:
recordOutcome(providerName: string, result: { success: boolean; latencyMs?: number }): void
```

4. Delete `src/providers/usage.ts`.

### Files touched

- `src/providers/registry.ts` — absorb usage counting + persistence
- `src/providers/usage.ts` — delete
- `src/index.ts` — remove `UsageTracker` import and instantiation
- `tests/providers/registry.test.ts` — update, test with in-memory adapter
- `tests/providers/usage.test.ts` — delete (coverage moves to registry tests)

### Verification

- `pnpm check` passes
- Monthly quota enforcement still works
- Persistence file format unchanged (no user-visible migration)
- Performance scoring still works

---

## Phase 6: HTTP adapter scaffolding (conditional)

### Problem

11 HTTP-based providers repeat identical scaffolding:

- `private headers()` returning `{ "Content-Type": "application/json", [authHeader]: key }`
- `if (!response.ok) throw new Error(\`${name} API error: ${response.status}\`)`
- `.slice(0, maxResults).map(r => ({ title, url, snippet: r[fieldName] }))`

### Changes

Extract a base helper that handles the HTTP mechanics:

```ts
interface HttpSearchConfig {
  name: string;
  endpoint: string | ((query: string, maxResults: number) => string);
  method: "GET" | "POST";
  authHeader: string;
  buildBody?: (
    query: string,
    maxResults: number,
    filters?: SearchFilters,
  ) => unknown;
  buildParams?: (
    query: string,
    maxResults: number,
    filters?: SearchFilters,
  ) => URLSearchParams;
  extractResults: (
    data: unknown,
  ) => Array<{ title: string; url: string; snippet: string }>;
}

function createHttpSearchProvider(
  apiKey: string,
  config: HttpSearchConfig,
): SearchProvider;
```

Each provider becomes a config object + the `createHttpSearchProvider` call. Outliers (DuckDuckGo CLI, ExaMCP JSON-RPC) keep their custom implementations.

### Condition

This phase is speculative. Proceed only if:

- The per-provider savings exceed 15 lines each (currently ~5-10 lines of true duplication)
- The adapter interface doesn't grow wider than a single provider implementation

If Phase 3 (provider metadata export) makes the providers feel clean enough, skip this phase.

### Files touched

- `src/providers/http-adapter.ts` — new
- `src/providers/brave.ts`, `serper.ts`, `tavily.ts`, `exa.ts`, `firecrawl.ts`, `jina.ts`, `openai-native.ts`, `parallel.ts`, `perplexity.ts`, `searxng.ts`, `websearchapi.ts` — rewrite to use adapter
- `src/providers/duckduckgo.ts`, `exa-mcp.ts` — unchanged (not HTTP-based)

### Verification

- `pnpm check` passes
- All provider tests pass unchanged (behavior preserved)
- Net line reduction ≥ 100 lines (otherwise not worth the abstraction)

---

## Phase dependencies

```
Phase 1 (config rename) ─────────────────────────────────────────────→ shippable
Phase 2 (pipeline config) ───────────────────────────────────────────→ shippable
Phase 3 (provider registration) ─────────────────────────────────────→ shippable
Phase 4 (unified fallback) ──────── depends on Phase 3 structure ───→ shippable
Phase 5 (registry consolidation) ── depends on Phase 3 structure ───→ shippable
Phase 6 (HTTP adapter) ─────────── depends on Phase 3 meta exports ─→ conditional
```

Phases 1-3 are fully independent. Phases 4 and 5 are independent of each other but assume Phase 3's provider structure. Phase 6 is conditional and depends on Phase 3.

---

## Success criteria

- `pnpm check` passes after every phase
- `index.ts` shrinks from 219 lines to ~80 lines (Phase 3)
- Provider fallback is tested through one interface (Phase 4)
- Adding a new provider requires editing exactly 2 files: the provider file + the barrel (Phase 3)
- `extractContent` is testable without filesystem config (Phase 2)
- Net line count reduction ≥ 80 lines across all phases (excluding Phase 6)
