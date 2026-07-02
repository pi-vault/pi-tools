// tests/providers/websearchapi.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSearchApiProvider } from "../../src/providers/websearchapi.ts";
import { stubFetch } from "../helpers.ts";

describe("WebSearchApiProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct name and label", () => {
    const provider = new WebSearchApiProvider("test-key");
    expect(provider.name).toBe("websearchapi");
    expect(provider.label).toBe("WebSearchAPI");
  });

  it("returns normalized search results from organic array", async () => {
    fetchStub.addResponse("api.websearchapi.ai", {
      body: {
        organic: [
          {
            title: "WS Result",
            url: "https://example.com/page",
            description: "A WebSearchAPI snippet",
            position: 1,
            score: 0.95,
          },
          {
            title: "Second Result",
            url: "https://example.com/other",
            description: "Another snippet",
            position: 2,
            score: 0.88,
          },
        ],
        responseTime: 1.2,
      },
    });

    const provider = new WebSearchApiProvider("test-key");
    const results = await provider.search("test query", 5);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "WS Result",
      url: "https://example.com/page",
      snippet: "A WebSearchAPI snippet",
    });
    expect(results[1]).toEqual({
      title: "Second Result",
      url: "https://example.com/other",
      snippet: "Another snippet",
    });
  });

  it("sends correct POST request with Bearer auth", async () => {
    fetchStub.addResponse("api.websearchapi.ai", {
      body: { organic: [], responseTime: 0.5 },
    });

    const provider = new WebSearchApiProvider("my-ws-key");
    await provider.search("my query", 7);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const url = fetchCall[0] as string;
    expect(url).toBe("https://api.websearchapi.ai/ai-search");
    expect(fetchCall[1].method).toBe("POST");

    const body = JSON.parse(fetchCall[1].body);
    expect(body.query).toBe("my query");
    expect(body.maxResults).toBe(7);

    expect(fetchCall[1].headers["Authorization"]).toBe("Bearer my-ws-key");
    expect(fetchCall[1].headers["Content-Type"]).toBe("application/json");
  });

  it("limits results to maxResults", async () => {
    const manyResults = Array.from({ length: 10 }, (_, i) => ({
      title: `Result ${i}`,
      url: `https://example.com/${i}`,
      description: `Snippet ${i}`,
      position: i + 1,
      score: 0.9 - i * 0.05,
    }));
    fetchStub.addResponse("api.websearchapi.ai", {
      body: { organic: manyResults, responseTime: 1.0 },
    });

    const provider = new WebSearchApiProvider("key");
    const results = await provider.search("test", 3);
    expect(results).toHaveLength(3);
  });

  it("throws on error response", async () => {
    fetchStub.addResponse("api.websearchapi.ai", {
      status: 401,
      body: "Unauthorized",
    });
    const provider = new WebSearchApiProvider("bad-key");
    await expect(provider.search("test", 5)).rejects.toThrow(
      "WebSearchAPI error",
    );
  });

  it("handles empty organic array", async () => {
    fetchStub.addResponse("api.websearchapi.ai", {
      body: { organic: [], responseTime: 0.3 },
    });

    const provider = new WebSearchApiProvider("key");
    const results = await provider.search("nothing", 5);
    expect(results).toEqual([]);
  });

  it("handles missing organic field gracefully", async () => {
    fetchStub.addResponse("api.websearchapi.ai", {
      body: { responseTime: 0.3 },
    });

    const provider = new WebSearchApiProvider("key");
    const results = await provider.search("nothing", 5);
    expect(results).toEqual([]);
  });
});
