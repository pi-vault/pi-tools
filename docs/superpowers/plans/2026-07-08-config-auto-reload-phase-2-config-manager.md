# Config Auto-Reload — Phase 2: ConfigManager with TTL + Diff

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a `ConfigManager` class that wraps `loadMergedConfig` with a 30-second TTL cache, diffs previous vs new config, and hot-swaps providers in the registry.

**Architecture:** `ConfigManager` holds the current `PiToolsConfig`, a timestamp, and references to the `ProviderRegistry` and `ProviderMeta[]` array. On `refresh()`, if the TTL has expired, it re-reads config, computes a `ConfigChangeSet` (added/removed/keyChanged providers, configChanged flag), and calls the registry's unregister/register methods to apply changes. Malformed JSON on reload preserves the previous config.

**Tech Stack:** TypeScript, Vitest, existing pi-tools infrastructure (`loadMergedConfig`, `resolveApiKey`, `ProviderRegistry`, `ProviderMeta`).

**Spec:** `docs/superpowers/specs/2026-07-08-config-auto-reload-design.md`
**Main plan:** `docs/superpowers/plans/2026-07-08-config-auto-reload.md`

**Depends on:** Phase 1 (registry unregister methods)
**Produces:** Standalone `ConfigManager` class with full test coverage, ready to be wired into `index.ts` in Phase 3.

---

## Context for the Engineer

### Config loading system

`src/config.ts` contains the three-layer config resolution:

1. `loadMergedConfig(cwd?)` (line 170-195) — deep-merges defaults + global + project config. Returns a `PiToolsConfig`.
2. `resolveApiKey(apiKey)` (line 108-131) — resolves env vars, shell commands, or literal keys.
3. `PiToolsConfig` interface (line 27-33):

```typescript
export interface PiToolsConfig {
  defaultProvider: string;
  selectionStrategy: SelectionStrategy;
  providers: Record<string, ProviderConfigEntry>;
  github: GitHubConfig;
  guidance?: Record<string, GuidanceOverride>;
}
```

4. `ProviderConfigEntry` (line 7-12):

```typescript
export interface ProviderConfigEntry {
  enabled: boolean;
  monthlyQuota?: number;
  apiKey?: string;
  instanceUrl?: string;
}
```

### Provider registration flow

In `src/index.ts` (line 38-60), the current startup loop:

```typescript
for (const meta of allProviders) {
  const providerConfig = config.providers[meta.name];
  if (providerConfig?.enabled === false) continue;

  const resolvedKey = resolveApiKey(providerConfig?.apiKey);
  if (meta.requiresKey && !resolvedKey) continue;

  const instances = meta.create(resolvedKey, providerConfig);
  const quota = providerConfig?.monthlyQuota ?? meta.monthlyQuota;

  if (instances.search) {
    registry.registerSearch(instances.search, {
      tier: meta.tier,
      monthlyQuota: quota,
    });
  }
  if (instances.fetch) {
    registry.registerFetch(instances.fetch);
  }
  if (instances.codeSearch) {
    registry.registerCodeSearch(instances.codeSearch);
  }
  if (instances.docs) {
    registry.registerDocs(instances.docs);
  }
}
```

`ProviderMeta` (from `src/providers/types.ts`, line 55-66):

```typescript
export interface ProviderMeta {
  name: string;
  tier: ProviderTier;
  monthlyQuota: number | null;
  requiresKey: boolean;
  create: (
    key?: string,
    providerConfig?: ProviderConfigEntry,
  ) => {
    search?: SearchProvider;
    fetch?: FetchProvider;
    codeSearch?: CodeSearchProvider;
    docs?: DocsProvider;
  };
}
```

### Test patterns

Tests mock `node:fs` at the module level with `vi.mock("node:fs")`, then use `vi.mocked(fs.readFileSync).mockReturnValue(...)` to control what config files return. See `tests/config.test.ts` for examples.

For the ConfigManager tests, you'll need to mock `loadMergedConfig` and `resolveApiKey` instead of raw filesystem calls, since ConfigManager consumes those higher-level functions.

---

### Task 2.1: Create ConfigChangeSet type and diffConfig function

**Files:**

- Create: `src/config-manager.ts`
- Create: `tests/config-manager.test.ts`

- [ ] **Step 1: Write failing tests for diffConfig**

