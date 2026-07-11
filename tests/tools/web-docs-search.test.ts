import { describe, expect, it, vi } from "vitest";
import { createWebDocsSearchTool } from "../../src/tools/web-docs-search.ts";
import { makeCtx } from "../helpers.ts";
import type { DocsProvider, DocsSearchResult } from "../../src/providers/types.ts";
import { Context7Error } from "../../src/providers/context7.ts";

function mockDocsProvider(results: DocsSearchResult[] = []): DocsProvider {
  return {
    name: "context7",
    label: "Context7",
    searchLibrary: vi.fn().mockResolvedValue(results),
    getContext: vi.fn().mockResolvedValue(""),
  };
}

const sampleResults: DocsSearchResult[] = [
  {
    id: "/facebook/react",
    name: "React",
    description: "A JavaScript library for building user interfaces",
    totalSnippets: 2500,
    trustScore: 10,
    benchmarkScore: 95.5,
    versions: ["v18.2.0", "v17.0.2"],
  },
  {
    id: "/preactjs/preact",
    name: "Preact",
    description: "Fast 3kB alternative to React",
    totalSnippets: 450,
    trustScore: 8,
    benchmarkScore: 78.0,
  },
];

describe("web_docs_search tool", () => {
  it("has correct tool metadata", () => {
    const tool = createWebDocsSearchTool(() => mockDocsProvider());
    expect(tool.name).toBe("web_docs_search");
    expect(tool.label).toBe("Docs Search");
  });

  it("rejects empty libraryName", async () => {
    const tool = createWebDocsSearchTool(() => mockDocsProvider(sampleResults));
    const ctx = makeCtx();
    await expect(
      tool.execute("call-1", { libraryName: "  ", query: "hooks" }, undefined, undefined, ctx),
    ).rejects.toThrow("libraryName");
  });

  it("rejects empty query", async () => {
    const tool = createWebDocsSearchTool(() => mockDocsProvider(sampleResults));
    const ctx = makeCtx();
    await expect(
      tool.execute("call-1", { libraryName: "react", query: "" }, undefined, undefined, ctx),
    ).rejects.toThrow("query");
  });

  it("returns formatted markdown table on success", async () => {
    const provider = mockDocsProvider(sampleResults);
    const onUpdate = vi.fn();
    const tool = createWebDocsSearchTool(() => provider);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-1",
      { libraryName: "react", query: "state management" },
      undefined,
      onUpdate,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;

    expect(text).toContain("/facebook/react");
    expect(text).toContain("React");
    expect(text).toContain("10"); // trustScore
    expect(text).toContain("95.5"); // benchmarkScore
    expect(text).toContain("2500"); // totalSnippets
    expect(text).toContain("v18.2.0"); // versions
    expect(text).toContain("/preactjs/preact");
    expect(text).toContain("web_docs_fetch"); // footer guidance

    // Verify onUpdate was called for progress
    expect(onUpdate).toHaveBeenCalled();
  });

  it("trims libraryName before calling provider", async () => {
    const provider = mockDocsProvider([]);
    const tool = createWebDocsSearchTool(() => provider);
    const ctx = makeCtx();
    await tool.execute(
      "call-1",
      { libraryName: "  react  ", query: "hooks" },
      undefined,
      undefined,
      ctx,
    );
    expect(provider.searchLibrary).toHaveBeenCalledWith("react", "hooks", undefined);
  });

  it("returns 'no libraries found' for empty results", async () => {
    const tool = createWebDocsSearchTool(() => mockDocsProvider([]));
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-2",
      { libraryName: "nonexistent", query: "anything" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;

    expect(text).toContain("No libraries found");
  });

  it("returns setup message when provider unavailable", async () => {
    const tool = createWebDocsSearchTool(() => undefined);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-3",
      { libraryName: "react", query: "hooks" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;

    expect(text).toContain("CONTEXT7_API_KEY");
  });

  it("throws on API errors", async () => {
    const failing: DocsProvider = {
      name: "context7",
      label: "Context7",
      searchLibrary: vi.fn().mockRejectedValue(new Context7Error("Rate limited.")),
      getContext: vi.fn(),
    };
    const tool = createWebDocsSearchTool(() => failing);
    const ctx = makeCtx();

    await expect(
      tool.execute("call-4", { libraryName: "react", query: "hooks" }, undefined, undefined, ctx),
    ).rejects.toThrow(Context7Error);
  });

  it("passes signal to provider", async () => {
    const provider = mockDocsProvider([]);
    const tool = createWebDocsSearchTool(() => provider);
    const ctx = makeCtx();
    const controller = new AbortController();

    await tool.execute(
      "call-5",
      { libraryName: "react", query: "hooks" },
      controller.signal,
      undefined,
      ctx,
    );

    expect(provider.searchLibrary).toHaveBeenCalledWith("react", "hooks", controller.signal);
  });

  it("limits visible results to 10 and shows overflow note", async () => {
    const manyResults = Array.from({ length: 12 }, (_, i) => ({
      id: `/org/lib-${i}`,
      name: `Library ${i}`,
      description: `Description ${i}`,
      totalSnippets: 100 + i,
      trustScore: 8,
      benchmarkScore: 90 + i,
      versions: ["v1", "v2", "v3", "v4", "v5", "v6", "v7"],
    }));
    const tool = createWebDocsSearchTool(() => mockDocsProvider(manyResults));
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-6",
      { libraryName: "lib", query: "docs" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;

    expect(text).toContain("showing top 10");
    expect(text).toContain("2 more omitted");
    expect(text).toContain("v1, v2, v3, v4, v5, +2"); // MAX_VERSION_COUNT=5
    expect(text).not.toContain("/org/lib-10");
  });
});
