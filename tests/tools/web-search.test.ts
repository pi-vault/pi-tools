import { describe, expect, it, vi } from "vitest";
import { createWebSearchTool } from "../../src/tools/web-search.ts";
import { makeCtx } from "../helpers.ts";
import type { SearchFilters, SearchProvider, SearchResult } from "../../src/providers/types.ts";

function makeProvider(name: string, results: SearchResult[]): SearchProvider {
  return {
    name,
    label: name,
    async search(_query: string, maxResults: number, _signal?: AbortSignal) {
      return results.slice(0, maxResults);
    },
  };
}

function makeFailingProvider(name: string, message: string): SearchProvider {
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
    const tool = createWebSearchTool(() => [makeProvider("stub", sampleResults)]);
    expect(tool.name).toBe("web_search");
    expect(tool.label).toBe("Web Search");
    expect(tool.parameters).toBeDefined();
  });

  it("executes search and returns formatted results", async () => {
    const tool = createWebSearchTool(() => [makeProvider("stub", sampleResults)]);
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
    const tool = createWebSearchTool(() => [makeFailingProvider("stub", "Provider exploded")]);
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
    const failing = makeFailingProvider("brave", "429 Too Many Requests");
    const working = makeProvider("exa", sampleResults);

    const tool = createWebSearchTool(() => [failing, working], vi.fn());
    const ctx = makeCtx();
    const result = await tool.execute("call-1", { query: "test" }, undefined, undefined, ctx);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Result");
    expect(result.details.provider).toBe("exa");
  });

  it("returns aggregate error when all providers fail", async () => {
    const fail1 = makeFailingProvider("brave", "429 Too Many Requests");
    const fail2 = makeFailingProvider("exa", "Request timeout");

    const tool = createWebSearchTool(() => [fail1, fail2], vi.fn());
    const ctx = makeCtx();
    const result = await tool.execute("call-2", { query: "test" }, undefined, undefined, ctx);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("brave: 429 Too Many Requests");
    expect(text).toContain("exa: Request timeout");
  });

  it("records usage only for the successful provider", async () => {
    const failing = makeFailingProvider("brave", "429");
    const working = makeProvider("exa", sampleResults);
    const onSuccess = vi.fn();

    const tool = createWebSearchTool(() => [failing, working], onSuccess);
    const ctx = makeCtx();
    await tool.execute("call-3", { query: "test" }, undefined, undefined, ctx);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    const [name, latency] = onSuccess.mock.calls[0] as [string, number];
    expect(name).toBe("exa");
    expect(typeof latency).toBe("number");
  });

  it("returns error when candidates list is empty", async () => {
    const tool = createWebSearchTool(() => [], vi.fn());
    const ctx = makeCtx();
    const result = await tool.execute("call-4", { query: "test" }, undefined, undefined, ctx);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text.toLowerCase()).toContain("no search providers available");
  });
});

function makeCapturingProvider(): {
  provider: SearchProvider;
  captured: { query: string; filters?: SearchFilters }[];
} {
  const captured: { query: string; filters?: SearchFilters }[] = [];
  const provider: SearchProvider = {
    name: "capturing",
    label: "Capturing",
    async search(
      query: string,
      maxResults: number,
      signal?: AbortSignal,
      filters?: SearchFilters,
    ): Promise<SearchResult[]> {
      captured.push({ query, filters });
      return [
        { title: "Captured Result", url: "https://example.com", snippet: "captured" },
      ];
    },
  };
  return { provider, captured };
}

