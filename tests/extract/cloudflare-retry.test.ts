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
    // The HEAD probe fires before GET. We handle it separately so GET call
    // indexes are not shifted by the probe.
    const getCalls: { url: string; headers?: Record<string, string> }[] = [];
    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const method = (init as Record<string, unknown>)?.method ?? "GET";

      // HEAD probe — return 200 text/html so probe returns skip: false
      if (method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }

      getCalls.push({ url: input as string, headers: init?.headers as Record<string, string> });

      if (getCalls.length === 1) {
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

    expect(getCalls).toHaveLength(2);
    // First GET uses browser UA
    expect(getCalls[0].headers?.["User-Agent"]).toContain("Mozilla/5.0");
    // Retry uses honest UA
    expect(getCalls[1].headers?.["User-Agent"]).toContain("pi-tools");
    expect(result.text).toContain("Hello From Retry");
    expect(result.extractionChain).toContain("cf-challenge");
  });

  it("does NOT retry on 403 without cf-mitigated header", async () => {
    let getCallCount = 0;
    globalThis.fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const method = (init as Record<string, unknown>)?.method ?? "GET";
      if (method === "HEAD") {
        return new Response(null, { status: 200, headers: { "content-type": "text/html" } });
      }
      getCallCount++;
      return new Response("Forbidden", { status: 403, headers: {} });
    }) as unknown as typeof fetch;

    await expect(extractContent("https://example.com")).rejects.toThrow("HTTP 403");
    expect(getCallCount).toBe(1);
  });

  it("propagates error if retry also fails", async () => {
    let getCallCount = 0;
    globalThis.fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const method = (init as Record<string, unknown>)?.method ?? "GET";
      if (method === "HEAD") {
        return new Response(null, { status: 200, headers: { "content-type": "text/html" } });
      }
      getCallCount++;
      if (getCallCount === 1) {
        return new Response("challenge", {
          status: 403,
          headers: { "cf-mitigated": "challenge" },
        });
      }
      return new Response("Still blocked", { status: 403, headers: {} });
    }) as unknown as typeof fetch;

    await expect(extractContent("https://example.com")).rejects.toThrow("HTTP 403");
    expect(getCallCount).toBe(2);
  });
});
