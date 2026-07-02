import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWebFetchTool } from "../../src/tools/web-fetch.ts";
import { ContentStore } from "../../src/storage.ts";
import { ContentCache } from "../../src/cache.ts";
import { makeCtx, stubFetch } from "../helpers.ts";
import type { FetchProvider, FetchResult } from "../../src/providers/types.ts";

const GOOD_HTML = `
<!DOCTYPE html><html><head><title>Test</title></head><body>
<article><h1>Article Title</h1>
<p>${"Meaningful content about the topic. ".repeat(30)}</p>
</article></body></html>`;

describe("web_fetch tool", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct tool metadata", () => {
    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    expect(tool.name).toBe("web_fetch");
    expect(tool.label).toBe("Web Fetch");
  });

  it("fetches and extracts HTML content", async () => {
    fetchStub.addResponse("example.com/page", {
      body: GOOD_HTML,
      headers: { "content-type": "text/html" },
    });

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-1",
      { url: "https://example.com/page" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Article Title");
  });

  it("stores large content and returns contentId", async () => {
    const largeContent = `
<!DOCTYPE html><html><head><title>Large</title></head><body>
<article><h1>Large Article</h1>
<p>${"A".repeat(20_000)}</p>
</article></body></html>`;

    fetchStub.addResponse("example.com/large", {
      body: largeContent,
      headers: { "content-type": "text/html" },
    });

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-2",
      { url: "https://example.com/large" },
      undefined,
      undefined,
      ctx,
    );
    expect(result.details).toHaveProperty("contentId");
    expect(result.details.truncated).toBe(true);
  });

  it("returns error for SSRF violations", async () => {
    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-3",
      { url: "http://127.0.0.1/admin" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text.toLowerCase()).toContain("error");
  });
});

function mockFetchProvider(name: string, result: FetchResult): FetchProvider {
  return {
    name,
    fetch: vi.fn().mockResolvedValue(result),
  };
}

function mockFailingFetchProvider(name: string, message: string): FetchProvider {
  return {
    name,
    fetch: vi.fn().mockRejectedValue(new Error(message)),
  };
}

describe("web_fetch fallback to FetchProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("falls back to FetchProvider when HTTP fetch returns 5xx", async () => {
    fetchStub.addResponse("example.com/broken", {
      status: 500,
      body: "Internal Server Error",
      headers: { "content-type": "text/html" },
    });

    const provider = mockFetchProvider("exa", {
      text: "Content from Exa provider",
      title: "Exa Title",
    });

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store, () => [provider]);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-fb-1",
      { url: "https://example.com/broken" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Content from Exa provider");
    expect(result.details.extractionChain).toContain("fetch-provider:exa");
  });

  it("falls back to second FetchProvider when first also fails", async () => {
    fetchStub.addResponse("example.com/broken", {
      status: 503,
      body: "Service Unavailable",
      headers: { "content-type": "text/html" },
    });

    const failProvider = mockFailingFetchProvider("jina", "Jina timeout");
    const workProvider = mockFetchProvider("exa", {
      text: "Content from Exa",
      title: "Exa Title",
    });

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store, () => [failProvider, workProvider]);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-fb-2",
      { url: "https://example.com/broken" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Content from Exa");
  });

  it("does NOT fall back on 4xx client errors (except 429)", async () => {
    fetchStub.addResponse("example.com/notfound", {
      status: 404,
      body: "Not Found",
      headers: { "content-type": "text/html" },
    });

    const provider = mockFetchProvider("exa", {
      text: "Should not reach this",
      title: "Exa",
    });

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store, () => [provider]);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-fb-3",
      { url: "https://example.com/notfound" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text.toLowerCase()).toContain("error");
    expect(provider.fetch).not.toHaveBeenCalled();
  });

  it("falls back on 429 rate limit errors", async () => {
    fetchStub.addResponse("example.com/limited", {
      status: 429,
      body: "Rate Limited",
      headers: { "content-type": "text/html" },
    });

    const provider = mockFetchProvider("exa", {
      text: "Content via fallback",
      title: "Fallback Title",
    });

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store, () => [provider]);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-fb-4",
      { url: "https://example.com/limited" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Content via fallback");
  });

  it("returns aggregate error when pipeline and all providers fail", async () => {
    fetchStub.addResponse("example.com/broken", {
      status: 500,
      body: "Server Error",
      headers: { "content-type": "text/html" },
    });

    const failProvider = mockFailingFetchProvider("exa", "Exa unavailable");

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store, () => [failProvider]);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-fb-5",
      { url: "https://example.com/broken" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text.toLowerCase()).toContain("error");
  });

  it("works without any fetch providers (existing behavior preserved)", async () => {
    fetchStub.addResponse("example.com/page", {
      body: GOOD_HTML,
      headers: { "content-type": "text/html" },
    });

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store, () => []);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-fb-6",
      { url: "https://example.com/page" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Article Title");
  });
});

