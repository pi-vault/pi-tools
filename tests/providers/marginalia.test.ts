import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { providerMeta } from "../../src/providers/marginalia.ts";
import type { SearchFilters } from "../../src/providers/types.ts";
import { stubFetch } from "../helpers.ts";

const makeProvider = (key?: string) => providerMeta.create(key).search!;

describe("MarginaliaProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct metadata", () => {
    expect(providerMeta.name).toBe("marginalia");
    expect(providerMeta.tier).toBe(3);
    expect(providerMeta.monthlyQuota).toBeNull();
    expect(providerMeta.requiresKey).toBe(false);
  });

  it("creates provider with 'public' key when no key provided", () => {
    const provider = makeProvider();
    expect(provider.name).toBe("marginalia");
    expect(provider.label).toBe("Marginalia Search");
  });

  it("returns search results from API response", async () => {
    fetchStub.addResponse("api2.marginalia-search.com", {
      body: {
        results: [
          {
            title: "Indie Web",
            url: "https://indieweb.org",
            description: "Independent web",
          },
          {
            title: "Gemini Protocol",
            url: "gemini://gemini.circumlunar.space",
            description: "A new internet protocol",
          },
        ],
      },
    });

    const results = await makeProvider().search("indie web", 10);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "Indie Web",
      url: "https://indieweb.org",
      snippet: "Independent web",
    });
    expect(results[1]).toEqual({
      title: "Gemini Protocol",
      url: "gemini://gemini.circumlunar.space",
      snippet: "A new internet protocol",
    });
  });

  it("sends correct query parameters", async () => {
    fetchStub.addResponse("api2.marginalia-search.com", {
      body: { results: [] },
    });

    await makeProvider("my-key").search("test query", 20);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const url = fetchCall[0] as string;
    expect(url).toContain("query=test+query");
    expect(url).toContain("count=20");
  });

  it("caps maxResults at 100", async () => {
    fetchStub.addResponse("api2.marginalia-search.com", {
      body: { results: [] },
    });

    await makeProvider().search("test", 200);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const url = fetchCall[0] as string;
    expect(url).toContain("count=100");
  });

  it("sends API-Key header", async () => {
    fetchStub.addResponse("api2.marginalia-search.com", {
      body: { results: [] },
    });

    await makeProvider("my-api-key").search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers["API-Key"]).toBe("my-api-key");
    expect(fetchCall[1].headers["Accept"]).toBe("application/json");
  });

  it("uses 'public' as API-Key when no key provided", async () => {
    fetchStub.addResponse("api2.marginalia-search.com", {
      body: { results: [] },
    });

    await makeProvider().search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers["API-Key"]).toBe("public");
  });

  it("throws on non-200 response", async () => {
    fetchStub.addResponse("api2.marginalia-search.com", {
      status: 503,
      body: "Service Unavailable",
    });

    await expect(makeProvider().search("test", 5)).rejects.toThrow(
      /Marginalia Search API error: 503/,
    );
  });

  it("handles empty results gracefully", async () => {
    fetchStub.addResponse("api2.marginalia-search.com", {
      body: { results: [] },
    });

    const results = await makeProvider().search("obscure query", 10);
    expect(results).toEqual([]);
  });

  describe("search filters", () => {
    it("does not modify request when filters are provided", async () => {
      fetchStub.addResponse("api2.marginalia-search.com", {
        body: { results: [] },
      });

      const filters: SearchFilters = { includeDomains: ["example.com"] };
      await makeProvider().search("test query", 5, undefined, filters);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const url = fetchCall[0] as string;
      expect(url).toContain("query=test+query");
      expect(url).not.toContain("site");
    });
  });
});
