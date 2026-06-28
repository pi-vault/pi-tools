import { describe, expect, it } from "vitest";
import type {
  CodeSearchProvider,
  CodeSearchResult,
  FetchProvider,
  FetchResult,
  ProviderMeta,
  SearchProvider,
  SearchResult,
} from "../../src/providers/types.ts";

describe("provider types", () => {
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

  it("CodeSearchResult includes optional language", () => {
    const result: CodeSearchResult = {
      title: "Code Example",
      url: "https://github.com/example",
      snippet: "const x = 1;",
      language: "typescript",
    };
    expect(result.language).toBe("typescript");

    const noLang: CodeSearchResult = {
      title: "Code",
      url: "https://example.com",
      snippet: "code",
    };
    expect(noLang.language).toBeUndefined();
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

  it("ProviderMeta describes provider characteristics", () => {
    const meta: ProviderMeta = {
      name: "brave",
      label: "Brave Search",
      tier: 1,
      requiresKey: true,
      defaultMonthlyQuota: 2000,
      capabilities: { search: true },
    };
    expect(meta.tier).toBe(1);
    expect(meta.requiresKey).toBe(true);
    expect(meta.capabilities.search).toBe(true);
    expect(meta.capabilities.fetch).toBeUndefined();
  });
});
