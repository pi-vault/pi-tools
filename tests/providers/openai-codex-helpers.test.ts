// tests/providers/openai-codex-helpers.test.ts
import { describe, expect, it } from "vitest";
import { injectCodexSearchPayload, normalizeCodexToolCallResults } from "../../src/providers/openai-codex.ts";

describe("injectCodexSearchPayload", () => {
  it("adds web_search tool with external_web_access and search_context_size", () => {
    const result = injectCodexSearchPayload({}) as Record<string, unknown>;
    const tools = result.tools as Array<Record<string, unknown>>;
    expect(tools[0]).toEqual({
      type: "web_search",
      external_web_access: true,
      search_context_size: "low",
    });
  });

  it("removes existing web_search tools and preserves others", () => {
    const input = { tools: [{ type: "web_search" }, { type: "function", name: "foo" }] };
    const result = injectCodexSearchPayload(input) as Record<string, unknown>;
    const tools = result.tools as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(2);
    expect(tools[1]).toEqual({ type: "function", name: "foo" });
  });

  it("sets tool_choice to auto and disables parallel_tool_calls", () => {
    const result = injectCodexSearchPayload({}) as Record<string, unknown>;
    expect(result.tool_choice).toBe("auto");
    expect(result.parallel_tool_calls).toBe(false);
  });

  it("adds web_search_call.action.sources to include array", () => {
    const result = injectCodexSearchPayload({}) as Record<string, unknown>;
    expect(result.include).toContain("web_search_call.action.sources");
  });

  it("preserves existing include entries without duplicating", () => {
    const input = { include: ["existing_value", "web_search_call.action.sources"] };
    const result = injectCodexSearchPayload(input) as Record<string, unknown>;
    const include = result.include as string[];
    expect(include).toContain("existing_value");
    expect(include.filter((v) => v === "web_search_call.action.sources")).toHaveLength(1);
  });
});

describe("normalizeCodexToolCallResults", () => {
  it("extracts valid results from tool call arguments", () => {
    const args = {
      results: [
        { title: "Test", url: "https://example.com/page", snippet: "Description" },
      ],
    };
    const results = normalizeCodexToolCallResults(args, 10);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      title: "Test",
      url: "https://example.com/page",
      snippet: "Description",
    });
  });

  it("deduplicates by normalized URL (strips hash fragments)", () => {
    const args = {
      results: [
        { title: "A", url: "https://example.com/page#section1", snippet: "First" },
        { title: "B", url: "https://example.com/page#section2", snippet: "Second" },
      ],
    };
    const results = normalizeCodexToolCallResults(args, 10);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("A");
  });

  it("rejects non-http URLs", () => {
    const args = {
      results: [
        { title: "FTP", url: "ftp://example.com", snippet: "Bad protocol" },
        { title: "Good", url: "https://example.com", snippet: "OK" },
      ],
    };
    const results = normalizeCodexToolCallResults(args, 10);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Good");
  });

  it("respects maxResults limit", () => {
    const args = {
      results: Array.from({ length: 20 }, (_, i) => ({
        title: `Site ${i}`, url: `https://site${i}.com`, snippet: `Snippet ${i}`,
      })),
    };
    const results = normalizeCodexToolCallResults(args, 5);
    expect(results).toHaveLength(5);
  });

  it("truncates long titles and snippets", () => {
    const args = {
      results: [{
        title: "X".repeat(300),
        url: "https://example.com",
        snippet: "Y".repeat(1500),
      }],
    };
    const results = normalizeCodexToolCallResults(args, 10);
    expect(results[0].title.length).toBe(200);
    expect(results[0].snippet.length).toBe(1000);
  });

  it("returns empty array for invalid arguments", () => {
    expect(normalizeCodexToolCallResults(null, 10)).toEqual([]);
    expect(normalizeCodexToolCallResults({}, 10)).toEqual([]);
    expect(normalizeCodexToolCallResults({ results: "not array" }, 10)).toEqual([]);
  });

  it("uses hostname as fallback title when title is empty", () => {
    const args = {
      results: [{ title: "", url: "https://example.com/path", snippet: "Content" }],
    };
    const results = normalizeCodexToolCallResults(args, 10);
    expect(results[0].title).toBe("example.com");
  });
});
