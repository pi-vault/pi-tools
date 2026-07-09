# Phase 3: Config Schema + Registry Methods

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `CombineConfig` to the config system and `selectSearchForFusion()`/`selectSearchByPerformanceAll()` to the provider registry. These are the config and selection plumbing that Phase 4 will wire into the web_search tool.

**Architecture:** Extend existing `PiToolsConfig` with a `combine` field. Add two new methods to `ProviderRegistry` that return ordered lists of multiple providers for fusion (reusing existing scoring/filtering logic).

**Tech Stack:** TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-07-08-multi-provider-fusion-rrf-design.md` (sections "Config Schema" and "Registry Changes")

**Prerequisite:** None (can run in parallel with Phases 1-2 if desired, since it only extends existing files)

---

### Task 1: Add CombineConfig type and defaults

**Files:**

- Modify: `src/config.ts`

- [ ] **Step 1: Add the CombineConfig interface and update PiToolsConfig**

In `src/config.ts`, after the `SsrfConfig` interface, add:

```typescript
export interface CombineConfig {
  enabled: boolean;
  mode: "targeted" | "all";
  targetBackends: number;
  k: number;
}
```

Add `combine: CombineConfig;` to the `PiToolsConfig` interface (after the `ssrf` field):

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

Add a default constant:

```typescript
export const DEFAULT_COMBINE_CONFIG: CombineConfig = {
  enabled: false,
  mode: "targeted",
  targetBackends: 3,
  k: 60,
};
```

Update `DEFAULT_CONFIG` to include `combine`:

```typescript
const DEFAULT_CONFIG: PiToolsConfig = {
  // ... existing fields ...
  ssrf: { allowRanges: [] },
  combine: DEFAULT_COMBINE_CONFIG,
};
```

Update `parseConfigFile` to include `combine`:

```typescript
function parseConfigFile(raw: string): PiToolsConfig {
  const parsed = JSON.parse(raw);
  // ... existing parsing ...
  return {
    // ... existing fields ...
    ssrf: validateSsrfConfig(parsed.ssrf),
    combine: {
      ...DEFAULT_COMBINE_CONFIG,
      ...parsed.combine,
    },
  };
}
```

- [ ] **Step 2: Run typecheck to verify no errors**

Run: `pnpm typecheck`
Expected: PASS — all existing code that uses `PiToolsConfig` should still work because `combine` has a default.

- [ ] **Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat(config): add CombineConfig type and defaults"
```

---

### Task 2: Write failing test for config loading with combine

**Files:**

- Modify: `tests/config.test.ts`

- [ ] **Step 4: Add test for combine config loading**

Add to the existing `describe` block in `tests/config.test.ts`:

```typescript
it("loads combine config with defaults when not specified", () => {
  const config = loadConfig(tmpFile("{}"));
  expect(config.combine).toEqual({
    enabled: false,
    mode: "targeted",
    targetBackends: 3,
    k: 60,
  });
});

it("merges partial combine config with defaults", () => {
  const config = loadConfig(
    tmpFile(JSON.stringify({ combine: { enabled: true, targetBackends: 5 } })),
  );
  expect(config.combine.enabled).toBe(true);
  expect(config.combine.mode).toBe("targeted"); // default preserved
  expect(config.combine.targetBackends).toBe(5);
  expect(config.combine.k).toBe(60); // default preserved
});
```

Note: Check how `tmpFile` is defined in the existing test file. It likely writes a temp JSON file and returns the path. Match that pattern.

- [ ] **Step 5: Run the config tests**

Run: `pnpm vitest run tests/config.test.ts`
Expected: PASS — the implementation from Step 1 should already handle this.

- [ ] **Step 6: Commit**

```bash
git add tests/config.test.ts
git commit -m "test(config): add CombineConfig loading tests"
```

---

### Task 3: Write failing tests for selectSearchByPerformanceAll

**Files:**

