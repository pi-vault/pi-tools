import { describe, expect, it } from "vitest";
import {
  parseBraveLlmResults,
  parseBraveResults,
  parseDuckDuckGoResults,
  parseLangSearchResults,
  parseMarginaliaResults,
  parseOpenAINativeResults,
  parsePerplexityResults,
  parseSerperResults,
  parseWebSearchApiResults,
} from "../../src/providers/parsers.ts";

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

describe("parseBraveLlmResults", () => {
  it("maps grounding.generic entries to SearchResult[]", () => {
    const data = {
      grounding: {
        generic: [
          {
            url: "https://brave.com/about",
            title: "About Brave",
            snippets: [
              "Brave Search is a privacy-focused search engine.",
              "It does not track users.",
            ],
          },
          {
            url: "https://brave.com/ai",
            title: "Brave AI",
            snippets: ["Brave offers AI-powered search summaries."],
          },
        ],
      },
    };
    const results = parseBraveLlmResults(data);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "About Brave",
      url: "https://brave.com/about",
      snippet:
        "Brave Search is a privacy-focused search engine.\n\nIt does not track users.",
    });
    expect(results[1]).toEqual({
      title: "Brave AI",
      url: "https://brave.com/ai",
      snippet: "Brave offers AI-powered search summaries.",
    });
  });

  it("returns empty array when grounding is missing", () => {
    expect(parseBraveLlmResults({})).toEqual([]);
    expect(parseBraveLlmResults({ grounding: null })).toEqual([]);
  });

  it("returns empty array for null/undefined input", () => {
    expect(parseBraveLlmResults(null)).toEqual([]);
    expect(parseBraveLlmResults(undefined)).toEqual([]);
  });

  it("returns empty array when generic is not an array", () => {
    expect(parseBraveLlmResults({ grounding: {} })).toEqual([]);
    expect(
      parseBraveLlmResults({ grounding: { generic: "not-array" } }),
    ).toEqual([]);
  });

  it("handles entries with missing fields gracefully", () => {
    const data = {
      grounding: {
        generic: [
          { snippets: ["Some content without url/title metadata"] },
          { url: "https://example.com", title: "Has URL" },
          {},
        ],
      },
    };
    const results = parseBraveLlmResults(data);
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({
      title: "",
      url: "",
      snippet: "Some content without url/title metadata",
    });
    expect(results[1]).toEqual({
      title: "Has URL",
      url: "https://example.com",
      snippet: "",
    });
    expect(results[2]).toEqual({
      title: "",
      url: "",
      snippet: "",
    });
  });

  it("joins multiple snippets with double newline", () => {
    const data = {
      grounding: {
        generic: [
          {
            url: "https://example.com",
            title: "Multi",
            snippets: ["First chunk.", "Second chunk.", "Third chunk."],
          },
        ],
      },
    };
    const results = parseBraveLlmResults(data);
    expect(results[0].snippet).toBe(
      "First chunk.\n\nSecond chunk.\n\nThird chunk.",
    );
  });

  it("handles empty snippets array", () => {
    const data = {
      grounding: {
        generic: [
          { url: "https://example.com", title: "Empty", snippets: [] },
        ],
      },
    };
    const results = parseBraveLlmResults(data);
    expect(results[0].snippet).toBe("");
  });

  it("handles null entries in generic array gracefully", () => {
    const data = {
      grounding: {
        generic: [
          null,
          { url: "https://example.com", title: "Valid", snippets: ["test"] },
        ],
      },
    };
    const results = parseBraveLlmResults(data);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ title: "", url: "", snippet: "" });
    expect(results[1]).toEqual({
      title: "Valid",
      url: "https://example.com",
      snippet: "test",
    });
  });

  it("handles non-array snippets gracefully", () => {
    const data = {
      grounding: {
        generic: [
          { url: "https://example.com", title: "Bad", snippets: "not-array" },
        ],
      },
    };
    const results = parseBraveLlmResults(data);
    expect(results[0].snippet).toBe("");
  });
});

