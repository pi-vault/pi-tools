import { describe, expect, it } from "vitest";
import { allProviders } from "../../src/providers/all.ts";

describe("allProviders barrel", () => {
  it("exports exactly 13 providers", () => {
    expect(allProviders).toHaveLength(13);
  });

  it("every entry has required ProviderMeta fields", () => {
    for (const meta of allProviders) {
      expect(meta.name).toBeTypeOf("string");
      expect([1, 2, 3]).toContain(meta.tier);
      expect(meta.monthlyQuota === null || typeof meta.monthlyQuota === "number").toBe(true);
      expect(meta.requiresKey).toBeTypeOf("boolean");
      expect(meta.create).toBeTypeOf("function");
    }
  });

  it("has no duplicate names", () => {
    const names = allProviders.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("contains all expected provider names", () => {
    const names = allProviders.map((m) => m.name).sort();
    expect(names).toEqual([
      "brave",
      "duckduckgo",
      "exa",
      "exa-mcp",
      "firecrawl",
      "jina",
      "openai-native",
      "parallel",
      "perplexity",
      "searxng",
      "serper",
      "tavily",
      "websearchapi",
    ]);
  });
});