describe("web_fetch caching", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("returns cached content on second call without re-fetching", async () => {
    fetchStub.addResponse("example.com/cached", {
      body: GOOD_HTML,
      headers: { "content-type": "text/html" },
    });

    const store = new ContentStore(() => {});
    const cache = new ContentCache(100, 300_000);
    const tool = createWebFetchTool(store, undefined, cache);
    const ctx = makeCtx();

    // First call — fetches from network
    const result1 = await tool.execute(
      "call-c1",
      { url: "https://example.com/cached" },
      undefined,
      undefined,
      ctx,
    );
    expect((result1.content[0] as { type: "text"; text: string }).text).toContain("Article Title");

    // Clear fetch routes to prove second call doesn't fetch
    fetchStub.restore();
    const emptyFetch = stubFetch();

    const result2 = await tool.execute(
      "call-c2",
      { url: "https://example.com/cached" },
      undefined,
      undefined,
      ctx,
    );
    expect((result2.content[0] as { type: "text"; text: string }).text).toContain("Article Title");

    emptyFetch.restore();
  });

  it("works without a cache (backward compatible)", async () => {
    fetchStub.addResponse("example.com/nocache", {
      body: GOOD_HTML,
      headers: { "content-type": "text/html" },
    });

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    const ctx = makeCtx();

    const result = await tool.execute(
      "call-c3",
      { url: "https://example.com/nocache" },
      undefined,
      undefined,
      ctx,
    );
    expect((result.content[0] as { type: "text"; text: string }).text).toContain("Article Title");
  });
});

describe("web_fetch multi-URL", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("rejects when both url and urls are provided", async () => {
    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-m1",
      { url: "https://a.com", urls: ["https://b.com"] } as any,
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text.toLowerCase()).toContain("error");
    expect(text).toContain("exactly one");
  });

  it("rejects when neither url nor urls is provided", async () => {
    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-m2",
      {} as any,
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text.toLowerCase()).toContain("error");
    expect(text).toContain("exactly one");
  });

  it("rejects urls array longer than 20", async () => {
    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    const ctx = makeCtx();
    const urls = Array.from({ length: 21 }, (_, i) => `https://example.com/${i}`);
    const result = await tool.execute(
      "call-m3",
      { urls } as any,
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text.toLowerCase()).toContain("error");
    expect(text).toContain("20");
  });

  it("fetches 2 URLs concurrently with split budget", async () => {
    const html1 = `<!DOCTYPE html><html><head><title>Page One</title></head><body>
<article><h1>Page One</h1><p>${"First page content. ".repeat(30)}</p></article></body></html>`;
    const html2 = `<!DOCTYPE html><html><head><title>Page Two</title></head><body>
<article><h1>Page Two</h1><p>${"Second page content. ".repeat(30)}</p></article></body></html>`;

    fetchStub.addResponse("example.com/one", {
      body: html1,
      headers: { "content-type": "text/html" },
    });
    fetchStub.addResponse("example.com/two", {
      body: html2,
      headers: { "content-type": "text/html" },
    });

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-m4",
      { urls: ["https://example.com/one", "https://example.com/two"] },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Page One");
    expect(text).toContain("Page Two");
    expect(result.details.urlResults).toHaveLength(2);
  });

  it("stores full content for multi-URL via ContentStore", async () => {
    const html1 = `<!DOCTYPE html><html><head><title>Stored</title></head><body>
<article><h1>Stored Page</h1><p>${"Stored content. ".repeat(30)}</p></article></body></html>`;

    fetchStub.addResponse("example.com/stored", {
      body: html1,
      headers: { "content-type": "text/html" },
    });

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-m5",
      { urls: ["https://example.com/stored"] },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Stored Page");
  });

  it("handles partial failures in multi-URL mode", async () => {
    fetchStub.addResponse("example.com/ok", {
      body: GOOD_HTML,
      headers: { "content-type": "text/html" },
    });
    fetchStub.addResponse("example.com/fail", {
      status: 500,
      body: "Server Error",
      headers: { "content-type": "text/html" },
    });

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-m6",
      { urls: ["https://example.com/ok", "https://example.com/fail"] },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Article Title");
    expect(result.details.urlResults).toHaveLength(2);
    const failResult = result.details.urlResults!.find(
      (r: any) => r.url === "https://example.com/fail",
    );
    expect(failResult!.error).toBeDefined();
  });

  it("uses manifest mode (512-char preview) for 6+ URLs", async () => {
    const urls: string[] = [];
    for (let i = 0; i < 6; i++) {
      const domain = `site${i}.com`;
      urls.push(`https://${domain}/page`);
      fetchStub.addResponse(`${domain}/page`, {
        body: `<!DOCTYPE html><html><head><title>Site ${i}</title></head><body>
<article><h1>Site ${i}</h1><p>${"Content for this site. ".repeat(50)}</p></article></body></html>`,
        headers: { "content-type": "text/html" },
      });
    }

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-m7",
      { urls },
      undefined,
      undefined,
      ctx,
    );
    expect(result.details.urlResults).toHaveLength(6);
    // All should have contentIds for full retrieval
    for (const ur of result.details.urlResults!) {
      if (!(ur as any).error) {
        expect((ur as any).contentId).toBeDefined();
      }
    }
  });
});

