import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentCache } from "../src/cache.ts";
import type { ExtractedContent } from "../src/extract/pipeline.ts";

function makeContent(url: string, text?: string): ExtractedContent {
  const t = text ?? `Content for ${url}`;
  return {
    text: t,
    title: `Title for ${url}`,
    url,
    extractionChain: ["http:200", "readability"],
    chars: t.length,
    truncated: false,
  };
}

describe("ContentCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns undefined for cache miss", () => {
    const cache = new ContentCache(100, 300_000);
    expect(cache.get("https://example.com/miss")).toBeUndefined();
  });

  it("stores and retrieves content", () => {
    const cache = new ContentCache(100, 300_000);
    const content = makeContent("https://example.com/page");
    cache.set("https://example.com/page", content);
    const hit = cache.get("https://example.com/page");
    expect(hit).toBeDefined();
    expect(hit?.text).toBe("Content for https://example.com/page");
    expect(hit?.title).toBe("Title for https://example.com/page");
  });

  it("evicts oldest entry when maxSize is exceeded", () => {
    const cache = new ContentCache(3, 300_000);
    cache.set("https://a.com", makeContent("https://a.com"));
    cache.set("https://b.com", makeContent("https://b.com"));
    cache.set("https://c.com", makeContent("https://c.com"));

    // Adding a 4th should evict "a" (oldest)
    cache.set("https://d.com", makeContent("https://d.com"));
    expect(cache.get("https://a.com")).toBeUndefined();
    expect(cache.get("https://b.com")).toBeDefined();
    expect(cache.get("https://c.com")).toBeDefined();
    expect(cache.get("https://d.com")).toBeDefined();
  });

  it("expires entries after TTL", () => {
    const cache = new ContentCache(100, 5_000); // 5 second TTL
    cache.set("https://example.com/ttl", makeContent("https://example.com/ttl"));

    // Before TTL: hit
    vi.advanceTimersByTime(4_999);
    expect(cache.get("https://example.com/ttl")).toBeDefined();

    // After TTL: miss
    vi.advanceTimersByTime(2);
    expect(cache.get("https://example.com/ttl")).toBeUndefined();
  });

  it("refreshes insertion order when overwriting an existing key", () => {
    const cache = new ContentCache(3, 300_000);
    cache.set("https://a.com", makeContent("https://a.com"));
    cache.set("https://b.com", makeContent("https://b.com"));
    cache.set("https://c.com", makeContent("https://c.com"));

    // Overwrite "a" — it becomes the newest
    cache.set("https://a.com", makeContent("https://a.com", "Updated"));
    // Adding a 4th should now evict "b" (the oldest remaining)
    cache.set("https://d.com", makeContent("https://d.com"));
    expect(cache.get("https://a.com")).toBeDefined();
    expect(cache.get("https://a.com")?.text).toBe("Updated");
    expect(cache.get("https://b.com")).toBeUndefined();
  });

  it("clear() removes all entries", () => {
    const cache = new ContentCache(100, 300_000);
    cache.set("https://a.com", makeContent("https://a.com"));
    cache.set("https://b.com", makeContent("https://b.com"));
    cache.clear();
    expect(cache.get("https://a.com")).toBeUndefined();
    expect(cache.get("https://b.com")).toBeUndefined();
  });

  it("handles zero maxSize gracefully (never stores)", () => {
    const cache = new ContentCache(0, 300_000);
    cache.set("https://a.com", makeContent("https://a.com"));
    expect(cache.get("https://a.com")).toBeUndefined();
  });
});
