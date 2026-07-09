import { describe, expect, it, vi } from "vitest";
import { reciprocalRankFusion, executeWithFusion } from "../../src/providers/fusion.ts";
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

  it("does not deduplicate URLs with different query parameters", () => {
    const providerResults = [
      {
        providerName: "brave",
        results: [
          { title: "A", url: "https://a.com?src=google", snippet: "a" },
        ] as SearchResult[],
      },
      {
        providerName: "exa",
        results: [
          { title: "A", url: "https://a.com?src=twitter", snippet: "a" },
        ] as SearchResult[],
      },
    ];

    const fused = reciprocalRankFusion(providerResults, 10);
    expect(fused).toHaveLength(2);
  });

  it("falls back to lowercase comparison for invalid URLs", () => {
    const providerResults = [
      {
        providerName: "brave",
        results: [
          { title: "A", url: "not-a-valid-url", snippet: "a" },
        ] as SearchResult[],
      },
      {
        providerName: "exa",
        results: [
          { title: "A", url: "NOT-A-VALID-URL", snippet: "a from exa" },
        ] as SearchResult[],
      },
    ];

    const fused = reciprocalRankFusion(providerResults, 10);
    expect(fused).toHaveLength(1);
    expect(fused[0].providers).toHaveLength(2);
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
});

describe("executeWithFusion", () => {
  describe("all mode", () => {
    it("runs all candidates in parallel and fuses results", async () => {
      const candidates = [
        {
          name: "brave",
          execute: async (_n: number) =>
            [
              { title: "A", url: "https://a.com", snippet: "a" },
            ] as SearchResult[],
        },
        {
          name: "exa",
          execute: async (_n: number) =>
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
          execute: async (_n: number) =>
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
          execute: async (_n: number) =>
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
          execute: async (_n: number) =>
            [
              { title: "A", url: "https://a.com", snippet: "a" },
            ] as SearchResult[],
        },
        {
          name: "exa",
          execute: async (_n: number) =>
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
          execute: async (_n: number) =>
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

  describe("targeted mode", () => {
    it("stops after targetBackends usable providers respond", async () => {
      const executionOrder: string[] = [];
      const candidates = [
        {
          name: "a",
          execute: async (_n: number) => {
            executionOrder.push("a");
            return [
              { title: "A", url: "https://a.com", snippet: "a" },
            ] as SearchResult[];
          },
        },
        {
          name: "b",
          execute: async (_n: number) => {
            executionOrder.push("b");
            return [
              { title: "B", url: "https://b.com", snippet: "b" },
            ] as SearchResult[];
          },
        },
        {
          name: "c",
          execute: async (_n: number) => {
            executionOrder.push("c");
            return [
              { title: "C", url: "https://c.com", snippet: "c" },
            ] as SearchResult[];
          },
        },
        {
          name: "d",
          execute: async (_n: number) => {
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
          execute: async (_n: number) =>
            [
              { title: "A", url: "https://a.com", snippet: "a" },
            ] as SearchResult[],
        },
        {
          name: "good2",
          execute: async (_n: number) =>
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
          execute: async (_n: number) =>
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
          execute: async (_n: number) => [] as SearchResult[],
        },
        {
          name: "good1",
          execute: async (_n: number) =>
            [
              { title: "A", url: "https://a.com", snippet: "a" },
            ] as SearchResult[],
        },
        {
          name: "good2",
          execute: async (_n: number) =>
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
});
