// tests/providers/openai-web-search.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createOpenAiWebSearchProvider,
  providerMeta,
} from "../../src/providers/openai-web-search.ts";
import { stubFetch } from "../helpers.ts";

describe("OpenAI Web Search Provider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct name and label", () => {
    const { search } = createOpenAiWebSearchProvider("test-key");
    expect(search.name).toBe("openai-web-search");
    expect(search.label).toBe("OpenAI Web Search");
  });

  it("sends correct Authorization header and request body", async () => {
    fetchStub.addResponse("api.openai.com/v1/responses", {
      body: { output: [] },
    });

    const { search } = createOpenAiWebSearchProvider("sk-my-key");
    await search.search("typescript patterns", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[0]).toBe("https://api.openai.com/v1/responses");
    expect(fetchCall[1].method).toBe("POST");
    expect(fetchCall[1].headers["Authorization"]).toBe("Bearer sk-my-key");

    const body = JSON.parse(fetchCall[1].body);
    expect(body.model).toBe("gpt-4.1-mini");
    expect(body.tools).toEqual([{ type: "web_search" }]);
    expect(body.input).toContain("typescript patterns");
  });

  it("uses custom model from config", async () => {
    fetchStub.addResponse("api.openai.com", {
      body: { output: [] },
    });

    const { search } = createOpenAiWebSearchProvider("sk-key", {
      model: "gpt-4.1",
    });
    await search.search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.model).toBe("gpt-4.1");
  });

  it("extracts results from url_citation annotations", async () => {
    fetchStub.addResponse("api.openai.com", {
      body: {
        output: [
          {
            type: "message",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: "Here are results",
                annotations: [
                  {
                    type: "url_citation",
                    url: "https://example.com",
                    title: "Example Page",
                  },
                  {
                    type: "url_citation",
                    url: "https://docs.example.com",
                    title: "Docs Page",
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const { search } = createOpenAiWebSearchProvider("sk-key");
    const results = await search.search("test", 5);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "Example Page",
      url: "https://example.com",
      snippet: "",
    });
    expect(results[1]).toEqual({
      title: "Docs Page",
      url: "https://docs.example.com",
      snippet: "",
    });
  });

  it("deduplicates results by URL", async () => {
    fetchStub.addResponse("api.openai.com", {
      body: {
        output: [
          {
            type: "message",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: "results",
                annotations: [
                  {
                    type: "url_citation",
                    url: "https://example.com",
                    title: "First",
                  },
                  {
                    type: "url_citation",
                    url: "https://example.com",
                    title: "Duplicate",
                  },
                  {
                    type: "url_citation",
                    url: "https://other.com",
                    title: "Other",
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const { search } = createOpenAiWebSearchProvider("sk-key");
    const results = await search.search("test", 10);

    expect(results).toHaveLength(2);
    expect(results[0].title).toBe("First");
    expect(results[1].title).toBe("Other");
  });

  it("respects maxResults limit", async () => {
    const annotations = Array.from({ length: 20 }, (_, i) => ({
      type: "url_citation",
      url: `https://site${i}.com`,
      title: `Site ${i}`,
    }));
    fetchStub.addResponse("api.openai.com", {
      body: {
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "text", annotations }],
          },
        ],
      },
    });

    const { search } = createOpenAiWebSearchProvider("sk-key");
    const results = await search.search("test", 5);
    expect(results).toHaveLength(5);
  });

  it("throws on non-2xx response", async () => {
    fetchStub.addResponse("api.openai.com", {
      status: 429,
      body: "Rate limited",
    });

    const { search } = createOpenAiWebSearchProvider("sk-key");
    await expect(search.search("test", 5)).rejects.toThrow("429");
  });

  it("returns empty results for empty output", async () => {
    fetchStub.addResponse("api.openai.com", {
      body: { output: [] },
    });

    const { search } = createOpenAiWebSearchProvider("sk-key");
    const results = await search.search("test", 5);
    expect(results).toEqual([]);
  });

  it("returns empty results for output without message type", async () => {
    fetchStub.addResponse("api.openai.com", {
      body: {
        output: [{ type: "web_search_call", id: "ws_123", status: "completed" }],
      },
    });

    const { search } = createOpenAiWebSearchProvider("sk-key");
    const results = await search.search("test", 5);
    expect(results).toEqual([]);
  });
});

describe("providerMeta", () => {
  it("has correct metadata", () => {
    expect(providerMeta.name).toBe("openai-web-search");
    expect(providerMeta.tier).toBe(1);
    expect(providerMeta).not.toHaveProperty("monthlyQuota");
    expect(providerMeta.requiresKey).toBe(true);
  });

  it("creates search provider when key is provided", () => {
    const instance = providerMeta.create("sk-key");
    expect(instance.search).toBeDefined();
  });

  it("does not create search provider without key", () => {
    const instance = providerMeta.create();
    expect(instance.search).toBeUndefined();
  });

  it("does not create search provider when enabled is false", () => {
    const instance = providerMeta.create("sk-key", {
      enabled: false,
      budget: { mode: "managed" },
    });
    expect(instance.search).toBeUndefined();
  });
});
