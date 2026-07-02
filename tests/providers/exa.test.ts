// tests/providers/exa.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExaProvider } from "../../src/providers/exa.ts";
import { stubFetch } from "../helpers.ts";
import type { SearchFilters } from "../../src/providers/types.ts";

describe("ExaProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => { fetchStub = stubFetch(); });
  afterEach(() => { fetchStub.restore(); });

  it("has correct name and label", () => {
    expect(new ExaProvider("key").name).toBe("exa");
    expect(new ExaProvider("key").label).toBe("Exa");
  });

  it("returns search results", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: {
        results: [
          { title: "Exa Result", url: "https://exa.ai", text: "Exa snippet" },
        ],
      },
    });
    const results = await new ExaProvider("key").search("test", 5);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Exa Result");
  });

  it("returns code search results", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: {
        results: [
          { title: "Code Example", url: "https://github.com/ex", text: "const x = 1;" },
        ],
      },
    });
    const results = await new ExaProvider("key").codeSearch("typescript example", 5);
    expect(results).toHaveLength(1);
    expect(results[0].snippet).toBe("const x = 1;");
  });

  it("sends auth header", async () => {
    fetchStub.addResponse("api.exa.ai", { body: { results: [] } });
    await new ExaProvider("my-exa-key").search("test", 5);
    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers["x-api-key"]).toBe("my-exa-key");
  });

  it("fetches content via contents endpoint", async () => {
    fetchStub.addResponse("api.exa.ai/contents", {
      body: { results: [{ text: "Full page content" }] },
    });
    const result = await new ExaProvider("key").fetch("https://example.com");
    expect(result.text).toBe("Full page content");
  });

  describe("search filters", () => {
    it("passes includeDomains to the API", async () => {
      fetchStub.addResponse("api.exa.ai/search", {
        body: { results: [] },
      });

      const provider = new ExaProvider("key");
      const filters: SearchFilters = { includeDomains: ["example.com", "docs.rs"] };
      await provider.search("test", 5, undefined, filters);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.includeDomains).toEqual(["example.com", "docs.rs"]);
    });

    it("passes excludeDomains to the API", async () => {
      fetchStub.addResponse("api.exa.ai/search", {
        body: { results: [] },
      });

      const provider = new ExaProvider("key");
      const filters: SearchFilters = { excludeDomains: ["spam.com"] };
      await provider.search("test", 5, undefined, filters);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.excludeDomains).toEqual(["spam.com"]);
    });

    it("passes startPublishedDate and endPublishedDate to the API", async () => {
      fetchStub.addResponse("api.exa.ai/search", {
        body: { results: [] },
      });

      const provider = new ExaProvider("key");
      const filters: SearchFilters = {
        startDate: "2025-01-01",
        endDate: "2025-12-31",
      };
      await provider.search("test", 5, undefined, filters);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.startPublishedDate).toBe("2025-01-01");
      expect(body.endPublishedDate).toBe("2025-12-31");
    });

    it("combines all filter fields", async () => {
      fetchStub.addResponse("api.exa.ai/search", {
        body: { results: [] },
      });

      const provider = new ExaProvider("key");
      const filters: SearchFilters = {
        includeDomains: ["example.com"],
        excludeDomains: ["spam.com"],
        startDate: "2025-01-01",
        endDate: "2025-06-30",
      };
      await provider.search("test", 5, undefined, filters);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.includeDomains).toEqual(["example.com"]);
      expect(body.excludeDomains).toEqual(["spam.com"]);
      expect(body.startPublishedDate).toBe("2025-01-01");
      expect(body.endPublishedDate).toBe("2025-06-30");
    });

    it("omits filter fields from body when not provided", async () => {
      fetchStub.addResponse("api.exa.ai/search", {
        body: { results: [] },
      });

      const provider = new ExaProvider("key");
      await provider.search("test", 5);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.includeDomains).toBeUndefined();
      expect(body.excludeDomains).toBeUndefined();
      expect(body.startPublishedDate).toBeUndefined();
      expect(body.endPublishedDate).toBeUndefined();
    });

    it("does not affect codeSearch method", async () => {
      fetchStub.addResponse("api.exa.ai/search", {
        body: {
          results: [
            { title: "Code", url: "https://github.com/ex", text: "const x = 1;" },
          ],
        },
      });

      const provider = new ExaProvider("key");
      const results = await provider.codeSearch("typescript", 5);
      expect(results).toHaveLength(1);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.includeDomains).toBeUndefined();
      expect(body.excludeDomains).toBeUndefined();
    });
  });
});
