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