describe("parseBraveResults", () => {
  it("extracts results from valid response", () => {
    const data = {
      web: {
        results: [
          { title: "Brave Result", url: "https://brave.com", description: "A snippet" },
          { title: "Second", url: "https://example.com", description: "Another" },
        ],
      },
    };
    const results = parseBraveResults(data);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "Brave Result",
      url: "https://brave.com",
      snippet: "A snippet",
    });
  });

  it("returns [] for malformed input", () => {
    expect(parseBraveResults(null)).toEqual([]);
    expect(parseBraveResults(undefined)).toEqual([]);
    expect(parseBraveResults({})).toEqual([]);
    expect(parseBraveResults({ web: {} })).toEqual([]);
    expect(parseBraveResults({ web: { results: "not-array" } })).toEqual([]);
  });

  it("truncates snippets to 500 chars", () => {
    const long = "x".repeat(600);
    const data = { web: { results: [{ title: "T", url: "http://u", description: long }] } };
    const results = parseBraveResults(data);
    expect(results[0].snippet).toHaveLength(500);
  });

  it("handles items with missing fields gracefully", () => {
    const data = { web: { results: [{ title: "Only Title" }, {}] } };
    const results = parseBraveResults(data);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ title: "Only Title", url: "", snippet: "" });
    expect(results[1]).toEqual({ title: "", url: "", snippet: "" });
  });
});

describe("parseSerperResults", () => {
  it("extracts results from valid response", () => {
    const data = {
      organic: [
        { title: "Google Result", link: "https://google.com/1", snippet: "A snippet" },
      ],
    };
    const results = parseSerperResults(data);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      title: "Google Result",
      url: "https://google.com/1",
      snippet: "A snippet",
    });
  });

  it("returns [] for malformed input", () => {
    expect(parseSerperResults(null)).toEqual([]);
    expect(parseSerperResults(undefined)).toEqual([]);
    expect(parseSerperResults({})).toEqual([]);
    expect(parseSerperResults({ organic: "not-array" })).toEqual([]);
  });

  it("truncates snippets to 500 chars", () => {
    const long = "y".repeat(600);
    const data = { organic: [{ title: "T", link: "http://u", snippet: long }] };
    const results = parseSerperResults(data);
    expect(results[0].snippet).toHaveLength(500);
  });

  it("handles items with missing fields gracefully", () => {
    const data = { organic: [{ title: "Only Title" }, {}] };
    const results = parseSerperResults(data);
    expect(results[0]).toEqual({ title: "Only Title", url: "", snippet: "" });
    expect(results[1]).toEqual({ title: "", url: "", snippet: "" });
  });
});

describe("parseWebSearchApiResults", () => {
  it("extracts results from valid response", () => {
    const data = {
      organic: [
        { title: "WebSearch Result", url: "https://example.com", description: "Web snippet" },
      ],
    };
    const results = parseWebSearchApiResults(data);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      title: "WebSearch Result",
      url: "https://example.com",
      snippet: "Web snippet",
    });
  });

  it("returns [] for malformed input", () => {
    expect(parseWebSearchApiResults(null)).toEqual([]);
    expect(parseWebSearchApiResults(undefined)).toEqual([]);
    expect(parseWebSearchApiResults({})).toEqual([]);
    expect(parseWebSearchApiResults({ organic: "not-array" })).toEqual([]);
  });

  it("truncates snippets to 500 chars", () => {
    const long = "z".repeat(600);
    const data = { organic: [{ title: "T", url: "http://u", description: long }] };
    const results = parseWebSearchApiResults(data);
    expect(results[0].snippet).toHaveLength(500);
  });

  it("handles items with missing fields gracefully", () => {
    const data = { organic: [{ title: "Only Title" }, {}] };
    const results = parseWebSearchApiResults(data);
    expect(results[0]).toEqual({ title: "Only Title", url: "", snippet: "" });
    expect(results[1]).toEqual({ title: "", url: "", snippet: "" });
  });
});

