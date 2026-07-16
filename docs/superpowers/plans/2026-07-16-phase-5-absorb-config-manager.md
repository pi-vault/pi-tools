# Phase 5: Absorb ConfigManager into ProviderRegistry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate `ConfigManager` (172 lines) by absorbing its config-driven provider lifecycle into `ProviderRegistry`. After this phase, `src/config-manager.ts` no longer exists. The registry owns TTL-cached config refresh, change detection, and automatic provider registration/unregistration.

**Architecture:** `diffConfig`, `ConfigChangeSet`, and `isEnabled` move to `src/config.ts` (pure config functions). `PROVIDER_ALIASES`, `resolveProviderAlias`, `registerProvider`, `registerFromConfig`, `applyChanges`, `refresh`, and the `current` getter move into `ProviderRegistry`. The registry constructor gains `providerMetas` and `cwd` parameters. `src/index.ts` drops the `ConfigManager` import entirely.

**Tech Stack:** TypeScript (ES2022, Node16 modules), Vitest

**Spec:** `docs/superpowers/specs/2026-07-16-architecture-deepening-design.md` (Phase 5)
**Depends on:** Phase 2 (both touch index.ts; Phase 2 landed first so index.ts is already thinned)

---

## File Overview

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/config.ts` | Gains `diffConfig`, `ConfigChangeSet`, `isEnabled` (moved from config-manager.ts) |
| Modify | `src/providers/registry.ts` | Absorbs config lifecycle: constructor params, `current`, `refresh`, alias resolution, provider registration |
| Modify | `src/index.ts` | Drops `ConfigManager`; uses `registry.current` and `registry.refresh()` everywhere |
| Create | `tests/providers/registry-config.test.ts` | Config lifecycle tests moved from config-manager.test.ts |
| Modify | `tests/config.test.ts` | Gains `diffConfig` tests moved from config-manager.test.ts |
| Delete | `src/config-manager.ts` | Absorbed into registry.ts and config.ts |
| Delete | `tests/config-manager.test.ts` | Tests moved to registry-config.test.ts and config.test.ts |

---

## Task 1: Move `diffConfig` and helpers to `config.ts`

**Files:**
- Modify: `src/config.ts`
- Modify: `tests/config.test.ts`

- [ ] **Step 1: Add `ConfigChangeSet`, `isEnabled`, and `diffConfig` to `config.ts`**

At the bottom of `src/config.ts`, before the closing of the file, add the following exports:

```typescript
// --- Config change detection (moved from config-manager.ts) ---

export interface ConfigChangeSet {
  added: string[];
  removed: string[];
  keyChanged: string[];
}

export function isEnabled(entry: ProviderConfigEntry | undefined): boolean {
  return entry !== undefined && entry.enabled !== false;
}

/**
 * Compare two configs and return what changed.
 *
 * `resolveKey` is injected so callers can pass `resolveApiKey` (or a test stub).
 */
export function diffConfig(
  prev: PiToolsConfig,
  next: PiToolsConfig,
  resolveKey: (apiKey: string | undefined) => string | undefined,
): ConfigChangeSet {
  const added: string[] = [];
  const removed: string[] = [];
  const keyChanged: string[] = [];

  const allNames = new Set([...Object.keys(prev.providers), ...Object.keys(next.providers)]);

  for (const name of allNames) {
    const prevEntry = prev.providers[name];
    const nextEntry = next.providers[name];
    const wasPrevEnabled = isEnabled(prevEntry);
    const isNextEnabled = isEnabled(nextEntry);

    if (!wasPrevEnabled && isNextEnabled) {
      added.push(name);
    } else if (wasPrevEnabled && !isNextEnabled) {
      removed.push(name);
    } else if (wasPrevEnabled && isNextEnabled) {
      const prevResolved = resolveKey(prevEntry?.apiKey);
      const nextResolved = resolveKey(nextEntry?.apiKey);
      if (prevResolved !== nextResolved) {
        keyChanged.push(name);
      }
    }
  }

  return { added, removed, keyChanged };
}
```

- [ ] **Step 2: Move `diffConfig` tests from `tests/config-manager.test.ts` to `tests/config.test.ts`**

At the bottom of `tests/config.test.ts`, add the following test block. The import for `diffConfig` comes from `config.ts` now:

```typescript
import { diffConfig } from "../src/config.ts";
import type { PiToolsConfig } from "../src/config.ts";

