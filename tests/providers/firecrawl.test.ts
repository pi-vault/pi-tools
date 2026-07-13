// tests/providers/firecrawl.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FirecrawlProvider, providerMeta } from "../../src/providers/firecrawl.ts";
import { stubFetch } from "../helpers.ts";
import type { SearchFilters } from "../../src/providers/types.ts";

describe("FirecrawlProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });
  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct name and label", () => {
    expect(new FirecrawlProvider("key").name).toBe("firecrawl");
    expect(new FirecrawlProvider("key").label).toBe("Firecrawl");
  });

  it("returns search results", async () => {
    fetchStub.addResponse("api.firecrawl.dev/v1/search", {
      body: {
        data: [{ title: "FC Result", url: "https://firecrawl.dev", markdown: "snippet text" }],
      },
    });
    const results = await new FirecrawlProvider("key").search("test", 5);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("FC Result");
  });

  it("fetches content via scrape API", async () => {
    fetchStub.addResponse("api.firecrawl.dev/v1/scrape", {
      body: { data: { markdown: "Scraped content" } },
    });
    const result = await new FirecrawlProvider("key").fetch("https://example.com");
    expect(result.text).toBe("Scraped content");
  });

  it("sends Bearer auth header", async () => {
    fetchStub.addResponse("api.firecrawl.dev", { body: { data: [] } });
    await new FirecrawlProvider("my-key").search("test", 5);
    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers.Authorization).toBe("Bearer my-key");
  });

  describe("search filters", () => {
    it("accepts filters parameter without error", async () => {
      fetchStub.addResponse("api.firecrawl.dev/v1/search", {
        body: {
          data: [{ title: "Result", url: "https://example.com", markdown: "snippet" }],
        },
      });

      const provider = new FirecrawlProvider("key");
      const filters: SearchFilters = {
        includeDomains: ["example.com"],
        excludeDomains: ["spam.com"],
        startDate: "2025-01-01",
        endDate: "2025-12-31",
      };
      const results = await provider.search("test", 5, undefined, filters);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Result");
    });

    it("does not modify the request body when filters are provided", async () => {
      fetchStub.addResponse("api.firecrawl.dev/v1/search", {
        body: { data: [] },
      });

      const provider = new FirecrawlProvider("key");
      const filters: SearchFilters = { includeDomains: ["example.com"] };
      await provider.search("test query", 5, undefined, filters);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.query).toBe("test query");
      expect(body.includeDomains).toBeUndefined();
    });
  });

  describe("keyless mode", () => {
    it("works without API key", async () => {
      fetchStub.addResponse("api.firecrawl.dev/v1/search", {
        body: {
          data: [{ title: "Free Result", url: "https://free.dev/1", markdown: "Free snippet" }],
        },
      });

      const provider = new FirecrawlProvider();
      const results = await provider.search("test", 5);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Free Result");
    });

    it("does not send Authorization header when no key", async () => {
      fetchStub.addResponse("api.firecrawl.dev", { body: { data: [] } });

      const provider = new FirecrawlProvider();
      await provider.search("test", 5);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      expect(fetchCall[1].headers.Authorization).toBeUndefined();
    });

    it("providerMeta has requiresKey: false", () => {
      expect(providerMeta.requiresKey).toBe(false);
    });

    it("providerMeta.create works without key", () => {
      const instance = providerMeta.create(undefined);
      expect(instance.search).toBeDefined();
      expect(instance.fetch).toBeDefined();
    });
  });
});
