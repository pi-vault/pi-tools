// tests/providers/tavily.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TavilyProvider } from "../../src/providers/tavily.ts";
import { stubFetch } from "../helpers.ts";

describe("TavilyProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => { fetchStub = stubFetch(); });
  afterEach(() => { fetchStub.restore(); });

  it("has correct name and label", () => {
    expect(new TavilyProvider("key").name).toBe("tavily");
    expect(new TavilyProvider("key").label).toBe("Tavily");
  });

  it("returns search results", async () => {
    fetchStub.addResponse("api.tavily.com", {
      body: {
        results: [
          { title: "Tavily Result", url: "https://tavily.com", content: "A snippet" },
        ],
      },
    });
    const results = await new TavilyProvider("key").search("test", 5);
    expect(results).toHaveLength(1);
    expect(results[0].snippet).toBe("A snippet");
  });

  it("sends API key in request body", async () => {
    fetchStub.addResponse("api.tavily.com", { body: { results: [] } });
    await new TavilyProvider("my-key").search("test", 5);
    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.api_key).toBe("my-key");
  });

  it("fetches content via extract API", async () => {
    fetchStub.addResponse("api.tavily.com/extract", {
      body: { results: [{ raw_content: "Extracted content here" }] },
    });
    const result = await new TavilyProvider("key").fetch("https://example.com");
    expect(result.text).toBe("Extracted content here");
  });
});
