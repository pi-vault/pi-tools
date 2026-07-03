# Phase 6: Config & UX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add project-level config, `/tools` slash command with status display and interactive setup, session-level backend scoring, and prompt guidance overrides.

**Architecture:** Extend `loadConfig` with project-level config discovery and deep merge. New `src/commands/tools.ts` for the slash command. Add `ProviderMetrics` tracking to `ProviderRegistry` with optional `best-performing` selection strategy. Guidance overrides read from config at tool creation time.

**Tech Stack:** TypeScript, Vitest, existing pi-tools config system.

**Key API constraints (verified against `@earendil-works/pi-coding-agent` type definitions):**
- `pi.registerCommand(name: string, options: { description?, handler })` — name is first arg, options second
- Command handler signature: `(args: string, ctx: ExtensionCommandContext) => Promise<void>` — `args` is a single string, not `string[]`
- `ctx.ui.select(title, options: string[])` — options are plain strings, returns `Promise<string | undefined>` (single-select only)
- `ctx.ui.confirm(title, message)` — returns `Promise<boolean>`
- `ctx.ui.input(title, placeholder?)` — returns `Promise<string | undefined>`
- `createWebFetchTool` currently has 3 params: `(store, resolveFetchCandidates?, cache?)` — any new param goes after `cache`

---

### Task 1: Deep merge utility function

**Files:**
- Create: `src/utils/deep-merge.ts`
- Create: `tests/utils/deep-merge.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/utils/deep-merge.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deepMerge } from "../../src/utils/deep-merge.ts";

describe("deepMerge", () => {
  it("returns a copy of base when override is empty", () => {
    const base = { a: 1, b: { c: 2 } };
    const result = deepMerge(base, {});
    expect(result).toEqual({ a: 1, b: { c: 2 } });
    // Must be a new object, not the same reference
    expect(result).not.toBe(base);
    expect(result.b).not.toBe(base.b);
  });

  it("overrides scalar values", () => {
    const base = { a: 1, b: "hello" };
    const override = { a: 42 };
    expect(deepMerge(base, override)).toEqual({ a: 42, b: "hello" });
  });

  it("merges nested objects recursively", () => {
    const base = {
      providers: {
        brave: { enabled: true, monthlyQuota: 2000 },
        exa: { enabled: true, monthlyQuota: 1000 },
      },
    };
    const override = {
      providers: {
        brave: { enabled: false },
      },
    };
    const result = deepMerge(base, override);
    expect(result).toEqual({
      providers: {
        brave: { enabled: false, monthlyQuota: 2000 },
        exa: { enabled: true, monthlyQuota: 1000 },
      },
    });
  });

  it("replaces arrays entirely from override", () => {
    const base = { tags: ["a", "b", "c"] };
    const override = { tags: ["x"] };
    expect(deepMerge(base, override)).toEqual({ tags: ["x"] });
  });

  it("adds keys from override that are not in base", () => {
    const base = { a: 1 };
    const override = { b: 2 };
    expect(deepMerge(base, override)).toEqual({ a: 1, b: 2 });
  });

  it("handles null in override by replacing the value", () => {
    const base = { a: { nested: true } };
    const override = { a: null };
    expect(deepMerge(base, override)).toEqual({ a: null });
  });

  it("skips undefined values in override", () => {
    const base = { a: 1, b: 2 };
    const override = { a: undefined };
    expect(deepMerge(base, override)).toEqual({ a: 1, b: 2 });
  });

  it("does not merge when override value is not a plain object", () => {
    const base = { a: { nested: true } };
    const override = { a: "replaced" };
    expect(deepMerge(base, override)).toEqual({ a: "replaced" });
  });

  it("does not merge when base value is not a plain object", () => {
    const base = { a: "string" };
    const override = { a: { nested: true } };
    expect(deepMerge(base, override)).toEqual({ a: { nested: true } });
  });

  it("handles deeply nested structures (3+ levels)", () => {
    const base = { l1: { l2: { l3: { value: "base" } } } };
    const override = { l1: { l2: { l3: { value: "override" } } } };
    expect(deepMerge(base, override)).toEqual({
      l1: { l2: { l3: { value: "override" } } },
    });
  });

  it("handles empty base", () => {
    const override = { a: 1, b: { c: 2 } };
    expect(deepMerge({}, override)).toEqual({ a: 1, b: { c: 2 } });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/utils/deep-merge.test.ts`
Expected: FAIL — `src/utils/deep-merge.ts` does not exist

- [ ] **Step 3: Implement `deepMerge`**

Create `src/utils/deep-merge.ts`:

```ts
/**
 * Check whether a value is a plain object (not null, not an array, not a class instance).
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Deep-merge two plain objects. Override values take precedence.
 *
 * Rules:
 * - Nested plain objects are merged recursively.
 * - Arrays and scalars from `override` replace `base` values.
 * - `null` in override replaces the base value.
 * - `undefined` in override is skipped (base value preserved).
 */
export function deepMerge<T extends Record<string, unknown>>(
  base: T,
  override: Record<string, unknown>,
): T {
  const result: Record<string, unknown> = {};

  // Copy all base keys (deep-clone nested objects)
  for (const key of Object.keys(base)) {
    const baseVal = base[key];
    result[key] = isPlainObject(baseVal) ? deepMerge(baseVal, {}) : baseVal;
  }

  // Apply override keys
  for (const key of Object.keys(override)) {
    const overrideVal = override[key];

    // Skip undefined — preserve base value
    if (overrideVal === undefined) continue;

    const baseVal = result[key];

    // Recursively merge only when both sides are plain objects
    if (isPlainObject(baseVal) && isPlainObject(overrideVal)) {
      result[key] = deepMerge(baseVal, overrideVal);
    } else {
      result[key] = overrideVal;
    }
  }

  return result as T;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/utils/deep-merge.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/deep-merge.ts tests/utils/deep-merge.test.ts
git commit -m "feat: add deepMerge utility for config layering"
```

---

### Task 2: Project-level config discovery and loading

**Files:**
- Modify: `src/config.ts`
- Modify: `tests/config.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/config.test.ts`. First update the import on line 3:

Replace:
```ts
import { loadConfig, resolveApiKey } from "../src/config.ts";
```

With:
```ts
import { loadConfig, resolveApiKey, findProjectConfigPath, loadMergedConfig } from "../src/config.ts";
import * as path from "node:path";
```

Then add these test blocks after the closing `});` of the `"GitHub config"` describe block (after line 139):

