import { afterEach, describe, expect, it, vi } from "vitest";
import { probeUrl } from "../../src/extract/pipeline.ts";

describe("probeUrl", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns skip: true for binary content type (image/png)", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(null, {
        status: 200,
        headers: { "content-type": "image/png", "content-length": "1024" },
      }),
    ) as unknown as typeof fetch;

    const result = await probeUrl("https://example.com/photo.png");
    expect(result.skip).toBe(true);
    expect(result.reason).toBe("binary content type");
  });

  it("returns skip: false for text/html", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(null, {
        status: 200,
        headers: { "content-type": "text/html", "content-length": "5000" },
      }),
    ) as unknown as typeof fetch;

    const result = await probeUrl("https://example.com/page");
    expect(result.skip).toBe(false);
    expect(result.contentType).toBe("text/html");
  });

  it("returns skip: false when HEAD returns 405", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(null, { status: 405 }),
    ) as unknown as typeof fetch;

    const result = await probeUrl("https://example.com/page");
    expect(result.skip).toBe(false);
  });

  it("returns skip: false when HEAD times out", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("timeout");
    }) as unknown as typeof fetch;

    const result = await probeUrl("https://example.com/page");
    expect(result.skip).toBe(false);
  });

  it("returns skip: true for non-PDF content over 10MB", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(null, {
        status: 200,
        headers: { "content-type": "text/html", "content-length": String(11 * 1024 * 1024) },
      }),
    ) as unknown as typeof fetch;

    const result = await probeUrl("https://example.com/huge");
    expect(result.skip).toBe(true);
    expect(result.reason).toBe("response too large");
  });

  it("allows PDF under 50MB", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(null, {
        status: 200,
        headers: { "content-type": "application/pdf", "content-length": String(30 * 1024 * 1024) },
      }),
    ) as unknown as typeof fetch;

    const result = await probeUrl("https://example.com/doc.pdf");
    expect(result.skip).toBe(false);
  });

  it("returns skip: true for PDF over 50MB", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(null, {
        status: 200,
        headers: { "content-type": "application/pdf", "content-length": String(55 * 1024 * 1024) },
      }),
    ) as unknown as typeof fetch;

    const result = await probeUrl("https://example.com/huge.pdf");
    expect(result.skip).toBe(true);
    expect(result.reason).toBe("PDF too large");
  });
});
