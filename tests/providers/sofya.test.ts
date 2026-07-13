import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { providerMeta } from "../../src/providers/sofya.ts";
import { parseSofyaResults } from "../../src/providers/parsers.ts";
import { stubFetch } from "../helpers.ts";

const makeProvider = (
  key = "test-key",
  providerConfig?: Record<string, unknown>,
) => {
  const created = providerMeta.create(key, providerConfig as any);
  return { search: created.search!, fetch: created.fetch! };
};

describe("SofyaProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct metadata", () => {
    expect(providerMeta.name).toBe("sofya");
    expect(providerMeta.tier).toBe(2);
    expect(providerMeta.monthlyQuota).toBeNull();
    expect(providerMeta.requiresKey).toBe(true);
  });

  it("creates both search and fetch providers", () => {
    const created = providerMeta.create("key");
    expect(created.search).toBeDefined();
    expect(created.fetch).toBeDefined();
  });

  it("has correct name", () => {
    const { search, fetch } = makeProvider();
    expect(search.name).toBe("sofya");
    expect(fetch.name).toBe("sofya");
  });

  describe("search", () => {
    it("returns normalized search results", async () => {
      fetchStub.addResponse("sofya.co/v1/search", {
        body: {
          results: [
            {
              title: "Sofya Result",
              url: "https://example.com",
              content: "content text",
              description: "A sofya snippet",
            },
            {
              title: "Second",
              url: "https://second.com",
              content: "more content",
              description: "",
            },
          ],
        },
      });

      const { search } = makeProvider();
      const results = await search.search("test query", 10);
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        title: "Sofya Result",
        url: "https://example.com",
        snippet: "A sofya snippet",
      });
    });

    it("sends Bearer token and correct POST body", async () => {
      fetchStub.addResponse("sofya.co/v1/search", { body: { results: [] } });

      const { search } = makeProvider("my-sofya-key");
      await search.search("test", 10);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      expect(fetchCall[0]).toBe("https://sofya.co/v1/search");
      expect(fetchCall[1].headers.Authorization).toBe("Bearer my-sofya-key");
      expect(fetchCall[1].method).toBe("POST");
      const body = JSON.parse(fetchCall[1].body);
      expect(body.query).toBe("test");
      expect(body.search_depth).toBe("basic");
      expect(body.max_results).toBe(10);
      expect(body.include_answer).toBe(false);
      expect(body.topic).toBe("general");
    });

    it("caps max_results at 20", async () => {
      fetchStub.addResponse("sofya.co/v1/search", { body: { results: [] } });

      const { search } = makeProvider();
      await search.search("test", 50);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.max_results).toBe(20);
    });

    it("respects searchDepth and topic config options", async () => {
      fetchStub.addResponse("sofya.co/v1/search", { body: { results: [] } });

      const { search } = makeProvider("key", {
        enabled: true,
        searchDepth: "snippets",
        topic: "news",
      });
      await search.search("test", 5);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.search_depth).toBe("snippets");
      expect(body.topic).toBe("news");
    });

    it("throws on non-2xx response", async () => {
      fetchStub.addResponse("sofya.co/v1/search", {
        status: 401,
        body: "Unauthorized",
      });
      const { search } = makeProvider();
      await expect(search.search("test", 5)).rejects.toThrow("Sofya API error");
    });
  });

  describe("fetch", () => {
    it("returns extracted content", async () => {
      fetchStub.addResponse("sofya.co/v1/fetch", {
        body: {
          results: [{ content: "Extracted page content", title: "Page Title" }],
        },
      });

      const { fetch: fetchProvider } = makeProvider();
      const result = await fetchProvider.fetch("https://example.com/page");
      expect(result.text).toBe("Extracted page content");
      expect(result.title).toBe("Page Title");
    });

    it("sends correct POST body for fetch", async () => {
      fetchStub.addResponse("sofya.co/v1/fetch", { body: { results: [] } });

      const { fetch: fetchProvider } = makeProvider("my-key");
      await fetchProvider.fetch("https://example.com/page");

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      expect(fetchCall[0]).toBe("https://sofya.co/v1/fetch");
      expect(fetchCall[1].headers.Authorization).toBe("Bearer my-key");
      const body = JSON.parse(fetchCall[1].body);
      expect(body.urls).toEqual(["https://example.com/page"]);
      expect(body.include_raw_html).toBe(false);
    });

    it("returns empty text when no results", async () => {
      fetchStub.addResponse("sofya.co/v1/fetch", { body: { results: [] } });

      const { fetch: fetchProvider } = makeProvider();
      const result = await fetchProvider.fetch("https://example.com");
      expect(result.text).toBe("");
      expect(result.title).toBeUndefined();
    });

    it("throws on non-2xx response", async () => {
      fetchStub.addResponse("sofya.co/v1/fetch", {
        status: 500,
        body: "Error",
      });
      const { fetch: fetchProvider } = makeProvider();
      await expect(fetchProvider.fetch("https://example.com")).rejects.toThrow(
        "Sofya fetch error",
      );
    });
  });
});

describe("parseSofyaResults", () => {
  it("returns empty array for null/undefined input", () => {
    expect(parseSofyaResults(null)).toEqual([]);
    expect(parseSofyaResults(undefined)).toEqual([]);
  });

  it("returns empty array when results is not an array", () => {
    expect(parseSofyaResults({ results: "not-array" })).toEqual([]);
    expect(parseSofyaResults({})).toEqual([]);
  });

  it("prefers description over content for snippet", () => {
    const results = parseSofyaResults({
      results: [
        {
          title: "T",
          url: "https://u.com",
          description: "desc text",
          content: "content text",
        },
      ],
    });
    expect(results[0].snippet).toBe("desc text");
  });

  it("falls back to content when description is empty", () => {
    const results = parseSofyaResults({
      results: [
        {
          title: "T",
          url: "https://u.com",
          description: "",
          content: "content text",
        },
      ],
    });
    expect(results[0].snippet).toBe("content text");
  });

  it("truncates snippets to 500 characters", () => {
    const longContent = "s".repeat(600);
    const results = parseSofyaResults({
      results: [{ title: "T", url: "https://u.com", content: longContent }],
    });
    expect(results[0].snippet).toHaveLength(500);
  });
});
