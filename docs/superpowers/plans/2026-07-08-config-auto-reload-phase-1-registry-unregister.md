# Config Auto-Reload — Phase 1: Registry Unregister Methods

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add methods to `ProviderRegistry` that allow removing providers from the registry without destroying accumulated metrics. This is the foundation for hot-swapping providers during config reload.

**Architecture:** Add `unregisterSearch`, `unregisterFetch`, `unregisterCodeSearch`, `unregisterDocs`, and `unregisterAll` to the `ProviderRegistry` class. These delete from the provider maps (`searchProviders`, `fetchProviders`, `codeSearchProviders`, `docsProvider`) but never touch the `metrics` map, so performance data survives across unregister+re-register cycles.

**Tech Stack:** TypeScript, Vitest, existing pi-tools infrastructure.

**Spec:** `docs/superpowers/specs/2026-07-08-config-auto-reload-design.md`
**Main plan:** `docs/superpowers/plans/2026-07-08-config-auto-reload.md`

**Depends on:** Nothing (first phase)
**Produces:** Registry with hot-swap capability, ready for ConfigManager in Phase 2.

---

## Context for the Engineer

### ProviderRegistry internals

`src/providers/registry.ts` contains `ProviderRegistry`, which manages four provider maps:

```typescript
private searchProviders = new Map<string, RegisteredSearch>();  // line 48
private fetchProviders = new Map<string, RegisteredFetch>();    // line 49
private codeSearchProviders = new Map<string, RegisteredCodeSearch>(); // line 50
private docsProvider: DocsProvider | undefined;                 // line 51
private metrics = new Map<string, ProviderMetrics>();           // line 52
```

**Existing register methods:**

- `registerSearch(provider, options)` — line 108-117
- `registerFetch(provider)` — line 119-121
- `registerCodeSearch(provider)` — line 123-125
- `registerDocs(provider)` — line 246-248

All use `Map.set`, so re-registering with the same name overwrites the entry.

**Key invariant:** The `metrics` map is keyed by provider name (string). It must never be cleared by unregister operations. When a provider is removed and later re-added, its historical metrics should still be available for scoring.

### Test patterns

Tests live in `tests/providers/registry.test.ts` (599 lines). The file uses:

- `vi.fn()` for mock provider search/fetch functions
- A `mockProvider(name, label)` helper (line 5-13) that creates a `SearchProvider`
- A `mem()` helper (line 15) that creates a registry with an in-memory persistence adapter
- `describe/it/expect` from vitest, no `beforeEach`/`afterEach` in the main describe block

---

### Task 1.1: Add unregister methods and tests

**Files:**

- Modify: `src/providers/registry.ts:108-125` (after existing register methods)
- Modify: `tests/providers/registry.test.ts`

- [ ] **Step 1: Write failing tests for unregister methods**

Add a new describe block at the end of the top-level `describe("ProviderRegistry", ...)` block in `tests/providers/registry.test.ts`, before the closing `});` on line 580:

