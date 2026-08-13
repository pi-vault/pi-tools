import { describe, expect, it } from "vitest";
import {
  filterResultsByDomains,
  unsupportedSearchFilters,
} from "../../src/utils/filters.ts";
import {
  UNSUPPORTED_SEARCH_FILTERS,
  type SearchFilterSupport,
  type SearchResult,
} from "../../src/providers/types.ts";

const results: SearchResult[] = [
  { title: "Docs", url: "https://docs.example.com/a", snippet: "docs" },
  { title: "Root", url: "https://example.com/b", snippet: "root" },
  { title: "Lookalike", url: "https://notexample.com/c", snippet: "other" },
];

describe("search filter support", () => {
  it("filters included domains by host and subdomain", () => {
    expect(
      filterResultsByDomains(results, { includeDomains: ["example.com"] }),
    ).toEqual(results.slice(0, 2));
  });

  it("filters excluded domains without matching lookalike hosts", () => {
    expect(
      filterResultsByDomains(results, { excludeDomains: ["example.com"] }),
    ).toEqual([results[2]]);
  });

  it("reports unsupported domain and date groups", () => {
    expect(
      unsupportedSearchFilters(
        {
          includeDomains: ["example.com"],
          startDate: "2026-01-01",
        },
        UNSUPPORTED_SEARCH_FILTERS,
      ),
    ).toEqual(["domains", "dates"]);
  });

  it("allows native domains and dates", () => {
    const support: SearchFilterSupport = { domains: "native", dates: "native" };
    expect(
      unsupportedSearchFilters(
        { includeDomains: ["example.com"], endDate: "2026-08-12" },
        support,
      ),
    ).toEqual([]);
  });

  it("does not match malformed URLs and supports post-filter domains", () => {
    expect(
      filterResultsByDomains(
        [{ title: "Bad", url: "not-a-url", snippet: "bad" }],
        { includeDomains: ["example.com"] },
      ),
    ).toEqual([]);

    expect(
      unsupportedSearchFilters(
        { includeDomains: ["example.com"], endDate: "2026-08-12" },
        { domains: "post-filter", dates: "unsupported" },
      ),
    ).toEqual(["dates"]);
  });
});
