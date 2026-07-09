# Phase 2: Fusion Orchestration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `executeWithFusion()` — the orchestration function that runs multiple providers in parallel/batches and fuses their results using the RRF function from Phase 1.

**Architecture:** `executeWithFusion()` lives in `src/providers/fusion.ts` alongside `reciprocalRankFusion()`. It supports two modes: "targeted" (batch until N usable backends) and "all" (run everything in parallel). Returns a `FusionResult` with attribution metadata and a `degraded` flag.

**Tech Stack:** TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-07-08-multi-provider-fusion-rrf-design.md` (section "Core Fusion Module" — `executeWithFusion`)

**Prerequisite:** Phase 1 complete (`reciprocalRankFusion` exists in `src/providers/fusion.ts`)

---

### Task 1: Write failing tests for "all" mode

**Files:**

- Modify: `tests/providers/fusion.test.ts`

- [ ] **Step 1: Add executeWithFusion "all" mode tests**

Add a new `describe` block after the existing `reciprocalRankFusion` tests:

```typescript
import { describe, expect, it, vi } from "vitest";
import {
  reciprocalRankFusion,
  executeWithFusion,
} from "../../src/providers/fusion.ts";
import type { SearchResult } from "../../src/providers/types.ts";

// ... existing reciprocalRankFusion tests ...

