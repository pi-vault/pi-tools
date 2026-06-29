// tests/providers/exa.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExaProvider } from "../../src/providers/exa.ts";
import { stubFetch } from "../helpers.ts";

describe("ExaProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => { fetchStub = stubFetch(); });
  afterEach(() => { fetchStub.restore(); });

  it("has correct name and label", () => {
    expect(new ExaProvider("key").name).toBe("exa");
    expect(new ExaProvider("key").label).toBe("Exa");
  });

  it("returns search results", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: {
        results: [
          { title: "Exa Result", url: "https://exa.ai", text: "Exa snippet" },
        ],
      },
    });
    const results = await new ExaProvider("key").search("test", 5);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Exa Result");
  });

  it("returns code search results", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: {
        results: [
          { title: "Code Example", url: "https://github.com/ex", text: "const x = 1;" },
        ],
      },
    });
    const results = await new ExaProvider("key").codeSearch("typescript example", 5);
    expect(results).toHaveLength(1);
    expect(results[0].snippet).toBe("const x = 1;");
  });

  it("sends auth header", async () => {
    fetchStub.addResponse("api.exa.ai", { body: { results: [] } });
    await new ExaProvider("my-exa-key").search("test", 5);
    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers["x-api-key"]).toBe("my-exa-key");
  });

  it("fetches content via contents endpoint", async () => {
    fetchStub.addResponse("api.exa.ai/contents", {
      body: { results: [{ text: "Full page content" }] },
    });
    const result = await new ExaProvider("key").fetch("https://example.com");
    expect(result.text).toBe("Full page content");
  });
});
