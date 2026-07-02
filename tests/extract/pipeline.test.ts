import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RetryableExtractionError, extractContent } from "../../src/extract/pipeline.ts";
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

  it("falls back to RSC parser for Next.js pages", async () => {
    const rscHtml = `<html><body>
      <script>self.__next_f.push([1,"${"Real content ".repeat(50)}"])</script>
    </body></html>`;
    fetchStub.addResponse("nextjs-app.com", {
      body: rscHtml,
      headers: { "content-type": "text/html" },
    });
    const result = await extractContent("https://nextjs-app.com");
    expect(result.extractionChain).toContain("rsc");
  });

  it("rejects binary image content", async () => {
    fetchStub.addResponse("example.com/photo.jpg", {
      body: "binary",
      headers: { "content-type": "image/jpeg" },
    });
    await expect(extractContent("https://example.com/photo.jpg")).rejects.toThrow(/binary/i);
  });
});

describe("RetryableExtractionError", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("is thrown for HTTP 500", async () => {
    fetchStub.addResponse("example.com/server-error", {
      status: 500,
      body: "Internal Server Error",
      headers: { "content-type": "text/html" },
    });

    await expect(extractContent("https://example.com/server-error")).rejects.toThrow(
      RetryableExtractionError,
    );
  });

  it("is thrown for HTTP 503", async () => {
    fetchStub.addResponse("example.com/unavailable", {
      status: 503,
      body: "Service Unavailable",
      headers: { "content-type": "text/html" },
    });

    await expect(extractContent("https://example.com/unavailable")).rejects.toThrow(
      RetryableExtractionError,
    );
  });

  it("is thrown for HTTP 429", async () => {
    fetchStub.addResponse("example.com/rate-limited", {
      status: 429,
      body: "Too Many Requests",
      headers: { "content-type": "text/html" },
    });

    await expect(extractContent("https://example.com/rate-limited")).rejects.toThrow(
      RetryableExtractionError,
    );
  });

  it("is NOT thrown for HTTP 404", async () => {
    fetchStub.addResponse("example.com/missing", {
      status: 404,
      body: "Not Found",
      headers: { "content-type": "text/html" },
    });

    await expect(extractContent("https://example.com/missing")).rejects.toThrow(Error);
    await expect(extractContent("https://example.com/missing")).rejects.not.toThrow(
      RetryableExtractionError,
    );
  });

  it("is NOT thrown for HTTP 403", async () => {
    fetchStub.addResponse("example.com/forbidden", {
      status: 403,
      body: "Forbidden",
      headers: { "content-type": "text/html" },
    });

    await expect(extractContent("https://example.com/forbidden")).rejects.toThrow(Error);
    await expect(extractContent("https://example.com/forbidden")).rejects.not.toThrow(
      RetryableExtractionError,
    );
  });

  it("is thrown for network-level failures (DNS, connection refused, etc)", async () => {
    // Override the stubFetch to throw a TypeError (what fetch() throws on network failure)
    fetchStub.restore();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    try {
      await expect(extractContent("https://unreachable.example.com")).rejects.toThrow(
        RetryableExtractionError,
      );
      await expect(extractContent("https://unreachable.example.com")).rejects.toThrow(
        /fetch failed/,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("extractContent raw mode", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("returns raw HTML body without parsing when raw is true", async () => {
    const rawHtml = `<!DOCTYPE html><html><head><title>Raw</title></head><body>
<div class="sidebar">Nav</div>
<article><h1>Title</h1><p>Content</p></article>
</body></html>`;

    fetchStub.addResponse("example.com/raw", {
      body: rawHtml,
      headers: { "content-type": "text/html" },
    });

    const result = await extractContent(
      "https://example.com/raw",
      undefined,
      { raw: true },
    );
    expect(result.text).toBe(rawHtml);
    expect(result.extractionChain).toContain("raw");
    expect(result.chars).toBe(rawHtml.length);
  });

  it("raw mode still blocks SSRF URLs", async () => {
    await expect(
      extractContent("http://127.0.0.1/admin", undefined, { raw: true }),
    ).rejects.toThrow(/blocked/i);
  });

  it("raw mode still blocks binary content types", async () => {
    fetchStub.addResponse("example.com/image", {
      body: "binary-data",
      headers: { "content-type": "image/png" },
    });

    await expect(
      extractContent("https://example.com/image", undefined, { raw: true }),
    ).rejects.toThrow(/unsupported binary/i);
  });

  it("raw mode returns body for non-HTML content types", async () => {
    const jsonBody = '{"key": "value", "items": [1, 2, 3]}';
    fetchStub.addResponse("example.com/api", {
      body: jsonBody,
      headers: { "content-type": "application/json" },
    });

    const result = await extractContent(
      "https://example.com/api",
      undefined,
      { raw: true },
    );
    expect(result.text).toBe(jsonBody);
    expect(result.extractionChain).toContain("raw");
  });

  it("raw mode propagates HTTP errors normally", async () => {
    fetchStub.addResponse("example.com/err", {
      status: 404,
      body: "Not Found",
      headers: { "content-type": "text/html" },
    });

    await expect(
      extractContent("https://example.com/err", undefined, { raw: true }),
    ).rejects.toThrow(/404/);
  });
});

describe("GitHub URL interception in extractContent", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("intercepts blob URL and returns raw file content", async () => {
    fetchStub.addResponse(
      "raw.githubusercontent.com/facebook/react/main/README.md",
      {
        body: "# React\n\nA library for building UIs.",
        headers: { "content-type": "text/plain" },
      },
    );

    const result = await extractContent(
      "https://github.com/facebook/react/blob/main/README.md",
    );
    expect(result.text).toContain("React");
    expect(result.extractionChain).toContain("github:raw");
    // Should NOT have gone through the normal HTTP pipeline
    expect(result.extractionChain).not.toContain("readability");
  });

  it("intercepts raw.githubusercontent.com URL directly", async () => {
    fetchStub.addResponse(
      "raw.githubusercontent.com/owner/repo/main/config.json",
      {
        body: '{"setting": true}',
        headers: { "content-type": "text/plain" },
      },
    );

    const result = await extractContent(
      "https://raw.githubusercontent.com/owner/repo/main/config.json",
    );
    expect(result.text).toContain('"setting": true');
    expect(result.extractionChain).toContain("github:raw");
  });

  it("does NOT intercept issues URL — falls through to normal pipeline", async () => {
    const issuesHtml = `
      <!DOCTYPE html><html><head><title>Issue #123</title></head><body>
      <article><h1>Bug Report</h1>
      <p>${"This issue describes a bug in the system. ".repeat(30)}</p>
      </article></body></html>`;

    fetchStub.addResponse("github.com/facebook/react/issues/123", {
      body: issuesHtml,
      headers: { "content-type": "text/html" },
    });

    const result = await extractContent(
      "https://github.com/facebook/react/issues/123",
    );
    // Should go through normal extraction (Readability, etc.)
    expect(result.extractionChain).toContain("readability");
    expect(result.extractionChain).not.toContain("github:raw");
    expect(result.extractionChain).not.toContain("github:clone");
    expect(result.extractionChain).not.toContain("github:api");
  });

  it("does NOT intercept pull request URL", async () => {
    const prHtml = `
      <!DOCTYPE html><html><head><title>PR #456</title></head><body>
      <article><h1>Feature PR</h1>
      <p>${"This PR adds a new feature to the codebase. ".repeat(30)}</p>
      </article></body></html>`;

    fetchStub.addResponse("github.com/facebook/react/pull/456", {
      body: prHtml,
      headers: { "content-type": "text/html" },
    });

    const result = await extractContent(
      "https://github.com/facebook/react/pull/456",
    );
    expect(result.extractionChain).toContain("readability");
  });

  it("falls through to normal pipeline when GitHub interceptor returns null", async () => {
    // Tier 1: raw fetch fails
    fetchStub.addResponse(
      "raw.githubusercontent.com/owner/repo/main/missing.ts",
      { status: 404, body: "Not Found" },
    );

    // Tier 3 (API) mock added before less-specific repo mock
    fetchStub.addResponse(
      "api.github.com/repos/owner/repo/contents/missing.ts",
      {
        status: 404,
        body: { message: "Not Found" },
        headers: { "content-type": "application/json" },
      },
    );

    // Tier 2: repo size check fails (API returns error)
    fetchStub.addResponse("api.github.com/repos/owner/repo", {
      status: 403,
      body: { message: "rate limited" },
      headers: { "content-type": "application/json" },
    });

    // Normal pipeline's HTTP fetch for the original URL
    const fallbackHtml = `
      <!DOCTYPE html><html><head><title>Blob View</title></head><body>
      <article><h1>File Content</h1>
      <p>${"Rendered blob view content from GitHub. ".repeat(30)}</p>
      </article></body></html>`;

    fetchStub.addResponse("github.com/owner/repo/blob/main/missing.ts", {
      body: fallbackHtml,
      headers: { "content-type": "text/html" },
    });

    const result = await extractContent(
      "https://github.com/owner/repo/blob/main/missing.ts",
    );
    // Falls through to normal pipeline
    expect(result.extractionChain).toContain("readability");
  });

  it("does not interfere with non-GitHub URLs", async () => {
    fetchStub.addResponse("example.com/page", {
      body: `<html><head><title>Normal Page</title></head><body>
        <article><h1>Normal Content</h1>
        <p>${"Regular web page content. ".repeat(30)}</p>
        </article></body></html>`,
      headers: { "content-type": "text/html" },
    });

    const result = await extractContent("https://example.com/page");
    expect(result.text).toContain("Normal Content");
    expect(result.extractionChain).toContain("readability");
    expect(result.extractionChain).not.toContain("github:raw");
  });

  it("preserves raw mode for non-GitHub URLs", async () => {
    fetchStub.addResponse("example.com/api/data", {
      body: '{"raw": true}',
      headers: { "content-type": "application/json" },
    });

    const result = await extractContent(
      "https://example.com/api/data",
      undefined,
      { raw: true },
    );
    expect(result.text).toContain('"raw": true');
    expect(result.extractionChain).toContain("raw");
  });
});
