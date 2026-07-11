// tests/providers/openai-native.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { providerMeta } from "../../src/providers/openai-native.ts";
import { stubFetch } from "../helpers.ts";

const makeProvider = (key = "test-key") => providerMeta.create(key).search!;

describe("OpenAINativeProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct name and label", () => {
    const provider = makeProvider();
    expect(provider.name).toBe("openai-native");
    expect(provider.label).toBe("OpenAI Web Search");
  });

  it("returns normalized search results from url_citation annotations", async () => {
    fetchStub.addResponse("api.openai.com/v1/responses", {
      body: {
        id: "resp_123",
        output: [
          {
            type: "web_search_call",
            id: "ws_1",
            status: "completed",
            action: { type: "search", query: "test query" },
          },
          {
            type: "message",
            id: "msg_1",
            status: "completed",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: "Here are your results about the topic.",
                annotations: [
                  {
                    type: "url_citation",
                    url: "https://openai.com/page",
                    title: "OpenAI Result",
                    start_index: 0,
                    end_index: 20,
                  },
                  {
                    type: "url_citation",
                    url: "https://example.com/other",
                    title: "Another Result",
                    start_index: 21,
                    end_index: 38,
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const results = await makeProvider().search("test query", 5);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "OpenAI Result",
      url: "https://openai.com/page",
      snippet: "",
    });
    expect(results[1]).toEqual({
      title: "Another Result",
      url: "https://example.com/other",
      snippet: "",
    });
  });

  it("deduplicates citations by URL", async () => {
    fetchStub.addResponse("api.openai.com/v1/responses", {
      body: {
        id: "resp_123",
        output: [
          {
            type: "web_search_call",
            id: "ws_1",
            status: "completed",
            action: { type: "search", query: "test" },
          },
          {
            type: "message",
            id: "msg_1",
            status: "completed",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: "Multiple citations from same source.",
                annotations: [
                  {
                    type: "url_citation",
                    url: "https://example.com/page",
                    title: "Same Page",
                    start_index: 0,
                    end_index: 10,
                  },
                  {
                    type: "url_citation",
                    url: "https://example.com/page",
                    title: "Same Page",
                    start_index: 15,
                    end_index: 30,
                  },
                  {
                    type: "url_citation",
                    url: "https://other.com",
                    title: "Other Page",
                    start_index: 31,
                    end_index: 35,
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const results = await makeProvider("key").search("test", 10);
    expect(results).toHaveLength(2);
    expect(results[0].url).toBe("https://example.com/page");
    expect(results[1].url).toBe("https://other.com");
  });

  it("sends correct request body with web_search tool", async () => {
    fetchStub.addResponse("api.openai.com/v1/responses", {
      body: { id: "resp_123", output: [] },
    });

    await makeProvider("my-openai-key").search("my query", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const url = fetchCall[0] as string;
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(fetchCall[1].method).toBe("POST");

    const body = JSON.parse(fetchCall[1].body);
    expect(body.model).toBe("gpt-4.1-nano");
    expect(body.tools).toEqual([{ type: "web_search" }]);
    expect(body.input).toContain("my query");
    expect(body.tool_choice).toBe("required");

    expect(fetchCall[1].headers["Authorization"]).toBe("Bearer my-openai-key");
    expect(fetchCall[1].headers["Content-Type"]).toBe("application/json");
  });

  it("limits results to maxResults", async () => {
    const annotations = Array.from({ length: 10 }, (_, i) => ({
      type: "url_citation",
      url: `https://example.com/${i}`,
      title: `Result ${i}`,
      start_index: i * 10,
      end_index: i * 10 + 9,
    }));
    fetchStub.addResponse("api.openai.com/v1/responses", {
      body: {
        id: "resp_123",
        output: [
          {
            type: "web_search_call",
            id: "ws_1",
            status: "completed",
            action: { type: "search", query: "test" },
          },
          {
            type: "message",
            id: "msg_1",
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: "Results.", annotations }],
          },
        ],
      },
    });

    const results = await makeProvider("key").search("test", 3);
    expect(results).toHaveLength(3);
  });

  it("throws on HTTP error response", async () => {
    fetchStub.addResponse("api.openai.com/v1/responses", {
      status: 401,
      body: "Invalid API key",
    });
    await expect(makeProvider("bad-key").search("test", 5)).rejects.toThrow();
  });

  it("returns empty results when no message in output", async () => {
    fetchStub.addResponse("api.openai.com/v1/responses", {
      body: { id: "resp_123", output: [] },
    });

    const results = await makeProvider("key").search("obscure query", 5);
    expect(results).toEqual([]);
  });

  it("returns empty results when message has no annotations", async () => {
    fetchStub.addResponse("api.openai.com/v1/responses", {
      body: {
        id: "resp_123",
        output: [
          {
            type: "message",
            id: "msg_1",
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: "I could not find any results." }],
          },
        ],
      },
    });

    const results = await makeProvider("key").search("nothing found", 5);
    expect(results).toEqual([]);
  });
});
