// tests/providers/searxng.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SearXNGProvider } from "../../src/providers/searxng.ts";
import { stubFetch } from "../helpers.ts";

describe("SearXNGProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct name and label", () => {
    const provider = new SearXNGProvider();
    expect(provider.name).toBe("searxng");
    expect(provider.label).toBe("SearXNG");
  });

  it("uses localhost:8080 as default instanceUrl", () => {
    const provider = new SearXNGProvider();
    expect(provider.instanceUrl).toBe("http://localhost:8080");
  });

  it("accepts a custom instanceUrl", () => {
    const provider = new SearXNGProvider({
      instanceUrl: "http://searxng.internal:4000",
    });
    expect(provider.instanceUrl).toBe("http://searxng.internal:4000");
  });

  it("returns normalized search results", async () => {
    fetchStub.addResponse("localhost:8080", {
      body: {
        results: [
          { title: "SearXNG Result", url: "https://example.com/page", content: "A snippet" },
          { title: "Second Result", url: "https://example.com/other", content: "Another snippet" },
        ],
      },
    });

    const provider = new SearXNGProvider();
    const results = await provider.search("test query", 5);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "SearXNG Result",
      url: "https://example.com/page",
      snippet: "A snippet",
    });
    expect(results[1]).toEqual({
      title: "Second Result",
      url: "https://example.com/other",
      snippet: "Another snippet",
    });
  });

  it("sends correct GET request with format=json", async () => {
    fetchStub.addResponse("localhost:8080", {
      body: { results: [] },
    });

    const provider = new SearXNGProvider();
    await provider.search("my query", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const url = new URL(fetchCall[0] as string);
    expect(url.pathname).toBe("/search");
    expect(url.searchParams.get("q")).toBe("my query");
    expect(url.searchParams.get("format")).toBe("json");
    expect(fetchCall[1].headers["Accept"]).toBe("application/json");
  });

  it("sends Authorization header when apiKey is provided", async () => {
    fetchStub.addResponse("localhost:8080", {
      body: { results: [] },
    });

    const provider = new SearXNGProvider({ apiKey: "searxng-secret" });
    await provider.search("query", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers["Authorization"]).toBe("Bearer searxng-secret");
  });

  it("does not send Authorization header without apiKey", async () => {
    fetchStub.addResponse("localhost:8080", {
      body: { results: [] },
    });

    const provider = new SearXNGProvider();
    await provider.search("query", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers["Authorization"]).toBeUndefined();
  });

  it("limits results to maxResults", async () => {
    const manyResults = Array.from({ length: 10 }, (_, i) => ({
      title: `Result ${i}`,
      url: `https://example.com/${i}`,
      content: `Snippet ${i}`,
    }));
    fetchStub.addResponse("localhost:8080", {
      body: { results: manyResults },
    });

    const provider = new SearXNGProvider();
    const results = await provider.search("test", 3);
    expect(results).toHaveLength(3);
  });

  it("throws on HTTP error response", async () => {
    fetchStub.addResponse("localhost:8080", {
      status: 500,
      body: "Server Error",
    });
    const provider = new SearXNGProvider();
    await expect(provider.search("test", 5)).rejects.toThrow("SearXNG error");
  });

  it("handles empty results array", async () => {
    fetchStub.addResponse("localhost:8080", {
      body: { results: [] },
    });

    const provider = new SearXNGProvider();
    const results = await provider.search("nothing", 5);
    expect(results).toEqual([]);
  });

  it("allows a remote public instanceUrl without SSRF rejection", async () => {
    fetchStub.addResponse("searxng.example.com", {
      body: { results: [{ title: "T", url: "https://foo.com", content: "s" }] },
    });

    const provider = new SearXNGProvider({ instanceUrl: "https://searxng.example.com" });
    const results = await provider.search("test", 5);
    expect(results).toHaveLength(1);
  });
});
