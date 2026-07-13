import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { providerMeta } from "../../src/providers/brave-llm.ts";
import { stubFetch } from "../helpers.ts";

const makeProvider = (
  key = "test-key",
  providerConfig?: Parameters<typeof providerMeta.create>[1],
) => providerMeta.create(key, providerConfig).search!;

describe("BraveLlmProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct metadata", () => {
    expect(providerMeta.name).toBe("brave-llm");
    expect(providerMeta.tier).toBe(1);
    expect(providerMeta.monthlyQuota).toBe(2000);
    expect(providerMeta.requiresKey).toBe(true);
  });

  it("has correct name and label", () => {
    const provider = makeProvider();
    expect(provider.name).toBe("brave-llm");
    expect(provider.label).toBe("Brave LLM Context");
  });

  it("returns normalized search results from grounding.generic", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: {
        grounding: {
          generic: [
            {
              url: "https://brave.com",
              title: "Brave Search",
              snippets: ["Privacy-first search engine"],
            },
          ],
        },
      },
    });

    const provider = makeProvider();
    const results = await provider.search("brave search", 5);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      title: "Brave Search",
      url: "https://brave.com",
      snippet: "Privacy-first search engine",
    });
  });

  it("sends X-Subscription-Token header", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: { grounding: { generic: [] } },
    });

    const provider = makeProvider("my-brave-token");
    await provider.search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers["X-Subscription-Token"]).toBe("my-brave-token");
    expect(fetchCall[1].headers["Accept"]).toBe("application/json");
  });

  it("sends POST to correct endpoint with q in body", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: { grounding: { generic: [] } },
    });

    const provider = makeProvider();
    await provider.search("my query", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[0]).toBe(
      "https://api.search.brave.com/res/v1/llm/context",
    );
    expect(fetchCall[1].method).toBe("POST");
    const body = JSON.parse(fetchCall[1].body);
    expect(body.q).toBe("my query");
  });

  it("includes maximum_number_of_tokens when providerConfig.tokenBudget is set", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: { grounding: { generic: [] } },
    });

    const provider = makeProvider("key", {
      enabled: true,
      tokenBudget: 4096,
    });
    await provider.search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.maximum_number_of_tokens).toBe(4096);
  });

  it("includes maximum_number_of_tokens when providerConfig.tokenBudget is 0", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: { grounding: { generic: [] } },
    });

    const provider = makeProvider("key", {
      enabled: true,
      tokenBudget: 0,
    });
    await provider.search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.maximum_number_of_tokens).toBe(0);
  });

  it("omits maximum_number_of_tokens when providerConfig.tokenBudget is not set", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: { grounding: { generic: [] } },
    });

    const provider = makeProvider("key", { enabled: true });
    await provider.search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.maximum_number_of_tokens).toBeUndefined();
  });

  it("throws on non-2xx response", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      status: 403,
      body: "Forbidden",
    });

    const provider = makeProvider("bad-key");
    await expect(provider.search("test", 5)).rejects.toThrow(
      "Brave LLM Context API error",
    );
  });
});
