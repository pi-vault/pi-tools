import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractContent } from "../../src/extract/pipeline.ts";
import { stubFetch } from "../helpers.ts";

const GOOD_HTML = `
<!DOCTYPE html><html><head><title>Article</title></head><body>
<article><h1>Real Article</h1>
<p>${"This is meaningful content about the topic. ".repeat(30)}</p>
</article></body></html>`;

describe("extractContent", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("extracts HTML content via Readability pipeline", async () => {
    fetchStub.addResponse("example.com/article", {
      body: GOOD_HTML,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    const result = await extractContent("https://example.com/article");
    expect(result.text).toContain("Real Article");
    expect(result.extractionChain).toContain("readability");
    expect(result.chars).toBeGreaterThan(0);
  });

  it("tracks extraction chain metadata", async () => {
    fetchStub.addResponse("example.com", {
      body: GOOD_HTML,
      headers: { "content-type": "text/html" },
    });
    const result = await extractContent("https://example.com");
    expect(result.extractionChain.length).toBeGreaterThan(0);
    expect(result.url).toBe("https://example.com");
  });

  it("rejects non-http URLs via SSRF guard", async () => {
    await expect(extractContent("ftp://evil.com")).rejects.toThrow();
  });

  it("rejects private IPs", async () => {
    await expect(extractContent("http://127.0.0.1/admin")).rejects.toThrow();
  });

  it("rejects binary content types", async () => {
    fetchStub.addResponse("example.com/image.png", {
      body: "binary",
      headers: { "content-type": "image/png" },
    });
    await expect(
      extractContent("https://example.com/image.png"),
    ).rejects.toThrow(/binary/i);
  });

  it("falls back to raw-text when Readability returns thin content", async () => {
    const thinHtml = "<html><body><p>Short content that is too thin for Readability</p></body></html>";
    fetchStub.addResponse("example.com/thin", {
      body: thinHtml,
      headers: { "content-type": "text/html" },
    });
    const result = await extractContent("https://example.com/thin");
    expect(result.extractionChain).toContain("readability:thin");
    expect(result.extractionChain).toContain("raw-text");
    expect(result.text).toContain("Short content");
  });

  it("throws on HTTP error responses", async () => {
    fetchStub.addResponse("example.com/missing", {
      status: 404,
      body: "Not Found",
      headers: { "content-type": "text/html" },
    });
    await expect(
      extractContent("https://example.com/missing"),
    ).rejects.toThrow(/HTTP 404/);
  });

  it("handles responses without content-type header", async () => {
    const html = `<html><body><p>${"Some text content. ".repeat(50)}</p></body></html>`;
    fetchStub.addResponse("example.com/no-ct", {
      body: html,
      headers: {},
    });
    // Should not throw — falls through to extraction attempt
    const result = await extractContent("https://example.com/no-ct");
    expect(result.text).toContain("Some text content");
  });
});
