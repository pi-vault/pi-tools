# Phase 1: Pure RRF Algorithm

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Reciprocal Rank Fusion pure function that merges ranked results from multiple providers with URL deduplication.

**Architecture:** A pure function `reciprocalRankFusion()` in `src/providers/fusion.ts` that takes provider result arrays and returns a merged, scored, deduplicated list. Zero side effects, zero dependencies on other new code.

**Tech Stack:** TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-07-08-multi-provider-fusion-rrf-design.md` (section "Core Fusion Module")

---

### Task 1: Write failing tests for basic RRF merge

**Files:**

- Create: `tests/providers/fusion.test.ts`

- [ ] **Step 1: Create the test file with the first test**

```typescript
import { describe, expect, it } from "vitest";
import { reciprocalRankFusion } from "../../src/providers/fusion.ts";
import type { SearchResult } from "../../src/providers/types.ts";

describe("reciprocalRankFusion", () => {
  it("merges results from two providers and orders by RRF score", () => {
    const providerResults = [
      {
        providerName: "brave",
        results: [
          { title: "A", url: "https://a.com", snippet: "Snippet A" },
          { title: "B", url: "https://b.com", snippet: "Snippet B" },
        ] as SearchResult[],
      },
      {
        providerName: "exa",
        results: [
          {
            title: "B alt",
            url: "https://b.com",
            snippet: "Snippet B from exa",
          },
          { title: "C", url: "https://c.com", snippet: "Snippet C" },
        ] as SearchResult[],
      },
    ];

    const fused = reciprocalRankFusion(providerResults, 10);

    // B appears in both providers -> highest RRF score
    expect(fused[0].result.url).toBe("https://b.com");
    expect(fused[0].providers).toContain("brave");
    expect(fused[0].providers).toContain("exa");
    expect(fused[0].rrfScore).toBeGreaterThan(fused[1].rrfScore);

    // All 3 unique URLs present
    const urls = fused.map((f) => f.result.url);
    expect(urls).toContain("https://a.com");
    expect(urls).toContain("https://b.com");
    expect(urls).toContain("https://c.com");
  });

  it("respects maxResults limit", () => {
    const providerResults = [
      {
        providerName: "brave",
        results: [
          { title: "A", url: "https://a.com", snippet: "a" },
          { title: "B", url: "https://b.com", snippet: "b" },
          { title: "C", url: "https://c.com", snippet: "c" },
        ] as SearchResult[],
      },
    ];

    const fused = reciprocalRankFusion(providerResults, 2);
    expect(fused).toHaveLength(2);
  });

  it("returns empty array when no provider results given", () => {
    const fused = reciprocalRankFusion([], 10);
    expect(fused).toEqual([]);
  });

  it("handles single provider input without error", () => {
    const providerResults = [
      {
        providerName: "brave",
        results: [
          { title: "A", url: "https://a.com", snippet: "a" },
        ] as SearchResult[],
      },
    ];

    const fused = reciprocalRankFusion(providerResults, 10);
    expect(fused).toHaveLength(1);
    expect(fused[0].result.url).toBe("https://a.com");
    expect(fused[0].providers).toEqual(["brave"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/providers/fusion.test.ts`
Expected: FAIL — `reciprocalRankFusion` cannot be resolved (file doesn't exist)

---

### Task 2: Implement reciprocalRankFusion

**Files:**

- Create: `src/providers/fusion.ts`

- [ ] **Step 3: Create the fusion module with the RRF function**

```typescript
import type { SearchResult } from "./types.ts";

export interface ProviderResults {
  providerName: string;
  results: SearchResult[];
}

export interface FusedResult {
  result: SearchResult;
  rrfScore: number;
  providers: string[];
}

const DEFAULT_K = 60;

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString().toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export function reciprocalRankFusion(
  providerResults: ProviderResults[],
  maxResults: number,
  k: number = DEFAULT_K,
): FusedResult[] {
  const urlMap = new Map<
    string,
    { rrfScore: number; result: SearchResult; providers: string[] }
  >();

  for (const { providerName, results } of providerResults) {
    for (let rank = 0; rank < results.length; rank++) {
      const r = results[rank];
      const key = normalizeUrl(r.url);
      const rrfContribution = 1 / (k + rank + 1);

      const existing = urlMap.get(key);
      if (existing) {
        existing.rrfScore += rrfContribution;
        existing.providers.push(providerName);
        // Keep result with longer snippet
        const existingLen = (existing.result.snippet ?? "").length;
        const newLen = (r.snippet ?? "").length;
        if (newLen > existingLen) {
          existing.result = r;
        }
      } else {
        urlMap.set(key, {
          rrfScore: rrfContribution,
          result: r,
          providers: [providerName],
        });
      }
    }
  }

  return Array.from(urlMap.values())
    .sort((a, b) => {
      if (b.rrfScore !== a.rrfScore) return b.rrfScore - a.rrfScore;
      return b.providers.length - a.providers.length;
    })
    .slice(0, maxResults)
    .map((entry) => ({
      result: entry.result,
      rrfScore: entry.rrfScore,
      providers: entry.providers,
    }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/providers/fusion.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/providers/fusion.ts tests/providers/fusion.test.ts
git commit -m "feat(fusion): add reciprocalRankFusion pure function with basic tests"
```

---

### Task 3: Add URL deduplication edge-case tests

**Files:**

- Modify: `tests/providers/fusion.test.ts`

- [ ] **Step 6: Add URL normalization dedup tests**

Add inside the `describe("reciprocalRankFusion")` block:

```typescript
it("deduplicates by normalized URL (trailing slash)", () => {
  const providerResults = [
    {
      providerName: "brave",
      results: [
        { title: "A", url: "https://example.com/path/", snippet: "from brave" },
      ] as SearchResult[],
    },
    {
      providerName: "exa",
      results: [
        {
          title: "A alt",
          url: "https://example.com/path",
          snippet: "from exa",
        },
      ] as SearchResult[],
    },
  ];

  const fused = reciprocalRankFusion(providerResults, 10);
  expect(fused).toHaveLength(1);
  expect(fused[0].providers).toContain("brave");
  expect(fused[0].providers).toContain("exa");
});

it("deduplicates by normalized URL (hash fragment stripped)", () => {
  const providerResults = [
    {
      providerName: "brave",
      results: [
        { title: "A", url: "https://example.com/page#section1", snippet: "s" },
      ] as SearchResult[],
    },
    {
      providerName: "exa",
      results: [
        { title: "A", url: "https://example.com/page#section2", snippet: "s" },
      ] as SearchResult[],
    },
  ];

  const fused = reciprocalRankFusion(providerResults, 10);
  expect(fused).toHaveLength(1);
});

it("deduplicates case-insensitively", () => {
  const providerResults = [
    {
      providerName: "brave",
      results: [
        { title: "A", url: "https://Example.COM/Page", snippet: "s" },
      ] as SearchResult[],
    },
    {
      providerName: "exa",
      results: [
        { title: "A", url: "https://example.com/page", snippet: "s" },
      ] as SearchResult[],
    },
  ];

  const fused = reciprocalRankFusion(providerResults, 10);
  expect(fused).toHaveLength(1);
  expect(fused[0].providers).toHaveLength(2);
});
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm vitest run tests/providers/fusion.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 8: Commit**

```bash
git add tests/providers/fusion.test.ts
git commit -m "test(fusion): add URL normalization dedup edge cases"
```

---

### Task 4: Add content-aware merge and custom k tests

**Files:**

- Modify: `tests/providers/fusion.test.ts`

- [ ] **Step 9: Add content-aware merge and custom k tests**

Add inside the `describe("reciprocalRankFusion")` block:

```typescript
it("keeps result with longer snippet on dedup", () => {
  const providerResults = [
    {
      providerName: "brave",
      results: [
        { title: "A", url: "https://a.com", snippet: "short" },
      ] as SearchResult[],
    },
    {
      providerName: "exa",
      results: [
        {
          title: "A Better",
          url: "https://a.com",
          snippet: "a much longer and more detailed snippet",
        },
      ] as SearchResult[],
    },
  ];

  const fused = reciprocalRankFusion(providerResults, 10);
  expect(fused[0].result.title).toBe("A Better");
  expect(fused[0].result.snippet).toBe(
    "a much longer and more detailed snippet",
  );
});

it("uses custom k parameter for scoring", () => {
  const providerResults = [
    {
      providerName: "brave",
      results: [
        { title: "A", url: "https://a.com", snippet: "a" },
      ] as SearchResult[],
    },
  ];

  // k=60 (default): score = 1/(60+0+1) = 1/61
  const defaultK = reciprocalRankFusion(providerResults, 10, 60);
  expect(defaultK[0].rrfScore).toBeCloseTo(1 / 61);

  // k=10: score = 1/(10+0+1) = 1/11
  const smallK = reciprocalRankFusion(providerResults, 10, 10);
  expect(smallK[0].rrfScore).toBeCloseTo(1 / 11);
});

it("handles provider with empty results array", () => {
  const providerResults = [
    {
      providerName: "brave",
      results: [] as SearchResult[],
    },
    {
      providerName: "exa",
      results: [
        { title: "A", url: "https://a.com", snippet: "a" },
      ] as SearchResult[],
    },
  ];

  const fused = reciprocalRankFusion(providerResults, 10);
  expect(fused).toHaveLength(1);
  expect(fused[0].providers).toEqual(["exa"]);
});

it("results with higher rank across more providers sort first", () => {
  // URL X is rank 0 in both providers, URL Y is rank 0 only in one
  const providerResults = [
    {
      providerName: "brave",
      results: [
        { title: "X", url: "https://x.com", snippet: "x" },
        { title: "Y", url: "https://y.com", snippet: "y" },
      ] as SearchResult[],
    },
    {
      providerName: "exa",
      results: [
        { title: "X", url: "https://x.com", snippet: "x" },
        { title: "Z", url: "https://z.com", snippet: "z" },
      ] as SearchResult[],
    },
  ];

  const fused = reciprocalRankFusion(providerResults, 10);
  // X appears at rank 0 in both -> score = 2 * 1/(60+0+1) = 2/61
  // Y appears at rank 1 in brave -> score = 1/(60+1+1) = 1/62
  // Z appears at rank 1 in exa -> score = 1/(60+1+1) = 1/62
  expect(fused[0].result.url).toBe("https://x.com");
  expect(fused[0].rrfScore).toBeCloseTo(2 / 61);
});
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `pnpm vitest run tests/providers/fusion.test.ts`
Expected: All 11 tests PASS

- [ ] **Step 11: Commit**

```bash
git add tests/providers/fusion.test.ts
git commit -m "test(fusion): add content-aware merge and scoring edge cases"
```

---

### Task 5: Run full test suite for regression check

- [ ] **Step 12: Run the full test suite**

Run: `pnpm check`
Expected: All tests pass, no lint errors, no type errors. The new file doesn't affect any existing code.