describe("web_fetch fresh parameter", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("bypasses cache when fresh is true", async () => {
    const html1 = `<!DOCTYPE html><html><head><title>V1</title></head><body>
<article><h1>Version 1</h1><p>${"First version content. ".repeat(30)}</p></article></body></html>`;
    const html2 = `<!DOCTYPE html><html><head><title>V2</title></head><body>
<article><h1>Version 2</h1><p>${"Second version content. ".repeat(30)}</p></article></body></html>`;

    fetchStub.addResponse("example.com/changing", {
      body: html1,
      headers: { "content-type": "text/html" },
    });

    const store = new ContentStore(() => {});
    const cache = new ContentCache(100, 300_000);
    const tool = createWebFetchTool(store, undefined, cache);
    const ctx = makeCtx();

    // First fetch — populates cache with V1
    const result1 = await tool.execute(
      "call-f1",
      { url: "https://example.com/changing" },
      undefined,
      undefined,
      ctx,
    );
    expect((result1.content[0] as { type: "text"; text: string }).text).toContain("Version 1");

    // Update the response to V2
    fetchStub.restore();
    const freshStub = stubFetch();
    freshStub.addResponse("example.com/changing", {
      body: html2,
      headers: { "content-type": "text/html" },
    });

    // Without fresh: still gets V1 from cache
    const result2 = await tool.execute(
      "call-f2",
      { url: "https://example.com/changing" },
      undefined,
      undefined,
      ctx,
    );
    expect((result2.content[0] as { type: "text"; text: string }).text).toContain("Version 1");

    // With fresh: bypasses cache, gets V2
    const result3 = await tool.execute(
      "call-f3",
      { url: "https://example.com/changing", fresh: true },
      undefined,
      undefined,
      ctx,
    );
    expect((result3.content[0] as { type: "text"; text: string }).text).toContain("Version 2");

    // Cache now has V2 — subsequent non-fresh call returns V2
    const result4 = await tool.execute(
      "call-f4",
      { url: "https://example.com/changing" },
      undefined,
      undefined,
      ctx,
    );
    expect((result4.content[0] as { type: "text"; text: string }).text).toContain("Version 2");

    freshStub.restore();
  });

  it("fresh still writes back to cache", async () => {
    fetchStub.addResponse("example.com/writeback", {
      body: GOOD_HTML,
      headers: { "content-type": "text/html" },
    });

    const store = new ContentStore(() => {});
    const cache = new ContentCache(100, 300_000);
    const tool = createWebFetchTool(store, undefined, cache);
    const ctx = makeCtx();

    // Fresh fetch — should write to cache
    await tool.execute(
      "call-f5",
      { url: "https://example.com/writeback", fresh: true },
      undefined,
      undefined,
      ctx,
    );

    // Second call without fresh — should hit cache
    fetchStub.restore();
    const emptyStub = stubFetch();

    const result = await tool.execute(
      "call-f6",
      { url: "https://example.com/writeback" },
      undefined,
      undefined,
      ctx,
    );
    expect((result.content[0] as { type: "text"; text: string }).text).toContain("Article Title");

    emptyStub.restore();
  });
});