Create `tests/config-manager.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import type { PiToolsConfig, ProviderConfigEntry } from "../src/config.ts";

// We'll test diffConfig as a standalone function first, then the full class.
// To test it in isolation, we import it directly.
// (ConfigManager exports diffConfig as a static method for testability.)
import { diffConfig } from "../src/config-manager.ts";

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
    expect(result.configChanged).toBe(false);
  });

  it("detects added provider (disabled → enabled)", () => {
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

  it("detects removed provider (enabled → disabled)", () => {
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
    // resolveKey returns different values for old vs new key
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
    // Both resolve to the same value
    const resolveKey = () => "same-value";
    const result = diffConfig(prev, next, resolveKey);
    expect(result.keyChanged).toEqual([]);
  });

  it("detects configChanged when selectionStrategy differs", () => {
    const prev = makeConfig();
    const next = makeConfig({ selectionStrategy: "best-performing" });
    const result = diffConfig(prev, next, (key) => key);
    expect(result.configChanged).toBe(true);
  });

  it("detects configChanged when defaultProvider differs", () => {
    const prev = makeConfig();
    const next = makeConfig({ defaultProvider: "brave" });
    const result = diffConfig(prev, next, (key) => key);
    expect(result.configChanged).toBe(true);
  });

  it("detects configChanged when guidance differs", () => {
    const prev = makeConfig();
    const next = makeConfig({
      guidance: { web_search: { promptSnippet: "Be concise" } },
    });
    const result = diffConfig(prev, next, (key) => key);
    expect(result.configChanged).toBe(true);
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

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/config-manager.test.ts`

Expected: Failure — `Cannot find module '../src/config-manager.ts'`.

- [ ] **Step 3: Implement diffConfig**

Create `src/config-manager.ts`:

```typescript
import type { PiToolsConfig, ProviderConfigEntry } from "./config.ts";

export interface ConfigChangeSet {
  added: string[];
  removed: string[];
  keyChanged: string[];
  configChanged: boolean;
}

function isEnabled(entry: ProviderConfigEntry | undefined): boolean {
  return entry?.enabled !== false && entry !== undefined;
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

  // Collect all provider names from both configs
  const allNames = new Set([
    ...Object.keys(prev.providers),
    ...Object.keys(next.providers),
  ]);

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
      // Both enabled — check if key changed
      const prevResolved = resolveKey(prevEntry?.apiKey);
      const nextResolved = resolveKey(nextEntry?.apiKey);
      if (prevResolved !== nextResolved) {
        keyChanged.push(name);
      }
    }
  }

  const configChanged =
    prev.selectionStrategy !== next.selectionStrategy ||
    prev.defaultProvider !== next.defaultProvider ||
    JSON.stringify(prev.guidance) !== JSON.stringify(next.guidance);

  return { added, removed, keyChanged, configChanged };
}
```

- [ ] **Step 4: Run diffConfig tests to verify they pass**

Run: `pnpm vitest run tests/config-manager.test.ts`

Expected: All `diffConfig` tests pass.

- [ ] **Step 5: Commit diffConfig**

```bash
git add src/config-manager.ts tests/config-manager.test.ts
git commit -m "feat: add diffConfig for detecting config changes

Standalone function that compares two PiToolsConfig objects and
returns a ConfigChangeSet (added/removed/keyChanged providers,
configChanged flag). Foundation for ConfigManager.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

### Task 2.2: Implement ConfigManager class with TTL and apply logic

**Files:**

- Modify: `src/config-manager.ts`
- Modify: `tests/config-manager.test.ts`

- [ ] **Step 1: Write failing tests for ConfigManager**

Append to `tests/config-manager.test.ts`:

```typescript
import { ConfigManager } from "../src/config-manager.ts";
import { ProviderRegistry } from "../src/providers/registry.ts";
import type { ProviderMeta } from "../src/providers/types.ts";

vi.mock("../src/config.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config.ts")>();
  return {
    ...actual,
    loadMergedConfig: vi.fn(),
    resolveApiKey: vi.fn((key: string | undefined) => key),
  };
});

import { loadMergedConfig, resolveApiKey } from "../src/config.ts";

const mem = () => new ProviderRegistry({ load: () => ({}), save: () => {} });

function makeMeta(
  name: string,
  opts: Partial<ProviderMeta> = {},
): ProviderMeta {
  return {
    name,
    tier: 1,
    monthlyQuota: null,
    requiresKey: false,
    create: (key, config) => ({
      search: {
        name,
        label: name,
        search: vi.fn().mockResolvedValue([]),
      },
    }),
    ...opts,
  };
}

