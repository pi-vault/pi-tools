import { describe, expect, it } from "vitest";
import { allProviders } from "../../src/providers/all.ts";

describe("allProviders barrel", () => {
  it("exports exactly 22 providers", () => {
    expect(allProviders).toHaveLength(22);
  });

  it("every entry has required ProviderMeta fields", () => {
    for (const meta of allProviders) {
      expect(meta.name).toBeTypeOf("string");
      expect([1, 2, 3]).toContain(meta.tier);
      expect(meta).not.toHaveProperty("monthlyQuota");
      expect(meta.requiresKey).toBeTypeOf("boolean");
      expect(meta.create).toBeTypeOf("function");
    }
  });

  it("defines callbacks only for non-unit operation costs", () => {
    expect(
      allProviders
        .filter((meta) => meta.usageCost)
        .map((meta) => meta.name)
        .sort(),
    ).toEqual(["brave", "brave-llm", "exa", "firecrawl", "linkup", "youcom"]);
  });

  it("calculates Exa search, content, and deep-search costs", () => {
    const usageCost = allProviders.find((meta) => meta.name === "exa")!.usageCost!;
    const config = { enabled: true, budget: { mode: "managed" as const } };

    expect(usageCost({ capability: "search", maxResults: 10 }, config)).toBe(0.007);
    expect(usageCost({ capability: "search", maxResults: 11 }, config)).toBe(0.008);
    expect(usageCost({ capability: "code-search", maxResults: 25 }, config)).toBe(0.022);
    expect(usageCost({ capability: "fetch" }, config)).toBe(0.001);
    expect(
      usageCost(
        { capability: "research", type: "deep-lite", maxResults: 10, contentTypes: 2 },
        config,
      ),
    ).toBe(0.032);
    expect(
      usageCost(
        { capability: "research", type: "deep-reasoning", maxResults: 12, contentTypes: 3 },
        config,
      ),
    ).toBeCloseTo(0.053, 6);
  });

  it("calculates Firecrawl search and fetch credits", () => {
    const usageCost = allProviders.find((meta) => meta.name === "firecrawl")!.usageCost!;
    const config = { enabled: true, budget: { mode: "managed" as const } };

    expect(usageCost({ capability: "search", maxResults: 1 }, config)).toBe(2);
    expect(usageCost({ capability: "search", maxResults: 0 }, config)).toBe(2);
    expect(usageCost({ capability: "search", maxResults: 10 }, config)).toBe(2);
    expect(usageCost({ capability: "search", maxResults: 11 }, config)).toBe(4);
    expect(usageCost({ capability: "fetch" }, config)).toBe(1);
  });

  it("has no duplicate names", () => {
    const names = allProviders.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("contains all expected provider names", () => {
    const names = allProviders.map((m) => m.name).sort();
    expect(names).toEqual([
      "brave",
      "brave-llm",
      "context7",
      "duckduckgo",
      "exa",
      "fastcrw",
      "firecrawl",
      "jina",
      "langsearch",
      "linkup",
      "marginalia",
      "ollama",
      "openai-codex",
      "openai-web-search",
      "parallel",
      "perplexity",
      "searxng",
      "serper",
      "sofya",
      "tavily",
      "websearchapi",
      "youcom",
    ]);
  });
});
