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
