// tests/providers/searxng.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SearXNGProvider, providerMeta } from "../../src/providers/searxng.ts";
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

  it("uses SEARXNG_URL env var when set", () => {
    const prev = process.env["SEARXNG_URL"];
    try {
      process.env["SEARXNG_URL"] = "http://10.0.0.50:8888";
      const provider = new SearXNGProvider();
      expect(provider.instanceUrl).toBe("http://10.0.0.50:8888");
    } finally {
      if (prev === undefined) delete process.env["SEARXNG_URL"];
      else process.env["SEARXNG_URL"] = prev;
    }
  });

  it("config instanceUrl takes precedence over SEARXNG_URL env var", () => {
    const prev = process.env["SEARXNG_URL"];
    try {
      process.env["SEARXNG_URL"] = "http://env-instance:9999";
      const provider = new SearXNGProvider({
        instanceUrl: "http://config-instance:7777",
      });
      expect(provider.instanceUrl).toBe("http://config-instance:7777");
    } finally {
      if (prev === undefined) delete process.env["SEARXNG_URL"];
      else process.env["SEARXNG_URL"] = prev;
    }
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

  describe("providerMeta", () => {
    it("creates provider with instanceUrl from config", () => {
      const instance = providerMeta.create(undefined, {
        enabled: true,
        instanceUrl: "http://my-searx.local:9090",
      });
      expect(instance.search).toBeDefined();
      expect((instance.search as SearXNGProvider).instanceUrl).toBe("http://my-searx.local:9090");
    });

    it("creates provider with apiKey resolved from config", async () => {
      fetchStub.addResponse("my-searx.local:9090", { body: { results: [] } });

      const instance = providerMeta.create(undefined, {
        enabled: true,
        instanceUrl: "http://my-searx.local:9090",
        apiKey: "my-token",
      });
      await instance.search!.search("test", 5);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      expect(fetchCall[1].headers["Authorization"]).toBe("Bearer my-token");
    });

    it("creates provider without apiKey when not in config", async () => {
      fetchStub.addResponse("localhost:8080", { body: { results: [] } });

      const instance = providerMeta.create(undefined, { enabled: true });
      await instance.search!.search("test", 5);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      expect(fetchCall[1].headers["Authorization"]).toBeUndefined();
    });
  });
});
