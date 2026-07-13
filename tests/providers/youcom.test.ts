import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { providerMeta } from "../../src/providers/youcom.ts";
import { parseYouComResults } from "../../src/providers/parsers.ts";
import { stubFetch } from "../helpers.ts";

const makeProvider = (key = "test-key") => providerMeta.create(key).search!;

describe("YouComProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct metadata", () => {
    expect(providerMeta.name).toBe("youcom");
    expect(providerMeta.tier).toBe(2);
    expect(providerMeta.monthlyQuota).toBeNull();
    expect(providerMeta.requiresKey).toBe(true);
  });

  it("has correct name and label", () => {
    const provider = makeProvider();
    expect(provider.name).toBe("youcom");
    expect(provider.label).toBe("You.com");
  });

  it("returns normalized search results", async () => {
    fetchStub.addResponse("api.you.com", {
      body: {
        hits: [
          {
            title: "You Result",
            url: "https://example.com",
            description: "A you.com snippet",
            snippets: [],
          },
          {
            title: "Second",
            url: "https://second.com",
            description: "",
            snippets: ["snip1", "snip2"],
          },
        ],
      },
    });

    const results = await makeProvider().search("test query", 10);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "You Result",
      url: "https://example.com",
      snippet: "A you.com snippet",
    });
    expect(results[1].snippet).toBe("snip1 snip2");
  });

  it("sends X-API-Key header via GET with query params", async () => {
    fetchStub.addResponse("api.you.com", { body: { hits: [] } });

    await makeProvider("my-you-key").search("hello world", 8);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const url = fetchCall[0] as string;
    expect(url).toContain("api.you.com/v1/search");
    expect(url).toContain("query=hello+world");
    expect(url).toContain("num_web_results=8");
    expect(fetchCall[1].headers["X-API-Key"]).toBe("my-you-key");
  });

  it("caps num_web_results at 100", async () => {
    fetchStub.addResponse("api.you.com", { body: { hits: [] } });

    await makeProvider().search("test", 200);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const url = fetchCall[0] as string;
    expect(url).toContain("num_web_results=100");
  });

  it("throws on non-2xx response", async () => {
    fetchStub.addResponse("api.you.com", { status: 403, body: "Forbidden" });
    await expect(makeProvider().search("test", 5)).rejects.toThrow("You.com");
  });
});

describe("parseYouComResults", () => {
  it("returns empty array for null/undefined input", () => {
    expect(parseYouComResults(null)).toEqual([]);
    expect(parseYouComResults(undefined)).toEqual([]);
  });

  it("returns empty array when no hits array found", () => {
    expect(parseYouComResults({ foo: "bar" })).toEqual([]);
  });

  it("joins snippets array when description is empty", () => {
    const results = parseYouComResults({
      hits: [
        {
          title: "T",
          url: "https://u.com",
          description: "",
          snippets: ["a", "b", "c"],
        },
      ],
    });
    expect(results[0].snippet).toBe("a b c");
  });

  it("prefers description over snippets", () => {
    const results = parseYouComResults({
      hits: [
        {
          title: "T",
          url: "https://u.com",
          description: "desc",
          snippets: ["snip"],
        },
      ],
    });
    expect(results[0].snippet).toBe("desc");
  });

  it("truncates snippets to 500 characters", () => {
    const longDesc = "y".repeat(600);
    const results = parseYouComResults({
      hits: [{ title: "T", url: "https://u.com", description: longDesc }],
    });
    expect(results[0].snippet).toHaveLength(500);
  });
});
