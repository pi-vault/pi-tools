// tests/providers/perplexity.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PerplexityProvider } from "../../src/providers/perplexity.ts";
import { stubFetch } from "../helpers.ts";

describe("PerplexityProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => { fetchStub = stubFetch(); });
  afterEach(() => { fetchStub.restore(); });

  it("has correct name and label", () => {
    expect(new PerplexityProvider("key").name).toBe("perplexity");
    expect(new PerplexityProvider("key").label).toBe("Perplexity Sonar");
  });

  it("returns search results from chat completion format", async () => {
    fetchStub.addResponse("api.perplexity.ai", {
      body: {
        choices: [{ message: { content: "Perplexity answer about the topic" } }],
        citations: ["https://source1.com", "https://source2.com"],
      },
    });
    const results = await new PerplexityProvider("key").search("test", 5);
    expect(results.length).toBeGreaterThan(0);
  });

  it("sends Bearer auth header", async () => {
    fetchStub.addResponse("api.perplexity.ai", {
      body: { choices: [{ message: { content: "answer" } }], citations: [] },
    });
    await new PerplexityProvider("my-key").search("test", 5);
    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers.Authorization).toBe("Bearer my-key");
  });
});
