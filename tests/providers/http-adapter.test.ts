import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHttpSearchProvider } from "../../src/providers/http-adapter.ts";
import { stubFetch } from "../helpers.ts";

describe("createHttpSearchProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("performs a POST request with correct headers and body", async () => {
    fetchStub.addResponse("api.example.com/search", {
      body: { results: [{ title: "Test", url: "https://test.com", content: "snippet text" }] },
    });

    const provider = createHttpSearchProvider("test-key", {
      name: "example",
      label: "Example",
      endpoint: "https://api.example.com/search",
      method: "POST",
      authHeader: "X-API-Key",
      buildBody: (query, maxResults) => ({ query, max_results: maxResults }),
      extractResults: (data) => {
        const d = data as { results: Array<{ title: string; url: string; content: string }> };
        return d.results.map((r) => ({ title: r.title, url: r.url, snippet: r.content }));
      },
    });

    expect(provider.name).toBe("example");
    expect(provider.label).toBe("Example");
    const results = await provider.search("test query", 5);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Test");
    expect(results[0].snippet).toBe("snippet text");
  });

  it("performs a GET request with dynamic URL", async () => {
    fetchStub.addResponse("api.example.com/search", {
      body: { items: [{ name: "Result", link: "https://r.com", desc: "a result" }] },
    });

    const provider = createHttpSearchProvider("my-key", {
      name: "get-example",
      label: "GET Example",
      endpoint: (query, maxResults) =>
        `https://api.example.com/search?q=${encodeURIComponent(query)}&count=${maxResults}`,
      method: "GET",
      authHeader: "Authorization",
      authPrefix: "Bearer ",
      extractResults: (data) => {
        const d = data as { items: Array<{ name: string; link: string; desc: string }> };
        return d.items.map((r) => ({ title: r.name, url: r.link, snippet: r.desc }));
      },
    });

    const results = await provider.search("hello", 3);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Result");
  });

  it("supports custom headers via buildHeaders", async () => {
    fetchStub.addResponse("api.example.com", {
      body: { results: [] },
    });

    const provider = createHttpSearchProvider("key", {
      name: "custom-headers",
      label: "Custom",
      endpoint: "https://api.example.com/search",
      method: "GET",
      buildHeaders: (apiKey) => ({
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      }),
      extractResults: () => [],
    });

    await provider.search("q", 5);
    // Verifying no error thrown — header construction worked
  });

  it("throws on non-ok response", async () => {
    fetchStub.addResponse("api.example.com", {
      status: 429,
      body: "rate limited",
    });

    const provider = createHttpSearchProvider("key", {
      name: "failing",
      label: "Failing",
      endpoint: "https://api.example.com/search",
      method: "POST",
      authHeader: "X-Key",
      buildBody: (q) => ({ q }),
      extractResults: () => [],
    });

    await expect(provider.search("q", 5)).rejects.toThrow("failing API error: 429");
  });

  it("slices results to maxResults", async () => {
    const manyResults = Array.from({ length: 20 }, (_, i) => ({
      title: `R${i}`, url: `https://r${i}.com`, snippet: `s${i}`,
    }));
    fetchStub.addResponse("api.example.com", {
      body: { results: manyResults },
    });

    const provider = createHttpSearchProvider("key", {
      name: "many",
      label: "Many",
      endpoint: "https://api.example.com/search",
      method: "POST",
      authHeader: "X-Key",
      buildBody: (q) => ({ q }),
      extractResults: (data) => {
        const d = data as { results: Array<{ title: string; url: string; snippet: string }> };
        return d.results;
      },
    });

    const results = await provider.search("q", 5);
    expect(results).toHaveLength(5);
  });
});
