// tests/providers/tavily.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TavilyProvider } from "../../src/providers/tavily.ts";
import { stubFetch } from "../helpers.ts";
import type { SearchFilters } from "../../src/providers/types.ts";

describe("TavilyProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => { fetchStub = stubFetch(); });
  afterEach(() => { fetchStub.restore(); });

  it("has correct name and label", () => {
    expect(new TavilyProvider("key").name).toBe("tavily");
    expect(new TavilyProvider("key").label).toBe("Tavily");
  });

  it("returns search results", async () => {
    fetchStub.addResponse("api.tavily.com", {
      body: {
        results: [
          { title: "Tavily Result", url: "https://tavily.com", content: "A snippet" },
        ],
      },
    });
    const results = await new TavilyProvider("key").search("test", 5);
    expect(results).toHaveLength(1);
    expect(results[0].snippet).toBe("A snippet");
  });

  it("sends API key in request body", async () => {
    fetchStub.addResponse("api.tavily.com", { body: { results: [] } });
    await new TavilyProvider("my-key").search("test", 5);
    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.api_key).toBe("my-key");
  });

  it("fetches content via extract API", async () => {
    fetchStub.addResponse("api.tavily.com/extract", {
      body: { results: [{ raw_content: "Extracted content here" }] },
    });
    const result = await new TavilyProvider("key").fetch("https://example.com");
    expect(result.text).toBe("Extracted content here");
  });

  describe("search filters", () => {
    it("passes include_domains to the API", async () => {
      fetchStub.addResponse("api.tavily.com", {
        body: { results: [] },
      });

      const provider = new TavilyProvider("key");
      const filters: SearchFilters = { includeDomains: ["example.com", "docs.rs"] };
      await provider.search("test", 5, undefined, filters);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.include_domains).toEqual(["example.com", "docs.rs"]);
    });

    it("passes exclude_domains to the API", async () => {
      fetchStub.addResponse("api.tavily.com", {
        body: { results: [] },
      });

      const provider = new TavilyProvider("key");
      const filters: SearchFilters = { excludeDomains: ["spam.com"] };
      await provider.search("test", 5, undefined, filters);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.exclude_domains).toEqual(["spam.com"]);
    });

    it("silently ignores date filters (not supported by Tavily)", async () => {
      fetchStub.addResponse("api.tavily.com", {
        body: { results: [] },
      });

      const provider = new TavilyProvider("key");
      const filters: SearchFilters = {
        startDate: "2025-01-01",
        endDate: "2025-12-31",
      };
      await provider.search("test", 5, undefined, filters);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.startDate).toBeUndefined();
      expect(body.endDate).toBeUndefined();
      expect(body.start_date).toBeUndefined();
      expect(body.end_date).toBeUndefined();
    });

    it("omits domain fields from body when not provided", async () => {
      fetchStub.addResponse("api.tavily.com", {
        body: { results: [] },
      });

      const provider = new TavilyProvider("key");
      await provider.search("test", 5);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.include_domains).toBeUndefined();
      expect(body.exclude_domains).toBeUndefined();
    });

    it("combines domain filters with existing search params", async () => {
      fetchStub.addResponse("api.tavily.com", {
        body: { results: [] },
      });

      const provider = new TavilyProvider("key");
      const filters: SearchFilters = {
        includeDomains: ["example.com"],
        excludeDomains: ["spam.com"],
      };
      await provider.search("test query", 10, undefined, filters);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.query).toBe("test query");
      expect(body.max_results).toBe(10);
      expect(body.include_domains).toEqual(["example.com"]);
      expect(body.exclude_domains).toEqual(["spam.com"]);
    });
  });
});
