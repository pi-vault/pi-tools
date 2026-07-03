// tests/providers/brave.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { providerMeta } from "../../src/providers/brave.ts";
import type { SearchFilters } from "../../src/providers/types.ts";
import { stubFetch } from "../helpers.ts";

const makeProvider = (key = "test-key") => providerMeta.create(key).search!;

describe("BraveProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct name and label", () => {
    const provider = makeProvider();
    expect(provider.name).toBe("brave");
    expect(provider.label).toBe("Brave Search");
  });

  it("returns normalized search results", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: {
        web: {
          results: [
            { title: "Brave Result", url: "https://brave.com", description: "A brave snippet" },
          ],
        },
      },
    });

    const results = await makeProvider().search("test", 5);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Brave Result");
    expect(results[0].snippet).toBe("A brave snippet");
  });

  it("sends API key in header", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: { web: { results: [] } },
    });

    await makeProvider("my-brave-key").search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers["X-Subscription-Token"]).toBe("my-brave-key");
  });

  it("throws on non-2xx response", async () => {
    fetchStub.addResponse("api.search.brave.com", { status: 429, body: "Rate limited" });
    await expect(makeProvider().search("test", 5)).rejects.toThrow();
  });

  describe("search filters", () => {
    it("prepends site: operators for includeDomains", async () => {
      fetchStub.addResponse("api.search.brave.com", {
        body: { web: { results: [] } },
      });

      const filters: SearchFilters = { includeDomains: ["example.com", "docs.rs"] };
      await makeProvider().search("rust tutorial", 5, undefined, filters);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const url = fetchCall[0] as string;
      expect(url).toContain("site%3Aexample.com+OR+site%3Adocs.rs");
      expect(url).toContain("rust+tutorial");
    });

    it("prepends -site: operators for excludeDomains", async () => {
      fetchStub.addResponse("api.search.brave.com", {
        body: { web: { results: [] } },
      });

      const filters: SearchFilters = { excludeDomains: ["spam.com"] };
      await makeProvider().search("test query", 5, undefined, filters);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const url = fetchCall[0] as string;
      expect(url).toContain("-site%3Aspam.com");
      expect(url).toContain("test+query");
    });

    it("adds freshness parameter for date filters", async () => {
      fetchStub.addResponse("api.search.brave.com", {
        body: { web: { results: [] } },
      });

      const filters: SearchFilters = {
        startDate: "2025-06-01",
        endDate: "2025-06-30",
      };
      await makeProvider().search("test", 5, undefined, filters);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const url = fetchCall[0] as string;
      expect(url).toContain("freshness=2025-06-01to2025-06-30");
    });

    it("uses open-ended freshness when only startDate is set", async () => {
      fetchStub.addResponse("api.search.brave.com", {
        body: { web: { results: [] } },
      });

      const filters: SearchFilters = { startDate: "2025-01-01" };
      await makeProvider().search("test", 5, undefined, filters);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const url = fetchCall[0] as string;
      expect(url).toContain("freshness=2025-01-01to");
    });

    it("uses open-ended freshness when only endDate is set", async () => {
      fetchStub.addResponse("api.search.brave.com", {
        body: { web: { results: [] } },
      });

      const filters: SearchFilters = { endDate: "2025-12-31" };
      await makeProvider().search("test", 5, undefined, filters);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const url = fetchCall[0] as string;
      expect(url).toContain("freshness=to2025-12-31");
    });

    it("combines domain and date filters", async () => {
      fetchStub.addResponse("api.search.brave.com", {
        body: { web: { results: [] } },
      });

      const filters: SearchFilters = {
        includeDomains: ["example.com"],
        startDate: "2025-01-01",
        endDate: "2025-06-30",
      };
      await makeProvider().search("query", 5, undefined, filters);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const url = fetchCall[0] as string;
      expect(url).toContain("site%3Aexample.com");
      expect(url).toContain("freshness=2025-01-01to2025-06-30");
    });

    it("works normally without filters", async () => {
      fetchStub.addResponse("api.search.brave.com", {
        body: {
          web: {
            results: [{ title: "Result", url: "https://example.com", description: "snippet" }],
          },
        },
      });

      const results = await makeProvider().search("test", 5);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Result");
    });
  });
});