describe("web_search filter parameters", () => {
  it("passes includeDomains to the provider as SearchFilters", async () => {
    const { provider, captured } = makeCapturingProvider();
    const tool = createWebSearchTool(() => [provider]);
    const ctx = makeCtx();
    await tool.execute(
      "call-f1",
      { query: "test", includeDomains: ["example.com", "docs.rs"] },
      undefined,
      undefined,
      ctx,
    );
    expect(captured).toHaveLength(1);
    expect(captured[0].filters?.includeDomains).toEqual(["example.com", "docs.rs"]);
  });

  it("passes excludeDomains to the provider as SearchFilters", async () => {
    const { provider, captured } = makeCapturingProvider();
    const tool = createWebSearchTool(() => [provider]);
    const ctx = makeCtx();
    await tool.execute(
      "call-f2",
      { query: "test", excludeDomains: ["spam.com"] },
      undefined,
      undefined,
      ctx,
    );
    expect(captured).toHaveLength(1);
    expect(captured[0].filters?.excludeDomains).toEqual(["spam.com"]);
  });

  it("passes startDate and endDate to the provider as SearchFilters", async () => {
    const { provider, captured } = makeCapturingProvider();
    const tool = createWebSearchTool(() => [provider]);
    const ctx = makeCtx();
    await tool.execute(
      "call-f3",
      { query: "test", startDate: "2025-01-01", endDate: "2025-12-31" },
      undefined,
      undefined,
      ctx,
    );
    expect(captured).toHaveLength(1);
    expect(captured[0].filters?.startDate).toBe("2025-01-01");
    expect(captured[0].filters?.endDate).toBe("2025-12-31");
  });

  it("passes all filter fields together", async () => {
    const { provider, captured } = makeCapturingProvider();
    const tool = createWebSearchTool(() => [provider]);
    const ctx = makeCtx();
    await tool.execute(
      "call-f4",
      {
        query: "test",
        includeDomains: ["example.com"],
        excludeDomains: ["spam.com"],
        startDate: "2025-01-01",
        endDate: "2025-06-30",
      },
      undefined,
      undefined,
      ctx,
    );
    expect(captured).toHaveLength(1);
    expect(captured[0].filters).toEqual({
      includeDomains: ["example.com"],
      excludeDomains: ["spam.com"],
      startDate: "2025-01-01",
      endDate: "2025-06-30",
    });
  });

  it("passes undefined filters when no filter params are provided", async () => {
    const { provider, captured } = makeCapturingProvider();
    const tool = createWebSearchTool(() => [provider]);
    const ctx = makeCtx();
    await tool.execute(
      "call-f5",
      { query: "test" },
      undefined,
      undefined,
      ctx,
    );
    expect(captured).toHaveLength(1);
    expect(captured[0].filters).toBeUndefined();
  });

  it("filters out empty strings from domain arrays", async () => {
    const { provider, captured } = makeCapturingProvider();
    const tool = createWebSearchTool(() => [provider]);
    const ctx = makeCtx();
    await tool.execute(
      "call-f6",
      { query: "test", includeDomains: ["", "example.com", "  "] },
      undefined,
      undefined,
      ctx,
    );
    expect(captured).toHaveLength(1);
    expect(captured[0].filters?.includeDomains).toEqual(["example.com"]);
  });

  it("returns undefined filters when all domains are empty strings", async () => {
    const { provider, captured } = makeCapturingProvider();
    const tool = createWebSearchTool(() => [provider]);
    const ctx = makeCtx();
    await tool.execute(
      "call-f7",
      { query: "test", includeDomains: ["", "  "] },
      undefined,
      undefined,
      ctx,
    );
    expect(captured).toHaveLength(1);
    expect(captured[0].filters).toBeUndefined();
  });

  it("strips invalid date formats (non-ISO)", async () => {
    const { provider, captured } = makeCapturingProvider();
    const tool = createWebSearchTool(() => [provider]);
    const ctx = makeCtx();
    await tool.execute(
      "call-f8",
      { query: "test", startDate: "01/01/2025", endDate: "not-a-date" },
      undefined,
      undefined,
      ctx,
    );
    expect(captured).toHaveLength(1);
    expect(captured[0].filters).toBeUndefined();
  });

  it("keeps valid ISO dates and strips invalid ones", async () => {
    const { provider, captured } = makeCapturingProvider();
    const tool = createWebSearchTool(() => [provider]);
    const ctx = makeCtx();
    await tool.execute(
      "call-f9",
      { query: "test", startDate: "2025-01-01", endDate: "invalid" },
      undefined,
      undefined,
      ctx,
    );
    expect(captured).toHaveLength(1);
    expect(captured[0].filters?.startDate).toBe("2025-01-01");
    expect(captured[0].filters?.endDate).toBeUndefined();
  });
});

