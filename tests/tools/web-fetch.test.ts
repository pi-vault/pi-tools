import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWebFetchTool } from "../../src/tools/web-fetch.ts";
import { ContentStore } from "../../src/storage.ts";
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
