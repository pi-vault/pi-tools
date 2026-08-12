import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { providerMeta, TinyFishProvider } from "../../src/providers/tinyfish.ts";
import { stubFetch } from "../helpers.ts";

describe("TinyFishProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has the expected metadata", () => {
    const provider = new TinyFishProvider("key");
    expect(provider.name).toBe("tinyfish");
    expect(provider.label).toBe("TinyFish");
    expect(providerMeta).toMatchObject({
      name: "tinyfish",
      tier: 2,
      requiresKey: true,
    });
    expect(providerMeta.create("key")).toMatchObject({
      search: expect.anything(),
      fetch: expect.anything(),
    });
  });

  it("sends the API key and maps Search filters", async () => {
    fetchStub.addResponse("api.search.tinyfish.ai", {
      body: { results: [] },
    });

    await new TinyFishProvider("tiny-key").search("pi tools", 5, undefined, {
      includeDomains: ["github.com", "docs.example.com"],
      excludeDomains: ["spam.example.com"],
      startDate: "2026-01-01",
      endDate: "2026-08-12",
    });

    const [input, init] = (globalThis.fetch as any).mock.calls[0];
    const url = new URL(input as string);
    expect(url.origin + url.pathname).toBe("https://api.search.tinyfish.ai/");
    expect(url.searchParams.get("query")).toBe("pi tools");
    expect(url.searchParams.get("include_domains")).toBe("github.com,docs.example.com");
    expect(url.searchParams.get("exclude_domains")).toBe("spam.example.com");
    expect(url.searchParams.get("after_date")).toBe("2026-01-01");
    expect(url.searchParams.get("before_date")).toBe("2026-08-12");
    expect(init.headers["X-API-Key"]).toBe("tiny-key");
    expect(init.headers.Accept).toBe("application/json");
  });

  it("normalizes Search results and drops non-HTTP URLs", async () => {
    fetchStub.addResponse("api.search.tinyfish.ai", {
      body: {
        results: [
          {
            title: "First",
            snippet: "snippet one",
            url: "https://example.com/one",
          },
          {
            title: "Second",
            snippet: "snippet two",
            url: "javascript:alert(1)",
          },
        ],
      },
    });

    const results = await new TinyFishProvider("tiny-key").search("test", 5);
    expect(results).toEqual([
      {
        title: "First",
        snippet: "snippet one",
        url: "https://example.com/one",
      },
    ]);
  });

  it("caps Search results to maxResults", async () => {
    fetchStub.addResponse("api.search.tinyfish.ai", {
      body: {
        results: [
          { title: "A", snippet: "a", url: "https://a.example" },
          { title: "B", snippet: "b", url: "https://b.example" },
          { title: "C", snippet: "c", url: "https://c.example" },
        ],
      },
    });

    const results = await new TinyFishProvider("tiny-key").search("test", 1);
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://a.example");
  });

  it("uses empty strings for missing title/snippet in Search results", async () => {
    fetchStub.addResponse("api.search.tinyfish.ai", {
      body: {
        results: [{ url: "https://example.com/x" }],
      },
    });

    const results = await new TinyFishProvider("tiny-key").search("test", 5);
    expect(results).toEqual([{ title: "", snippet: "", url: "https://example.com/x" }]);
  });

  it("throws on Search error response", async () => {
    fetchStub.addResponse("api.search.tinyfish.ai", {
      status: 429,
      body: { error: "rate limited" },
    });

    await expect(new TinyFishProvider("tiny-key").search("test", 5)).rejects.toThrow(
      /TinyFish search error/,
    );
  });

  it("sends Fetch POST request with markdown format", async () => {
    fetchStub.addResponse("api.fetch.tinyfish.ai", {
      body: {
        results: [
          {
            url: "https://example.com",
            title: "Example",
            text: "# Example\n\nFetched markdown",
            format: "markdown",
          },
        ],
        errors: [],
      },
    });

    const controller = new AbortController();
    const result = await new TinyFishProvider("tiny-key").fetch(
      "https://example.com",
      controller.signal,
    );
    expect(result).toEqual({
      text: "# Example\n\nFetched markdown",
      title: "Example",
      contentType: "text/markdown",
    });

    const [input, init] = (globalThis.fetch as any).mock.calls[0];
    expect(input).toBe("https://api.fetch.tinyfish.ai");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      urls: ["https://example.com"],
      format: "markdown",
    });
    expect(init.headers["X-API-Key"]).toBe("tiny-key");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.signal).toBe(controller.signal);
  });

  it("throws Fetch error when result is missing but errors entry matches URL", async () => {
    fetchStub.addResponse("api.fetch.tinyfish.ai", {
      body: {
        results: [],
        errors: [{ url: "https://example.com", error: "timeout" }],
      },
    });

    await expect(new TinyFishProvider("tiny-key").fetch("https://example.com")).rejects.toThrow(
      /TinyFish fetch error.*timeout/,
    );
  });

  it("throws Fetch error when no result and no matching errors entry", async () => {
    fetchStub.addResponse("api.fetch.tinyfish.ai", {
      body: { results: [], errors: [] },
    });

    await expect(new TinyFishProvider("tiny-key").fetch("https://example.com")).rejects.toThrow(
      /TinyFish fetch error: no result for https:\/\/example\.com/,
    );
  });

  it("throws on Fetch non-2xx response", async () => {
    fetchStub.addResponse("api.fetch.tinyfish.ai", {
      status: 500,
      body: { error: "boom" },
    });

    await expect(new TinyFishProvider("tiny-key").fetch("https://example.com")).rejects.toThrow(
      /TinyFish fetch error/,
    );
  });

  it("forwards AbortSignal to fetch", async () => {
    fetchStub.addResponse("api.search.tinyfish.ai", {
      body: { results: [] },
    });

    const controller = new AbortController();
    await new TinyFishProvider("tiny-key").search("test", 5, controller.signal);

    const [, init] = (globalThis.fetch as any).mock.calls[0];
    expect(init.signal).toBe(controller.signal);
  });
});
