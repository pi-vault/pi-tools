import { afterEach, describe, expect, it, vi } from "vitest";
import { extractContent } from "../../src/extract/pipeline.ts";

// Must be long enough for Readability (≥500 chars markdown output) to avoid
// fallthrough to Jina Reader which would make extra fetch calls.
const SUCCESS_HTML = `<!DOCTYPE html><html><head><title>Test Page</title></head><body>
<article><h1>Hello From Retry</h1>
<p>${"This is meaningful content about the topic that Readability can extract. ".repeat(20)}</p>
</article></body></html>`;

describe("Cloudflare bot retry", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("retries with honest User-Agent on 403 + cf-mitigated: challenge", async () => {
    const calls: { url: string; headers?: Record<string, string> }[] = [];
    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: input as string, headers: init?.headers as Record<string, string> });

      if (calls.length === 1) {
        return new Response("challenge", {
          status: 403,
          headers: { "cf-mitigated": "challenge" },
        });
      }
      return new Response(SUCCESS_HTML, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as unknown as typeof fetch;

    const result = await extractContent("https://example.com");

    expect(calls).toHaveLength(2);
    // First call uses browser UA
    expect(calls[0].headers?.["User-Agent"]).toContain("Mozilla/5.0");
    // Retry uses honest UA
    expect(calls[1].headers?.["User-Agent"]).toContain("pi-tools");
    expect(result.text).toContain("Hello From Retry");
    expect(result.extractionChain).toContain("cf-challenge");
  });

  it("does NOT retry on 403 without cf-mitigated header", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response("Forbidden", {
        status: 403,
        headers: {},
      });
    }) as unknown as typeof fetch;

    await expect(extractContent("https://example.com")).rejects.toThrow("HTTP 403");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("propagates error if retry also fails", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response("challenge", {
          status: 403,
          headers: { "cf-mitigated": "challenge" },
        });
      }
      return new Response("Still blocked", {
        status: 403,
        headers: {},
      });
    }) as unknown as typeof fetch;

    await expect(extractContent("https://example.com")).rejects.toThrow("HTTP 403");
    expect(callCount).toBe(2);
  });
});