describe("executeWithFusion", () => {
  describe("all mode", () => {
    it("runs all candidates in parallel and fuses results", async () => {
      const candidates = [
        {
          name: "brave",
          execute: async (n: number) =>
            [
              { title: "A", url: "https://a.com", snippet: "a" },
            ] as SearchResult[],
        },
        {
          name: "exa",
          execute: async (n: number) =>
            [
              { title: "B", url: "https://b.com", snippet: "b" },
            ] as SearchResult[],
        },
      ];

      const result = await executeWithFusion({
        candidates,
        maxResults: 10,
        mode: "all",
        targetBackends: 3,
        k: 60,
      });

      expect(result.providersUsed).toContain("brave");
      expect(result.providersUsed).toContain("exa");
      expect(result.providersFailed).toEqual([]);
      expect(result.degraded).toBe(false);
      expect(result.results).toHaveLength(2);
    });

    it("records failures and fuses only successes", async () => {
      const candidates = [
        {
          name: "brave",
          execute: async (n: number) =>
            [
              { title: "A", url: "https://a.com", snippet: "a" },
            ] as SearchResult[],
        },
        {
          name: "failing",
          execute: async (_n: number): Promise<SearchResult[]> => {
            throw new Error("timeout");
          },
        },
        {
          name: "exa",
          execute: async (n: number) =>
            [
              { title: "B", url: "https://b.com", snippet: "b" },
            ] as SearchResult[],
        },
      ];

      const result = await executeWithFusion({
        candidates,
        maxResults: 10,
        mode: "all",
        targetBackends: 3,
        k: 60,
      });

      expect(result.providersUsed).toEqual(["brave", "exa"]);
      expect(result.providersFailed).toEqual(["failing"]);
      expect(result.results).toHaveLength(2);
    });

    it("distributes numResults across providers", async () => {
      const capturedN: number[] = [];
      const candidates = [
        {
          name: "a",
          execute: async (n: number) => {
            capturedN.push(n);
            return [
              { title: "A", url: "https://a.com", snippet: "a" },
            ] as SearchResult[];
          },
        },
        {
          name: "b",
          execute: async (n: number) => {
            capturedN.push(n);
            return [
              { title: "B", url: "https://b.com", snippet: "b" },
            ] as SearchResult[];
          },
        },
        {
          name: "c",
          execute: async (n: number) => {
            capturedN.push(n);
            return [
              { title: "C", url: "https://c.com", snippet: "c" },
            ] as SearchResult[];
          },
        },
      ];

      await executeWithFusion({
        candidates,
        maxResults: 10,
        mode: "all",
        targetBackends: 3,
        k: 60,
      });

      // Math.ceil(10 / 3) = 4
      expect(capturedN).toEqual([4, 4, 4]);
    });

    it("calls onSuccess for each successful provider", async () => {
      const onSuccess = vi.fn();
      const candidates = [
        {
          name: "brave",
          execute: async (n: number) =>
            [
              { title: "A", url: "https://a.com", snippet: "a" },
            ] as SearchResult[],
        },
        {
          name: "exa",
          execute: async (n: number) =>
            [
              { title: "B", url: "https://b.com", snippet: "b" },
            ] as SearchResult[],
        },
      ];

      await executeWithFusion({
        candidates,
        maxResults: 10,
        mode: "all",
        targetBackends: 3,
        k: 60,
        onSuccess,
      });

      expect(onSuccess).toHaveBeenCalledTimes(2);
      expect(onSuccess).toHaveBeenCalledWith("brave", expect.any(Number));
      expect(onSuccess).toHaveBeenCalledWith("exa", expect.any(Number));
    });

    it("calls onFailure for each failed provider", async () => {
      const onFailure = vi.fn();
      const candidates = [
        {
          name: "brave",
          execute: async (_n: number): Promise<SearchResult[]> => {
            throw new Error("timeout");
          },
        },
        {
          name: "exa",
          execute: async (n: number) =>
            [
              { title: "A", url: "https://a.com", snippet: "a" },
            ] as SearchResult[],
        },
      ];

      await executeWithFusion({
        candidates,
        maxResults: 10,
        mode: "all",
        targetBackends: 3,
        k: 60,
        onFailure,
      });

      expect(onFailure).toHaveBeenCalledOnce();
      expect(onFailure).toHaveBeenCalledWith("brave");
    });

    it("throws AggregateProviderError when all candidates fail", async () => {
      const candidates = [
        {
          name: "brave",
          execute: async (_n: number): Promise<SearchResult[]> => {
            throw new Error("err-brave");
          },
        },
        {
          name: "exa",
          execute: async (_n: number): Promise<SearchResult[]> => {
            throw new Error("err-exa");
          },
        },
      ];

      await expect(
        executeWithFusion({
          candidates,
          maxResults: 10,
          mode: "all",
          targetBackends: 3,
          k: 60,
        }),
      ).rejects.toThrow("All search providers failed");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/providers/fusion.test.ts`
Expected: FAIL — `executeWithFusion` is not exported from `fusion.ts`

---

### Task 2: Implement executeWithFusion (all mode)

**Files:**

- Modify: `src/providers/fusion.ts`

- [ ] **Step 3: Add types and the executeWithFusion function**

Add at the bottom of `src/providers/fusion.ts`:

```typescript
import { AggregateProviderError } from "../utils/errors.ts";

export interface FusionCandidate {
  name: string;
  execute: (numResults: number) => Promise<SearchResult[]>;
}

export interface FusionOptions {
  candidates: FusionCandidate[];
  maxResults: number;
  mode: "targeted" | "all";
  targetBackends: number;
  k: number;
  onSuccess?: (providerName: string, latencyMs: number) => void;
  onFailure?: (providerName: string) => void;
}

export interface FusionResult {
  results: FusedResult[];
  providersUsed: string[];
  providersFailed: string[];
  degraded: boolean;
}

export async function executeWithFusion(
  options: FusionOptions,
): Promise<FusionResult> {
  const {
    candidates,
    maxResults,
    mode,
    targetBackends,
    k,
    onSuccess,
    onFailure,
  } = options;

  if (candidates.length === 0) {
    throw new AggregateProviderError("search", [
      { provider: "none", error: "No search providers available" },
    ]);
  }

  if (mode === "all") {
    return executeAll(
      candidates,
      maxResults,
      targetBackends,
      k,
      onSuccess,
      onFailure,
    );
  }

  return executeTargeted(
    candidates,
    maxResults,
    targetBackends,
    k,
    onSuccess,
    onFailure,
  );
}

async function executeAll(
  candidates: FusionCandidate[],
  maxResults: number,
  targetBackends: number,
  k: number,
  onSuccess?: (name: string, latencyMs: number) => void,
  onFailure?: (name: string) => void,
): Promise<FusionResult> {
  const perProvider = Math.ceil(maxResults / candidates.length);
  const providersUsed: string[] = [];
  const providersFailed: string[] = [];
  const providerResults: ProviderResults[] = [];
  const errors: Array<{ provider: string; error: string }> = [];

  const settled = await Promise.all(
    candidates.map(async (candidate) => {
      const startMs = Date.now();
      try {
        const results = await candidate.execute(perProvider);
        const latencyMs = Date.now() - startMs;
        onSuccess?.(candidate.name, latencyMs);
        return { name: candidate.name, results, success: true as const };
      } catch (err) {
        onFailure?.(candidate.name);
        return {
          name: candidate.name,
          error: err instanceof Error ? err.message : String(err),
          success: false as const,
        };
      }
    }),
  );

  for (const entry of settled) {
    if (entry.success) {
      if (entry.results.length > 0) {
        providersUsed.push(entry.name);
        providerResults.push({
          providerName: entry.name,
          results: entry.results,
        });
      }
      // Success but empty — not usable, not a failure, not counted as "used"
    } else {
      providersFailed.push(entry.name);
      errors.push({ provider: entry.name, error: entry.error });
    }
  }

  if (providerResults.length === 0) {
    throw new AggregateProviderError("search", errors);
  }

  const fused =
    providerResults.length === 1
      ? providerResults[0].results.slice(0, maxResults).map((r) => ({
          result: r,
          rrfScore: 0,
          providers: [providerResults[0].providerName],
        }))
      : reciprocalRankFusion(providerResults, maxResults, k);

  return {
    results: fused,
    providersUsed,
    providersFailed,
    degraded: providersUsed.length < targetBackends,
  };
}
```

Note: `executeTargeted` will be a stub for now (we'll implement it in Task 3):

```typescript
async function executeTargeted(
  candidates: FusionCandidate[],
  maxResults: number,
  targetBackends: number,
  k: number,
  onSuccess?: (name: string, latencyMs: number) => void,
  onFailure?: (name: string) => void,
): Promise<FusionResult> {
  // Targeted mode implemented in next task
  return executeAll(
    candidates,
    maxResults,
    targetBackends,
    k,
    onSuccess,
    onFailure,
  );
}
```

Also move the `import { AggregateProviderError }` to the top of the file.

- [ ] **Step 4: Run tests to verify "all" mode tests pass**

Run: `pnpm vitest run tests/providers/fusion.test.ts`
Expected: All "all mode" tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/providers/fusion.ts tests/providers/fusion.test.ts
git commit -m "feat(fusion): add executeWithFusion with 'all' mode parallel execution"
```

---

### Task 3: Write failing tests for "targeted" mode

**Files:**

- Modify: `tests/providers/fusion.test.ts`

- [ ] **Step 6: Add targeted mode tests**

Add a new `describe("targeted mode")` block inside `describe("executeWithFusion")`:

```typescript
describe("targeted mode", () => {
  it("stops after targetBackends usable providers respond", async () => {
    const executionOrder: string[] = [];
    const candidates = [
      {
        name: "a",
        execute: async (n: number) => {
          executionOrder.push("a");
          return [
            { title: "A", url: "https://a.com", snippet: "a" },
          ] as SearchResult[];
        },
      },
      {
        name: "b",
        execute: async (n: number) => {
          executionOrder.push("b");
          return [
            { title: "B", url: "https://b.com", snippet: "b" },
          ] as SearchResult[];
        },
      },
      {
        name: "c",
        execute: async (n: number) => {
          executionOrder.push("c");
          return [
            { title: "C", url: "https://c.com", snippet: "c" },
          ] as SearchResult[];
        },
      },
      {
        name: "d",
        execute: async (n: number) => {
          executionOrder.push("d");
          return [
            { title: "D", url: "https://d.com", snippet: "d" },
          ] as SearchResult[];
        },
      },
    ];

    const result = await executeWithFusion({
      candidates,
      maxResults: 10,
      mode: "targeted",
      targetBackends: 2,
      k: 60,
    });

    // Should stop after finding 2 usable providers
    expect(result.providersUsed).toHaveLength(2);
    expect(executionOrder).toHaveLength(2);
    expect(result.degraded).toBe(false);
  });

  it("continues to next batch when first batch has failures", async () => {
    const candidates = [
      {
        name: "failing1",
        execute: async (_n: number): Promise<SearchResult[]> => {
          throw new Error("err");
        },
      },
      {
        name: "failing2",
        execute: async (_n: number): Promise<SearchResult[]> => {
          throw new Error("err");
        },
      },
      {
        name: "good1",
        execute: async (n: number) =>
          [
            { title: "A", url: "https://a.com", snippet: "a" },
          ] as SearchResult[],
      },
      {
        name: "good2",
        execute: async (n: number) =>
          [
            { title: "B", url: "https://b.com", snippet: "b" },
          ] as SearchResult[],
      },
    ];

    const result = await executeWithFusion({
      candidates,
      maxResults: 10,
      mode: "targeted",
      targetBackends: 2,
      k: 60,
    });

    expect(result.providersUsed).toContain("good1");
    expect(result.providersUsed).toContain("good2");
    expect(result.providersFailed).toContain("failing1");
    expect(result.providersFailed).toContain("failing2");
    expect(result.degraded).toBe(false);
  });

  it("sets degraded when fewer providers respond than target", async () => {
    const candidates = [
      {
        name: "good",
        execute: async (n: number) =>
          [
            { title: "A", url: "https://a.com", snippet: "a" },
          ] as SearchResult[],
      },
      {
        name: "failing",
        execute: async (_n: number): Promise<SearchResult[]> => {
          throw new Error("err");
        },
      },
    ];

    const result = await executeWithFusion({
      candidates,
      maxResults: 10,
      mode: "targeted",
      targetBackends: 3,
      k: 60,
    });

    expect(result.providersUsed).toEqual(["good"]);
    expect(result.degraded).toBe(true);
    expect(result.results).toHaveLength(1);
  });

  it("treats empty results as not usable and continues", async () => {
    const candidates = [
      {
        name: "empty",
        execute: async (n: number) => [] as SearchResult[],
      },
      {
        name: "good1",
        execute: async (n: number) =>
          [
            { title: "A", url: "https://a.com", snippet: "a" },
          ] as SearchResult[],
      },
      {
        name: "good2",
        execute: async (n: number) =>
          [
            { title: "B", url: "https://b.com", snippet: "b" },
          ] as SearchResult[],
      },
    ];

    const result = await executeWithFusion({
      candidates,
      maxResults: 10,
      mode: "targeted",
      targetBackends: 2,
      k: 60,
    });

    expect(result.providersUsed).toContain("good1");
    expect(result.providersUsed).toContain("good2");
    expect(result.providersUsed).not.toContain("empty");
    // "empty" returned success but 0 results, not counted as usable
    expect(result.results).toHaveLength(2);
  });

  it("distributes numResults using Math.ceil(maxResults / targetBackends)", async () => {
    const capturedN: number[] = [];
    const candidates = [
      {
        name: "a",
        execute: async (n: number) => {
          capturedN.push(n);
          return [
            { title: "A", url: "https://a.com", snippet: "a" },
          ] as SearchResult[];
        },
      },
      {
        name: "b",
        execute: async (n: number) => {
          capturedN.push(n);
          return [
            { title: "B", url: "https://b.com", snippet: "b" },
          ] as SearchResult[];
        },
      },
      {
        name: "c",
        execute: async (n: number) => {
          capturedN.push(n);
          return [
            { title: "C", url: "https://c.com", snippet: "c" },
          ] as SearchResult[];
        },
      },
    ];

    await executeWithFusion({
      candidates,
      maxResults: 10,
      mode: "targeted",
      targetBackends: 3,
      k: 60,
    });

    // Math.ceil(10 / 3) = 4
    for (const n of capturedN) {
      expect(n).toBe(4);
    }
  });

  it("throws AggregateProviderError when no usable providers found", async () => {
    const candidates = [
      {
        name: "a",
        execute: async (_n: number): Promise<SearchResult[]> => {
          throw new Error("err-a");
        },
      },
      {
        name: "b",
        execute: async (_n: number): Promise<SearchResult[]> => {
          throw new Error("err-b");
        },
      },
    ];

    await expect(
      executeWithFusion({
        candidates,
        maxResults: 10,
        mode: "targeted",
        targetBackends: 3,
        k: 60,
      }),
    ).rejects.toThrow("All search providers failed");
  });
});
```

- [ ] **Step 7: Run tests to verify targeted mode tests fail**

Run: `pnpm vitest run tests/providers/fusion.test.ts`
Expected: The targeted mode test "stops after targetBackends" will FAIL because `executeTargeted` currently delegates to `executeAll` which runs everything.

---

### Task 4: Implement targeted mode

**Files:**

- Modify: `src/providers/fusion.ts`

- [ ] **Step 8: Replace the executeTargeted stub with real implementation**

Replace the `executeTargeted` function:

```typescript
async function executeTargeted(
  candidates: FusionCandidate[],
  maxResults: number,
  targetBackends: number,
  k: number,
  onSuccess?: (name: string, latencyMs: number) => void,
  onFailure?: (name: string) => void,
): Promise<FusionResult> {
  const perProvider = Math.ceil(maxResults / targetBackends);
  const providersUsed: string[] = [];
  const providersFailed: string[] = [];
  const usableResults: ProviderResults[] = [];
  const errors: Array<{ provider: string; error: string }> = [];
  let cursor = 0;

  while (usableResults.length < targetBackends && cursor < candidates.length) {
    const needed = targetBackends - usableResults.length;
    const remaining = candidates.length - cursor;
    const batchSize = Math.min(needed, remaining);
    const batch = candidates.slice(cursor, cursor + batchSize);
    cursor += batchSize;

    const batchSettled = await Promise.all(
      batch.map(async (candidate) => {
        const startMs = Date.now();
        try {
          const results = await candidate.execute(perProvider);
          const latencyMs = Date.now() - startMs;
          onSuccess?.(candidate.name, latencyMs);
          return { name: candidate.name, results, success: true as const };
        } catch (err) {
          onFailure?.(candidate.name);
          return {
            name: candidate.name,
            error: err instanceof Error ? err.message : String(err),
            success: false as const,
          };
        }
      }),
    );

    for (const entry of batchSettled) {
      if (entry.success) {
        if (entry.results.length > 0) {
          providersUsed.push(entry.name);
          usableResults.push({
            providerName: entry.name,
            results: entry.results,
          });
        }
        // empty results → not usable, not a failure, not counted as "used"
      } else {
        providersFailed.push(entry.name);
        errors.push({ provider: entry.name, error: entry.error });
      }
    }
  }

  if (usableResults.length === 0) {
    throw new AggregateProviderError("search", errors);
  }

  const fused =
    usableResults.length === 1
      ? usableResults[0].results.slice(0, maxResults).map((r) => ({
          result: r,
          rrfScore: 0,
          providers: [usableResults[0].providerName],
        }))
      : reciprocalRankFusion(usableResults, maxResults, k);

  return {
    results: fused,
    providersUsed,
    providersFailed,
    degraded: usableResults.length < targetBackends,
  };
}
```

- [ ] **Step 9: Run tests to verify all pass**

Run: `pnpm vitest run tests/providers/fusion.test.ts`
Expected: All tests PASS (both "all" and "targeted" mode)

- [ ] **Step 10: Commit**

```bash
git add src/providers/fusion.ts tests/providers/fusion.test.ts
git commit -m "feat(fusion): implement targeted mode with batch execution"
```

---

### Task 5: Run full test suite for regression check

- [ ] **Step 11: Run the full test suite**

Run: `pnpm check`
Expected: All tests pass, no lint errors, no type errors.