```ts
describe("findProjectConfigPath", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns path when .pi/pi-tools.json exists in cwd", () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return p === path.join("/projects/my-app", ".pi", "pi-tools.json");
    });
    const result = findProjectConfigPath("/projects/my-app");
    expect(result).toBe(
      path.join("/projects/my-app", ".pi", "pi-tools.json"),
    );
  });

  it("walks up to find .pi/pi-tools.json in ancestor", () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return p === path.join("/projects", ".pi", "pi-tools.json");
    });
    const result = findProjectConfigPath("/projects/my-app/src/deep");
    expect(result).toBe(path.join("/projects", ".pi", "pi-tools.json"));
  });

  it("returns undefined when no .pi/pi-tools.json found", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const result = findProjectConfigPath("/projects/my-app");
    expect(result).toBeUndefined();
  });

  it("stops after 10 levels", () => {
    const calls: string[] = [];
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      calls.push(p as string);
      return false;
    });
    findProjectConfigPath("/a/b/c/d/e/f/g/h/i/j/k/l/m/n");
    // Should check at most 10 directories
    expect(calls.length).toBeLessThanOrEqual(10);
  });

  it("stops at filesystem root", () => {
    const calls: string[] = [];
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      calls.push(p as string);
      return false;
    });
    findProjectConfigPath("/a/b");
    // /a/b, /a, / — should stop at root, not go further
    expect(calls.length).toBe(3);
  });
});

describe("loadMergedConfig", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns global config when no project config exists", () => {
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      const filePath = typeof p === "string" ? p : p.toString();
      if (filePath.includes(path.join(".pi", "agent"))) {
        return JSON.stringify({
          defaultProvider: "brave",
          providers: { brave: { enabled: true, monthlyQuota: 2000 } },
        });
      }
      throw new Error("ENOENT");
    });
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const config = loadMergedConfig("/projects/my-app");
    expect(config.defaultProvider).toBe("brave");
  });

  it("deep-merges project config over global config", () => {
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      const filePath = typeof p === "string" ? p : p.toString();
      if (filePath.includes(path.join(".pi", "agent"))) {
        return JSON.stringify({
          defaultProvider: "auto",
          providers: {
            brave: { enabled: true, monthlyQuota: 2000 },
            exa: { enabled: true, monthlyQuota: 1000 },
          },
        });
      }
      if (filePath.includes(path.join(".pi", "pi-tools.json"))) {
        return JSON.stringify({
          defaultProvider: "brave",
          providers: {
            exa: { enabled: false },
          },
        });
      }
      throw new Error("ENOENT");
    });
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return (p as string).includes(path.join(".pi", "pi-tools.json"));
    });

    const config = loadMergedConfig("/projects/my-app");
    expect(config.defaultProvider).toBe("brave");
    // exa disabled by project config
    expect(config.providers.exa.enabled).toBe(false);
    // brave untouched — kept from global config
    expect(config.providers.brave.enabled).toBe(true);
    expect(config.providers.brave.monthlyQuota).toBe(2000);
  });

  it("project config overrides built-in defaults when no global config", () => {
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      const filePath = typeof p === "string" ? p : p.toString();
      if (filePath.includes(path.join(".pi", "pi-tools.json"))) {
        return JSON.stringify({
          providers: { duckduckgo: { enabled: false } },
        });
      }
      throw new Error("ENOENT");
    });
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return (p as string).includes(path.join(".pi", "pi-tools.json"));
    });

    const config = loadMergedConfig("/projects/my-app");
    // duckduckgo overridden by project config
    expect(config.providers.duckduckgo.enabled).toBe(false);
    // Other defaults preserved
    expect(config.providers.brave.enabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — `findProjectConfigPath` and `loadMergedConfig` are not exported from `src/config.ts`

- [ ] **Step 3: Implement project config discovery and merged loading**

In `src/config.ts`, add the import after the existing `import * as path` line (line 4):

```ts
import { deepMerge } from "./utils/deep-merge.ts";
```

Add these functions at the bottom of `src/config.ts`, after the `resolveApiKey` function:

```ts
const MAX_WALK_DEPTH = 10;
const PROJECT_CONFIG_RELATIVE = path.join(".pi", "pi-tools.json");

/**
 * Walk up from `startDir` looking for `.pi/pi-tools.json`.
 * Returns the absolute path if found, or undefined.
 * Stops at the filesystem root or after MAX_WALK_DEPTH levels.
 */
