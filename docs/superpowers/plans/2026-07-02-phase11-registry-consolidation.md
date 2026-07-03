# Phase 11: Registry Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Absorb UsageTracker's quota counting and filesystem persistence into ProviderRegistry. One module owns all provider runtime state. Delete `usage.ts`.

**Architecture:** ProviderRegistry gains an internal `PersistenceAdapter` seam — production uses filesystem, tests use in-memory. The public method `recordOutcome(name, {success, latencyMs})` replaces the three-method pattern (`recordUsage` + `recordSuccess`/`recordFailure`). Quota counting and performance metrics are unified in one data structure.

**Tech Stack:** TypeScript 6, Vitest 4, Node 24+ fs APIs

---

## Context

Current state:
- `src/providers/usage.ts` (68 lines): monthly count tracking + filesystem persistence
- `src/providers/registry.ts` (183 lines): wraps UsageTracker + maintains separate metrics map
- Registry has thin pass-throughs: `recordUsage(name)` → `tracker.increment(name)`, `getRemaining(name)` → `tracker.getRemaining(name, quota)`

After this phase: one module, one metrics map, one persistence layer.

---

### Task 1: Add PersistenceAdapter and absorb counting into Registry

**Files:**
- Modify: `src/providers/registry.ts`
- Test: `tests/providers/registry.test.ts`

- [ ] **Step 1: Write failing test for new recordOutcome method**

Add to `tests/providers/registry.test.ts`:

```ts
describe("recordOutcome", () => {
  it("increments usage count on success", () => {
    const registry = new ProviderRegistry({ load: () => ({}), save: () => {} });
    const provider = mockProvider("brave", "Brave");
    registry.registerSearch(provider, { tier: 1, monthlyQuota: 2000 });

    registry.recordOutcome("brave", { success: true, latencyMs: 200 });

    // Should track 1 usage
    expect(registry.getRemaining("brave")).toBe(1999);
  });

  it("increments usage count on failure", () => {
    const registry = new ProviderRegistry({ load: () => ({}), save: () => {} });
    const provider = mockProvider("brave", "Brave");
    registry.registerSearch(provider, { tier: 1, monthlyQuota: 2000 });

    registry.recordOutcome("brave", { success: false });

    expect(registry.getRemaining("brave")).toBe(1999);
  });

  it("records latency for performance scoring on success", () => {
    const registry = new ProviderRegistry({ load: () => ({}), save: () => {} });
    const provider = mockProvider("brave", "Brave");
    registry.registerSearch(provider, { tier: 1, monthlyQuota: 2000 });

    registry.recordOutcome("brave", { success: true, latencyMs: 300 });

    const metrics = registry.getMetrics("brave");
    expect(metrics?.successes).toBe(1);
    expect(metrics?.totalLatencyMs).toBe(300);
  });

  it("records failure for performance scoring", () => {
    const registry = new ProviderRegistry({ load: () => ({}), save: () => {} });
    const provider = mockProvider("brave", "Brave");
    registry.registerSearch(provider, { tier: 1, monthlyQuota: 2000 });

    registry.recordOutcome("brave", { success: false });

    const metrics = registry.getMetrics("brave");
    expect(metrics?.failures).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/providers/registry.test.ts`
Expected: FAIL — `ProviderRegistry` constructor doesn't accept a persistence adapter, `recordOutcome` doesn't exist

- [ ] **Step 3: Rewrite ProviderRegistry to absorb usage tracking**

Replace `src/providers/registry.ts`:

```ts
import type { SearchProvider, FetchProvider, CodeSearchProvider, ProviderTier } from "./types.ts";

interface RegisteredSearch {
  provider: SearchProvider;
  tier: ProviderTier;
  monthlyQuota: number | null;
}

interface RegisteredFetch {
  provider: FetchProvider;
}

interface RegisteredCodeSearch {
  provider: CodeSearchProvider;
}

export interface ProviderMetrics {
  successes: number;
  failures: number;
  totalLatencyMs: number;
}

export interface UsageRecord {
  count: number;
  month: string;
}

export interface PersistenceAdapter {
  load(): Record<string, UsageRecord>;
  save(data: Record<string, UsageRecord>): void;
}

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export class ProviderRegistry {
  private searchProviders = new Map<string, RegisteredSearch>();
  private fetchProviders = new Map<string, RegisteredFetch>();
  private codeSearchProviders = new Map<string, RegisteredCodeSearch>();
  private metrics = new Map<string, ProviderMetrics>();
  private counts: Record<string, number> = {};
  private currentMonth: string;
  private persistence: PersistenceAdapter;

  constructor(persistence: PersistenceAdapter) {
    this.persistence = persistence;
    this.currentMonth = getCurrentMonth();
    this.loadUsage();
  }

  private loadUsage(): void {
    const data = this.persistence.load();
    for (const [name, record] of Object.entries(data)) {
      if (record.month === this.currentMonth) {
        this.counts[name] = record.count;
      }
      // Different month — counts reset to 0 (already initialized)
    }
  }

  private saveUsage(): void {
    const data: Record<string, UsageRecord> = {};
    for (const [name, count] of Object.entries(this.counts)) {
      data[name] = { count, month: this.currentMonth };
    }
    this.persistence.save(data);
  }

  registerSearch(
    provider: SearchProvider,
    options: { tier: ProviderTier; monthlyQuota: number | null },
  ): void {
    this.searchProviders.set(provider.name, {
      provider,
      tier: options.tier,
      monthlyQuota: options.monthlyQuota,
    });
  }

  registerFetch(provider: FetchProvider): void {
    this.fetchProviders.set(provider.name, { provider });
  }

  registerCodeSearch(provider: CodeSearchProvider): void {
    this.codeSearchProviders.set(provider.name, { provider });
  }

  recordOutcome(providerName: string, result: { success: boolean; latencyMs?: number }): void {
    // Increment usage count (both success and failure count as a "use")
    this.counts[providerName] = (this.counts[providerName] ?? 0) + 1;
    this.saveUsage();

    // Update performance metrics
    const m = this.metrics.get(providerName) ?? { successes: 0, failures: 0, totalLatencyMs: 0 };
    if (result.success) {
      m.successes += 1;
      m.totalLatencyMs += result.latencyMs ?? 0;
    } else {
      m.failures += 1;
    }
    this.metrics.set(providerName, m);
  }

  // Legacy methods — kept for backward compatibility during transition
  recordUsage(providerName: string): void {
    this.counts[providerName] = (this.counts[providerName] ?? 0) + 1;
    this.saveUsage();
  }

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

  getRemaining(providerName: string): number {
    const reg = this.searchProviders.get(providerName);
    if (!reg) return 0;
    if (reg.monthlyQuota === null) return Infinity;
    return Math.max(0, reg.monthlyQuota - (this.counts[providerName] ?? 0));
  }

  getCount(providerName: string): number {
    return this.counts[providerName] ?? 0;
  }

  selectSearch(name?: string): SearchProvider | undefined {
    return this.selectSearchCandidates(name)[0];
  }

  selectSearchCandidates(name?: string): SearchProvider[] {
    if (name && name !== "auto") {
      const provider = this.searchProviders.get(name)?.provider;
      return provider ? [provider] : [];
    }

    const candidates: SearchProvider[] = [];
    for (const tier of [1, 2, 3] as ProviderTier[]) {
      const tierCandidates = [...this.searchProviders.values()]
        .filter((r) => r.tier === tier)
        .filter((r) => {
          if (r.monthlyQuota === null) return true;
          return (this.counts[r.provider.name] ?? 0) < r.monthlyQuota;
        })
        .sort((a, b) => {
          const remA = a.monthlyQuota === null ? Infinity : Math.max(0, a.monthlyQuota - (this.counts[a.provider.name] ?? 0));
          const remB = b.monthlyQuota === null ? Infinity : Math.max(0, b.monthlyQuota - (this.counts[b.provider.name] ?? 0));
          return remB - remA;
        });
      candidates.push(...tierCandidates.map((c) => c.provider));
    }
    return candidates;
  }

  selectSearchByPerformance(name?: string): SearchProvider | undefined {
    if (name && name !== "auto") {
      return this.searchProviders.get(name)?.provider;
    }

    const eligible = [...this.searchProviders.values()].filter((r) => {
      if (r.monthlyQuota === null) return true;
      return (this.counts[r.provider.name] ?? 0) < r.monthlyQuota;
    });

    if (eligible.length === 0) return undefined;

    const TIER_SCORES: Record<number, number> = { 1: 1.0, 2: 0.6, 3: 0.3 };

    const scored = eligible.map((r) => {
      const m = this.metrics.get(r.provider.name);
      const tierScore = TIER_SCORES[r.tier] ?? 0.3;

      if (!m || (m.successes + m.failures) === 0) {
        return { provider: r.provider, score: tierScore * 0.2 };
      }

      const total = m.successes + m.failures;
      const successRate = m.successes / total;
      const avgLatency = m.successes > 0 ? m.totalLatencyMs / m.successes : Infinity;

      return { provider: r.provider, score: 0, avgLatency, successRate, tierScore };
    });

    const latencies = scored
      .filter((s) => "avgLatency" in s && s.avgLatency !== Infinity)
      .map((s) => (s as { avgLatency: number }).avgLatency);
    const maxLatency = latencies.length > 0 ? Math.max(...latencies) : 1;

    for (const s of scored) {
      if ("successRate" in s && s.successRate !== undefined) {
        const speedScore = s.avgLatency === Infinity ? 0 : 1 - (s.avgLatency / (maxLatency || 1));
        s.score = (s.successRate * 0.5) + (speedScore * 0.3) + (s.tierScore! * 0.2);
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.provider;
  }

  selectFetchCandidates(): FetchProvider[] {
    return [...this.fetchProviders.values()].map((r) => r.provider);
  }

  selectCodeSearch(): CodeSearchProvider | undefined {
    const first = this.codeSearchProviders.values().next();
    return first.done ? undefined : first.value.provider;
  }

  getSearchProviderNames(): string[] {
    return [...this.searchProviders.keys()];
  }

  getMetrics(providerName: string): ProviderMetrics | undefined {
    return this.metrics.get(providerName);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/providers/registry.test.ts`
