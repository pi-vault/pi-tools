import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { providerMeta } from "../../src/providers/fastcrw.ts";
import { parseFastcrwResults } from "../../src/providers/parsers.ts";
import { stubFetch } from "../helpers.ts";

const makeProvider = (
  key = "test-key",
  providerConfig?: Record<string, unknown>,
) => providerMeta.create(key, providerConfig as any).search!;

describe("FastcrwProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct metadata", () => {
    expect(providerMeta.name).toBe("fastcrw");
    expect(providerMeta.tier).toBe(2);
    expect(providerMeta.monthlyQuota).toBe(500);
    expect(providerMeta.requiresKey).toBe(true);
  });

  it("has correct name and label", () => {
    const provider = makeProvider();
    expect(provider.name).toBe("fastcrw");
    expect(provider.label).toBe("fastCRW");
  });

  it("returns normalized search results", async () => {
    fetchStub.addResponse("api.fastcrw.com", {
      body: {
        success: true,
        data: [
          {
            title: "Fast Result",
            url: "https://example.com",
            description: "A fast snippet",
          },
          {
            title: "Second",
            url: "https://second.com",
            description: "Another",
          },
        ],
      },
    });

    const results = await makeProvider().search("test query", 10);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "Fast Result",
      url: "https://example.com",
      snippet: "A fast snippet",
    });
  });

  it("sends Bearer token and POST body with limit", async () => {
    fetchStub.addResponse("api.fastcrw.com", {
      body: { success: true, data: [] },
    });

    await makeProvider("my-fastcrw-key").search("test", 15);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[0]).toContain("api.fastcrw.com/v1/search");
    expect(fetchCall[1].headers.Authorization).toBe("Bearer my-fastcrw-key");
    expect(fetchCall[1].method).toBe("POST");
    const body = JSON.parse(fetchCall[1].body);
    expect(body.query).toBe("test");
    expect(body.limit).toBe(15);
  });

  it("caps limit at 20", async () => {
    fetchStub.addResponse("api.fastcrw.com", {
      body: { success: true, data: [] },
    });

    await makeProvider().search("test", 50);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.limit).toBe(20);
  });

  it("respects baseUrl config option", async () => {
    fetchStub.addResponse("custom.host.com", {
      body: { success: true, data: [] },
    });

    await makeProvider("key", {
      enabled: true,
      baseUrl: "https://custom.host.com",
    }).search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[0]).toContain("custom.host.com/v1/search");
  });

  it("throws on non-2xx response", async () => {
    fetchStub.addResponse("api.fastcrw.com", {
      status: 500,
      body: "Server Error",
    });
    await expect(makeProvider().search("test", 5)).rejects.toThrow("fastCRW");
  });
});

describe("parseFastcrwResults", () => {
  it("returns empty array for null/undefined input", () => {
    expect(parseFastcrwResults(null)).toEqual([]);
    expect(parseFastcrwResults(undefined)).toEqual([]);
  });

  it("returns empty array when data is not an array", () => {
    expect(parseFastcrwResults({ data: "not-array" })).toEqual([]);
    expect(parseFastcrwResults({ success: true })).toEqual([]);
  });

  it("truncates snippets to 500 characters", () => {
    const longDesc = "z".repeat(600);
    const results = parseFastcrwResults({
      data: [{ title: "T", url: "https://u.com", description: longDesc }],
    });
    expect(results[0].snippet).toHaveLength(500);
  });

  it("falls back to snippet field when description is missing", () => {
    const results = parseFastcrwResults({
      data: [{ title: "T", url: "https://u.com", snippet: "from snippet" }],
    });
    expect(results[0].snippet).toBe("from snippet");
  });
});
