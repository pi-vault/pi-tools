import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExaDeepResearchClient } from "../../src/providers/exa-deep-research.ts";
import { stubFetch } from "../helpers.ts";

describe("ExaDeepResearchClient", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });
  afterEach(() => {
    fetchStub.restore();
  });

  it("sends correct headers with API key", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: { results: [] },
    });
    const client = new ExaDeepResearchClient("test-key");
    await client.deepResearch({ query: "test", type: "deep-lite" });

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers["x-api-key"]).toBe("test-key");
    expect(fetchCall[1].headers["Content-Type"]).toBe("application/json");
  });

  it("sends deep type in request body", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: { results: [] },
    });
    const client = new ExaDeepResearchClient("key");
    await client.deepResearch({ query: "test", type: "deep-reasoning" });

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.type).toBe("deep-reasoning");
    expect(body.query).toBe("test");
  });

  it("builds contents config with text and highlights", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: { results: [] },
    });
    const client = new ExaDeepResearchClient("key");
    await client.deepResearch({
      query: "test",
      type: "deep-reasoning",
      textMaxCharacters: 16000,
      highlightsMaxCharacters: 900,
      highlightNumSentences: 4,
      highlightsPerUrl: 2,
    });

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.contents.text.maxCharacters).toBe(16000);
    expect(body.contents.highlights.maxCharacters).toBe(900);
    expect(body.contents.highlights.numSentences).toBe(4);
    expect(body.contents.highlights.highlightsPerUrl).toBe(2);
  });

  it("includes summaryQuery in contents when provided", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: { results: [] },
    });
    const client = new ExaDeepResearchClient("key");
    await client.deepResearch({
      query: "test",
      type: "deep-reasoning",
      summaryQuery: "Summarize findings",
    });

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.contents.summary.query).toBe("Summarize findings");
  });

  it("includes optional params when provided", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: { results: [] },
    });
    const client = new ExaDeepResearchClient("key");
    await client.deepResearch({
      query: "test",
      type: "deep-reasoning",
      numResults: 50,
      category: "research paper",
      maxAgeHours: 720,
      includeDomains: ["arxiv.org"],
      excludeDomains: ["spam.com"],
      startPublishedDate: "2025-01-01",
      endPublishedDate: "2025-12-31",
      additionalQueries: ["related topic"],
      systemPrompt: "You are a researcher.",
      outputSchema: { type: "object", properties: {} },
    });

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.numResults).toBe(50);
    expect(body.category).toBe("research paper");
    expect(body.maxAgeHours).toBe(720);
    expect(body.includeDomains).toEqual(["arxiv.org"]);
    expect(body.excludeDomains).toEqual(["spam.com"]);
    expect(body.startPublishedDate).toBe("2025-01-01");
    expect(body.endPublishedDate).toBe("2025-12-31");
    expect(body.additionalQueries).toEqual(["related topic"]);
    expect(body.systemPrompt).toBe("You are a researcher.");
    expect(body.outputSchema).toEqual({ type: "object", properties: {} });
  });

  it("normalizes response results", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: {
        results: [
          {
            title: "Source 1",
            url: "https://example.com/1",
            text: "Full text",
            summary: "Brief summary",
            highlights: ["highlight 1"],
            publishedDate: "2025-06-01",
          },
        ],
        answer: "Synthesized answer",
      },
    });
    const client = new ExaDeepResearchClient("key");
    const response = await client.deepResearch({
      query: "test",
      type: "deep-lite",
    });

    expect(response.answer).toBe("Synthesized answer");
    expect(response.results).toHaveLength(1);
    expect(response.results[0].title).toBe("Source 1");
    expect(response.results[0].url).toBe("https://example.com/1");
    expect(response.results[0].text).toBe("Full text");
    expect(response.results[0].summary).toBe("Brief summary");
    expect(response.results[0].highlights).toEqual(["highlight 1"]);
    expect(response.results[0].publishedDate).toBe("2025-06-01");
  });

  it("handles structured output in response", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: {
        results: [],
        output: {
          content: {
            executiveSummary: "Summary here",
            keyFindings: ["finding 1"],
          },
        },
      },
    });
    const client = new ExaDeepResearchClient("key");
    const response = await client.deepResearch({
      query: "test",
      type: "deep-reasoning",
    });

    expect(response.answer).toContain("Summary here");
    expect(response.answer).toContain("- finding 1");
    expect(response.raw).toHaveProperty("output");
    expect(response.metadata).toHaveProperty("request");
  });

  it("throws on non-2xx response", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      status: 429,
      body: "Rate limited",
    });
    const client = new ExaDeepResearchClient("key");
    await expect(client.deepResearch({ query: "test", type: "deep-lite" })).rejects.toThrow(/429/);
  });

  it("omits undefined optional params from request body", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: { results: [] },
    });
    const client = new ExaDeepResearchClient("key");
    await client.deepResearch({ query: "test", type: "deep-lite" });

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.category).toBeUndefined();
    expect(body.maxAgeHours).toBeUndefined();
    expect(body.includeDomains).toBeUndefined();
    expect(body.excludeDomains).toBeUndefined();
    expect(body.systemPrompt).toBeUndefined();
    expect(body.outputSchema).toBeUndefined();
    expect(body.contents.highlights).toBe(true);
  });

  it("normalizes response with sources array fallback", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: {
        sources: [
          {
            title: "Source via fallback",
            url: "https://example.com/fallback",
            text: "Fallback text",
          },
        ],
      },
    });
    const client = new ExaDeepResearchClient("key");
    const response = await client.deepResearch({
      query: "test",
      type: "deep-lite",
    });

    expect(response.results).toHaveLength(1);
    expect(response.results[0].title).toBe("Source via fallback");
    expect(response.results[0].url).toBe("https://example.com/fallback");
    expect(response.results[0].text).toBe("Fallback text");
  });

  it("passes abort signal to fetch", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: { results: [] },
    });
    const controller = new AbortController();
    const client = new ExaDeepResearchClient("key");
    await client.deepResearch({ query: "test", type: "deep-lite" }, controller.signal);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].signal).toBe(controller.signal);
  });
});
