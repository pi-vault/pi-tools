import * as dns from "node:dns/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as configModule from "../../src/config.ts";
import { extractContent } from "../../src/extract/pipeline.ts";
import { SSRFError } from "../../src/utils/ssrf.ts";

function mockResolvedAddresses(addresses: Array<{ address: string; family: number }>): void {
  vi.mocked(dns.lookup).mockResolvedValue(
    addresses as unknown as Awaited<ReturnType<typeof dns.lookup>>,
  );
}

const SUCCESS_HTML = `<!DOCTYPE html><html><head><title>Redirected</title></head><body>
<article><h1>Redirected Article</h1>
<p>${"This is meaningful content after a safe redirect. ".repeat(30)}</p>
</article></body></html>`;

describe("extractContent SSRF with allowRanges", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("blocks a private IP by default", async () => {
    await expect(extractContent("http://198.18.1.1/page")).rejects.toThrow(SSRFError);
  });

  it("allows a private IP when in allowRanges", async () => {
    // Use a short timeout so the network call fails quickly without hanging.
    // The key assertion: SSRF validation passes (no SSRFError) — any other error is fine.
    const config = configModule.loadMergedConfig(process.cwd());
    vi.spyOn(configModule, "loadMergedConfig").mockReturnValue({
      ...config,
      ssrf: { allowRanges: ["198.18.0.0/15"] },
    });

    const signal = AbortSignal.timeout(300);
    const result = extractContent("http://198.18.1.1/page", signal);
    // Should reject with a network/abort error, never SSRFError
    await expect(result).rejects.toSatisfy((err) => !(err instanceof SSRFError));
  }, 2000);

  it("follows public redirects with manual redirect validation", async () => {
    mockResolvedAddresses([{ address: "93.184.216.34", family: 4 }]);
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input.href : input;
      calls.push({ url, init });
      const method = init?.method ?? "GET";
      if (url === "https://public.example/start") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://public.example/final" },
        });
      }
      if (method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      return new Response(SUCCESS_HTML, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as unknown as typeof fetch;

    try {
      const result = await extractContent("https://public.example/start");

      expect(result.text).toContain("Redirected Article");
      expect(calls.every((call) => call.init?.redirect === "manual")).toBe(true);
      expect(calls.map((call) => call.url)).toContain("https://public.example/final");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects a redirect to a private address before requesting it", async () => {
    mockResolvedAddresses([{ address: "93.184.216.34", family: 4 }]);
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: string | URL) => {
      const url = input instanceof URL ? input.href : input;
      calls.push(url);
      return new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/admin" },
      });
    }) as unknown as typeof fetch;

    try {
      await expect(extractContent("https://public.example/start")).rejects.toThrow(SSRFError);
      expect(calls).not.toContain("http://127.0.0.1/admin");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects a redirect to a non-http protocol", async () => {
    mockResolvedAddresses([{ address: "93.184.216.34", family: 4 }]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "file:///etc/passwd" },
        }),
    ) as unknown as typeof fetch;

    try {
      await expect(extractContent("https://public.example/start")).rejects.toThrow(SSRFError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("stops a redirect loop at the maximum hop count", async () => {
    mockResolvedAddresses([{ address: "93.184.216.34", family: 4 }]);
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: string | URL) => {
      const url = input instanceof URL ? input.href : input;
      calls.push(url);
      const current = new URL(url);
      const hop = current.pathname === "/start" ? 0 : Number(current.pathname.slice(5));
      return new Response(null, {
        status: 302,
        headers: { location: `https://loop.example/hop-${hop + 1}` },
      });
    }) as unknown as typeof fetch;

    try {
      await expect(extractContent("https://loop.example/start")).rejects.toThrow(
        /Too many redirects/,
      );
      expect(calls).toHaveLength(11);
      expect(calls).not.toContain("https://loop.example/hop-11");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fails closed when DNS resolution fails", async () => {
    vi.mocked(dns.lookup).mockRejectedValue(new Error("NXDOMAIN"));
    const fetchMock = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      await expect(extractContent("https://missing.example")).rejects.toThrow(SSRFError);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