describe("ConfigManager", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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

    const registry = mem();
    const metas = [makeMeta("brave"), makeMeta("duckduckgo"), makeMeta("exa")];
    const manager = new ConfigManager("/test/cwd", registry, metas);

    // brave and duckduckgo enabled, exa disabled
    expect(registry.getSearchProviderNames().sort()).toEqual([
      "brave",
      "duckduckgo",
    ]);
  });

  it("refresh is a no-op within TTL", () => {
    const config = makeConfig();
    vi.mocked(loadMergedConfig).mockReturnValue(config);
    vi.mocked(resolveApiKey).mockReturnValue(undefined);

    const registry = mem();
    const manager = new ConfigManager("/test/cwd", registry, [
      makeMeta("brave"),
      makeMeta("duckduckgo"),
    ]);

    // loadMergedConfig called once during construction
    expect(vi.mocked(loadMergedConfig)).toHaveBeenCalledTimes(1);

    manager.refresh();

    // Still only 1 call — TTL not expired
    expect(vi.mocked(loadMergedConfig)).toHaveBeenCalledTimes(1);
  });

  it("refresh reloads config after TTL expires", () => {
    const config = makeConfig();
    vi.mocked(loadMergedConfig).mockReturnValue(config);
    vi.mocked(resolveApiKey).mockReturnValue(undefined);

    const registry = mem();
    const manager = new ConfigManager("/test/cwd", registry, [
      makeMeta("brave"),
      makeMeta("duckduckgo"),
    ]);

    // Expire the TTL
    manager.expireTtlForTest();
    manager.refresh();

    expect(vi.mocked(loadMergedConfig)).toHaveBeenCalledTimes(2);
  });

  it("refresh(force=true) reloads regardless of TTL", () => {
    const config = makeConfig();
    vi.mocked(loadMergedConfig).mockReturnValue(config);
    vi.mocked(resolveApiKey).mockReturnValue(undefined);

    const registry = mem();
    const manager = new ConfigManager("/test/cwd", registry, [
      makeMeta("brave"),
      makeMeta("duckduckgo"),
    ]);

    manager.refresh(true);

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

    const registry = mem();
    const manager = new ConfigManager("/test/cwd", registry, [
      makeMeta("brave"),
      makeMeta("exa"),
    ]);

    expect(registry.getSearchProviderNames()).toEqual(["brave"]);

    manager.expireTtlForTest();
    manager.refresh();

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

    const registry = mem();
    const manager = new ConfigManager("/test/cwd", registry, [
      makeMeta("brave"),
      makeMeta("duckduckgo"),
    ]);

    expect(registry.getSearchProviderNames().sort()).toEqual([
      "brave",
      "duckduckgo",
    ]);

    manager.expireTtlForTest();
    manager.refresh();

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
    const registry = mem();
    const manager = new ConfigManager("/test/cwd", registry, [
      makeMeta("brave", { create: createFn }),
    ]);

    // Created once on construction
    expect(createFn).toHaveBeenCalledTimes(1);

    manager.expireTtlForTest();
    manager.refresh();

    // Created again due to key change
    expect(createFn).toHaveBeenCalledTimes(2);
    expect(createFn).toHaveBeenLastCalledWith(
      "new-resolved",
      updatedConfig.providers.brave,
    );
  });

  it("preserves previous config when reload produces malformed JSON", () => {
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

    const registry = mem();
    const manager = new ConfigManager("/test/cwd", registry, [
      makeMeta("brave"),
    ]);

    manager.expireTtlForTest();
    manager.refresh();

    // Config unchanged — still the valid one
    expect(manager.current.providers.brave.enabled).toBe(true);
    expect(registry.getSearchProviderNames()).toEqual(["brave"]);
  });

  it("updates current config when selectionStrategy changes", () => {
    const initialConfig = makeConfig({ selectionStrategy: "auto" });
    const updatedConfig = makeConfig({ selectionStrategy: "best-performing" });

    vi.mocked(loadMergedConfig)
      .mockReturnValueOnce(initialConfig)
      .mockReturnValueOnce(updatedConfig);
    vi.mocked(resolveApiKey).mockReturnValue(undefined);

    const registry = mem();
    const manager = new ConfigManager("/test/cwd", registry, [
      makeMeta("brave"),
      makeMeta("duckduckgo"),
    ]);

    expect(manager.current.selectionStrategy).toBe("auto");

    manager.expireTtlForTest();
    manager.refresh();

    expect(manager.current.selectionStrategy).toBe("best-performing");
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

    const registry = mem();
    const manager = new ConfigManager("/test/cwd", registry, [
      makeMeta("brave", { requiresKey: true }),
    ]);

    // brave requires key but resolveApiKey returns undefined → not registered
    expect(registry.getSearchProviderNames()).toEqual([]);
  });
});
```

Note: Add `beforeEach` import — update the top import line to:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/config-manager.test.ts`

Expected: Failures — `ConfigManager` not exported from `../src/config-manager.ts`.

- [ ] **Step 3: Implement ConfigManager class**

Update `src/config-manager.ts` — add the class after the existing `diffConfig` function:

