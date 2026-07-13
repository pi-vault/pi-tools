// tests/providers/perplexity.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { providerMeta } from "../../src/providers/perplexity.ts";
import { stubFetch } from "../helpers.ts";
import type { SearchFilters } from "../../src/providers/types.ts";

const makeProvider = (key = "key") => providerMeta.create(key).search!;

describe("PerplexityProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });
  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct name and label", () => {
    const p = makeProvider();
    expect(p.name).toBe("perplexity");
    expect(p.label).toBe("Perplexity Sonar");
  });

  it("returns search results from chat completion format", async () => {
    fetchStub.addResponse("api.perplexity.ai", {
      body: {
        choices: [{ message: { content: "Perplexity answer about the topic" } }],
        citations: ["https://source1.com", "https://source2.com"],
      },
    });
    const results = await makeProvider().search("test", 5);
    expect(results.length).toBeGreaterThan(0);
  });

  it("sends Bearer auth header", async () => {
    fetchStub.addResponse("api.perplexity.ai", {
      body: { choices: [{ message: { content: "answer" } }], citations: [] },
    });
    await makeProvider("my-key").search("test", 5);
    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers.Authorization).toBe("Bearer my-key");
  });

  describe("search filters", () => {
    it("accepts filters parameter without error", async () => {
      fetchStub.addResponse("api.perplexity.ai", {
        body: {
          choices: [{ message: { content: "Answer text" } }],
          citations: ["https://example.com"],
        },
      });

      const filters: SearchFilters = {
        includeDomains: ["example.com"],
        excludeDomains: ["spam.com"],
        startDate: "2025-01-01",
        endDate: "2025-12-31",
      };
      const results = await makeProvider().search("test", 5, undefined, filters);
      expect(results.length).toBeGreaterThan(0);
    });

    it("does not modify the request body when filters are provided", async () => {
      fetchStub.addResponse("api.perplexity.ai", {
        body: {
          choices: [{ message: { content: "Answer" } }],
          citations: [],
        },
      });

      const filters: SearchFilters = { includeDomains: ["example.com"] };
      await makeProvider().search("test query", 5, undefined, filters);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.messages[0].content).toBe("test query");
      expect(body.includeDomains).toBeUndefined();
    });
  });

  describe("model config", () => {
    it("uses default model 'sonar' when not configured", async () => {
      fetchStub.addResponse("api.perplexity.ai", {
        body: { choices: [{ message: { content: "answer" } }], citations: [] },
      });

      await makeProvider().search("test", 5);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.model).toBe("sonar");
    });

    it("uses configured model from providerConfig", async () => {
      fetchStub.addResponse("api.perplexity.ai", {
        body: { choices: [{ message: { content: "answer" } }], citations: [] },
      });

      const provider = providerMeta.create("pplx-key", {
        enabled: true,
        model: "sonar-pro",
      }).search!;
      await provider.search("test", 5);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.model).toBe("sonar-pro");
    });

  });
});
