import { describe, expect, it, vi } from "vitest";
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

function makeNamedProvider(name: string, results: SearchResult[]): SearchProvider {
  return {
    name,
    label: name,
    async search(_query: string, maxResults: number, _signal?: AbortSignal) {
      return results.slice(0, maxResults);
    },
  };
}

function makeNamedFailingProvider(name: string, message: string): SearchProvider {
  return {
    name,
    label: name,
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
    const tool = createWebSearchTool(() => [makeStubProvider(sampleResults)]);
    expect(tool.name).toBe("web_search");
    expect(tool.label).toBe("Web Search");
    expect(tool.parameters).toBeDefined();
  });

  it("executes search and returns formatted results", async () => {
    const tool = createWebSearchTool(() => [makeStubProvider(sampleResults)]);
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
    const tool = createWebSearchTool(() => [makeFailingProvider("Provider exploded")]);
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

describe("web_search fallback chain", () => {
  const sampleResults: SearchResult[] = [
    { title: "Result", url: "https://example.com", snippet: "test" },
  ];

  it("falls back to second provider when first fails", async () => {
    const failing = makeNamedFailingProvider("brave", "429 Too Many Requests");
    const working = makeNamedProvider("exa", sampleResults);

    const tool = createWebSearchTool(() => [failing, working], vi.fn());
    const ctx = makeCtx();
    const result = await tool.execute("call-1", { query: "test" }, undefined, undefined, ctx);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Result");
    expect(result.details.provider).toBe("exa");
  });

  it("returns aggregate error when all providers fail", async () => {
    const fail1 = makeNamedFailingProvider("brave", "429 Too Many Requests");
    const fail2 = makeNamedFailingProvider("exa", "Request timeout");

    const tool = createWebSearchTool(() => [fail1, fail2], vi.fn());
    const ctx = makeCtx();
    const result = await tool.execute("call-2", { query: "test" }, undefined, undefined, ctx);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("brave: 429 Too Many Requests");
    expect(text).toContain("exa: Request timeout");
  });

  it("records usage only for the successful provider", async () => {
    const failing = makeNamedFailingProvider("brave", "429");
    const working = makeNamedProvider("exa", sampleResults);
    const onSuccess = vi.fn();

    const tool = createWebSearchTool(() => [failing, working], onSuccess);
    const ctx = makeCtx();
    await tool.execute("call-3", { query: "test" }, undefined, undefined, ctx);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith("exa");
  });

  it("returns error when candidates list is empty", async () => {
    const tool = createWebSearchTool(() => [], vi.fn());
    const ctx = makeCtx();
    const result = await tool.execute("call-4", { query: "test" }, undefined, undefined, ctx);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text.toLowerCase()).toContain("no search providers available");
  });
});
