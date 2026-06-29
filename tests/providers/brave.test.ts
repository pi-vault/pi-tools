// tests/providers/brave.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BraveProvider } from "../../src/providers/brave.ts";
import { stubFetch } from "../helpers.ts";

describe("BraveProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct name and label", () => {
    const provider = new BraveProvider("test-key");
    expect(provider.name).toBe("brave");
    expect(provider.label).toBe("Brave Search");
  });

  it("returns normalized search results", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: {
        web: {
          results: [
            { title: "Brave Result", url: "https://brave.com", description: "A brave snippet" },
          ],
        },
      },
    });

    const provider = new BraveProvider("test-key");
    const results = await provider.search("test", 5);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Brave Result");
    expect(results[0].snippet).toBe("A brave snippet");
  });

  it("sends API key in header", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: { web: { results: [] } },
    });

    const provider = new BraveProvider("my-brave-key");
    await provider.search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers["X-Subscription-Token"]).toBe("my-brave-key");
  });

  it("throws on non-2xx response", async () => {
    fetchStub.addResponse("api.search.brave.com", { status: 429, body: "Rate limited" });
    const provider = new BraveProvider("test-key");
    await expect(provider.search("test", 5)).rejects.toThrow();
  });
});
