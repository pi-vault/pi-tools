# Phase 3: Config Schema + Registry Methods

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `CombineConfig` to the config system and `selectSearchForFusion()`/`selectSearchByPerformanceAll()` to the provider registry. These are the config and selection plumbing that Phase 4 will wire into the web_search tool.

**Architecture:** Extend existing `PiToolsConfig` with a `combine` field parsed through a validation function (matching the `validateSsrfConfig` pattern). Extract the scoring logic from `selectSearchByPerformance` into a shared private method, then add `selectSearchByPerformanceAll` and `selectSearchForFusion` on top of it.

**Tech Stack:** TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-07-08-multi-provider-fusion-rrf-design.md` (sections "Config Schema" and "Registry Changes")

**Prerequisite:** None (can run in parallel with Phases 1-2 if desired, since it only extends existing files)

---

### Task 1: Add CombineConfig type, defaults, and validated parsing

**Files:**

- Modify: `src/config.ts`

- [ ] **Step 1: Add the CombineConfig interface, default constant, and update PiToolsConfig**

In `src/config.ts`, after the `SsrfConfig` interface (line 31), add the `CombineConfig` interface:

```typescript
export interface CombineConfig {
  enabled: boolean;
  mode: "targeted" | "all";
  targetBackends: number;
  k: number;
}
```

Add the `combine` field to the `PiToolsConfig` interface (after the `ssrf` field on line 39):

```typescript
export interface PiToolsConfig {
  defaultProvider: string;
  selectionStrategy: SelectionStrategy;
  providers: Record<string, ProviderConfigEntry>;
  github: GitHubConfig;
  guidance?: Record<string, GuidanceOverride>;
  ssrf: SsrfConfig;
  combine: CombineConfig;
}
```

Add the default constant after `DEFAULT_GITHUB_CONFIG` (after line 50):

```typescript
export const DEFAULT_COMBINE_CONFIG: CombineConfig = {
  enabled: false,
  mode: "targeted",
  targetBackends: 3,
  k: 60,
};
```

Add `combine: DEFAULT_COMBINE_CONFIG` to `DEFAULT_CONFIG` (after the `ssrf` line):

```typescript
const DEFAULT_CONFIG: PiToolsConfig = {
  // ... existing fields unchanged ...
  ssrf: { allowRanges: [] },
  combine: DEFAULT_COMBINE_CONFIG,
};
```

- [ ] **Step 2: Add the validateCombineConfig function and wire into parseConfigFile**

Add a `validateCombineConfig` function after `validateSsrfConfig` (after line 88). This validates `mode` against known values and clamps numeric fields to `>= 1`, matching how `selectionStrategy` is validated:

```typescript
function validateCombineConfig(parsed: unknown): CombineConfig {
  const raw = (parsed ?? {}) as Record<string, unknown>;
  const mode =
    raw.mode === "targeted" || raw.mode === "all"
      ? (raw.mode as CombineConfig["mode"])
      : DEFAULT_COMBINE_CONFIG.mode;

  return {
    enabled:
      typeof raw.enabled === "boolean"
        ? raw.enabled
        : DEFAULT_COMBINE_CONFIG.enabled,
    mode,
    targetBackends: Math.max(
      1,
      typeof raw.targetBackends === "number"
        ? raw.targetBackends
        : DEFAULT_COMBINE_CONFIG.targetBackends,
    ),
    k: Math.max(
      1,
      typeof raw.k === "number" ? raw.k : DEFAULT_COMBINE_CONFIG.k,
    ),
  };
}
```

Update `parseConfigFile` to use it. Add `combine: validateCombineConfig(parsed.combine),` after the `ssrf` line in the return object:

```typescript
function parseConfigFile(raw: string): PiToolsConfig {
  const parsed = JSON.parse(raw);

  const strategy =
    parsed.selectionStrategy === "auto" ||
    parsed.selectionStrategy === "best-performing"
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
    ssrf: validateSsrfConfig(parsed.ssrf),
    combine: validateCombineConfig(parsed.combine),
  };
}
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS -- all existing code that uses `PiToolsConfig` still works because `combine` has a default in `DEFAULT_CONFIG`.

- [ ] **Step 4: Commit**

```bash
git add src/config.ts
git commit -m "feat(config): add CombineConfig type with validated parsing"
```

---

### Task 2: Config loading tests for combine

**Files:**

- Modify: `tests/config.test.ts`

