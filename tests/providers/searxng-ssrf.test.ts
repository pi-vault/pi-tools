import { describe, expect, it } from "vitest";
import { SearXNGProvider } from "../../src/providers/searxng.ts";

describe("SearXNGProvider allowRanges", () => {
  it("accepts allowRanges in constructor without error", () => {
    // SearXNG already uses allowedBaseUrls for its own instanceUrl, so
    // allowRanges provides defense-in-depth for consistency with other callers.
    // This test verifies the option is accepted at the type/constructor level.
    const provider = new SearXNGProvider({
      instanceUrl: "http://localhost:8080",
      allowRanges: ["198.18.0.0/15"],
    });
    expect(provider).toBeDefined();
    expect(provider.instanceUrl).toBe("http://localhost:8080");
  });

  it("works without allowRanges (backward compatible)", () => {
    const provider = new SearXNGProvider({
      instanceUrl: "http://localhost:9090",
    });
    expect(provider).toBeDefined();
  });
});
