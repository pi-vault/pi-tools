import { describe, expect, it } from "vitest";
import { createWebSearchTool } from "../../src/tools/web-search.ts";
import { makeCtx } from "../helpers.ts";
import type { SearchProvider, SearchResult } from "../../src/providers/types.ts";

function makeStubProvider(results: SearchResult[]): SearchProvider {
  return {
    name: "stub",
    label: "Stub",
    async search(_query: string, maxResults: number, _signal?: AbortSignal) {
      return results.slice(0, maxResults);
    },
  };
}

function makeFailingProvider(message: string): SearchProvider {
  return {
    name: "stub",
    label: "Stub",
    async search() {
      throw new Error(message);
    },
  };
}

describe("web_search tool", () => {
  const sampleResults: SearchResult[] = [
    {
      title: "TypeScript",
      url: "https://typescriptlang.org",
      snippet: "A typed superset of JavaScript",
    },
    {
      title: "MDN Web Docs",
      url: "https://developer.mozilla.org",
      snippet: "Web technology reference",
    },
  ];

  it("has correct tool metadata", () => {
    const tool = createWebSearchTool(() => makeStubProvider(sampleResults));
    expect(tool.name).toBe("web_search");
    expect(tool.label).toBe("Web Search");
    expect(tool.parameters).toBeDefined();
  });

  it("executes search and returns formatted results", async () => {
    const tool = createWebSearchTool(() => makeStubProvider(sampleResults));
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-1",
      { query: "typescript" },
      undefined,
      undefined,
      ctx,
    );
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content[0]).toHaveProperty("type", "text");
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("TypeScript");
    expect(text).toContain("https://typescriptlang.org");
  });

  it("returns error result on provider failure", async () => {
    const tool = createWebSearchTool(() =>
      makeFailingProvider("Provider exploded"),
    );
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-2",
      { query: "test" },
      undefined,
      undefined,
      ctx,
    );
    // Tool should not throw — it returns an error in content
    expect(result.content[0]).toHaveProperty("type", "text");
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text.toLowerCase()).toContain("error");
  });
});
