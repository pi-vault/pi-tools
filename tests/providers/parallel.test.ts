// tests/providers/parallel.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ParallelProvider } from "../../src/providers/parallel.ts";
import { stubFetch } from "../helpers.ts";

describe("ParallelProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct name and label", () => {
    const provider = new ParallelProvider("test-key");
    expect(provider.name).toBe("parallel");
    expect(provider.label).toBe("Parallel");
  });

  describe("search", () => {
    it("returns normalized search results with excerpts joined as snippet", async () => {
      fetchStub.addResponse("api.parallel.ai/v1/search", {
        body: {
          search_id: "search_abc123",
          results: [
            {
              url: "https://example.com/page",
              title: "Parallel Result",
              excerpts: ["First excerpt.", "Second excerpt."],
            },
            {
              url: "https://example.com/other",
              title: "Second Result",
              excerpts: ["Another snippet"],
            },
          ],
          session_id: "session_abc123",
        },
      });

      const provider = new ParallelProvider("test-key");
      const results = await provider.search("test query", 5);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        title: "Parallel Result",
        url: "https://example.com/page",
        snippet: "First excerpt. Second excerpt.",
      });
      expect(results[1]).toEqual({
        title: "Second Result",
        url: "https://example.com/other",
        snippet: "Another snippet",
      });
    });

    it("sends correct POST request with x-api-key header", async () => {
      fetchStub.addResponse("api.parallel.ai/v1/search", {
        body: { search_id: "s_1", results: [], session_id: "sess_1" },
      });

      const provider = new ParallelProvider("my-parallel-key");
      await provider.search("my query", 7);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const url = fetchCall[0] as string;
      expect(url).toBe("https://api.parallel.ai/v1/search");
      expect(fetchCall[1].method).toBe("POST");

      const body = JSON.parse(fetchCall[1].body);
      expect(body.search_queries).toEqual(["my query"]);
      expect(body.objective).toBe("my query");
      expect(body.mode).toBe("basic");

      expect(fetchCall[1].headers["x-api-key"]).toBe("my-parallel-key");
      expect(fetchCall[1].headers["Content-Type"]).toBe("application/json");
    });

    it("limits results to maxResults", async () => {
      const manyResults = Array.from({ length: 10 }, (_, i) => ({
        url: `https://example.com/${i}`,
        title: `Result ${i}`,
        excerpts: [`Snippet ${i}`],
      }));
      fetchStub.addResponse("api.parallel.ai/v1/search", {
        body: { search_id: "s_1", results: manyResults, session_id: "sess_1" },
      });

      const provider = new ParallelProvider("key");
      const results = await provider.search("test", 3);
      expect(results).toHaveLength(3);
    });

    it("throws on error response", async () => {
      fetchStub.addResponse("api.parallel.ai/v1/search", {
        status: 403,
        body: "Forbidden",
      });
      const provider = new ParallelProvider("bad-key");
      await expect(provider.search("test", 5)).rejects.toThrow(
        "Parallel search error",
      );
    });

    it("handles empty results array", async () => {
      fetchStub.addResponse("api.parallel.ai/v1/search", {
        body: { search_id: "s_1", results: [], session_id: "sess_1" },
      });

      const provider = new ParallelProvider("key");
      const results = await provider.search("nothing", 5);
      expect(results).toEqual([]);
    });

    it("handles results with empty excerpts", async () => {
      fetchStub.addResponse("api.parallel.ai/v1/search", {
        body: {
          search_id: "s_1",
          results: [{ url: "https://example.com", title: "No excerpts", excerpts: [] }],
          session_id: "sess_1",
        },
      });

      const provider = new ParallelProvider("key");
      const results = await provider.search("test", 5);
      expect(results[0].snippet).toBe("");
    });
  });

  describe("fetch", () => {
    it("returns fetched content from extract endpoint", async () => {
      fetchStub.addResponse("api.parallel.ai/v1/extract", {
        body: {
          extract_id: "extract_abc123",
          results: [
            {
              url: "https://example.com/page",
              title: "Page Title",
              full_content: "# Page Title\n\nFetched markdown content from the page.",
              excerpts: ["Some excerpt"],
            },
          ],
          session_id: "session_abc123",
        },
      });

      const provider = new ParallelProvider("test-key");
      const result = await provider.fetch("https://example.com/page");

      expect(result.text).toBe("# Page Title\n\nFetched markdown content from the page.");
      expect(result.title).toBe("Page Title");
    });

    it("sends correct POST request for extract", async () => {
      fetchStub.addResponse("api.parallel.ai/v1/extract", {
        body: {
          extract_id: "e_1",
          results: [{ url: "https://example.com/target", title: "", full_content: "" }],
          session_id: "sess_1",
        },
      });

      const provider = new ParallelProvider("my-key");
      await provider.fetch("https://example.com/target");

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const url = fetchCall[0] as string;
      expect(url).toBe("https://api.parallel.ai/v1/extract");
      expect(fetchCall[1].method).toBe("POST");

      const body = JSON.parse(fetchCall[1].body);
      expect(body.urls).toEqual(["https://example.com/target"]);
      expect(body.full_content).toBe(true);

      expect(fetchCall[1].headers["x-api-key"]).toBe("my-key");
    });

    it("throws on extract error response", async () => {
      fetchStub.addResponse("api.parallel.ai/v1/extract", {
        status: 500,
        body: "Server Error",
      });
      const provider = new ParallelProvider("key");
      await expect(
        provider.fetch("https://example.com/broken"),
      ).rejects.toThrow("Parallel extract error");
    });

    it("throws when extract returns no results for URL", async () => {
      fetchStub.addResponse("api.parallel.ai/v1/extract", {
        body: {
          extract_id: "e_1",
          results: [],
          session_id: "sess_1",
        },
      });
      const provider = new ParallelProvider("key");
      await expect(
        provider.fetch("https://example.com/missing"),
      ).rejects.toThrow("Parallel extract error");
    });
  });
});