function makeConfig(overrides: Partial<PiToolsConfig> = {}): PiToolsConfig {
  return {
    defaultProvider: "auto",
    selectionStrategy: "auto",
    providers: {
      brave: { enabled: true, monthlyQuota: 2000, apiKey: "BRAVE_API_KEY" },
      duckduckgo: { enabled: true },
      exa: { enabled: false, apiKey: "EXA_API_KEY" },
    },
    github: { enabled: true, maxRepoSizeMB: 350, cloneTimeoutSeconds: 30 },
    ssrf: { allowRanges: [] },
    combine: { enabled: false, mode: "targeted", targetBackends: 3, k: 60 },
    deepResearch: { enabled: true },
    ...overrides,
  };
}

describe("diffConfig", () => {
  it("detects no changes when configs are identical", () => {
    const config = makeConfig();
    const result = diffConfig(config, config, (key) => key);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.keyChanged).toEqual([]);
  });

  it("detects added provider (disabled -> enabled)", () => {
    const prev = makeConfig();
    const next = makeConfig({
      providers: {
        ...prev.providers,
        exa: { enabled: true, apiKey: "EXA_API_KEY" },
      },
    });
    const result = diffConfig(prev, next, (key) => key);
    expect(result.added).toEqual(["exa"]);
    expect(result.removed).toEqual([]);
  });

  it("detects removed provider (enabled -> disabled)", () => {
    const prev = makeConfig();
    const next = makeConfig({
      providers: {
        ...prev.providers,
        brave: { enabled: false, apiKey: "BRAVE_API_KEY" },
      },
    });
    const result = diffConfig(prev, next, (key) => key);
    expect(result.removed).toEqual(["brave"]);
    expect(result.added).toEqual([]);
  });

  it("detects key changed for enabled provider", () => {
    const prev = makeConfig();
    const next = makeConfig({
      providers: {
        ...prev.providers,
        brave: { enabled: true, monthlyQuota: 2000, apiKey: "NEW_KEY" },
      },
    });
    const resolveKey = (key: string | undefined) => {
      if (key === "BRAVE_API_KEY") return "old-resolved";
      if (key === "NEW_KEY") return "new-resolved";
      return key;
    };
    const result = diffConfig(prev, next, resolveKey);
    expect(result.keyChanged).toEqual(["brave"]);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it("does not report key change when resolved values are the same", () => {
    const prev = makeConfig();
    const next = makeConfig({
      providers: {
        ...prev.providers,
        brave: { enabled: true, monthlyQuota: 2000, apiKey: "DIFFERENT_VAR" },
      },
    });
    const resolveKey = () => "same-value";
    const result = diffConfig(prev, next, resolveKey);
    expect(result.keyChanged).toEqual([]);
  });

  it("does not flag disabled providers as key-changed", () => {
    const prev = makeConfig();
    const next = makeConfig({
      providers: {
        ...prev.providers,
        exa: { enabled: false, apiKey: "CHANGED_KEY" },
      },
    });
    const resolveKey = (key: string | undefined) => key;
    const result = diffConfig(prev, next, resolveKey);
    expect(result.keyChanged).toEqual([]);
  });

  it("handles provider appearing in next but not in prev", () => {
    const prev = makeConfig();
    const next = makeConfig({
      providers: {
        ...prev.providers,
        tavily: { enabled: true, apiKey: "TAVILY_API_KEY" },
      },
    });
    const result = diffConfig(prev, next, (key) => key);
    expect(result.added).toEqual(["tavily"]);
  });

  it("handles provider disappearing from next config", () => {
    const prev = makeConfig();
    const { brave, ...rest } = prev.providers;
    const next = makeConfig({ providers: rest });
    const result = diffConfig(prev, next, (key) => key);
    expect(result.removed).toEqual(["brave"]);
  });
});
```

Note: `PiToolsConfig` is already imported in `tests/config.test.ts`. If `makeConfig` conflicts with existing helpers, rename it to `makeDiffConfig` in the test block. Check the existing imports and merge the new `diffConfig` import into the existing `import { ... } from "../src/config.ts"` statement.

- [ ] **Step 3: Run diffConfig tests in config.test.ts**

```bash
pnpm vitest run tests/config.test.ts
```

Expected: all tests PASS, including the new `diffConfig` describe block.

- [ ] **Step 4: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "refactor: move diffConfig, ConfigChangeSet, isEnabled to config.ts

Pure functions over PiToolsConfig that belong in the config module.
Moves tests to tests/config.test.ts. Preparatory step for absorbing
ConfigManager into ProviderRegistry.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

## Task 2: Add config lifecycle to `ProviderRegistry`

**Files:**
- Modify: `src/providers/registry.ts`

- [ ] **Step 1: Add new imports to `registry.ts`**

Add the following imports at the top of `src/providers/registry.ts`:

```typescript
import type { PiToolsConfig, ProviderConfigEntry } from "../config.ts";
import {
  loadMergedConfig,
  resolveApiKey,
  clearCredentialCache,
  diffConfig,
  isEnabled,
} from "../config.ts";
import type { ProviderMeta } from "./types.ts";
```

These are added alongside the existing imports. The existing `import type { SelectionStrategy } from "../config.ts";` should be merged into the new type import:

```typescript
import type { PiToolsConfig, ProviderConfigEntry, SelectionStrategy } from "../config.ts";
```

- [ ] **Step 2: Add `PROVIDER_ALIASES` and `resolveProviderAlias` to `registry.ts`**

Add these above the `ProviderRegistry` class definition in `src/providers/registry.ts`:

```typescript
/** Provider name aliases for backward compatibility. */
const PROVIDER_ALIASES: Record<string, string> = {
  "openai-native": "openai-codex",
};

function resolveProviderAlias(name: string): string {
  const resolved = PROVIDER_ALIASES[name];
  if (resolved) {
    console.warn(`[pi-tools] Provider "${name}" is deprecated. Use "${resolved}" instead.`);
    return resolved;
  }
  return name;
}

const CONFIG_TTL_MS = 30_000;
```

- [ ] **Step 3: Expand the `ProviderRegistry` constructor and add config state fields**

Replace the existing constructor and add new private fields. The full change to the class:

Add three new private fields after the existing ones:

```typescript
  private _config: PiToolsConfig;
  private cacheTime: number;
  private readonly cwd: string;
  private readonly metaByName: Map<string, ProviderMeta>;
```

Replace the constructor:

```typescript
  constructor(persistence: PersistenceAdapter, providerMetas: ProviderMeta[], cwd: string) {
    this.persistence = persistence;
    this.currentMonth = getCurrentMonth();
    this.loadUsage();
    this.cwd = cwd;
    this.metaByName = new Map(providerMetas.map((m) => [m.name, m]));
    this._config = loadMergedConfig(cwd);
    this.cacheTime = Date.now();
    this.registerFromConfig(this._config);
  }
```

- [ ] **Step 4: Add `current` getter and `refresh` method**

Add these public methods to the `ProviderRegistry` class, after the constructor:

```typescript
  get current(): PiToolsConfig {
    return this._config;
  }

  refresh(force = false): void {
    const now = Date.now();
    if (!force && now - this.cacheTime < CONFIG_TTL_MS) return;

    clearCredentialCache();

    let nextConfig: PiToolsConfig;
    try {
      nextConfig = loadMergedConfig(this.cwd);
    } catch {
      // Malformed config -- keep previous, reset TTL to retry next cycle
      this.cacheTime = now;
      return;
    }

    const changeSet = diffConfig(this._config, nextConfig, resolveApiKey);
    this.applyChanges(changeSet, nextConfig);
    this._config = nextConfig;
    this.cacheTime = now;
  }
```

- [ ] **Step 5: Add private `applyChanges`, `registerProvider`, and `registerFromConfig` methods**

Add these private methods to the `ProviderRegistry` class, before the `expireMetricsWindow` method:

```typescript
  private applyChanges(changeSet: { added: string[]; removed: string[]; keyChanged: string[] }, nextConfig: PiToolsConfig): void {
    for (const name of changeSet.removed) {
      this.unregisterAll(name);
    }
    for (const name of changeSet.keyChanged) {
      this.unregisterAll(name);
      this.registerProvider(name, nextConfig);
    }
    for (const name of changeSet.added) {
      this.registerProvider(name, nextConfig);
    }
  }

  private registerProvider(name: string, config: PiToolsConfig): void {
    const resolved = resolveProviderAlias(name);
    const meta = this.metaByName.get(resolved);
    if (!meta) return;

    const providerConfig = config.providers[name];
    const resolvedKey = resolveApiKey(providerConfig?.apiKey);
    if (meta.requiresKey && !resolvedKey) return;

    // Inject global ssrf.allowRanges into the per-provider config passed to meta.create.
    // This avoids changing the ProviderMeta.create(key, providerConfig) signature which
    // would touch every provider module.
    const configWithSsrf = { ...providerConfig, ssrfAllowRanges: config.ssrf.allowRanges };

    let instances: ReturnType<typeof meta.create>;
    try {
      instances = meta.create(resolvedKey, configWithSsrf);
    } catch {
      // Provider instantiation failed -- skip, other providers unaffected
      return;
    }
    const quota = providerConfig?.monthlyQuota ?? meta.monthlyQuota;

    if (instances.search) {
      this.registerSearch(instances.search, { tier: meta.tier, monthlyQuota: quota });
    }
    if (instances.fetch) {
      this.registerFetch(instances.fetch);
    }
    if (instances.codeSearch) {
      this.registerCodeSearch(instances.codeSearch);
    }
    if (instances.docs) {
      this.registerDocs(instances.docs);
    }
  }

  private registerFromConfig(config: PiToolsConfig): void {
    for (const [name, entry] of Object.entries(config.providers)) {
      if (!isEnabled(entry)) continue;
      this.registerProvider(name, config);
    }
  }
```

- [ ] **Step 6: Verify registry.ts compiles**

```bash
pnpm run typecheck
```

Expected: no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/providers/registry.ts
git commit -m "feat: absorb config lifecycle into ProviderRegistry

ProviderRegistry now owns TTL-cached config refresh, change detection,
and automatic provider registration/unregistration. Constructor takes
providerMetas and cwd. Adds current getter, refresh(force?) method,
and private registerProvider/registerFromConfig/applyChanges methods.
Provider alias resolution (openai-native -> openai-codex) also moves in.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

## Task 3: Update `index.ts` to use `ProviderRegistry` directly

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Remove `ConfigManager` import**

In `src/index.ts`, remove the line:

```typescript
import { ConfigManager } from "./config-manager.ts";
```

- [ ] **Step 2: Update `ProviderRegistry` construction**

Replace:

```typescript
  const registry = new ProviderRegistry(createFilePersistence());
  const configManager = new ConfigManager(process.cwd(), registry, allProviders);
```

With:

```typescript
  const registry = new ProviderRegistry(createFilePersistence(), allProviders, process.cwd());
```

- [ ] **Step 3: Replace all `configManager.current` with `registry.current`**

In `src/index.ts`, replace every occurrence of `configManager.current` with `registry.current`. There are 19 occurrences:

```
configManager.current.providers["openai-web-search"]  ->  registry.current.providers["openai-web-search"]
configManager.current.defaultProvider                  ->  registry.current.defaultProvider
configManager.current.combine.enabled                  ->  registry.current.combine.enabled
configManager.current.selectionStrategy                ->  registry.current.selectionStrategy
configManager.current.guidance?.web_search             ->  registry.current.guidance?.web_search
configManager.current.combine                          ->  registry.current.combine
configManager.current.guidance?.web_fetch              ->  registry.current.guidance?.web_fetch
configManager.current.github                           ->  registry.current.github
configManager.current.ssrf.allowRanges                 ->  registry.current.ssrf.allowRanges
configManager.current.pdf                              ->  registry.current.pdf
configManager.current.gemini                           ->  registry.current.gemini
configManager.current.guidance?.web_read               ->  registry.current.guidance?.web_read
configManager.current.guidance?.code_search            ->  registry.current.guidance?.code_search
configManager.current.guidance?.web_docs_search        ->  registry.current.guidance?.web_docs_search
configManager.current.guidance?.web_docs_fetch         ->  registry.current.guidance?.web_docs_fetch
configManager.current.providers?.exa                   ->  registry.current.providers?.exa
configManager.current.deepResearch?.enabled            ->  registry.current.deepResearch?.enabled
configManager.current.deepResearch                     ->  registry.current.deepResearch
configManager.current.deepResearch?.guidance           ->  registry.current.deepResearch?.guidance
```

- [ ] **Step 4: Replace all `configManager.refresh` with `registry.refresh`**

In `src/index.ts`, replace every occurrence of `configManager.refresh` with `registry.refresh`. There are 4 occurrences:

```
configManager.refresh();       ->  registry.refresh();       (3 occurrences in closures)
configManager.refresh(true)    ->  registry.refresh(true)    (1 occurrence in /tools reload callback)
```

- [ ] **Step 5: Verify the final `index.ts` has no `configManager` references**

Search for remaining references:

```bash
grep -n "configManager\|ConfigManager\|config-manager" src/index.ts
```

Expected: zero matches.

- [ ] **Step 6: Typecheck**

```bash
pnpm run typecheck
```

Expected: no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts
git commit -m "refactor: replace ConfigManager with registry.current/registry.refresh in index.ts

All configManager.current references become registry.current.
All configManager.refresh() calls become registry.refresh().
ConfigManager import removed entirely.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

## Task 4: Move config lifecycle tests to `tests/providers/registry-config.test.ts`

**Files:**
- Create: `tests/providers/registry-config.test.ts`

The config lifecycle tests (TTL refresh, change detection, alias resolution, error resilience) move out of `tests/config-manager.test.ts` into a new file. They now construct `ProviderRegistry` directly instead of `ConfigManager`.

- [ ] **Step 1: Create `tests/providers/registry-config.test.ts`**

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PiToolsConfig } from "../../src/config.ts";
import { ProviderRegistry } from "../../src/providers/registry.ts";
import type { ProviderMeta } from "../../src/providers/types.ts";

vi.mock("../../src/config.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config.ts")>();
  return {
    ...actual,
    loadMergedConfig: vi.fn(),
    resolveApiKey: vi.fn((key: string | undefined) => key),
  };
});

import { loadMergedConfig, resolveApiKey } from "../../src/config.ts";

function makeConfig(overrides: Partial<PiToolsConfig> = {}): PiToolsConfig {
  return {
    defaultProvider: "auto",
    selectionStrategy: "auto",
    providers: {
      brave: { enabled: true, monthlyQuota: 2000, apiKey: "BRAVE_API_KEY" },
      duckduckgo: { enabled: true },
      exa: { enabled: false, apiKey: "EXA_API_KEY" },
    },
    github: { enabled: true, maxRepoSizeMB: 350, cloneTimeoutSeconds: 30 },
    ssrf: { allowRanges: [] },
    combine: { enabled: false, mode: "targeted", targetBackends: 3, k: 60 },
    deepResearch: { enabled: true },
    ...overrides,
  };
}

const mem = () => ({ load: () => ({}), save: () => {} });

function makeMeta(name: string, opts: Partial<ProviderMeta> = {}): ProviderMeta {
  return {
    name,
    tier: 1,
    monthlyQuota: null,
    requiresKey: false,
    create: (_key, _config) => ({
      search: { name, label: name, search: vi.fn().mockResolvedValue([]) },
    }),
    ...opts,
  };
}

describe("ProviderRegistry config lifecycle", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads config on construction and registers providers", () => {
    vi.mocked(loadMergedConfig).mockReturnValue(
      makeConfig({
        providers: {
          brave: { enabled: true, monthlyQuota: 2000 },
          duckduckgo: { enabled: true },
          exa: { enabled: false },
        },
      }),
    );
    vi.mocked(resolveApiKey).mockReturnValue(undefined);

    const metas = [makeMeta("brave"), makeMeta("duckduckgo"), makeMeta("exa")];
    const registry = new ProviderRegistry(mem(), metas, "/test/cwd");

    expect(registry.getSearchProviderNames().sort()).toEqual(["brave", "duckduckgo"]);
  });

  it("refresh is a no-op within TTL", () => {
    const config = makeConfig();
    vi.mocked(loadMergedConfig).mockReturnValue(config);
    vi.mocked(resolveApiKey).mockReturnValue(undefined);

    const registry = new ProviderRegistry(mem(), [makeMeta("brave"), makeMeta("duckduckgo")], "/test/cwd");

    expect(vi.mocked(loadMergedConfig)).toHaveBeenCalledTimes(1);

    registry.refresh();

    expect(vi.mocked(loadMergedConfig)).toHaveBeenCalledTimes(1);
  });

  it("refresh reloads config after TTL expires", () => {
    const config = makeConfig();
    vi.mocked(loadMergedConfig).mockReturnValue(config);
    vi.mocked(resolveApiKey).mockReturnValue(undefined);

    const registry = new ProviderRegistry(mem(), [makeMeta("brave"), makeMeta("duckduckgo")], "/test/cwd");

    vi.advanceTimersByTime(30_001);
    registry.refresh();

    expect(vi.mocked(loadMergedConfig)).toHaveBeenCalledTimes(2);
  });

  it("refresh(force=true) reloads regardless of TTL", () => {
    const config = makeConfig();
    vi.mocked(loadMergedConfig).mockReturnValue(config);
    vi.mocked(resolveApiKey).mockReturnValue(undefined);

    const registry = new ProviderRegistry(mem(), [makeMeta("brave"), makeMeta("duckduckgo")], "/test/cwd");

    registry.refresh(true);

    expect(vi.mocked(loadMergedConfig)).toHaveBeenCalledTimes(2);
  });

  it("adds newly enabled provider on refresh", () => {
    const initialConfig = makeConfig({
      providers: {
        brave: { enabled: true },
        exa: { enabled: false },
      },
    });
    const updatedConfig = makeConfig({
      providers: {
        brave: { enabled: true },
        exa: { enabled: true },
      },
    });

    vi.mocked(loadMergedConfig)
      .mockReturnValueOnce(initialConfig)
      .mockReturnValueOnce(updatedConfig);
    vi.mocked(resolveApiKey).mockReturnValue(undefined);

    const registry = new ProviderRegistry(mem(), [makeMeta("brave"), makeMeta("exa")], "/test/cwd");

    expect(registry.getSearchProviderNames()).toEqual(["brave"]);

    vi.advanceTimersByTime(30_001);
    registry.refresh();

    expect(registry.getSearchProviderNames().sort()).toEqual(["brave", "exa"]);
  });

  it("removes newly disabled provider on refresh", () => {
    const initialConfig = makeConfig({
      providers: {
        brave: { enabled: true },
        duckduckgo: { enabled: true },
      },
    });
    const updatedConfig = makeConfig({
      providers: {
        brave: { enabled: false },
        duckduckgo: { enabled: true },
      },
    });

    vi.mocked(loadMergedConfig)
      .mockReturnValueOnce(initialConfig)
      .mockReturnValueOnce(updatedConfig);
    vi.mocked(resolveApiKey).mockReturnValue(undefined);

    const registry = new ProviderRegistry(mem(), [makeMeta("brave"), makeMeta("duckduckgo")], "/test/cwd");

    expect(registry.getSearchProviderNames().sort()).toEqual(["brave", "duckduckgo"]);

    vi.advanceTimersByTime(30_001);
    registry.refresh();

    expect(registry.getSearchProviderNames()).toEqual(["duckduckgo"]);
  });

  it("re-registers provider when key changes", () => {
    const initialConfig = makeConfig({
      providers: {
        brave: { enabled: true, apiKey: "OLD_KEY" },
      },
    });
    const updatedConfig = makeConfig({
      providers: {
        brave: { enabled: true, apiKey: "NEW_KEY" },
      },
    });

    vi.mocked(loadMergedConfig)
      .mockReturnValueOnce(initialConfig)
      .mockReturnValueOnce(updatedConfig);
    vi.mocked(resolveApiKey).mockImplementation((key) => {
      if (key === "OLD_KEY") return "old-resolved";
      if (key === "NEW_KEY") return "new-resolved";
      return undefined;
    });

    const createFn = vi.fn().mockReturnValue({
      search: { name: "brave", label: "Brave", search: vi.fn() },
    });
    const registry = new ProviderRegistry(mem(), [makeMeta("brave", { create: createFn })], "/test/cwd");

    expect(createFn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_001);
    registry.refresh();

    expect(createFn).toHaveBeenCalledTimes(2);
    expect(createFn).toHaveBeenLastCalledWith("new-resolved", {
      ...updatedConfig.providers.brave,
      ssrfAllowRanges: updatedConfig.ssrf.allowRanges,
    });
  });

  it("preserves previous config when reload throws", () => {
    const validConfig = makeConfig({
      providers: {
        brave: { enabled: true },
      },
    });

    vi.mocked(loadMergedConfig)
      .mockReturnValueOnce(validConfig)
      .mockImplementationOnce(() => {
        throw new Error("JSON parse error");
      });
    vi.mocked(resolveApiKey).mockReturnValue(undefined);

    const registry = new ProviderRegistry(mem(), [makeMeta("brave")], "/test/cwd");

    vi.advanceTimersByTime(30_001);
    registry.refresh();

    expect(registry.current.providers.brave.enabled).toBe(true);
    expect(registry.getSearchProviderNames()).toEqual(["brave"]);
  });

  it("updates current config when selectionStrategy changes", () => {
    const initialConfig = makeConfig({ selectionStrategy: "auto" });
    const updatedConfig = makeConfig({ selectionStrategy: "best-performing" });

    vi.mocked(loadMergedConfig)
      .mockReturnValueOnce(initialConfig)
      .mockReturnValueOnce(updatedConfig);
    vi.mocked(resolveApiKey).mockReturnValue(undefined);

    const registry = new ProviderRegistry(mem(), [makeMeta("brave"), makeMeta("duckduckgo")], "/test/cwd");

    expect(registry.current.selectionStrategy).toBe("auto");

    vi.advanceTimersByTime(30_001);
    registry.refresh();

    expect(registry.current.selectionStrategy).toBe("best-performing");
  });

  it("skips provider requiring key when key resolves to undefined", () => {
    vi.mocked(loadMergedConfig).mockReturnValue(
      makeConfig({
        providers: {
          brave: { enabled: true, apiKey: "BRAVE_API_KEY" },
        },
      }),
    );
    vi.mocked(resolveApiKey).mockReturnValue(undefined);

    const registry = new ProviderRegistry(mem(), [makeMeta("brave", { requiresKey: true })], "/test/cwd");

    expect(registry.getSearchProviderNames()).toEqual([]);
  });

  it("skips provider when meta.create throws during hot-add", () => {
    const initialConfig = makeConfig({
      providers: {
        brave: { enabled: true },
        exa: { enabled: false },
      },
    });
    const updatedConfig = makeConfig({
      providers: {
        brave: { enabled: true },
        exa: { enabled: true },
      },
    });

    vi.mocked(loadMergedConfig)
      .mockReturnValueOnce(initialConfig)
      .mockReturnValueOnce(updatedConfig);
    vi.mocked(resolveApiKey).mockReturnValue(undefined);

    const throwingCreate = () => {
      throw new Error("provider init failed");
    };

    const registry = new ProviderRegistry(
      mem(),
      [makeMeta("brave"), makeMeta("exa", { create: throwingCreate })],
      "/test/cwd",
    );

    expect(registry.getSearchProviderNames()).toEqual(["brave"]);

    vi.advanceTimersByTime(30_001);
    registry.refresh();

    // exa's create throws -- brave still registered, no crash
    expect(registry.getSearchProviderNames()).toEqual(["brave"]);
  });

  it("resolves openai-native config alias to openai-codex provider", () => {
    vi.mocked(loadMergedConfig).mockReturnValue(
      makeConfig({
        providers: {
          "openai-native": { enabled: true, apiKey: "sk-test" },
        },
      }),
    );
    vi.mocked(resolveApiKey).mockReturnValue("sk-test");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const metas = [makeMeta("openai-codex", { requiresKey: true })];
    const registry = new ProviderRegistry(mem(), metas, "/test/cwd");

    // Provider registered under the resolved name
    expect(registry.getSearchProviderNames()).toContain("openai-codex");
    // Deprecation warning emitted
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("openai-native"),
    );
    warnSpy.mockRestore();
  });

  it("does not warn for non-aliased provider names", () => {
    vi.mocked(loadMergedConfig).mockReturnValue(
      makeConfig({
        providers: {
          "openai-codex": { enabled: true },
        },
      }),
    );
    vi.mocked(resolveApiKey).mockReturnValue(undefined);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const metas = [makeMeta("openai-codex")];
    const registry = new ProviderRegistry(mem(), metas, "/test/cwd");

    expect(registry.getSearchProviderNames()).toContain("openai-codex");
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run new registry config tests**

```bash
pnpm vitest run tests/providers/registry-config.test.ts
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/providers/registry-config.test.ts
git commit -m "test: add config lifecycle tests for ProviderRegistry

Tests for TTL refresh, config change detection, provider alias
resolution, error resilience, and key rotation. Moved from
config-manager.test.ts and updated to construct ProviderRegistry
directly.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

## Task 5: Update existing `registry.test.ts` for new constructor signature

**Files:**
- Modify: `tests/providers/registry.test.ts`

The existing registry tests construct `ProviderRegistry` with only a `PersistenceAdapter`. The new constructor requires `(PersistenceAdapter, ProviderMeta[], cwd)`. These tests don't need config lifecycle -- they test selection, metrics, and quota. We must update the constructor calls to pass empty metas and a dummy cwd, and mock `loadMergedConfig` so the constructor doesn't hit the filesystem.

- [ ] **Step 1: Add mock and update constructor helper**

At the top of `tests/providers/registry.test.ts`, add the config mock before other imports:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/config.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config.ts")>();
  return {
    ...actual,
    loadMergedConfig: vi.fn().mockReturnValue({
      defaultProvider: "auto",
      selectionStrategy: "auto",
      providers: {},
      github: { enabled: true, maxRepoSizeMB: 350, cloneTimeoutSeconds: 30 },
      ssrf: { allowRanges: [] },
      combine: { enabled: false, mode: "targeted", targetBackends: 3, k: 60 },
      deepResearch: { enabled: true },
    }),
    resolveApiKey: vi.fn((key: string | undefined) => key),
  };
});
```

Update the `mem` helper to use the new constructor signature:

```typescript
const mem = () => new ProviderRegistry({ load: () => ({}), save: () => {} }, [], "/test/cwd");
```

Update every other direct `new ProviderRegistry(...)` call in the file to pass the two extra arguments. There are several in the test file:

```typescript
// Pattern: new ProviderRegistry({ load: ..., save: ... })
// Becomes: new ProviderRegistry({ load: ..., save: ... }, [], "/test/cwd")
```

Specifically, update these occurrences:

```typescript
// In "recordOutcome" describe block:
const registry = new ProviderRegistry({ load: () => ({}), save: () => {} }, [], "/test/cwd");