```typescript
import { loadMergedConfig, resolveApiKey } from "./config.ts";
import type { PiToolsConfig, ProviderConfigEntry } from "./config.ts";
import type { ProviderRegistry } from "./providers/registry.ts";
import type { ProviderMeta } from "./providers/types.ts";

export interface ConfigChangeSet {
  added: string[];
  removed: string[];
  keyChanged: string[];
  configChanged: boolean;
}

function isEnabled(entry: ProviderConfigEntry | undefined): boolean {
  return entry?.enabled !== false && entry !== undefined;
}

export function diffConfig(
  prev: PiToolsConfig,
  next: PiToolsConfig,
  resolveKey: (apiKey: string | undefined) => string | undefined,
): ConfigChangeSet {
  const added: string[] = [];
  const removed: string[] = [];
  const keyChanged: string[] = [];

  const allNames = new Set([
    ...Object.keys(prev.providers),
    ...Object.keys(next.providers),
  ]);

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

  const configChanged =
    prev.selectionStrategy !== next.selectionStrategy ||
    prev.defaultProvider !== next.defaultProvider ||
    JSON.stringify(prev.guidance) !== JSON.stringify(next.guidance);

  return { added, removed, keyChanged, configChanged };
}

const CONFIG_TTL_MS = 30_000;

export class ConfigManager {
  private _config: PiToolsConfig;
  private cacheTime: number;
  private readonly cwd: string;
  private readonly registry: ProviderRegistry;
  private readonly metaByName: Map<string, ProviderMeta>;

  constructor(
    cwd: string,
    registry: ProviderRegistry,
    providerMetas: ProviderMeta[],
  ) {
    this.cwd = cwd;
    this.registry = registry;
    this.metaByName = new Map(providerMetas.map((m) => [m.name, m]));
    this._config = loadMergedConfig(cwd);
    this.cacheTime = Date.now();
    this.registerFromConfig(this._config);
  }

  get current(): PiToolsConfig {
    return this._config;
  }

  refresh(force = false): void {
    const now = Date.now();
    if (!force && now - this.cacheTime < CONFIG_TTL_MS) return;

    let nextConfig: PiToolsConfig;
    try {
      nextConfig = loadMergedConfig(this.cwd);
    } catch {
      // Malformed config — keep previous, reset TTL for retry
      this.cacheTime = now;
      return;
    }

    const changeSet = diffConfig(this._config, nextConfig, resolveApiKey);
    this.applyChanges(changeSet, nextConfig);
    this._config = nextConfig;
    this.cacheTime = now;
  }

  private applyChanges(
    changeSet: ConfigChangeSet,
    nextConfig: PiToolsConfig,
  ): void {
    // Remove disabled providers
    for (const name of changeSet.removed) {
      this.registry.unregisterAll(name);
    }

    // Re-register providers with changed keys
    for (const name of changeSet.keyChanged) {
      this.registry.unregisterAll(name);
      this.registerProvider(name, nextConfig);
    }

    // Add newly enabled providers
    for (const name of changeSet.added) {
      this.registerProvider(name, nextConfig);
    }
  }

  private registerProvider(name: string, config: PiToolsConfig): void {
    const meta = this.metaByName.get(name);
    if (!meta) return;

    const providerConfig = config.providers[name];
    const resolvedKey = resolveApiKey(providerConfig?.apiKey);
    if (meta.requiresKey && !resolvedKey) return;

    const instances = meta.create(resolvedKey, providerConfig);
    const quota = providerConfig?.monthlyQuota ?? meta.monthlyQuota;

    if (instances.search) {
      this.registry.registerSearch(instances.search, {
        tier: meta.tier,
        monthlyQuota: quota,
      });
    }
    if (instances.fetch) {
      this.registry.registerFetch(instances.fetch);
    }
    if (instances.codeSearch) {
      this.registry.registerCodeSearch(instances.codeSearch);
    }
    if (instances.docs) {
      this.registry.registerDocs(instances.docs);
    }
  }

  private registerFromConfig(config: PiToolsConfig): void {
    for (const [name, entry] of Object.entries(config.providers)) {
      if (!isEnabled(entry)) continue;
      this.registerProvider(name, config);
    }
  }

  /** @internal Exposed for tests to simulate TTL expiry without time mocking. */
  expireTtlForTest(): void {
    this.cacheTime = 0;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/config-manager.test.ts`

Expected: All tests pass.

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `pnpm vitest run`

Expected: All tests pass.

- [ ] **Step 6: Run lint and typecheck**

Run: `pnpm biome check src/config-manager.ts tests/config-manager.test.ts && pnpm tsc --noEmit`

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/config-manager.ts tests/config-manager.test.ts
git commit -m "feat: add ConfigManager with TTL-based auto-reload

ConfigManager wraps loadMergedConfig with a 30s TTL cache. On
refresh, it diffs the previous config against the new one and
hot-swaps providers in the registry without destroying metrics.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```