```typescript
describe("unregister methods", () => {
  it("unregisterSearch removes search provider from candidates", () => {
    const registry = mem();
    const brave = mockProvider("brave", "Brave");
    const ddg = mockProvider("duckduckgo", "DuckDuckGo");

    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
    registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

    registry.unregisterSearch("brave");

    const candidates = registry.selectSearchCandidates();
    expect(candidates.map((c) => c.name)).toEqual(["duckduckgo"]);
  });

  it("unregisterSearch is a no-op for unknown provider", () => {
    const registry = mem();
    const brave = mockProvider("brave", "Brave");
    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

    registry.unregisterSearch("nonexistent"); // should not throw

    expect(registry.selectSearchCandidates().map((c) => c.name)).toEqual([
      "brave",
    ]);
  });

  it("unregisterFetch removes fetch provider from candidates", () => {
    const registry = mem();
    const jina: FetchProvider = {
      name: "jina",
      fetch: vi.fn().mockResolvedValue({ text: "content", title: "Title" }),
    };
    const exa: FetchProvider = {
      name: "exa",
      fetch: vi.fn().mockResolvedValue({ text: "content", title: "Title" }),
    };

    registry.registerFetch(jina);
    registry.registerFetch(exa);
    registry.unregisterFetch("jina");

    expect(registry.selectFetchCandidates().map((c) => c.name)).toEqual([
      "exa",
    ]);
  });

  it("unregisterCodeSearch removes code search provider", () => {
    const registry = mem();
    const exa: CodeSearchProvider = {
      name: "exa",
      codeSearch: vi.fn().mockResolvedValue([]),
    };

    registry.registerCodeSearch(exa);
    registry.unregisterCodeSearch("exa");

    expect(registry.selectCodeSearch()).toBeUndefined();
  });

  it("unregisterDocs clears docs provider", () => {
    const registry = mem();
    const docsProvider: DocsProvider = {
      name: "context7",
      label: "Context7",
      searchLibrary: vi.fn(),
      getContext: vi.fn(),
    };

    registry.registerDocs(docsProvider);
    registry.unregisterDocs();

    expect(registry.selectDocs()).toBeUndefined();
  });

  it("unregisterAll removes provider from all capability maps", () => {
    const registry = mem();
    const brave = mockProvider("brave", "Brave");
    const braveFetch: FetchProvider = {
      name: "brave",
      fetch: vi.fn().mockResolvedValue({ text: "content", title: "Title" }),
    };

    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
    registry.registerFetch(braveFetch);

    registry.unregisterAll("brave");

    expect(registry.selectSearchCandidates().map((c) => c.name)).toEqual([]);
    expect(registry.selectFetchCandidates().map((c) => c.name)).toEqual([]);
  });

  it("metrics survive unregister + re-register cycle", () => {
    const registry = mem();
    const brave = mockProvider("brave", "Brave");
    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

    // Record some metrics
    registry.recordOutcome("brave", { success: true, latencyMs: 300 });
    registry.recordOutcome("brave", { success: true, latencyMs: 500 });

    // Unregister
    registry.unregisterSearch("brave");
    expect(registry.selectSearchCandidates().map((c) => c.name)).toEqual([]);

    // Metrics still accessible
    const metricsAfterUnregister = registry.getMetrics("brave");
    expect(metricsAfterUnregister).toBeDefined();
    expect(metricsAfterUnregister!.successes).toBe(2);
    expect(metricsAfterUnregister!.avgLatency).toBe(400);

    // Re-register
    const brave2 = mockProvider("brave", "Brave");
    registry.registerSearch(brave2, { tier: 1, monthlyQuota: 2000 });

    // Provider is back
    expect(registry.selectSearchCandidates().map((c) => c.name)).toEqual([
      "brave",
    ]);

    // Metrics survived the cycle
    const metricsAfterReregister = registry.getMetrics("brave");
    expect(metricsAfterReregister!.successes).toBe(2);
    expect(metricsAfterReregister!.avgLatency).toBe(400);
  });

  it("unregisterAll does not clear docs if name does not match", () => {
    const registry = mem();
    const docsProvider: DocsProvider = {
      name: "context7",
      label: "Context7",
      searchLibrary: vi.fn(),
      getContext: vi.fn(),
    };

    registry.registerDocs(docsProvider);
    registry.unregisterAll("brave"); // different name

    expect(registry.selectDocs()).toBe(docsProvider);
  });

  it("unregisterAll clears docs when name matches", () => {
    const registry = mem();
    const docsProvider: DocsProvider = {
      name: "context7",
      label: "Context7",
      searchLibrary: vi.fn(),
      getContext: vi.fn(),
    };

    registry.registerDocs(docsProvider);
    registry.unregisterAll("context7");

    expect(registry.selectDocs()).toBeUndefined();
  });
});
```

Note: `CodeSearchProvider` and `DocsProvider` must be imported. Check the existing imports at the top of the test file (line 3):

```typescript
import type {
  DocsProvider,
  FetchProvider,
  SearchProvider,
} from "../../src/providers/types.ts";
```

Add `CodeSearchProvider` to this import:

```typescript
import type {
  CodeSearchProvider,
  DocsProvider,
  FetchProvider,
  SearchProvider,
} from "../../src/providers/types.ts";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/providers/registry.test.ts`

Expected: Multiple failures — `registry.unregisterSearch is not a function` (and similar for the other unregister methods).

- [ ] **Step 3: Implement unregister methods**

Add the following methods to the `ProviderRegistry` class in `src/providers/registry.ts`. Insert them after the existing `registerCodeSearch` method (after line 125) and before `recordOutcome` (line 127):

```typescript
unregisterSearch(name: string): void {
  this.searchProviders.delete(name);
}

unregisterFetch(name: string): void {
  this.fetchProviders.delete(name);
}

unregisterCodeSearch(name: string): void {
  this.codeSearchProviders.delete(name);
}

unregisterDocs(): void {
  this.docsProvider = undefined;
}

unregisterAll(name: string): void {
  this.searchProviders.delete(name);
  this.fetchProviders.delete(name);
  this.codeSearchProviders.delete(name);
  if (this.docsProvider?.name === name) {
    this.docsProvider = undefined;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/providers/registry.test.ts`

Expected: All tests pass, including the new `unregister methods` describe block.

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `pnpm vitest run`

Expected: All tests pass.

- [ ] **Step 6: Run lint and typecheck**

Run: `pnpm biome check src/providers/registry.ts tests/providers/registry.test.ts && pnpm tsc --noEmit`

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/providers/registry.ts tests/providers/registry.test.ts
git commit -m "feat(registry): add unregister methods for provider hot-swapping

Add unregisterSearch, unregisterFetch, unregisterCodeSearch,
unregisterDocs, and unregisterAll to ProviderRegistry. Metrics
are preserved across unregister+re-register cycles.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```