describe("parsePerplexityResults", () => {
  it("extracts answer and citations", () => {
    const data = {
      choices: [{ message: { content: "The answer is 42." } }],
      citations: ["https://source1.com", "https://source2.com"],
    };
    const results = parsePerplexityResults(data);
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({
      title: "Perplexity Answer",
      url: "",
      snippet: "The answer is 42.",
    });
    expect(results[1]).toEqual({
      title: "https://source1.com",
      url: "https://source1.com",
      snippet: "",
    });
  });

  it("returns [] when no answer content", () => {
    expect(parsePerplexityResults({ choices: [{ message: { content: "" } }] })).toEqual([]);
    expect(parsePerplexityResults({})).toEqual([]);
  });

  it("returns [] for malformed input", () => {
    expect(parsePerplexityResults(null)).toEqual([]);
    expect(parsePerplexityResults(undefined)).toEqual([]);
    expect(parsePerplexityResults("string")).toEqual([]);
  });

  it("truncates answer snippet to 500 chars", () => {
    const long = "a".repeat(600);
    const data = { choices: [{ message: { content: long } }], citations: [] };
    const results = parsePerplexityResults(data);
    expect(results[0].snippet).toHaveLength(500);
  });

  it("returns answer only when citations missing", () => {
    const data = { choices: [{ message: { content: "Answer" } }] };
    const results = parsePerplexityResults(data);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Perplexity Answer");
  });
});

describe("parseOpenAINativeResults", () => {
  it("extracts deduplicated URL citations", () => {
    const data = {
      output: [
        {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "Here are results",
              annotations: [
                { type: "url_citation", url: "https://a.com", title: "A" },
                { type: "url_citation", url: "https://b.com", title: "B" },
                { type: "url_citation", url: "https://a.com", title: "A duplicate" },
              ],
            },
          ],
        },
      ],
    };
    const results = parseOpenAINativeResults(data);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ title: "A", url: "https://a.com", snippet: "" });
    expect(results[1]).toEqual({ title: "B", url: "https://b.com", snippet: "" });
  });

  it("returns [] when no message output", () => {
    expect(parseOpenAINativeResults({ output: [{ type: "other" }] })).toEqual([]);
  });

  it("returns [] for malformed input", () => {
    expect(parseOpenAINativeResults(null)).toEqual([]);
    expect(parseOpenAINativeResults(undefined)).toEqual([]);
    expect(parseOpenAINativeResults({})).toEqual([]);
    expect(parseOpenAINativeResults("string")).toEqual([]);
  });

  it("returns [] when output is not an array", () => {
    expect(parseOpenAINativeResults({ output: "not-array" })).toEqual([]);
  });

  it("returns [] when no annotations", () => {
    const data = {
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "No citations" }],
        },
      ],
    };
    expect(parseOpenAINativeResults(data)).toEqual([]);
  });

  it("skips annotations with empty url", () => {
    const data = {
      output: [
        {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "text",
              annotations: [
                { type: "url_citation", url: "", title: "Empty URL" },
                { type: "url_citation", url: "https://valid.com", title: "Valid" },
              ],
            },
          ],
        },
      ],
    };
    const results = parseOpenAINativeResults(data);
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://valid.com");
  });
});

describe("parseDuckDuckGoResults", () => {
  it("extracts results from valid array", () => {
    const data = [
      { title: "DDG Result", href: "https://ddg.co/1", body: "A snippet" },
      { title: "Second", href: "https://ddg.co/2", body: "Another" },
    ];
    const results = parseDuckDuckGoResults(data);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "DDG Result",
      url: "https://ddg.co/1",
      snippet: "A snippet",
    });
  });

  it("returns [] for non-array input", () => {
    expect(parseDuckDuckGoResults(null)).toEqual([]);
    expect(parseDuckDuckGoResults(undefined)).toEqual([]);
    expect(parseDuckDuckGoResults({})).toEqual([]);
    expect(parseDuckDuckGoResults("string")).toEqual([]);
  });

  it("truncates snippets to 500 chars", () => {
    const long = "d".repeat(600);
    const data = [{ title: "T", href: "http://u", body: long }];
    const results = parseDuckDuckGoResults(data);
    expect(results[0].snippet).toHaveLength(500);
  });

  it("handles items with missing fields gracefully", () => {
    const data = [{ title: "Only Title" }, {}];
    const results = parseDuckDuckGoResults(data);
    expect(results[0]).toEqual({ title: "Only Title", url: "", snippet: "" });
    expect(results[1]).toEqual({ title: "", url: "", snippet: "" });
  });
});
