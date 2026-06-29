// tests/providers/jina.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JinaProvider } from "../../src/providers/jina.ts";
import { stubFetch } from "../helpers.ts";

describe("JinaProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct name and label", () => {
    const provider = new JinaProvider();
    expect(provider.name).toBe("jina");
    expect(provider.label).toBe("Jina");
  });

  it("returns search results from Jina search API", async () => {
    fetchStub.addResponse("s.jina.ai", {
      body: {
        data: [
          { title: "Result 1", url: "https://example.com/1", description: "Snippet 1" },
          { title: "Result 2", url: "https://example.com/2", description: "Snippet 2" },
        ],
      },
    });

    const provider = new JinaProvider();
    const results = await provider.search("test query", 5);
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe("Result 1");
    expect(results[0].url).toBe("https://example.com/1");
    expect(results[0].snippet).toBe("Snippet 1");
  });

  it("sends auth header when API key provided", async () => {
    fetchStub.addResponse("s.jina.ai", { body: { data: [] } });

    const provider = new JinaProvider("test-key");
    await provider.search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers).toHaveProperty("Authorization", "Bearer test-key");
  });

  it("works without API key", async () => {
    fetchStub.addResponse("s.jina.ai", { body: { data: [] } });

    const provider = new JinaProvider();
    const results = await provider.search("test", 5);
    expect(results).toEqual([]);
  });

  it("fetches content via Jina Reader", async () => {
    fetchStub.addResponse("r.jina.ai", {
      body: "# Page Title\n\nPage content here",
      headers: { "content-type": "text/plain" },
    });

    const provider = new JinaProvider();
    const result = await provider.fetch("https://example.com");
    expect(result.text).toContain("Page content");
  });

  it("throws on non-2xx response", async () => {
    fetchStub.addResponse("s.jina.ai", { status: 500, body: "Error" });
    const provider = new JinaProvider();
    await expect(provider.search("test", 5)).rejects.toThrow();
  });
});