Expected: FAIL — existing tests still create `UsageTracker` and pass it to constructor

- [ ] **Step 5: Update existing registry tests to use in-memory adapter**

In `tests/providers/registry.test.ts`, update the test setup:

**a) Replace the common `UsageTracker` pattern** (most tests):
```ts
// Before:
const tracker = new UsageTracker();
const registry = new ProviderRegistry(tracker);

// After:
const registry = new ProviderRegistry({ load: () => ({}), save: () => {} });
```

**b) Rewrite "persists usage across registry instances" test** (line ~176):
```ts
it("persists usage across registry instances sharing the same adapter state", () => {
  const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const adapter = {
    load: () => ({ brave: { count: 1998, month } }),
    save: vi.fn(),
  };
  const registry = new ProviderRegistry(adapter);
  const brave = mockProvider("brave", "Brave");
  const ddg = mockProvider("duckduckgo", "DuckDuckGo");

  registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
  registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

  expect(registry.getRemaining("brave")).toBe(2);
  const selected = registry.selectSearch();
  expect(selected?.name).toBe("brave");

  registry.recordUsage("brave"); // 1999 used
  registry.recordUsage("brave"); // 2000 used
  const afterExhaust = registry.selectSearch();
  expect(afterExhaust?.name).toBe("duckduckgo");
});
```

**c) Fix `tracker.getCount` assertion** in "records usage via tracker" test (line ~87):
```ts
// Before:
expect(tracker.getCount("brave")).toBe(1);

// After:
expect(registry.getCount("brave")).toBe(1);
```

**d) Cleanup:** Remove `import { UsageTracker }`, remove `vi.mock("node:fs")`, remove the `beforeEach` fs mock setup (no longer needed since persistence is injected).

- [ ] **Step 6: Run registry tests**

Run: `pnpm vitest run tests/providers/registry.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/providers/registry.ts tests/providers/registry.test.ts
git commit -m "refactor: absorb usage counting into ProviderRegistry with PersistenceAdapter"
```

---

### Task 2: Create filesystem persistence adapter and update index.ts

**Files:**
- Modify: `src/index.ts`
- Modify: `src/providers/registry.ts` (add createFilePersistence helper)

- [ ] **Step 1: Add a filesystem adapter factory to registry.ts**