describe("web_search compact output", () => {
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

  it("returns compact single-line format when compact=true", async () => {
    const tool = createWebSearchTool(() => [makeProvider("stub", sampleResults)]);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-c1",
      { query: "test", compact: true },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toBe(
      "1. TypeScript -- https://typescriptlang.org\n2. MDN Web Docs -- https://developer.mozilla.org",
    );
  });

  it("returns full format when compact is not set", async () => {
    const tool = createWebSearchTool(() => [makeProvider("stub", sampleResults)]);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-c2",
      { query: "test" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("[TypeScript]");
    expect(text).toContain("A typed superset of JavaScript");
  });

  it("returns full format when compact=false", async () => {
    const tool = createWebSearchTool(() => [makeProvider("stub", sampleResults)]);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-c3",
      { query: "test", compact: false },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("[TypeScript]");
    expect(text).toContain("A typed superset of JavaScript");
  });

  it("returns 'No results found.' in compact mode with empty results", async () => {
    const tool = createWebSearchTool(() => [makeProvider("stub", [])]);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-c4",
      { query: "test", compact: true },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toBe("No results found.");
  });
});

describe("web_search metrics callbacks", () => {
  const sampleResults: SearchResult[] = [
    { title: "Result", url: "https://example.com", snippet: "Test" },
  ];

  it("calls onSuccess with provider name and latencyMs on success", async () => {
    const onSuccess = vi.fn();
    const tool = createWebSearchTool(
      () => [makeProvider("brave", sampleResults)],
      onSuccess,
    );
    const ctx = makeCtx();
    await tool.execute("id", { query: "test" }, undefined, undefined, ctx);

    expect(onSuccess).toHaveBeenCalledOnce();
    const [name, latency] = onSuccess.mock.calls[0] as [string, number];
    expect(name).toBe("brave");
    expect(typeof latency).toBe("number");
    expect(latency).toBeGreaterThanOrEqual(0);
  });

  it("calls onFailure when a provider fails", async () => {
    const onFailure = vi.fn();
    const provider: SearchProvider = {
      name: "brave",
      label: "Brave",
      search: vi.fn().mockRejectedValue(new Error("API error")),
    };
    const tool = createWebSearchTool(
      () => [provider],
      undefined,
      undefined,
      onFailure,
    );
    const ctx = makeCtx();
    await tool.execute("id", { query: "test" }, undefined, undefined, ctx);

    expect(onFailure).toHaveBeenCalledWith("brave");
  });

  it("does not call onFailure for a successful provider", async () => {
    const onSuccess = vi.fn();
    const onFailure = vi.fn();
    const tool = createWebSearchTool(
      () => [makeProvider("brave", sampleResults)],
      onSuccess,
      undefined,
      onFailure,
    );
    const ctx = makeCtx();
    await tool.execute("id", { query: "test" }, undefined, undefined, ctx);

    expect(onSuccess).toHaveBeenCalledOnce();
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("calls onResult with provider name, result count, and requested count", async () => {
    const onResult = vi.fn();
    const tool = createWebSearchTool(
      () => [makeProvider("brave", sampleResults)],
      vi.fn(),
      undefined,
      undefined,
      onResult,
    );
    const ctx = makeCtx();
    await tool.execute(
      "id",
      { query: "test", numResults: 10 },
      undefined,
      undefined,
      ctx,
    );

    expect(onResult).toHaveBeenCalledOnce();
    expect(onResult).toHaveBeenCalledWith("brave", 1, 10);
  });

  it("does not call onResult when all providers fail", async () => {
    const onResult = vi.fn();
    const tool = createWebSearchTool(
      () => [makeFailingProvider("brave", "API error")],
      undefined,
      undefined,
      undefined,
      onResult,
    );
    const ctx = makeCtx();
    await tool.execute("id", { query: "test" }, undefined, undefined, ctx);

    expect(onResult).not.toHaveBeenCalled();
  });

  it("calls onResult with default numResults when not specified", async () => {
    const onResult = vi.fn();
    const tool = createWebSearchTool(
      () => [makeProvider("brave", sampleResults)],
      vi.fn(),
      undefined,
      undefined,
      onResult,
    );
    const ctx = makeCtx();
    await tool.execute("id", { query: "test" }, undefined, undefined, ctx);

    expect(onResult).toHaveBeenCalledWith("brave", 1, 5);
  });

  it("calls onResult with zero result count when provider returns empty", async () => {
    const onResult = vi.fn();
    const tool = createWebSearchTool(
      () => [makeProvider("brave", [])],
      vi.fn(),
      undefined,
      undefined,
      onResult,
    );
    const ctx = makeCtx();
    await tool.execute("id", { query: "test" }, undefined, undefined, ctx);

    expect(onResult).toHaveBeenCalledWith("brave", 0, 5);
  });
});
