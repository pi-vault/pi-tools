import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { providerMeta } from "../../src/providers/linkup.ts";
import { parseLinkupResults } from "../../src/providers/parsers.ts";
import { stubFetch } from "../helpers.ts";

const makeProvider = (
  key = "test-key",
  providerConfig?: Record<string, unknown>,
) => providerMeta.create(key, providerConfig as any).search!;

describe("LinkupProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct metadata", () => {
    expect(providerMeta.name).toBe("linkup");
    expect(providerMeta.tier).toBe(2);
    expect(providerMeta.monthlyQuota).toBeNull();
    expect(providerMeta.requiresKey).toBe(true);
  });

  it("has correct name and label", () => {
    const provider = makeProvider();
    expect(provider.name).toBe("linkup");
    expect(provider.label).toBe("Linkup");
  });

  it("returns normalized search results", async () => {
    fetchStub.addResponse("api.linkup.so", {
      body: {
        searchResults: [
          {
            title: "Linkup Result",
            url: "https://example.com",
            content: "A linkup snippet",
          },
          {
            title: "Second",
            url: "https://second.com",
            content: "Another result",
          },
        ],
      },
    });

    const results = await makeProvider().search("test query", 10);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "Linkup Result",
      url: "https://example.com",
      snippet: "A linkup snippet",
    });
  });

  it("sends Bearer token and POST body", async () => {
    fetchStub.addResponse("api.linkup.so", { body: { searchResults: [] } });

    await makeProvider("my-linkup-key").search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers.Authorization).toBe("Bearer my-linkup-key");
    expect(fetchCall[1].method).toBe("POST");
    const body = JSON.parse(fetchCall[1].body);
    expect(body.query).toBe("test");
    expect(body.outputType).toBe("searchResults");
    expect(body.depth).toBe("standard");
  });

  it("respects depth config option", async () => {
    fetchStub.addResponse("api.linkup.so", { body: { searchResults: [] } });

    await makeProvider("key", { enabled: true, depth: "deep" }).search(
      "test",
      5,
    );

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.depth).toBe("deep");
  });

  it("throws on non-2xx response", async () => {
    fetchStub.addResponse("api.linkup.so", {
      status: 401,
      body: "Unauthorized",
    });
    await expect(makeProvider().search("test", 5)).rejects.toThrow("Linkup");
  });

  it("handles fallback response shapes (results array)", async () => {
    fetchStub.addResponse("api.linkup.so", {
      body: {
        results: [
          { title: "Fallback", url: "https://fb.com", content: "fb snippet" },
        ],
      },
    });

    const results = await makeProvider().search("test", 5);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Fallback");
  });
});

describe("parseLinkupResults", () => {
  it("returns empty array for null/undefined input", () => {
    expect(parseLinkupResults(null)).toEqual([]);
    expect(parseLinkupResults(undefined)).toEqual([]);
  });

  it("returns empty array when no results array found", () => {
    expect(parseLinkupResults({ foo: "bar" })).toEqual([]);
  });

  it("truncates snippets to 500 characters", () => {
    const longContent = "x".repeat(600);
    const results = parseLinkupResults({
      searchResults: [
        { title: "T", url: "https://u.com", content: longContent },
      ],
    });
    expect(results[0].snippet).toHaveLength(500);
  });

  it("prefers content over snippet field", () => {
    const results = parseLinkupResults({
      searchResults: [
        {
          title: "T",
          url: "https://u.com",
          content: "from content",
          snippet: "from snippet",
        },
      ],
    });
    expect(results[0].snippet).toBe("from content");
  });
});