export function findProjectConfigPath(startDir: string): string | undefined {
  let dir = path.resolve(startDir);
  for (let i = 0; i < MAX_WALK_DEPTH; i++) {
    const candidate = path.join(dir, PROJECT_CONFIG_RELATIVE);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  return undefined;
}

/**
 * Load config with three-layer resolution:
 *   1. Project `.pi/pi-tools.json` (highest priority)
 *   2. Global `~/.pi/agent/extensions/pi-tools.json`
 *   3. Built-in defaults (lowest priority)
 *
 * Layers are deep-merged: nested objects merge recursively,
 * scalars and arrays from higher-priority sources replace lower-priority values.
 */
export function loadMergedConfig(cwd?: string): PiToolsConfig {
  // Start from built-in defaults
  let merged = deepMerge(DEFAULT_CONFIG as Record<string, unknown>, {});

  // Layer 2: global config
  const globalPath = getConfigPath();
  try {
    const raw = fs.readFileSync(globalPath, "utf-8");
    const globalOverrides = JSON.parse(raw);
    merged = deepMerge(merged, globalOverrides);
  } catch {
    // No global config or parse error — defaults stand
  }

  // Layer 1: project config (highest priority)
  if (cwd) {
    const projectPath = findProjectConfigPath(cwd);
    if (projectPath) {
      try {
        const raw = fs.readFileSync(projectPath, "utf-8");
        const projectOverrides = JSON.parse(raw);
        merged = deepMerge(merged, projectOverrides);
      } catch {
        // Malformed project config — skip
      }
    }
  }

  return merged as PiToolsConfig;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/config.test.ts`
Expected: All tests PASS (both existing and new)

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: add project-level config discovery and three-layer merging"
```

---

### Task 3: Add `selectionStrategy` and `guidance` fields to config types

**Files:**
- Modify: `src/config.ts`
- Modify: `tests/config.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/config.test.ts`, after the `"loadMergedConfig"` describe block:

```ts
describe("config types — selectionStrategy and guidance", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads selectionStrategy from config file", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        defaultProvider: "auto",
        selectionStrategy: "best-performing",
        providers: {},
      }),
    );
    const config = loadConfig();
    expect(config.selectionStrategy).toBe("best-performing");
  });

  it("defaults selectionStrategy to auto when not specified", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const config = loadConfig();
    expect(config.selectionStrategy).toBe("auto");
  });

  it("loads guidance overrides from config file", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        defaultProvider: "auto",
        providers: {},
        guidance: {
          web_search: {
            promptSnippet: "Custom search snippet",
            promptGuidelines: ["Guideline A", "Guideline B"],
          },
        },
      }),
    );
    const config = loadConfig();
    expect(config.guidance?.web_search?.promptSnippet).toBe("Custom search snippet");
    expect(config.guidance?.web_search?.promptGuidelines).toEqual([
      "Guideline A",
      "Guideline B",
    ]);
  });

  it("defaults guidance to undefined when not specified", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const config = loadConfig();
    expect(config.guidance).toBeUndefined();
  });

  it("rejects invalid selectionStrategy values", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        defaultProvider: "auto",
        selectionStrategy: "invalid-strategy",
        providers: {},
      }),
    );
    const config = loadConfig();
    // Invalid value should fall back to default
    expect(config.selectionStrategy).toBe("auto");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — `selectionStrategy` and `guidance` do not exist on `PiToolsConfig`

- [ ] **Step 3: Update `PiToolsConfig` interface and `loadConfig`**

In `src/config.ts`, replace the `PiToolsConfig` interface (lines 19-23):

Replace:
```ts
export interface PiToolsConfig {
  defaultProvider: string;
  providers: Record<string, ProviderConfigEntry>;
  github: GitHubConfig;
}
```

With:
```ts
export type SelectionStrategy = "auto" | "best-performing";

export interface GuidanceOverride {
  promptSnippet?: string;
  promptGuidelines?: string[];
}

export interface PiToolsConfig {
  defaultProvider: string;
  selectionStrategy: SelectionStrategy;
  providers: Record<string, ProviderConfigEntry>;
  github: GitHubConfig;
  guidance?: Record<string, GuidanceOverride>;
}
```

Replace the `DEFAULT_CONFIG` declaration (line 29, just the opening):

Replace:
```ts
const DEFAULT_CONFIG: PiToolsConfig = {
  defaultProvider: "auto",
  providers: {
```

With:
```ts
const VALID_STRATEGIES: readonly string[] = ["auto", "best-performing"];

const DEFAULT_CONFIG: PiToolsConfig = {
  defaultProvider: "auto",
  selectionStrategy: "auto",
  providers: {
```

Replace the `loadConfig` function (lines 57-76):

Replace:
```ts
export function loadConfig(configPath?: string): PiToolsConfig {
  const filePath = configPath ?? getConfigPath();
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      defaultProvider: parsed.defaultProvider ?? DEFAULT_CONFIG.defaultProvider,
      providers: {
        ...DEFAULT_CONFIG.providers,
        ...parsed.providers,
      },
      github: {
        ...DEFAULT_CONFIG.github,
        ...parsed.github,
      },
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
```

With:
```ts
export function loadConfig(configPath?: string): PiToolsConfig {
  const filePath = configPath ?? getConfigPath();
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);

    const strategy = VALID_STRATEGIES.includes(parsed.selectionStrategy)
      ? (parsed.selectionStrategy as SelectionStrategy)
      : DEFAULT_CONFIG.selectionStrategy;

    return {
      defaultProvider: parsed.defaultProvider ?? DEFAULT_CONFIG.defaultProvider,
      selectionStrategy: strategy,
      providers: {
        ...DEFAULT_CONFIG.providers,
        ...parsed.providers,
      },
      github: {
        ...DEFAULT_CONFIG.github,
        ...parsed.github,
      },
      guidance: parsed.guidance,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/config.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: add selectionStrategy and guidance fields to PiToolsConfig"
```

---

### Task 4: Session-level provider metrics tracking in ProviderRegistry

**Files:**
- Modify: `src/providers/registry.ts`
- Modify: `tests/providers/registry.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/providers/registry.test.ts`, inside the existing `describe("ProviderRegistry", ...)` block, after the `"selectFetchCandidates"` describe block (before the final closing `});`):

```ts
  describe("session metrics", () => {
    it("records success with latency", () => {
      const tracker = new UsageTracker();
      const registry = new ProviderRegistry(tracker);
      const brave = mockProvider("brave", "Brave");
      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

      registry.recordSuccess("brave", 340);
      registry.recordSuccess("brave", 500);

      const metrics = registry.getMetrics("brave");
      expect(metrics).toBeDefined();
      expect(metrics!.successes).toBe(2);
      expect(metrics!.failures).toBe(0);
      expect(metrics!.totalLatencyMs).toBe(840);
    });

    it("records failure", () => {
      const tracker = new UsageTracker();
      const registry = new ProviderRegistry(tracker);
      const brave = mockProvider("brave", "Brave");
      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

      registry.recordFailure("brave");
      registry.recordFailure("brave");

      const metrics = registry.getMetrics("brave");
      expect(metrics).toBeDefined();
      expect(metrics!.successes).toBe(0);
      expect(metrics!.failures).toBe(2);
      expect(metrics!.totalLatencyMs).toBe(0);
    });

    it("returns undefined metrics for unknown provider", () => {
      const tracker = new UsageTracker();
      const registry = new ProviderRegistry(tracker);
      expect(registry.getMetrics("unknown")).toBeUndefined();
    });

    it("tracks metrics independently per provider", () => {
      const tracker = new UsageTracker();
      const registry = new ProviderRegistry(tracker);
      const brave = mockProvider("brave", "Brave");
      const exa = mockProvider("exa", "Exa");
      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
      registry.registerSearch(exa, { tier: 1, monthlyQuota: 1000 });

      registry.recordSuccess("brave", 300);
      registry.recordFailure("exa");
      registry.recordSuccess("exa", 600);

      const braveMetrics = registry.getMetrics("brave")!;
      expect(braveMetrics.successes).toBe(1);
      expect(braveMetrics.failures).toBe(0);

      const exaMetrics = registry.getMetrics("exa")!;
      expect(exaMetrics.successes).toBe(1);
      expect(exaMetrics.failures).toBe(1);
      expect(exaMetrics.totalLatencyMs).toBe(600);
    });

    it("getAllMetrics returns all tracked providers", () => {
      const tracker = new UsageTracker();
      const registry = new ProviderRegistry(tracker);
      const brave = mockProvider("brave", "Brave");
      const exa = mockProvider("exa", "Exa");
      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
      registry.registerSearch(exa, { tier: 1, monthlyQuota: 1000 });

      registry.recordSuccess("brave", 300);
      registry.recordSuccess("exa", 600);

      const all = registry.getAllMetrics();
      expect(all.size).toBe(2);
      expect(all.get("brave")?.successes).toBe(1);
      expect(all.get("exa")?.successes).toBe(1);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/providers/registry.test.ts`
Expected: FAIL — `recordSuccess`, `recordFailure`, `getMetrics`, `getAllMetrics` do not exist on `ProviderRegistry`

- [ ] **Step 3: Implement session metrics tracking**

In `src/providers/registry.ts`, add the `ProviderMetrics` interface before the `ProviderRegistry` class (before line 18):

```ts
export interface ProviderMetrics {
  successes: number;
  failures: number;
  totalLatencyMs: number;
}
```

Add the metrics map as a private field in the `ProviderRegistry` class. Replace:

```ts
  private searchProviders = new Map<string, RegisteredSearch>();
  private fetchProviders = new Map<string, RegisteredFetch>();
  private codeSearchProviders = new Map<string, RegisteredCodeSearch>();
  private tracker: UsageTracker;
```

With:
```ts
  private searchProviders = new Map<string, RegisteredSearch>();
  private fetchProviders = new Map<string, RegisteredFetch>();
  private codeSearchProviders = new Map<string, RegisteredCodeSearch>();
  private tracker: UsageTracker;
  private metrics = new Map<string, ProviderMetrics>();
```

Add these methods to the `ProviderRegistry` class, after the `getSearchProviderNames()` method (before the final closing `}`):

```ts
  recordSuccess(providerName: string, latencyMs: number): void {
    const m = this.metrics.get(providerName) ?? { successes: 0, failures: 0, totalLatencyMs: 0 };
    m.successes += 1;
    m.totalLatencyMs += latencyMs;
    this.metrics.set(providerName, m);
  }

  recordFailure(providerName: string): void {
    const m = this.metrics.get(providerName) ?? { successes: 0, failures: 0, totalLatencyMs: 0 };
    m.failures += 1;
    this.metrics.set(providerName, m);
  }

  getMetrics(providerName: string): ProviderMetrics | undefined {
    return this.metrics.get(providerName);
  }

  getAllMetrics(): ReadonlyMap<string, ProviderMetrics> {
    return this.metrics;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/providers/registry.test.ts`
Expected: All tests PASS (both existing and new)

- [ ] **Step 5: Commit**

```bash
git add src/providers/registry.ts tests/providers/registry.test.ts
git commit -m "feat: add session-level provider metrics tracking to ProviderRegistry"
```

---

### Task 5: `best-performing` selection strategy

**Files:**
- Modify: `src/providers/registry.ts`
- Modify: `tests/providers/registry.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/providers/registry.test.ts`, inside the existing `describe("ProviderRegistry", ...)` block, after the `"session metrics"` describe block:

```ts
  describe("best-performing selection strategy", () => {
    it("selectSearch uses tier-based selection when strategy is auto", () => {
      const tracker = new UsageTracker();
      const registry = new ProviderRegistry(tracker);
      const brave = mockProvider("brave", "Brave");
      const ddg = mockProvider("duckduckgo", "DuckDuckGo");

      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
      registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

      // brave is tier 1, should be preferred even if ddg has better metrics
      registry.recordSuccess("duckduckgo", 100);
      registry.recordFailure("brave");

      const selected = registry.selectSearch();
      expect(selected?.name).toBe("brave");
    });

    it("selectSearchByPerformance scores providers by success rate, speed, and tier", () => {
      const tracker = new UsageTracker();
      const registry = new ProviderRegistry(tracker);
      const brave = mockProvider("brave", "Brave");
      const exa = mockProvider("exa", "Exa");
      const ddg = mockProvider("duckduckgo", "DuckDuckGo");

      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
      registry.registerSearch(exa, { tier: 1, monthlyQuota: 1000 });
      registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

      // brave: 100% success, fast
      registry.recordSuccess("brave", 200);
      registry.recordSuccess("brave", 200);

      // exa: 50% success, slower
      registry.recordSuccess("exa", 600);
      registry.recordFailure("exa");

      // ddg: 100% success, very slow, low tier
      registry.recordSuccess("duckduckgo", 1000);

      const selected = registry.selectSearchByPerformance();
      // brave should win: perfect success rate, fast, tier 1
      expect(selected?.name).toBe("brave");
    });

    it("selectSearchByPerformance falls back to tier-based when no metrics exist", () => {
      const tracker = new UsageTracker();
      const registry = new ProviderRegistry(tracker);
      const brave = mockProvider("brave", "Brave");
      const ddg = mockProvider("duckduckgo", "DuckDuckGo");

      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
      registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

      // No metrics recorded — should fall back to tier-based (like selectSearch)
      const selected = registry.selectSearchByPerformance();
      expect(selected?.name).toBe("brave");
    });

    it("selectSearchByPerformance excludes exhausted providers", () => {
      const tracker = new UsageTracker();
      const registry = new ProviderRegistry(tracker);
      const brave = mockProvider("brave", "Brave");
      const ddg = mockProvider("duckduckgo", "DuckDuckGo");

      registry.registerSearch(brave, { tier: 1, monthlyQuota: 1 });
      registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

      registry.recordUsage("brave"); // exhausted
      registry.recordSuccess("brave", 200);

      const selected = registry.selectSearchByPerformance();
      expect(selected?.name).toBe("duckduckgo");
    });

    it("selectSearchByPerformance prefers fast provider with good success rate over slow tier-1", () => {
      const tracker = new UsageTracker();
      const registry = new ProviderRegistry(tracker);
      const brave = mockProvider("brave", "Brave");
      const perplexity = mockProvider("perplexity", "Perplexity");

      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
      registry.registerSearch(perplexity, { tier: 2, monthlyQuota: null });

      // brave: 50% success, slow
      registry.recordSuccess("brave", 2000);
      registry.recordFailure("brave");

      // perplexity: 100% success, fast (tier 2 but much better performance)
      registry.recordSuccess("perplexity", 100);
      registry.recordSuccess("perplexity", 100);
      registry.recordSuccess("perplexity", 100);

      const selected = registry.selectSearchByPerformance();
      // perplexity should win due to much better success rate and speed
      expect(selected?.name).toBe("perplexity");
    });

    it("selectSearchByPerformance returns undefined when no providers registered", () => {
      const tracker = new UsageTracker();
      const registry = new ProviderRegistry(tracker);
      expect(registry.selectSearchByPerformance()).toBeUndefined();
    });

    it("selectSearchByPerformance selects explicit provider by name", () => {
      const tracker = new UsageTracker();
      const registry = new ProviderRegistry(tracker);
      const brave = mockProvider("brave", "Brave");
      const ddg = mockProvider("duckduckgo", "DuckDuckGo");

      registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
      registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

      const selected = registry.selectSearchByPerformance("duckduckgo");
      expect(selected?.name).toBe("duckduckgo");
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/providers/registry.test.ts`
Expected: FAIL — `selectSearchByPerformance` does not exist on `ProviderRegistry`

- [ ] **Step 3: Implement `selectSearchByPerformance`**

Add the following method to the `ProviderRegistry` class in `src/providers/registry.ts`, after the `selectSearchCandidates` method (after line 83):

```ts
  /**
   * Select the best search provider based on session performance metrics.
   *
   * Score formula:
   *   score = (success_rate * 0.5) + (speed_score * 0.3) + (tier_score * 0.2)
   *
   * Where:
   *   success_rate = successes / (successes + failures)
   *   speed_score  = 1 - (avg_latency / max_avg_latency)
   *   tier_score   = { 1: 1.0, 2: 0.6, 3: 0.3 }
   *
   * Providers with no metrics are scored using tier_score only (conservative default).
   */
  selectSearchByPerformance(name?: string): SearchProvider | undefined {
    if (name && name !== "auto") {
      return this.searchProviders.get(name)?.provider;
    }

    // Build list of eligible (non-exhausted) providers
    const eligible = [...this.searchProviders.values()].filter((r) => {
      if (r.monthlyQuota === null) return true;
      return this.tracker.getCount(r.provider.name) < r.monthlyQuota;
    });

    if (eligible.length === 0) return undefined;

    const TIER_SCORES: Record<number, number> = { 1: 1.0, 2: 0.6, 3: 0.3 };

    const scored = eligible.map((r) => {
      const m = this.metrics.get(r.provider.name);
      const tierScore = TIER_SCORES[r.tier] ?? 0.3;

      if (!m || (m.successes + m.failures) === 0) {
        // No data — score is tier_score * 0.2 only (weighted as the tier component)
        return { provider: r.provider, score: tierScore * 0.2 };
      }

      const total = m.successes + m.failures;
      const successRate = m.successes / total;
      const avgLatency = m.successes > 0 ? m.totalLatencyMs / m.successes : Infinity;

      return { provider: r.provider, score: 0, avgLatency, successRate, tierScore };
    });

    // Find max average latency among providers that have data
    const latencies = scored
      .filter((s) => "avgLatency" in s && s.avgLatency !== Infinity)
      .map((s) => (s as { avgLatency: number }).avgLatency);
    const maxLatency = latencies.length > 0 ? Math.max(...latencies) : 1;

    // Compute final scores
    for (const s of scored) {
      if ("successRate" in s && s.successRate !== undefined) {
        const speedScore = s.avgLatency === Infinity ? 0 : 1 - (s.avgLatency / (maxLatency || 1));
        s.score = (s.successRate * 0.5) + (speedScore * 0.3) + (s.tierScore! * 0.2);
      }
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    return scored[0]?.provider;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/providers/registry.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/providers/registry.ts tests/providers/registry.test.ts
git commit -m "feat: add best-performing selection strategy to ProviderRegistry"
```

---

### Task 6: Prompt guidance overrides in tool creation

**Context:** Each tool creation function (`createWebSearchTool`, `createWebFetchTool`, `createWebReadTool`, `createCodeSearchTool`) needs a `guidance?: GuidanceOverride` parameter that overrides hardcoded `promptSnippet` and `promptGuidelines`. The `guidance` parameter is always added as the **last** parameter to avoid breaking existing call sites. The existing `createWebFetchTool` signature is `(store, resolveFetchCandidates?, cache?)`, so `guidance` becomes the 4th parameter.

**Files:**
- Modify: `src/tools/web-search.ts`
- Modify: `src/tools/web-fetch.ts`
- Modify: `src/tools/web-read.ts`
- Modify: `src/tools/code-search.ts`
- Modify: `src/index.ts`
- Create: `tests/tools/guidance.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/tools/guidance.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createWebSearchTool } from "../../src/tools/web-search.ts";
import { createWebFetchTool } from "../../src/tools/web-fetch.ts";
import { createWebReadTool } from "../../src/tools/web-read.ts";
import { createCodeSearchTool } from "../../src/tools/code-search.ts";
import type { GuidanceOverride } from "../../src/config.ts";
import type { ContentStore } from "../../src/storage.ts";

function mockStore(): ContentStore {
  return {
    store: vi.fn().mockReturnValue("content-id"),
    get: vi.fn().mockReturnValue(undefined),
    restore: vi.fn(),
  } as unknown as ContentStore;
}

describe("prompt guidance overrides", () => {
  it("web_search uses custom promptSnippet when provided", () => {
    const guidance: GuidanceOverride = {
      promptSnippet: "Custom search snippet",
    };
    const tool = createWebSearchTool(
      () => { throw new Error("not called"); },
      undefined,
      guidance,
    );
    expect(tool.promptSnippet).toBe("Custom search snippet");
  });

  it("web_search uses custom promptGuidelines when provided", () => {
    const guidance: GuidanceOverride = {
      promptGuidelines: ["Guideline A", "Guideline B"],
    };
    const tool = createWebSearchTool(
      () => { throw new Error("not called"); },
      undefined,
      guidance,
    );
    expect(tool.promptGuidelines).toEqual(["Guideline A", "Guideline B"]);
  });

  it("web_search uses defaults when no guidance provided", () => {
    const tool = createWebSearchTool(
      () => { throw new Error("not called"); },
    );
    expect(tool.promptSnippet).toBe(
      "Search the web for up-to-date information.",
    );
    expect(tool.promptGuidelines!.length).toBeGreaterThan(0);
  });

  it("web_search uses defaults when guidance fields are undefined", () => {
    const guidance: GuidanceOverride = {};
    const tool = createWebSearchTool(
      () => { throw new Error("not called"); },
      undefined,
      guidance,
    );
    expect(tool.promptSnippet).toBe(
      "Search the web for up-to-date information.",
    );
  });

  it("web_fetch uses custom promptSnippet when provided", () => {
    const guidance: GuidanceOverride = {
      promptSnippet: "Custom fetch snippet",
    };
    // guidance is the 4th parameter: (store, resolveFetchCandidates, cache, guidance)
    const tool = createWebFetchTool(mockStore(), undefined, undefined, guidance);
    expect(tool.promptSnippet).toBe("Custom fetch snippet");
  });

  it("web_fetch uses defaults when no guidance provided", () => {
    const tool = createWebFetchTool(mockStore());
    expect(tool.promptSnippet).toBe(
      "Fetch a URL and extract readable content as markdown. Supports HTML pages.",
    );
  });

  it("web_read uses custom promptSnippet when provided", () => {
    const guidance: GuidanceOverride = {
      promptSnippet: "Custom read snippet",
    };
    const tool = createWebReadTool(mockStore(), guidance);
    expect(tool.promptSnippet).toBe("Custom read snippet");
  });

  it("web_read uses defaults when no guidance provided", () => {
    const tool = createWebReadTool(mockStore());
    expect(tool.promptSnippet).toBe(
      "Retrieve previously fetched web content by its content ID without re-fetching.",
    );
  });

  it("code_search uses custom promptGuidelines when provided", () => {
    const guidance: GuidanceOverride = {
      promptGuidelines: ["Custom code guideline"],
    };
    const tool = createCodeSearchTool(
      () => undefined,
      undefined,
      guidance,
    );
    expect(tool.promptGuidelines).toEqual(["Custom code guideline"]);
  });

  it("code_search uses defaults when no guidance provided", () => {
    const tool = createCodeSearchTool(() => undefined);
    expect(tool.promptSnippet).toBe(
      "Search code, library APIs, and technical documentation across the web.",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tools/guidance.test.ts`
Expected: FAIL — tool creation functions do not accept a `guidance` parameter

- [ ] **Step 3: Add `guidance` parameter to `createWebSearchTool`**

In `src/tools/web-search.ts`, add the import after the existing imports (after line 5):

```ts
import type { GuidanceOverride } from "../config.ts";
```

Replace the function signature (lines 89-92):

Replace:
```ts
export function createWebSearchTool(
  resolveCandidates: (name?: string) => SearchProvider[],
  onSuccess?: (providerName: string) => void,
): ToolDefinition<typeof WebSearchParams, WebSearchDetails> {
```

With:
```ts
export function createWebSearchTool(
  resolveCandidates: (name?: string) => SearchProvider[],
  onSuccess?: (providerName: string) => void,
  guidance?: GuidanceOverride,
): ToolDefinition<typeof WebSearchParams, WebSearchDetails> {
```

Replace the hardcoded promptSnippet and promptGuidelines (lines 97-102):

Replace:
```ts
    promptSnippet: "Search the web for up-to-date information.",
    promptGuidelines: [
      "Use web_search for information beyond training data -- recent events, current library versions, live API docs.",
      "After answering, include a Sources: section listing relevant URLs as markdown hyperlinks.",
      "Use one web_search call per search angle rather than batching multiple queries.",
    ],
```

With:
```ts
    promptSnippet: guidance?.promptSnippet ?? "Search the web for up-to-date information.",
    promptGuidelines: guidance?.promptGuidelines ?? [
      "Use web_search for information beyond training data -- recent events, current library versions, live API docs.",
      "After answering, include a Sources: section listing relevant URLs as markdown hyperlinks.",
      "Use one web_search call per search angle rather than batching multiple queries.",
    ],
```

- [ ] **Step 4: Add `guidance` parameter to `createWebFetchTool`**

In `src/tools/web-fetch.ts`, add the import after line 9 (`import type { ContentCache } from "../cache.ts";`):

```ts
import type { GuidanceOverride } from "../config.ts";
```

Replace the function signature (lines 80-84):

Replace:
```ts
export function createWebFetchTool(
  store: ContentStore,
  resolveFetchCandidates?: () => FetchProvider[],
  cache?: ContentCache,
): ToolDefinition<typeof WebFetchParams, WebFetchDetails> {
```

With:
```ts
export function createWebFetchTool(
  store: ContentStore,
  resolveFetchCandidates?: () => FetchProvider[],
  cache?: ContentCache,
  guidance?: GuidanceOverride,
): ToolDefinition<typeof WebFetchParams, WebFetchDetails> {
```

Replace the hardcoded promptSnippet and promptGuidelines (lines 162-167):

Replace:
```ts
    promptSnippet:
      "Fetch a URL and extract readable content as markdown. Supports HTML pages.",
    promptGuidelines: [
      "Use web_fetch when you have a specific URL to read.",
      "For large pages, use web_read with the returned contentId to retrieve the full text.",
    ],
```

With:
```ts
    promptSnippet: guidance?.promptSnippet ??
      "Fetch a URL and extract readable content as markdown. Supports HTML pages.",
    promptGuidelines: guidance?.promptGuidelines ?? [
      "Use web_fetch when you have a specific URL to read.",
      "For large pages, use web_read with the returned contentId to retrieve the full text.",
    ],
```

- [ ] **Step 5: Add `guidance` parameter to `createWebReadTool`**

In `src/tools/web-read.ts`, add the import after line 4 (`import type { ContentStore } from "../storage.ts";`):

```ts
import type { GuidanceOverride } from "../config.ts";
```

Replace the function signature (lines 10-12):

Replace:
```ts
export function createWebReadTool(
  store: ContentStore,
): ToolDefinition<typeof WebReadParams> {
```

With:
```ts
export function createWebReadTool(
  store: ContentStore,
  guidance?: GuidanceOverride,
): ToolDefinition<typeof WebReadParams> {
```

Replace the hardcoded promptSnippet (lines 18-19):

Replace:
```ts
    promptSnippet:
      "Retrieve previously fetched web content by its content ID without re-fetching.",
```

With:
```ts
    promptSnippet: guidance?.promptSnippet ??
      "Retrieve previously fetched web content by its content ID without re-fetching.",
```

- [ ] **Step 6: Add `guidance` parameter to `createCodeSearchTool`**

In `src/tools/code-search.ts`, add the import after line 5 (`import { sanitizeError } from "../utils/errors.ts";`):

```ts
import type { GuidanceOverride } from "../config.ts";
```

Replace the function signature (lines 29-32):

Replace:
```ts
export function createCodeSearchTool(
  resolveProvider: () => CodeSearchProvider | undefined,
  onSuccess?: (providerName: string) => void,
): ToolDefinition<typeof CodeSearchParams, CodeSearchDetails> {
```

With:
```ts
export function createCodeSearchTool(
  resolveProvider: () => CodeSearchProvider | undefined,
  onSuccess?: (providerName: string) => void,
  guidance?: GuidanceOverride,
): ToolDefinition<typeof CodeSearchParams, CodeSearchDetails> {
```

Replace the hardcoded promptSnippet and promptGuidelines (lines 38-42):

Replace:
```ts
    promptSnippet:
      "Search code, library APIs, and technical documentation across the web.",
    promptGuidelines: [
      "Use code_search for finding code examples, library documentation, and API references.",
      "Prefer code_search over web_search for programming-related queries.",
    ],
```

With:
```ts
    promptSnippet: guidance?.promptSnippet ??
      "Search code, library APIs, and technical documentation across the web.",
    promptGuidelines: guidance?.promptGuidelines ?? [
      "Use code_search for finding code examples, library documentation, and API references.",
      "Prefer code_search over web_search for programming-related queries.",
    ],
```

- [ ] **Step 7: Update `src/index.ts` to pass guidance overrides**

Replace the tool registration block (lines 169-183):

Replace:
```ts
  pi.registerTool(
    createWebSearchTool(
      (name) => registry.selectSearchCandidates(name),
      (providerName) => registry.recordUsage(providerName),
    ),
  );
  const fetchCache = new ContentCache(200, 5 * 60_000);
  pi.registerTool(createWebFetchTool(store, () => registry.selectFetchCandidates(), fetchCache));
  pi.registerTool(createWebReadTool(store));
  pi.registerTool(
    createCodeSearchTool(
      () => registry.selectCodeSearch(),
      (providerName) => registry.recordUsage(providerName),
    ),
  );
```

With:
```ts
  pi.registerTool(
    createWebSearchTool(
      (name) => registry.selectSearchCandidates(name),
      (providerName) => registry.recordUsage(providerName),
      config.guidance?.web_search,
    ),
  );
  const fetchCache = new ContentCache(200, 5 * 60_000);
  pi.registerTool(
    createWebFetchTool(
      store,
      () => registry.selectFetchCandidates(),
      fetchCache,
      config.guidance?.web_fetch,
    ),
  );
  pi.registerTool(createWebReadTool(store, config.guidance?.web_read));
  pi.registerTool(
    createCodeSearchTool(
      () => registry.selectCodeSearch(),
      (providerName) => registry.recordUsage(providerName),
      config.guidance?.code_search,
    ),
  );
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run tests/tools/guidance.test.ts`
Expected: All tests PASS

- [ ] **Step 9: Run existing tool tests to verify no regressions**

Run: `npx vitest run tests/tools/`
Expected: All tests PASS

- [ ] **Step 10: Commit**

```bash
git add src/tools/web-search.ts src/tools/web-fetch.ts src/tools/web-read.ts src/tools/code-search.ts src/index.ts tests/tools/guidance.test.ts
git commit -m "feat: add prompt guidance overrides to all tool creation functions"
```

---

### Task 7: `/tools --status` command (display only)

**Context:** The slash command API uses `pi.registerCommand(name, options)` where the handler receives `(args: string, ctx: ExtensionCommandContext)`. Note `args` is a **single string** (the text after the command name), not an array. The handler must parse the string itself.

**Files:**
- Create: `src/commands/tools.ts`
- Create: `tests/commands/tools.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/commands/tools.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import { createToolsCommand } from "../../src/commands/tools.ts";
import { ProviderRegistry } from "../../src/providers/registry.ts";
import { UsageTracker } from "../../src/providers/usage.ts";
import type { SearchProvider, ProviderTier } from "../../src/providers/types.ts";
import { makeCtx } from "../helpers.ts";

vi.mock("node:fs");

function mockProvider(name: string, label: string): SearchProvider {
  return {
    name,
    label,
    search: vi.fn().mockResolvedValue([]),
  };
}

describe("tools --status command", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
  });

  it("displays provider status table with metrics", async () => {
    const tracker = new UsageTracker();
    const registry = new ProviderRegistry(tracker);
    const brave = mockProvider("brave", "Brave");
    const exa = mockProvider("exa", "Exa");
    const ddg = mockProvider("duckduckgo", "DuckDuckGo");

    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
    registry.registerSearch(exa, { tier: 1, monthlyQuota: 1000 });
    registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

    // Simulate some usage
    registry.recordUsage("brave");
    registry.recordSuccess("brave", 340);
    registry.recordSuccess("brave", 340);
    registry.recordFailure("brave");
    registry.recordSuccess("exa", 520);

    const tierMap = new Map<string, ProviderTier>([
      ["brave", 1],
      ["exa", 1],
      ["duckduckgo", 3],
    ]);

    const command = createToolsCommand(registry, tierMap);
    const ctx = makeCtx();

    // handler receives args as a single string
    await command.handler("--status", ctx);

    expect(ctx.ui.notify).toHaveBeenCalled();
    const output = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;

    // Should contain provider names
    expect(output).toContain("brave");
    expect(output).toContain("exa");
    expect(output).toContain("duckduckgo");
    // Should contain tier info
    expect(output).toContain("1");
    expect(output).toContain("3");
    // Should contain session stats for brave
    expect(output).toContain("2/1"); // 2 successes, 1 failure
    // Should contain remaining for brave (2000 - 1 = 1999)
    expect(output).toContain("1,999");
    // Should show unlimited for ddg
    expect(output).toMatch(/unlimited/i);
  });

  it("shows -- for avg latency when no successful calls", async () => {
    const tracker = new UsageTracker();
    const registry = new ProviderRegistry(tracker);
    const ddg = mockProvider("duckduckgo", "DuckDuckGo");
    registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

    const tierMap = new Map<string, ProviderTier>([["duckduckgo", 3]]);
    const command = createToolsCommand(registry, tierMap);
    const ctx = makeCtx();

    await command.handler("--status", ctx);

    const output = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(output).toContain("--");
  });

  it("handles empty registry gracefully", async () => {
    const tracker = new UsageTracker();
    const registry = new ProviderRegistry(tracker);
    const tierMap = new Map<string, ProviderTier>();

    const command = createToolsCommand(registry, tierMap);
    const ctx = makeCtx();

    await command.handler("--status", ctx);

    expect(ctx.ui.notify).toHaveBeenCalled();
    const output = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(output).toContain("No providers registered");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/commands/tools.test.ts`
Expected: FAIL — `src/commands/tools.ts` does not exist

- [ ] **Step 3: Implement the `/tools --status` command**

Create directory and file. Create `src/commands/tools.ts`:

```ts
import type { ProviderRegistry } from "../providers/registry.ts";
import type { ProviderTier } from "../providers/types.ts";

export interface ToolsCommand {
  name: string;
  description: string;
  handler: (args: string, ctx: { ui: { notify: (msg: string) => void; confirm: (title: string, message: string) => Promise<boolean>; input: (title: string, placeholder?: string) => Promise<string | undefined>; select: (title: string, options: string[]) => Promise<string | undefined> } }) => Promise<void>;
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "unlimited";
  return n.toLocaleString("en-US");
}

function padRight(str: string, len: number): string {
  return str + " ".repeat(Math.max(0, len - str.length));
}

function padLeft(str: string, len: number): string {
  return " ".repeat(Math.max(0, len - str.length)) + str;
}

function buildStatusTable(
  registry: ProviderRegistry,
  tierMap: ReadonlyMap<string, ProviderTier>,
): string {
  const names = registry.getSearchProviderNames();
  if (names.length === 0) return "No providers registered.";

  const rows: Array<{
    name: string;
    tier: string;
    remaining: string;
    session: string;
    latency: string;
  }> = [];

  for (const name of names) {
    const tier = tierMap.get(name) ?? 3;
    const remaining = registry.getRemaining(name);
    const metrics = registry.getMetrics(name);

    const successes = metrics?.successes ?? 0;
    const failures = metrics?.failures ?? 0;
    const sessionStr = `${successes}/${failures}`;

    let latencyStr = "--";
    if (metrics && metrics.successes > 0) {
      const avgMs = Math.round(metrics.totalLatencyMs / metrics.successes);
      latencyStr = `${avgMs}ms`;
    }

    rows.push({
      name,
      tier: String(tier),
      remaining: formatNumber(remaining),
      session: sessionStr,
      latency: latencyStr,
    });
  }

  const headers = {
    name: "Provider",
    tier: "Tier",
    remaining: "Remaining",
    session: "Session (ok/fail)",
    latency: "Avg Latency",
  };

  const colWidths = {
    name: Math.max(headers.name.length, ...rows.map((r) => r.name.length)),
    tier: Math.max(headers.tier.length, ...rows.map((r) => r.tier.length)),
    remaining: Math.max(headers.remaining.length, ...rows.map((r) => r.remaining.length)),
    session: Math.max(headers.session.length, ...rows.map((r) => r.session.length)),
    latency: Math.max(headers.latency.length, ...rows.map((r) => r.latency.length)),
  };

  const sep = "  ";
  const headerLine = [
    padRight(headers.name, colWidths.name),
    padRight(headers.tier, colWidths.tier),
    padLeft(headers.remaining, colWidths.remaining),
    padLeft(headers.session, colWidths.session),
    padLeft(headers.latency, colWidths.latency),
  ].join(sep);

  const divider = "-".repeat(headerLine.length);

  const dataLines = rows.map((r) =>
    [
      padRight(r.name, colWidths.name),
      padRight(r.tier, colWidths.tier),
      padLeft(r.remaining, colWidths.remaining),
      padLeft(r.session, colWidths.session),
      padLeft(r.latency, colWidths.latency),
    ].join(sep),
  );

  return [headerLine, divider, ...dataLines].join("\n");
}

export function createToolsCommand(
  registry: ProviderRegistry,
  tierMap: ReadonlyMap<string, ProviderTier>,
  allProviderNames?: string[],
): ToolsCommand {
  return {
    name: "tools",
    description: "Manage search/fetch providers. Use --status to see provider status.",
    async handler(args, ctx) {
      if (args.includes("--status")) {
        const table = buildStatusTable(registry, tierMap);
        ctx.ui.notify(table);
        return;
      }

      // Default: interactive setup (implemented in Task 8)
      ctx.ui.notify("Interactive provider setup is not yet implemented. Use /tools --status to view provider status.");
    },
  };
}
```

- [ ] **Step 4: Register the command in `src/index.ts`**

Add the import at the top of `src/index.ts`, after line 24 (`import { createCodeSearchTool } from "./tools/code-search.ts";`):

```ts
import { createToolsCommand } from "./commands/tools.ts";
```

Update the types import on line 20:

Replace:
```ts
import type { FetchProvider, SearchProvider, CodeSearchProvider } from "./providers/types.ts";
```

With:
```ts
import type { FetchProvider, SearchProvider, CodeSearchProvider, ProviderTier } from "./providers/types.ts";
```

Add the command registration after the tool registrations (before the closing `}` of `createExtension`, which is at line 184):

```ts
  // Build tier map for status display
  const tierMap = new Map<string, ProviderTier>();
  for (const [name, factory] of Object.entries(providerFactories)) {
    tierMap.set(name, factory.tier);
  }

  // Register /tools command
  const allProviderNames = Object.keys(providerFactories);
  const toolsCommand = createToolsCommand(registry, tierMap, allProviderNames);
  pi.registerCommand(toolsCommand.name, {
    description: toolsCommand.description,
    handler: toolsCommand.handler,
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/commands/tools.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Run full test suite to verify no regressions**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/commands/tools.ts tests/commands/tools.test.ts src/index.ts
git commit -m "feat: add /tools --status command with provider status table"
```

---

### Task 8: `/tools` interactive setup command

**Context:** The `ui.select` API only supports single-select with plain `string[]` options — no multi-select, no `{ label, value }` objects. The interactive setup uses `ui.confirm` (yes/no) per provider instead, then `ui.input` for API keys, then `ui.select` for the default provider.

**Files:**
- Modify: `src/commands/tools.ts`
- Modify: `tests/commands/tools.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/commands/tools.test.ts`, after the `"tools --status command"` describe block:

```ts
import { getConfigPath } from "../../src/config.ts";

describe("tools interactive setup", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  it("prompts to enable each provider via confirm", async () => {
    const tracker = new UsageTracker();
    const registry = new ProviderRegistry(tracker);
    const tierMap = new Map<string, ProviderTier>();
    const allProviderNames = ["brave", "duckduckgo"];

    const command = createToolsCommand(registry, tierMap, allProviderNames);
    const ctx = makeCtx();

    // Enable brave, skip duckduckgo
    vi.mocked(ctx.ui.confirm)
      .mockResolvedValueOnce(true)   // brave: yes
      .mockResolvedValueOnce(false); // duckduckgo: no
    // API key for brave
    vi.mocked(ctx.ui.input).mockResolvedValueOnce("test-brave-key");
    // Default provider
    vi.mocked(ctx.ui.select).mockResolvedValueOnce("auto");

    await command.handler("", ctx);

    // Should have asked about both providers
    expect(ctx.ui.confirm).toHaveBeenCalledTimes(2);
  });

  it("writes config to global config path", async () => {
    const tracker = new UsageTracker();
    const registry = new ProviderRegistry(tracker);
    const tierMap = new Map<string, ProviderTier>();
    const allProviderNames = ["brave", "duckduckgo"];

    const command = createToolsCommand(registry, tierMap, allProviderNames);
    const ctx = makeCtx();

    // Enable brave only
    vi.mocked(ctx.ui.confirm)
      .mockResolvedValueOnce(true)   // brave: yes
      .mockResolvedValueOnce(false); // duckduckgo: no
    vi.mocked(ctx.ui.input).mockResolvedValueOnce("test-key-123");
    vi.mocked(ctx.ui.select).mockResolvedValueOnce("auto");

    await command.handler("", ctx);

    // Should write to global config path
    expect(fs.writeFileSync).toHaveBeenCalled();
    const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
    const [writePath, writeContent] = writeCalls[writeCalls.length - 1];
    expect(writePath).toBe(getConfigPath());

    const written = JSON.parse(writeContent as string);
    expect(written.defaultProvider).toBe("auto");
    expect(written.providers.brave.enabled).toBe(true);
    expect(written.providers.brave.apiKey).toBe("test-key-123");
    expect(written.providers.duckduckgo.enabled).toBe(false);
  });

  it("notifies user on successful save", async () => {
    const tracker = new UsageTracker();
    const registry = new ProviderRegistry(tracker);
    const tierMap = new Map<string, ProviderTier>();
    const allProviderNames = ["brave"];

    const command = createToolsCommand(registry, tierMap, allProviderNames);
    const ctx = makeCtx();

    vi.mocked(ctx.ui.confirm).mockResolvedValueOnce(true);
    vi.mocked(ctx.ui.input).mockResolvedValueOnce("my-key");
    vi.mocked(ctx.ui.select).mockResolvedValueOnce("auto");

    await command.handler("", ctx);

    // Should notify success
    const notifyCalls = vi.mocked(ctx.ui.notify).mock.calls;
    const lastNotify = notifyCalls[notifyCalls.length - 1][0] as string;
    expect(lastNotify.toLowerCase()).toContain("saved");
  });

  it("handles no providers available", async () => {
    const tracker = new UsageTracker();
    const registry = new ProviderRegistry(tracker);
    const tierMap = new Map<string, ProviderTier>();

    const command = createToolsCommand(registry, tierMap, []);
    const ctx = makeCtx();

    await command.handler("", ctx);

    const output = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(output).toContain("No providers available");
  });

  it("skips API key prompt for providers the user disables", async () => {
    const tracker = new UsageTracker();
    const registry = new ProviderRegistry(tracker);
    const tierMap = new Map<string, ProviderTier>();
    const allProviderNames = ["brave", "exa"];

    const command = createToolsCommand(registry, tierMap, allProviderNames);
    const ctx = makeCtx();

    // Disable both providers
    vi.mocked(ctx.ui.confirm)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    vi.mocked(ctx.ui.select).mockResolvedValueOnce("auto");

    await command.handler("", ctx);

    // Should NOT have asked for any API keys
    expect(ctx.ui.input).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/commands/tools.test.ts`
Expected: FAIL — interactive setup is not implemented (placeholder returns early)

- [ ] **Step 3: Implement interactive setup**

Replace the entire content of `src/commands/tools.ts`:

```ts
import * as fs from "node:fs";
import * as path from "node:path";
import type { ProviderRegistry } from "../providers/registry.ts";
import type { ProviderTier } from "../providers/types.ts";
import { getConfigPath } from "../config.ts";

export interface ToolsCommand {
  name: string;
  description: string;
  handler: (args: string, ctx: { ui: { notify: (msg: string) => void; confirm: (title: string, message: string) => Promise<boolean>; input: (title: string, placeholder?: string) => Promise<string | undefined>; select: (title: string, options: string[]) => Promise<string | undefined> } }) => Promise<void>;
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "unlimited";
  return n.toLocaleString("en-US");
}

function padRight(str: string, len: number): string {
  return str + " ".repeat(Math.max(0, len - str.length));
}

function padLeft(str: string, len: number): string {
  return " ".repeat(Math.max(0, len - str.length)) + str;
}

function buildStatusTable(
  registry: ProviderRegistry,
  tierMap: ReadonlyMap<string, ProviderTier>,
): string {
  const names = registry.getSearchProviderNames();
  if (names.length === 0) return "No providers registered.";

  const rows: Array<{
    name: string;
    tier: string;
    remaining: string;
    session: string;
    latency: string;
  }> = [];

  for (const name of names) {
    const tier = tierMap.get(name) ?? 3;
    const remaining = registry.getRemaining(name);
    const metrics = registry.getMetrics(name);

    const successes = metrics?.successes ?? 0;
    const failures = metrics?.failures ?? 0;
    const sessionStr = `${successes}/${failures}`;

    let latencyStr = "--";
    if (metrics && metrics.successes > 0) {
      const avgMs = Math.round(metrics.totalLatencyMs / metrics.successes);
      latencyStr = `${avgMs}ms`;
    }

    rows.push({
      name,
      tier: String(tier),
      remaining: formatNumber(remaining),
      session: sessionStr,
      latency: latencyStr,
    });
  }

  const headers = {
    name: "Provider",
    tier: "Tier",
    remaining: "Remaining",
    session: "Session (ok/fail)",
    latency: "Avg Latency",
  };

  const colWidths = {
    name: Math.max(headers.name.length, ...rows.map((r) => r.name.length)),
    tier: Math.max(headers.tier.length, ...rows.map((r) => r.tier.length)),
    remaining: Math.max(headers.remaining.length, ...rows.map((r) => r.remaining.length)),
    session: Math.max(headers.session.length, ...rows.map((r) => r.session.length)),
    latency: Math.max(headers.latency.length, ...rows.map((r) => r.latency.length)),
  };

  const sep = "  ";
  const headerLine = [
    padRight(headers.name, colWidths.name),
    padRight(headers.tier, colWidths.tier),
    padLeft(headers.remaining, colWidths.remaining),
    padLeft(headers.session, colWidths.session),
    padLeft(headers.latency, colWidths.latency),
  ].join(sep);

  const divider = "-".repeat(headerLine.length);

  const dataLines = rows.map((r) =>
    [
      padRight(r.name, colWidths.name),
      padRight(r.tier, colWidths.tier),
      padLeft(r.remaining, colWidths.remaining),
      padLeft(r.session, colWidths.session),
      padLeft(r.latency, colWidths.latency),
    ].join(sep),
  );

  return [headerLine, divider, ...dataLines].join("\n");
}

async function handleInteractiveSetup(
  ctx: ToolsCommand["handler"] extends (args: string, ctx: infer C) => unknown ? C : never,
  allProviderNames: string[],
): Promise<void> {
  if (allProviderNames.length === 0) {
    ctx.ui.notify("No providers available for configuration.");
    return;
  }

  // Step 1: Ask about each provider
  const providers: Record<string, { enabled: boolean; apiKey?: string }> = {};
  const enabledNames: string[] = [];

  for (const name of allProviderNames) {
    const enabled = await ctx.ui.confirm("Provider setup", `Enable ${name}?`);
    providers[name] = { enabled };

    if (enabled) {
      enabledNames.push(name);
      const apiKey = await ctx.ui.input(`API key for ${name}`, "Leave empty to skip");
      if (apiKey && apiKey.trim().length > 0) {
        providers[name].apiKey = apiKey.trim();
      }
    }
  }

  // Step 2: Select default provider
  const defaultOptions = ["auto", ...enabledNames];
  const defaultProvider = (await ctx.ui.select("Default provider:", defaultOptions)) ?? "auto";

  // Step 3: Build and write config
  const config = {
    defaultProvider,
    providers,
  };

  const configPath = getConfigPath();
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    ctx.ui.notify(`Configuration saved to ${configPath}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`Failed to save configuration: ${msg}`);
  }
}

export function createToolsCommand(
  registry: ProviderRegistry,
  tierMap: ReadonlyMap<string, ProviderTier>,
  allProviderNames?: string[],
): ToolsCommand {
  return {
    name: "tools",
    description: "Manage search/fetch providers. Use --status to see provider status.",
    async handler(args, ctx) {
      if (args.includes("--status")) {
        const table = buildStatusTable(registry, tierMap);
        ctx.ui.notify(table);
        return;
      }

      await handleInteractiveSetup(ctx, allProviderNames ?? []);
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/commands/tools.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands/tools.ts tests/commands/tools.test.ts
git commit -m "feat: add /tools interactive setup command"
```

---

### Task 9: Full regression test

**Files:** None (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: All tests PASS across all test files

- [ ] **Step 2: Run type checking**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Verify all new exports are used**

Check that:
- `deepMerge` is imported in `src/config.ts`
- `findProjectConfigPath` and `loadMergedConfig` are exported from `src/config.ts`
- `ProviderMetrics` is exported from `src/providers/registry.ts`
- `selectSearchByPerformance` is available on `ProviderRegistry`
- `GuidanceOverride` and `SelectionStrategy` are exported from `src/config.ts`
- `createToolsCommand` is imported in `src/index.ts`
- `ProviderTier` is imported in `src/index.ts`

Run: `npx vitest run && npx tsc --noEmit`
Expected: Clean pass on both

- [ ] **Step 4: Final commit if any cleanup was needed**

```bash
git add -A
git commit -m "chore: phase 6 cleanup and regression verification"
```
