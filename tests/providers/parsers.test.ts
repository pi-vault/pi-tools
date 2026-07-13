import { describe, expect, it } from "vitest";
import { parseLangSearchResults, parseMarginaliaResults } from "../../src/providers/parsers.ts";

describe("parseMarginaliaResults", () => {
  it("maps valid response data to SearchResult[]", () => {
    const data = {
      results: [
        {
          title: "Indie Web",
          url: "https://indieweb.org",
          description: "A community of independent web creators",
        },
        {
          title: "Small Tech",
          url: "https://small-tech.org",
          description: "Technology for people",
        },
      ],
    };

    const results = parseMarginaliaResults(data);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "Indie Web",
      url: "https://indieweb.org",
      snippet: "A community of independent web creators",
    });
    expect(results[1]).toEqual({
      title: "Small Tech",
      url: "https://small-tech.org",
      snippet: "Technology for people",
    });
  });

  it("returns empty array for null input", () => {
    expect(parseMarginaliaResults(null)).toEqual([]);
  });

  it("returns empty array for non-object input", () => {
    expect(parseMarginaliaResults("string")).toEqual([]);
    expect(parseMarginaliaResults(42)).toEqual([]);
    expect(parseMarginaliaResults(undefined)).toEqual([]);
  });

  it("returns empty array when results field is missing", () => {
    expect(parseMarginaliaResults({})).toEqual([]);
    expect(parseMarginaliaResults({ other: "field" })).toEqual([]);
  });

  it("returns empty array when results is not an array", () => {
    expect(parseMarginaliaResults({ results: "not-array" })).toEqual([]);
    expect(parseMarginaliaResults({ results: 123 })).toEqual([]);
  });

  it("truncates snippets to 500 characters", () => {
    const longDescription = "x".repeat(600);
    const data = {
      results: [
        {
          title: "Long",
          url: "https://example.com",
          description: longDescription,
        },
      ],
    };

    const results = parseMarginaliaResults(data);

    expect(results[0].snippet).toHaveLength(500);
    expect(results[0].snippet).toBe("x".repeat(500));
  });

  it("handles items with missing fields gracefully", () => {
    const data = {
      results: [{ title: "Only Title" }, { url: "https://only-url.com" }, {}],
    };

    const results = parseMarginaliaResults(data);

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ title: "Only Title", url: "", snippet: "" });
    expect(results[1]).toEqual({
      title: "",
      url: "https://only-url.com",
      snippet: "",
    });
    expect(results[2]).toEqual({ title: "", url: "", snippet: "" });
  });
});

describe("parseLangSearchResults", () => {
  it("parses nested webPages.value response", () => {
    const data = {
      data: {
        webPages: {
          value: [
            {
              name: "LangSearch Docs",
              url: "https://langsearch.com/docs",
              snippet: "Documentation for LangSearch API",
            },
            {
              name: "Getting Started",
              url: "https://langsearch.com/start",
              snippet: "Quick start guide",
            },
          ],
        },
      },
    };
    const results = parseLangSearchResults(data);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "LangSearch Docs",
      url: "https://langsearch.com/docs",
      snippet: "Documentation for LangSearch API",
    });
    expect(results[1].title).toBe("Getting Started");
  });

  it("falls back to results array when webPages is absent", () => {
    const data = {
      results: [
        {
          title: "Fallback Result",
          link: "https://example.com",
          description: "A fallback",
        },
      ],
    };
    const results = parseLangSearchResults(data);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      title: "Fallback Result",
      url: "https://example.com",
      snippet: "A fallback",
    });
  });

  it("returns empty array for null/undefined input", () => {
    expect(parseLangSearchResults(null)).toEqual([]);
    expect(parseLangSearchResults(undefined)).toEqual([]);
  });

  it("returns empty array for malformed input", () => {
    expect(parseLangSearchResults("string")).toEqual([]);
    expect(
      parseLangSearchResults({ data: { webPages: { value: "not-array" } } }),
    ).toEqual([]);
  });

  it("truncates snippets to 500 characters", () => {
    const longSnippet = "x".repeat(600);
    const data = {
      data: {
        webPages: {
          value: [
            { name: "Long", url: "https://example.com", snippet: longSnippet },
          ],
        },
      },
    };
    const results = parseLangSearchResults(data);
    expect(results[0].snippet).toHaveLength(500);
  });

  it("prefers name over title field", () => {
    const data = {
      data: {
        webPages: {
          value: [
            { name: "Name", title: "Title", url: "https://example.com", snippet: "s" },
          ],
        },
      },
    };
    const results = parseLangSearchResults(data);
    expect(results[0].title).toBe("Name");
  });

  it("falls back to data array when webPages and results are absent", () => {
    const data = {
      data: [
        { name: "Direct Data", url: "https://example.com", snippet: "test" },
      ],
    };
    const results = parseLangSearchResults(data);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      title: "Direct Data",
      url: "https://example.com",
      snippet: "test",
    });
  });

  it("handles items with missing fields gracefully", () => {
    const data = {
      data: {
        webPages: {
          value: [{ name: "Only Name" }, { url: "https://only-url.com" }, {}],
        },
      },
    };
    const results = parseLangSearchResults(data);
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ title: "Only Name", url: "", snippet: "" });
    expect(results[1]).toEqual({ title: "", url: "https://only-url.com", snippet: "" });
    expect(results[2]).toEqual({ title: "", url: "", snippet: "" });
  });
});
