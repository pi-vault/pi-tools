# Context7 Docs Lookup — Phase 2: Registry Extension & Config

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the provider registry to support `DocsProvider`, add Context7 to the config defaults, and wire it into the provider barrel so the registration loop can pick it up.

**Architecture:** `ProviderRegistry` gains `registerDocs()`/`selectDocs()` methods (simple single-provider store, no tier logic needed). The context7 provider is added to `src/providers/all.ts` barrel and `DEFAULT_CONFIG`. The registration loop in `src/index.ts` gains a `docs` check alongside the existing `search`/`fetch`/`codeSearch` checks.

**Tech Stack:** TypeScript, Vitest, existing registry infrastructure.

**Spec:** `docs/superpowers/specs/2026-07-07-context7-docs-lookup-design.md`
**Main plan:** `docs/superpowers/plans/2026-07-07-context7-docs-lookup.md`

**Depends on:** Phase 1 (DocsProvider interface + context7.ts must exist)
**Produces:** Context7 recognized in provider system, ready for tool registration.

---

## Context for the Engineer

After Phase 1, these exist:

- `src/providers/types.ts` — has `DocsProvider`, `DocsSearchResult` interfaces and `ProviderMeta.create()` returns `{ ..., docs?: DocsProvider }`
- `src/providers/context7.ts` — exports `Context7DocsProvider` class and `providerMeta`

The registry (`src/providers/registry.ts`) currently stores:

- `searchProviders` (Map), `fetchProviders` (Map), `codeSearchProviders` (Map)
- Has `registerSearch()`, `registerFetch()`, `registerCodeSearch()`, `selectSearch()`, `selectFetchCandidates()`, `selectCodeSearch()`

The config (`src/config.ts`) defines `DEFAULT_CONFIG.providers` with entries like `brave: { enabled: true, ... }`.

The barrel (`src/providers/all.ts`) imports all provider metas and exports them as `allProviders[]`.

The main entry (`src/index.ts`) loops over `allProviders`, calls `meta.create(key)`, and registers instances via `registry.registerSearch/registerFetch/registerCodeSearch`.

---

### Task 2.1: Add registerDocs/selectDocs to ProviderRegistry

**Files:**

- Modify: `src/providers/registry.ts`
- Modify: `tests/providers/registry.test.ts` (append new describe block)

- [ ] **Step 1: Write failing test for registerDocs/selectDocs**

Append this describe block to `tests/providers/registry.test.ts`:

```typescript
describe("docs provider registration", () => {
  it("selectDocs returns undefined when no docs provider registered", () => {
    const registry = new ProviderRegistry(mockPersistence());
    expect(registry.selectDocs()).toBeUndefined();
  });

  it("registerDocs and selectDocs round-trip", () => {
    const registry = new ProviderRegistry(mockPersistence());
    const docsProvider = {
      name: "context7",
      label: "Context7",
      searchLibrary: vi.fn(),
      getContext: vi.fn(),
    };
    registry.registerDocs(docsProvider);
    expect(registry.selectDocs()).toBe(docsProvider);
  });
});
```

Note: `mockPersistence()` should already exist in this test file (it's used by the search provider tests). If it doesn't exist, add at the top of the file:

```typescript
function mockPersistence(): PersistenceAdapter {
  return { load: () => ({}), save: () => {} };
}
```

Also ensure `vi` is imported and `DocsProvider` type is available (add to existing imports if needed):

```typescript
import type { DocsProvider } from "../../src/providers/types.ts";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/providers/registry.test.ts -t "docs provider"`
Expected: FAIL with "registry.selectDocs is not a function" or "Property 'registerDocs' does not exist"

- [ ] **Step 3: Implement registerDocs and selectDocs**

In `src/providers/registry.ts`:

**a)** Update the import on line 4 to include `DocsProvider`:

```typescript
import type {
  SearchProvider,
  FetchProvider,
  CodeSearchProvider,
  DocsProvider,
  ProviderTier,
} from "./types.ts";
```

**b)** Add a private field inside the `ProviderRegistry` class (after line 44, after `private codeSearchProviders = ...`):

```typescript
  private docsProvider: DocsProvider | undefined;
```

**c)** Add two methods after `selectCodeSearch()` (after line 209):

```typescript
  registerDocs(provider: DocsProvider): void {
    this.docsProvider = provider;
  }

  selectDocs(): DocsProvider | undefined {
    return this.docsProvider;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/providers/registry.test.ts -t "docs provider"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/providers/registry.ts tests/providers/registry.test.ts
git commit -m "feat(registry): add registerDocs/selectDocs for DocsProvider"
```

---

### Task 2.2: Add context7 to config defaults and provider barrel

**Files:**

- Modify: `src/config.ts`
- Modify: `src/providers/all.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Add context7 to DEFAULT_CONFIG in config.ts**

In `src/config.ts`, find the `providers` object inside `DEFAULT_CONFIG` (around line 48-63). Add after the `websearchapi` entry (line 62):

```typescript
    context7: { enabled: true, apiKey: "CONTEXT7_API_KEY" },
```

The providers block should now end with:

```typescript
    websearchapi: { enabled: false, apiKey: "WEBSEARCHAPI_API_KEY" },
    context7: { enabled: true, apiKey: "CONTEXT7_API_KEY" },
  },
```

- [ ] **Step 2: Add context7 to providers barrel**

In `src/providers/all.ts`, add the import (alphabetical placement, after `brave` import):

```typescript
import { providerMeta as context7 } from "./context7.ts";
```

Update the `allProviders` array to include `context7` (alphabetically after `brave`):

```typescript
export const allProviders: ProviderMeta[] = [
  brave,
  context7,
  duckduckgo,
  exa,
  exaMcp,
  firecrawl,
  jina,
  openaiNative,
  parallel,
  perplexity,
  searxng,
  serper,
  tavily,
  websearchapi,
];
```

- [ ] **Step 3: Add docs registration to the loop in index.ts**

In `src/index.ts`, find the registration loop (around lines 36-55). After the `codeSearch` check block:

```typescript
if (instances.codeSearch) {
  registry.registerCodeSearch(instances.codeSearch);
}
```

Add:

```typescript
if (instances.docs) {
  registry.registerDocs(instances.docs);
}
```

- [ ] **Step 4: Run typecheck and tests**

Run: `pnpm check`
Expected: PASS (context7 will be skipped in tests because CONTEXT7_API_KEY is not set — `meta.requiresKey && !resolvedKey` causes it to be skipped in the loop)

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/providers/all.ts src/index.ts
git commit -m "feat(config): add context7 provider to defaults and barrel"
```