Add at the bottom of `src/providers/registry.ts`:

```ts
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export function createFilePersistence(filePath?: string): PersistenceAdapter {
  const usagePath = filePath ?? path.join(os.homedir(), ".pi", "agent", "tools-usage.json");
  const legacyPath = path.join(os.homedir(), ".pi", "agent", "pi-tools-usage.json");

  return {
    load(): Record<string, UsageRecord> {
      // Try primary path first, then legacy fallback (matches old UsageTracker behavior)
      for (const candidate of [usagePath, legacyPath]) {
        try {
          const raw = fs.readFileSync(candidate, "utf-8");
          const data = JSON.parse(raw);
          // Migrate from old format { resetAt, counts } to new { [name]: { count, month } }
          if (data.resetAt && data.counts) {
            const result: Record<string, UsageRecord> = {};
            for (const [name, count] of Object.entries(data.counts)) {
              result[name] = { count: count as number, month: data.resetAt };
            }
            return result;
          }
          return data as Record<string, UsageRecord>;
        } catch { continue; }
      }
      return {};
    },
    save(data: Record<string, UsageRecord>): void {
      try {
        fs.mkdirSync(path.dirname(usagePath), { recursive: true });
        fs.writeFileSync(usagePath, JSON.stringify(data, null, 2));
      } catch {
        // Non-fatal: usage tracking is best-effort
      }
    },
  };
}
```

- [ ] **Step 2: Update index.ts to use the filesystem adapter**

In `src/index.ts`, replace:

```ts
// Before:
import { UsageTracker } from "./providers/usage.ts";
// ...
const tracker = new UsageTracker();
const registry = new ProviderRegistry(tracker);

// After:
import { ProviderRegistry, createFilePersistence } from "./providers/registry.ts";
// ...
const registry = new ProviderRegistry(createFilePersistence());
```

Remove the `UsageTracker` import entirely.

- [ ] **Step 3: Run full test suite**

Run: `pnpm vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/providers/registry.ts src/index.ts
git commit -m "feat: add createFilePersistence adapter, wire into index.ts"
```

---

### Task 3: Delete usage.ts and its tests

**Files:**
- Delete: `src/providers/usage.ts`
- Delete: `tests/providers/usage.test.ts`

- [ ] **Step 1: Verify no remaining imports of UsageTracker**

```bash
grep -rn "UsageTracker\|from.*usage" src/ tests/
```

Expected: no matches (or only the now-deleted file). If any remain, update them.

- [ ] **Step 2: Delete the files**

```bash
rm src/providers/usage.ts tests/providers/usage.test.ts
```

- [ ] **Step 3: Run full verification**

Run: `pnpm check`
Expected: lint PASS, typecheck PASS, tests PASS

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: delete UsageTracker (absorbed into ProviderRegistry)"
```

---

### Task 4: Migrate callers to recordOutcome (optional cleanup)

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Replace legacy method calls with recordOutcome**

In `src/index.ts`, update the web-search tool registration:

```ts
// Before:
(providerName, latencyMs) => {
  registry.recordUsage(providerName);
  registry.recordSuccess(providerName, latencyMs);
},
config.guidance?.web_search,
(providerName) => registry.recordFailure(providerName),

// After:
(providerName, latencyMs) => {
  registry.recordOutcome(providerName, { success: true, latencyMs });
},
config.guidance?.web_search,
(providerName) => {
  registry.recordOutcome(providerName, { success: false });
},
```

Update the code-search tool registration:

```ts
// Before:
(providerName) => registry.recordUsage(providerName),

// After:
// Note: success: true is used as a usage tick — code-search doesn't report
// individual failures, and its providers use a separate selection path
// (selectCodeSearch), so inflating successes here is harmless.
(providerName) => registry.recordOutcome(providerName, { success: true }),
```

- [ ] **Step 2: Remove legacy methods from ProviderRegistry**

In `src/providers/registry.ts`, remove `recordUsage`, `recordSuccess`, `recordFailure` methods (keep `recordOutcome` only).

- [ ] **Step 3: Run full verification**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/index.ts src/providers/registry.ts
git commit -m "refactor: migrate all callers to recordOutcome, remove legacy methods"
```