- [ ] **Step 5: Add CombineConfig tests**

The existing config tests mock `fs.readFileSync` via `vi.mock("node:fs")`. Add a new `describe("CombineConfig")` block after the existing `describe("config types -- selectionStrategy and guidance")` block (after line 471):

```typescript
describe("CombineConfig", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("provides default combine config when config file is missing", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const config = loadConfig();
    expect(config.combine).toEqual({
      enabled: false,
      mode: "targeted",
      targetBackends: 3,
      k: 60,
    });
  });

  it("provides default combine config when combine not in config file", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ defaultProvider: "brave" }),
    );
    const config = loadConfig();
    expect(config.combine).toEqual({
      enabled: false,
      mode: "targeted",
      targetBackends: 3,
      k: 60,
    });
  });

  it("merges partial combine config with defaults", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ combine: { enabled: true, targetBackends: 5 } }),
    );
    const config = loadConfig();
    expect(config.combine.enabled).toBe(true);
    expect(config.combine.mode).toBe("targeted"); // default preserved
    expect(config.combine.targetBackends).toBe(5);
    expect(config.combine.k).toBe(60); // default preserved
  });

  it("rejects invalid combine.mode and falls back to default", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ combine: { mode: "invalid" } }),
    );
    const config = loadConfig();
    expect(config.combine.mode).toBe("targeted");
  });

  it("accepts 'all' as a valid combine.mode", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ combine: { mode: "all" } }),
    );
    const config = loadConfig();
    expect(config.combine.mode).toBe("all");
  });

  it("clamps combine.targetBackends to minimum of 1", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ combine: { targetBackends: 0 } }),
    );
    const config = loadConfig();
    expect(config.combine.targetBackends).toBe(1);
  });

  it("clamps combine.k to minimum of 1", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ combine: { k: -5 } }),
    );
    const config = loadConfig();
    expect(config.combine.k).toBe(1);
  });

  it("ignores non-boolean enabled values", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ combine: { enabled: "yes" } }),
    );
    const config = loadConfig();
    expect(config.combine.enabled).toBe(false); // default
  });
});
```

- [ ] **Step 6: Run the config tests**

Run: `pnpm vitest run tests/config.test.ts`
Expected: All tests PASS (implementation from Task 1 already handles these).

- [ ] **Step 7: Commit**

```bash
git add tests/config.test.ts
git commit -m "test(config): add CombineConfig loading and validation tests"
```

---

### Task 3: Extract scoring into shared private method

This is a refactor-only task. The existing `selectSearchByPerformance` duplicates scoring logic that `selectSearchByPerformanceAll` also needs. Extract it into a private `scoreEligibleProviders()` method first, then verify all existing tests still pass.

**Files:**

- Modify: `src/providers/registry.ts`

- [ ] **Step 8: Add the private `scoreEligibleProviders` method**

Add this private method to `ProviderRegistry`, after `getActiveMetrics` (after line 93):

```typescript
  /**
   * Score all eligible (non-exhausted) providers by composite metric.
   *
   * Score = (success_rate * 0.5) + (speed_score * 0.3) + (quality_score * 0.2)
   *
   * Providers with no active metrics get a neutral score of 0.5.
   * Returns the full sorted array (descending by score).
   */
  private scoreEligibleProviders(): Array<{ provider: SearchProvider; score: number }> {
    const eligible = [...this.searchProviders.values()].filter((r) => {
      if (r.monthlyQuota === null) return true;
      return (this.counts[r.provider.name] ?? 0) < r.monthlyQuota;
    });

    if (eligible.length === 0) return [];

    const NEUTRAL_SCORE = 0.5;
    const metricsEntries: Array<{
      provider: SearchProvider;
      successRate: number;
      avgLatency: number;
      qualityScore: number;
    }> = [];
    const neutralEntries: Array<{ provider: SearchProvider; score: number }> = [];

    for (const r of eligible) {
      const m = this.getActiveMetrics(r.provider.name);
      if (!m || m.successes + m.failures === 0) {
        neutralEntries.push({ provider: r.provider, score: NEUTRAL_SCORE });
      } else {
        const total = m.successes + m.failures;
        metricsEntries.push({
          provider: r.provider,
          successRate: m.successes / total,
          avgLatency: m.latencySamples > 0 ? m.avgLatency : Infinity,
          qualityScore: m.resultSamples > 0 ? m.avgResultRatio : 0.5,
        });
      }
    }

    const finiteLatencies = metricsEntries
      .map((e) => e.avgLatency)
      .filter((l) => l !== Infinity);
    const maxLatency = finiteLatencies.length > 0 ? Math.max(...finiteLatencies) : 1;

    const scoredEntries = metricsEntries.map((e) => {
      const speedScore =
        e.avgLatency === Infinity
          ? 0
          : Math.max(0, 1 - e.avgLatency / (maxLatency || 1));
      return {
        provider: e.provider,
        score: e.successRate * 0.5 + speedScore * 0.3 + e.qualityScore * 0.2,
      };
    });

    return [...scoredEntries, ...neutralEntries].sort((a, b) => b.score - a.score);
  }
```