// In "resets counts when loaded data is from a previous month":
const registry = new ProviderRegistry(adapter, [], "/test/cwd");

// In "persists usage across registry instances":
const registry = new ProviderRegistry(adapter, [], "/test/cwd");

// In quota warning tests:
const registry = new ProviderRegistry({ load: ..., save: ... }, [], "/test/cwd");
```

- [ ] **Step 2: Run existing registry tests**

```bash
pnpm vitest run tests/providers/registry.test.ts
```

Expected: all existing tests PASS with the updated constructor signature.

- [ ] **Step 3: Commit**

```bash
git add tests/providers/registry.test.ts
git commit -m "test: update registry.test.ts for new ProviderRegistry constructor

ProviderRegistry now requires (persistence, providerMetas, cwd).
Existing tests pass empty metas and mock loadMergedConfig since they
test selection, metrics, and quota independently of config lifecycle.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

## Task 6: Delete `config-manager.ts` and `config-manager.test.ts`

**Files:**
- Delete: `src/config-manager.ts`
- Delete: `tests/config-manager.test.ts`

- [ ] **Step 1: Verify no remaining imports of `config-manager.ts`**

```bash
grep -rn "config-manager" src/ tests/ --include="*.ts"
```

Expected: only hits in `src/config-manager.ts` and `tests/config-manager.test.ts` themselves (the files we're about to delete). No other file should import from `config-manager.ts`.

- [ ] **Step 2: Delete the files**

```bash
rm src/config-manager.ts tests/config-manager.test.ts
```

- [ ] **Step 3: Run the full test suite**

```bash
pnpm test
```

Expected: all tests PASS. No test references the deleted files.

- [ ] **Step 4: Run typecheck and lint**

```bash
pnpm run typecheck
pnpm run lint
```

Expected: no type errors, no lint errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: delete config-manager.ts -- absorbed into ProviderRegistry

ConfigManager (172 lines) fully absorbed:
- diffConfig, ConfigChangeSet, isEnabled -> config.ts
- PROVIDER_ALIASES, resolveProviderAlias, registerProvider,
  registerFromConfig, applyChanges, refresh, current -> registry.ts
- config-manager.test.ts tests split to registry-config.test.ts
  and config.test.ts

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

## Task 7: Final verification

- [ ] **Step 1: Run full test suite**

```bash
pnpm test
```

Expected: all tests PASS.

- [ ] **Step 2: Run typecheck**

```bash
pnpm run typecheck
```

Expected: no type errors.

- [ ] **Step 3: Run lint**

```bash
pnpm run lint
```

Expected: no lint errors.

- [ ] **Step 4: Verify line counts**

```bash
wc -l src/providers/registry.ts src/config.ts
```

Expected:
- `registry.ts`: ~460-490 lines (was 373, gained ~100 lines from ConfigManager lifecycle)
- `config.ts`: ~530-540 lines (was 479, gained ~55 lines from diffConfig/isEnabled/ConfigChangeSet)

- [ ] **Step 5: Verify `config-manager.ts` is fully gone**

```bash
ls src/config-manager.ts 2>&1 || echo "DELETED (expected)"
grep -rn "ConfigManager\|config-manager" src/ tests/ --include="*.ts" | grep -v "node_modules" || echo "No references (expected)"
```

Expected: file does not exist, no references remain.

- [ ] **Step 6: Commit final state (if any fixups were needed)**

```bash
git status
# If clean, no commit needed
# If fixups exist:
git add -A
git commit -m "fix: phase 5 post-verification fixups

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```
