import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { providerMeta } from "../../src/providers/langsearch.ts";
import { stubFetch } from "../helpers.ts";

const makeProvider = (key = "test-langsearch-key") =>
  providerMeta.create(key).search!;

describe("LangSearchProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct metadata", () => {
    expect(providerMeta.name).toBe("langsearch");
    expect(providerMeta.tier).toBe(2);
    expect(providerMeta.monthlyQuota).toBeNull();
    expect(providerMeta.requiresKey).toBe(true);
  });

  it("has correct name and label", () => {
    const provider = makeProvider();
    expect(provider.name).toBe("langsearch");
    expect(provider.label).toBe("LangSearch");
  });

  it("returns normalized search results", async () => {
    fetchStub.addResponse("api.langsearch.com", {
      body: {
        data: {
          webPages: {
            value: [
              {
                name: "Result 1",
                url: "https://example.com/1",
                snippet: "First result",
              },
              {
                name: "Result 2",
                url: "https://example.com/2",
                snippet: "Second result",
              },
            ],
          },
        },
      },
    });

    const results = await makeProvider().search("test query", 5);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "Result 1",
      url: "https://example.com/1",
      snippet: "First result",
    });
  });

  it("sends Bearer token in Authorization header", async () => {
    fetchStub.addResponse("api.langsearch.com", {
      body: { data: { webPages: { value: [] } } },
    });

    await makeProvider("my-lang-key").search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers["Authorization"]).toBe("Bearer my-lang-key");
  });

  it("sends POST with query and max_results in body", async () => {
    fetchStub.addResponse("api.langsearch.com", {
      body: { data: { webPages: { value: [] } } },
    });

    await makeProvider().search("my query", 10);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[0]).toBe("https://api.langsearch.com/v1/web-search");
    expect(fetchCall[1].method).toBe("POST");
    const body = JSON.parse(fetchCall[1].body);
    expect(body.query).toBe("my query");
    expect(body.max_results).toBe(10);
  });

  it("caps max_results at 20", async () => {
    fetchStub.addResponse("api.langsearch.com", {
      body: { data: { webPages: { value: [] } } },
    });

    await makeProvider().search("test", 50);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.max_results).toBe(20);
  });

  it("throws on non-2xx response", async () => {
    fetchStub.addResponse("api.langsearch.com", {
      status: 429,
      body: "Rate limited",
    });
    await expect(makeProvider().search("test", 5)).rejects.toThrow(
      "LangSearch API error",
    );
  });

  it("handles empty results gracefully", async () => {
    fetchStub.addResponse("api.langsearch.com", {
      body: { data: { webPages: { value: [] } } },
    });

    const results = await makeProvider().search("obscure query", 10);
    expect(results).toEqual([]);
  });
});