- [ ] **Step 9: Refactor `selectSearchByPerformance` to delegate to `scoreEligibleProviders`**

Replace the existing `selectSearchByPerformance` method (lines 207-251) with:

```typescript
  /**
   * Select the best search provider based on session performance metrics.
   *
   * Score = (success_rate * 0.5) + (speed_score * 0.3) + (quality_score * 0.2)
   *
   * Where:
   *   success_rate  = successes / (successes + failures)  (within rolling window)
   *   speed_score   = max(0, 1 - avg_latency / max_avg_latency)
   *   quality_score = avg_result_ratio  (results received / results requested)
   *
   * Providers with no active metrics get a neutral score of 0.5.
   */
  selectSearchByPerformance(name?: string): SearchProvider | undefined {
    if (name && name !== "auto") {
      return this.searchProviders.get(name)?.provider;
    }
    return this.scoreEligibleProviders()[0]?.provider;
  }
```

- [ ] **Step 10: Run the full registry test suite to verify no regression**

Run: `pnpm vitest run tests/providers/registry.test.ts`
Expected: All existing tests PASS. The refactor is behavior-preserving.

- [ ] **Step 11: Commit**

```bash
git add src/providers/registry.ts
git commit -m "refactor(registry): extract scoreEligibleProviders from selectSearchByPerformance"
```

---

### Task 4: Add selectSearchByPerformanceAll

**Files:**

- Modify: `tests/providers/registry.test.ts`
- Modify: `src/providers/registry.ts`

- [ ] **Step 12: Write failing tests for selectSearchByPerformanceAll**

Add a new `describe` block inside the main `describe("ProviderRegistry")` block, after the `describe("unregisterAll")` block (after line 653):

```typescript
describe("selectSearchByPerformanceAll", () => {
  it("returns all eligible providers sorted by composite score descending", () => {
    const registry = mem();
    const brave = mockProvider("brave", "Brave");
    const exa = mockProvider("exa", "Exa");
    const ddg = mockProvider("duckduckgo", "DuckDuckGo");

    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
    registry.registerSearch(exa, { tier: 1, monthlyQuota: 1000 });
    registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

    // brave: 100% success, fast
    registry.recordOutcome("brave", { success: true, latencyMs: 200 });
    registry.recordOutcome("brave", { success: true, latencyMs: 200 });

    // exa: 50% success, slow
    registry.recordOutcome("exa", { success: true, latencyMs: 800 });
    registry.recordOutcome("exa", { success: false });

    // ddg: no metrics -> neutral score 0.5
    const all = registry.selectSearchByPerformanceAll();
    expect(all.length).toBe(3);
    // brave should be first (best score)
    expect(all[0].name).toBe("brave");
  });

  it("excludes exhausted providers", () => {
    const registry = mem();
    const brave = mockProvider("brave", "Brave");
    const ddg = mockProvider("duckduckgo", "DuckDuckGo");

    registry.registerSearch(brave, { tier: 1, monthlyQuota: 1 });
    registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

    registry.recordOutcome("brave", { success: true }); // exhausted

    const all = registry.selectSearchByPerformanceAll();
    expect(all.map((p) => p.name)).toEqual(["duckduckgo"]);
  });

  it("returns empty array when no providers registered", () => {
    const registry = mem();
    expect(registry.selectSearchByPerformanceAll()).toEqual([]);
  });
});
```

- [ ] **Step 13: Run tests to verify they fail**

Run: `pnpm vitest run tests/providers/registry.test.ts`
Expected: FAIL -- `selectSearchByPerformanceAll` does not exist on `ProviderRegistry`.

- [ ] **Step 14: Implement selectSearchByPerformanceAll**

Add this method to `ProviderRegistry` after `selectSearchByPerformance`:

```typescript
  selectSearchByPerformanceAll(): SearchProvider[] {
    return this.scoreEligibleProviders().map((s) => s.provider);
  }
```

- [ ] **Step 15: Run tests to verify they pass**

Run: `pnpm vitest run tests/providers/registry.test.ts`
Expected: All tests PASS.

- [ ] **Step 16: Commit**

```bash
git add src/providers/registry.ts tests/providers/registry.test.ts
git commit -m "feat(registry): add selectSearchByPerformanceAll returning scored provider list"
```

---

### Task 5: Add selectSearchForFusion

**Files:**

- Modify: `tests/providers/registry.test.ts`
- Modify: `src/providers/registry.ts`

- [ ] **Step 17: Write failing tests for selectSearchForFusion**

Add a new `describe` block inside `describe("ProviderRegistry")`, after the `selectSearchByPerformanceAll` block:

```typescript
describe("selectSearchForFusion", () => {
  it("returns single provider when name is explicitly set", () => {
    const registry = mem();
    const brave = mockProvider("brave", "Brave");
    const ddg = mockProvider("duckduckgo", "DuckDuckGo");

    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
    registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

    const result = registry.selectSearchForFusion("auto", "duckduckgo");
    expect(result.map((p) => p.name)).toEqual(["duckduckgo"]);
  });

  it("delegates to selectSearchCandidates for 'auto' strategy", () => {
    const registry = mem();
    const brave = mockProvider("brave", "Brave");
    const ddg = mockProvider("duckduckgo", "DuckDuckGo");

    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
    registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

    const result = registry.selectSearchForFusion("auto");
    // Same order as selectSearchCandidates: tier-sorted, quota-filtered
    expect(result.map((p) => p.name)).toEqual(["brave", "duckduckgo"]);
  });

  it("delegates to selectSearchByPerformanceAll for 'best-performing' strategy", () => {
    const registry = mem();
    const brave = mockProvider("brave", "Brave");
    const ddg = mockProvider("duckduckgo", "DuckDuckGo");

    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
    registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

    // Give ddg better metrics
    registry.recordOutcome("duckduckgo", { success: true, latencyMs: 100 });
    registry.recordOutcome("duckduckgo", { success: true, latencyMs: 100 });
    registry.recordOutcome("brave", { success: true, latencyMs: 2000 });
    registry.recordOutcome("brave", { success: false });

    const result = registry.selectSearchForFusion("best-performing");
    // ddg should be first due to better performance
    expect(result[0].name).toBe("duckduckgo");
    // Both present
    expect(result).toHaveLength(2);
  });

  it("returns empty array for unknown explicit provider", () => {
    const registry = mem();
    expect(registry.selectSearchForFusion("auto", "nonexistent")).toEqual([]);
  });

  it("returns empty array when no providers registered", () => {
    const registry = mem();
    expect(registry.selectSearchForFusion("auto")).toEqual([]);
  });
});
```

- [ ] **Step 18: Run tests to verify they fail**

Run: `pnpm vitest run tests/providers/registry.test.ts`
Expected: FAIL -- `selectSearchForFusion` does not exist on `ProviderRegistry`.

- [ ] **Step 19: Implement selectSearchForFusion**

Add an import for `SelectionStrategy` at the top of `src/providers/registry.ts` (line 1):

```typescript
import type { SelectionStrategy } from "../config.ts";
```

Add the method to `ProviderRegistry` after `selectSearchByPerformanceAll`:

```typescript
  selectSearchForFusion(strategy: SelectionStrategy, name?: string): SearchProvider[] {
    if (name && name !== "auto") {
      const provider = this.searchProviders.get(name)?.provider;
      return provider ? [provider] : [];
    }
    if (strategy === "best-performing") {
      return this.selectSearchByPerformanceAll();
    }
    return this.selectSearchCandidates();
  }
```

- [ ] **Step 20: Run tests to verify they pass**

Run: `pnpm vitest run tests/providers/registry.test.ts`
Expected: All tests PASS.

- [ ] **Step 21: Commit**

```bash
git add src/providers/registry.ts tests/providers/registry.test.ts
git commit -m "feat(registry): add selectSearchForFusion dispatching by strategy"
```

---

### Task 6: Full regression check

- [ ] **Step 22: Run the full check suite**

Run: `pnpm check`
Expected: All tests pass, no lint errors, no type errors. Existing behavior unchanged.
