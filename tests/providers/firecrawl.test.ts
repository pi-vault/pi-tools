// tests/providers/firecrawl.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FirecrawlProvider } from "../../src/providers/firecrawl.ts";
import { stubFetch } from "../helpers.ts";

describe("FirecrawlProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => { fetchStub = stubFetch(); });
  afterEach(() => { fetchStub.restore(); });

  it("has correct name and label", () => {
    expect(new FirecrawlProvider("key").name).toBe("firecrawl");
    expect(new FirecrawlProvider("key").label).toBe("Firecrawl");
  });

  it("returns search results", async () => {
    fetchStub.addResponse("api.firecrawl.dev/v1/search", {
      body: {
        data: [
          { title: "FC Result", url: "https://firecrawl.dev", markdown: "snippet text" },
        ],
      },
    });
    const results = await new FirecrawlProvider("key").search("test", 5);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("FC Result");
  });

  it("fetches content via scrape API", async () => {
    fetchStub.addResponse("api.firecrawl.dev/v1/scrape", {
      body: { data: { markdown: "Scraped content" } },
    });
    const result = await new FirecrawlProvider("key").fetch("https://example.com");
    expect(result.text).toBe("Scraped content");
  });

  it("sends Bearer auth header", async () => {
    fetchStub.addResponse("api.firecrawl.dev", { body: { data: [] } });
    await new FirecrawlProvider("my-key").search("test", 5);
    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers.Authorization).toBe("Bearer my-key");
  });
});
