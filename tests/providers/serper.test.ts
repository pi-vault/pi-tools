// tests/providers/serper.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { providerMeta } from "../../src/providers/serper.ts";
import { stubFetch } from "../helpers.ts";
import type { SearchFilters } from "../../src/providers/types.ts";

const makeProvider = (key = "key") => providerMeta.create(key).search!;

describe("SerperProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => { fetchStub = stubFetch(); });
  afterEach(() => { fetchStub.restore(); });

  it("has correct name and label", () => {
    const p = makeProvider();
    expect(p.name).toBe("serper");
    expect(p.label).toBe("Google Serper");
  });

  it("returns normalized search results", async () => {
    fetchStub.addResponse("google.serper.dev", {
      body: {
        organic: [
          { title: "Serper Result", link: "https://serper.dev", snippet: "A snippet" },
        ],
      },
    });
    const results = await makeProvider().search("test", 5);
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://serper.dev");
  });

  it("sends API key in X-API-KEY header", async () => {
    fetchStub.addResponse("google.serper.dev", { body: { organic: [] } });
    await makeProvider("my-key").search("test", 5);
    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers["X-API-KEY"]).toBe("my-key");
  });

  it("throws on error response", async () => {
    fetchStub.addResponse("google.serper.dev", { status: 403 });
    await expect(makeProvider().search("test", 5)).rejects.toThrow();
  });

  describe("search filters", () => {
    it("prepends site: operators for includeDomains", async () => {
      fetchStub.addResponse("google.serper.dev", {
        body: { organic: [] },
      });

      const provider = makeProvider();
      const filters: SearchFilters = { includeDomains: ["example.com", "docs.rs"] };
      await provider.search("rust tutorial", 5, undefined, filters);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.q).toContain("site:example.com OR site:docs.rs");
      expect(body.q).toContain("rust tutorial");
    });

    it("prepends -site: operators for excludeDomains", async () => {
      fetchStub.addResponse("google.serper.dev", {
        body: { organic: [] },
      });

      const provider = makeProvider();
      const filters: SearchFilters = { excludeDomains: ["spam.com"] };
      await provider.search("test query", 5, undefined, filters);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.q).toContain("-site:spam.com");
      expect(body.q).toContain("test query");
    });

    it("adds tbs parameter for date range filters", async () => {
      fetchStub.addResponse("google.serper.dev", {
        body: { organic: [] },
      });

      const provider = makeProvider();
      const filters: SearchFilters = {
        startDate: "2025-06-01",
        endDate: "2025-06-30",
      };
      await provider.search("test", 5, undefined, filters);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.tbs).toBe("cdr:1,cd_min:06/01/2025,cd_max:06/30/2025");
    });

    it("uses open-ended tbs when only startDate is set", async () => {
      fetchStub.addResponse("google.serper.dev", {
        body: { organic: [] },
      });

      const provider = makeProvider();
      const filters: SearchFilters = { startDate: "2025-01-15" };
      await provider.search("test", 5, undefined, filters);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.tbs).toBe("cdr:1,cd_min:01/15/2025,cd_max:");
    });

    it("uses open-ended tbs when only endDate is set", async () => {
      fetchStub.addResponse("google.serper.dev", {
        body: { organic: [] },
      });

      const provider = makeProvider();
      const filters: SearchFilters = { endDate: "2025-12-31" };
      await provider.search("test", 5, undefined, filters);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.tbs).toBe("cdr:1,cd_min:,cd_max:12/31/2025");
    });

    it("combines domain and date filters", async () => {
      fetchStub.addResponse("google.serper.dev", {
        body: { organic: [] },
      });

      const provider = makeProvider();
      const filters: SearchFilters = {
        includeDomains: ["example.com"],
        excludeDomains: ["spam.com"],
        startDate: "2025-01-01",
        endDate: "2025-06-30",
      };
      await provider.search("query", 5, undefined, filters);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.q).toContain("site:example.com");
      expect(body.q).toContain("-site:spam.com");
      expect(body.tbs).toContain("cd_min:01/01/2025");
    });

    it("does not add tbs when no date filters are set", async () => {
      fetchStub.addResponse("google.serper.dev", {
        body: { organic: [] },
      });

      const provider = makeProvider();
      const filters: SearchFilters = { includeDomains: ["example.com"] };
      await provider.search("test", 5, undefined, filters);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.tbs).toBeUndefined();
    });

    it("works normally without filters", async () => {
      fetchStub.addResponse("google.serper.dev", {
        body: {
          organic: [
            { title: "Result", link: "https://example.com", snippet: "A snippet" },
          ],
        },
      });

      const results = await makeProvider().search("test", 5);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Result");
    });
  });
});
