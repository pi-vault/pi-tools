import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWebFetchTool } from "../../src/tools/web-fetch.ts";
import { ContentStore } from "../../src/storage.ts";
import { makeCtx, stubFetch } from "../helpers.ts";

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
