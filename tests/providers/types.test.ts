import { describe, expect, it } from "vitest";
import type {
  CodeSearchResult,
  FetchResult,
  ProviderMeta,
  ProviderOperation,
  SearchFilters,
  SearchProvider,
  SearchResult,
} from "../../src/providers/types.ts";

describe("provider types", () => {
  it("represents every metered operation", () => {
    const operations: ProviderOperation[] = [
      { capability: "search", maxResults: 10 },
      { capability: "fetch" },
      { capability: "code-search", maxResults: 10 },
      { capability: "docs-search" },
      { capability: "docs-fetch" },
      { capability: "research", type: "deep-reasoning", maxResults: 10, contentTypes: 2 },
    ];

    expect(operations.map((operation) => operation.capability)).toEqual([
      "search",
      "fetch",
      "code-search",
      "docs-search",
      "docs-fetch",
      "research",
    ]);
  });

  it("SearchResult satisfies the interface shape", () => {
    const result: SearchResult = {
      title: "Example",
      url: "https://example.com",
      snippet: "A snippet",
    };
    expect(result.title).toBe("Example");
    expect(result.url).toBe("https://example.com");
    expect(result.snippet).toBe("A snippet");
  });

  it("CodeSearchResult satisfies the interface shape", () => {
    const result: CodeSearchResult = {
      title: "Code Example",
      url: "https://github.com/example",
      snippet: "const x = 1;",
    };
    expect(result.title).toBe("Code Example");
    expect(result.url).toBe("https://github.com/example");
    expect(result.snippet).toBe("const x = 1;");
  });

  it("FetchResult includes optional fields", () => {
    const minimal: FetchResult = { text: "content" };
    expect(minimal.title).toBeUndefined();
    expect(minimal.contentType).toBeUndefined();

    const full: FetchResult = {
      text: "content",
      title: "Page Title",
      contentType: "text/html",
    };
    expect(full.title).toBe("Page Title");
  });

  it("ProviderMeta describes provider registration", () => {
    const mockSearch: SearchProvider = {
      name: "brave",
      label: "Brave Search",
      search: async () => [],
    };
    const meta: ProviderMeta = {
      name: "brave",
      tier: 1,
      requiresKey: true,
      usageCost: () => 0.005,
      create: (_key) => ({ search: mockSearch }),
    };
    expect(meta.tier).toBe(1);
    expect(meta.requiresKey).toBe(true);
    expect(meta).not.toHaveProperty("monthlyQuota");
    expect(
      meta.usageCost?.(
        { capability: "search", maxResults: 10 },
        { enabled: true, budget: { mode: "managed" } },
      ),
    ).toBe(0.005);
    const instances = meta.create("key");
    expect(instances.search).toBe(mockSearch);
    expect(instances.fetch).toBeUndefined();
    expect(instances.codeSearch).toBeUndefined();
  });
});

describe("SearchFilters type", () => {
  it("allows a provider to accept filters as an optional parameter", () => {
    const provider: SearchProvider = {
      name: "test",
      label: "Test",
      async search(
        query: string,
        maxResults: number,
        signal?: AbortSignal,
        filters?: SearchFilters,
      ): Promise<SearchResult[]> {
        return [];
      },
    };

    expect(provider.name).toBe("test");
  });

  it("allows a provider to omit the filters parameter (backward compat)", () => {
    const provider: SearchProvider = {
      name: "legacy",
      label: "Legacy",
      async search(
        query: string,
        maxResults: number,
        signal?: AbortSignal,
      ): Promise<SearchResult[]> {
        return [];
      },
    };

    expect(provider.name).toBe("legacy");
  });

  it("SearchFilters accepts all optional fields", () => {
    const filters: SearchFilters = {
      includeDomains: ["example.com", "docs.rs"],
      excludeDomains: ["spam.com"],
      startDate: "2025-01-01",
      endDate: "2025-12-31",
    };

    expect(filters.includeDomains).toHaveLength(2);
    expect(filters.excludeDomains).toHaveLength(1);
    expect(filters.startDate).toBe("2025-01-01");
    expect(filters.endDate).toBe("2025-12-31");
  });

  it("SearchFilters accepts empty object", () => {
    const filters: SearchFilters = {};
    expect(filters.includeDomains).toBeUndefined();
    expect(filters.excludeDomains).toBeUndefined();
    expect(filters.startDate).toBeUndefined();
    expect(filters.endDate).toBeUndefined();
  });
});
