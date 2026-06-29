// tests/providers/serper.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SerperProvider } from "../../src/providers/serper.ts";
import { stubFetch } from "../helpers.ts";

describe("SerperProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => { fetchStub = stubFetch(); });
  afterEach(() => { fetchStub.restore(); });

  it("has correct name and label", () => {
    expect(new SerperProvider("key").name).toBe("serper");
    expect(new SerperProvider("key").label).toBe("Google Serper");
  });

  it("returns normalized search results", async () => {
    fetchStub.addResponse("google.serper.dev", {
      body: {
        organic: [
          { title: "Serper Result", link: "https://serper.dev", snippet: "A snippet" },
        ],
      },
    });
    const results = await new SerperProvider("key").search("test", 5);
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://serper.dev");
  });

  it("sends API key in X-API-KEY header", async () => {
    fetchStub.addResponse("google.serper.dev", { body: { organic: [] } });
    await new SerperProvider("my-key").search("test", 5);
    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers["X-API-KEY"]).toBe("my-key");
  });

  it("throws on error response", async () => {
    fetchStub.addResponse("google.serper.dev", { status: 403 });
    await expect(new SerperProvider("key").search("test", 5)).rejects.toThrow();
  });
});
