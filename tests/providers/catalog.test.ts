import { describe, expect, it } from "vitest";
import {
  allProviders,
  defaultProviderConfigs,
  fallbackEnvMap,
  providerCatalog,
} from "../../src/providers/catalog.ts";

describe("provider catalog", () => {
  it("has one entry per provider and no duplicate names", () => {
    const names = providerCatalog.map(({ meta }) => meta.name);
    expect(names.length).toBe(23);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(allProviders.map(({ name }) => name))).toEqual(new Set(names));
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
      "tinyfish",
      "websearchapi",
      "youcom",
    ]);
    expect(allProviders.map(({ name }) => name)).toEqual([
      "brave",
      "brave-llm",
      "fastcrw",
      "langsearch",
      "linkup",
      "marginalia",
      "perplexity",
      "websearchapi",
      "youcom",
      "context7",
      "duckduckgo",
      "exa",
      "firecrawl",
      "jina",
      "ollama",
      "openai-codex",
      "openai-web-search",
      "parallel",
      "searxng",
      "serper",
      "sofya",
      "tavily",
      "tinyfish",
    ]);
    expect(Object.keys(defaultProviderConfigs)).toEqual(names);
  });

  it("has a valid default config for every provider", () => {
    for (const { meta, defaultConfig } of providerCatalog) {
      expect(defaultProviderConfigs[meta.name]).toEqual(defaultConfig);
      expect(typeof defaultConfig.enabled).toBe("boolean");
      expect(defaultConfig.budget.mode).toMatch(/^(hard|managed|unlimited)$/);
    }
  });

  it("keeps fallback env mappings in the catalog projection", () => {
    expect(fallbackEnvMap.brave).toBe("BRAVE_API_KEY");
    expect(fallbackEnvMap.exa).toBe("EXA_API_KEY");
    expect(fallbackEnvMap.gemini).toBe("GEMINI_API_KEY");
    expect(fallbackEnvMap["openai-codex"]).toBeUndefined();
  });
});