- Modify: `tests/providers/registry.test.ts`

- [ ] **Step 7: Add tests for selectSearchByPerformanceAll**

Add a new describe block inside the main `describe("ProviderRegistry")`:

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
    // brave should be first (best score), exa or ddg after
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

- [ ] **Step 8: Run tests to verify they fail**

Run: `pnpm vitest run tests/providers/registry.test.ts`
Expected: FAIL — `selectSearchByPerformanceAll` does not exist on `ProviderRegistry`

---

### Task 4: Implement selectSearchByPerformanceAll

**Files:**

- Modify: `src/providers/registry.ts`

- [ ] **Step 9: Add selectSearchByPerformanceAll method**

Add after the existing `selectSearchByPerformance` method in `ProviderRegistry`:

```typescript
  selectSearchByPerformanceAll(): SearchProvider[] {
    const eligible = [...this.searchProviders.values()].filter((r) => {
      if (r.monthlyQuota === null) return true;
      return (this.counts[r.provider.name] ?? 0) < r.monthlyQuota;
    });

    if (eligible.length === 0) return [];

    const scored = eligible.map((r) => {
      const m = this.getActiveMetrics(r.provider.name);

      if (!m || m.successes + m.failures === 0) {
        return { provider: r.provider, score: 0.5 };
      }

      const total = m.successes + m.failures;
      const successRate = m.successes / total;
      const avgLatency = m.latencySamples > 0 ? m.avgLatency : Infinity;
      const qualityScore = m.resultSamples > 0 ? m.avgResultRatio : 0.5;

      return { provider: r.provider, score: 0, avgLatency, successRate, qualityScore };
    });

    const latencies = scored
      .filter((s) => "avgLatency" in s && s.avgLatency !== Infinity)
      .map((s) => (s as { avgLatency: number }).avgLatency);
    const maxLatency = latencies.length > 0 ? Math.max(...latencies) : 1;

    for (const s of scored) {
      if ("successRate" in s && s.successRate !== undefined) {
        const speedScore =
          s.avgLatency === Infinity ? 0 : Math.max(0, 1 - s.avgLatency / (maxLatency || 1));
        s.score = s.successRate * 0.5 + speedScore * 0.3 + s.qualityScore! * 0.2;
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.provider);
  }
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `pnpm vitest run tests/providers/registry.test.ts`
Expected: All tests PASS

- [ ] **Step 11: Commit**

```bash
git add src/providers/registry.ts tests/providers/registry.test.ts
git commit -m "feat(registry): add selectSearchByPerformanceAll returning scored provider list"
```

---

### Task 5: Write failing tests for selectSearchForFusion

**Files:**

- Modify: `tests/providers/registry.test.ts`

- [ ] **Step 12: Add tests for selectSearchForFusion**

Add a new describe block:

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

- [ ] **Step 13: Run tests to verify they fail**

Run: `pnpm vitest run tests/providers/registry.test.ts`
Expected: FAIL — `selectSearchForFusion` does not exist

---

### Task 6: Implement selectSearchForFusion

**Files:**

- Modify: `src/providers/registry.ts`

- [ ] **Step 14: Add selectSearchForFusion method and import SelectionStrategy**

Add to the top of `src/providers/registry.ts`:

```typescript
import type { SelectionStrategy } from "../config.ts";
```

Add the method after `selectSearchByPerformanceAll`:

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

- [ ] **Step 15: Run tests to verify they pass**

Run: `pnpm vitest run tests/providers/registry.test.ts`
Expected: All tests PASS

- [ ] **Step 16: Commit**

```bash
git add src/providers/registry.ts tests/providers/registry.test.ts
git commit -m "feat(registry): add selectSearchForFusion dispatching by strategy"
```

---

### Task 7: Run full test suite for regression check

- [ ] **Step 17: Run the full test suite**

Run: `pnpm check`
Expected: All tests pass, no lint errors, no type errors. Existing behavior unchanged.
