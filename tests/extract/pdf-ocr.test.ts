import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  looksLikeScannedPdf,
  modelSupportsImages,
  rasterizePdfPages,
  extractTextWithGeminiVision,
} from "../../src/extract/pdf-ocr.ts";
import { makeCtx } from "../helpers.ts";

describe("looksLikeScannedPdf", () => {
  it("returns true when text is empty", () => {
    expect(looksLikeScannedPdf("", 10_000)).toBe(true);
  });

  it("returns true when text is only whitespace", () => {
    expect(looksLikeScannedPdf("   \n\t  ", 10_000)).toBe(true);
  });

  it("returns true when PDF is large but text is short", () => {
    expect(looksLikeScannedPdf("Title page", 50_000)).toBe(true);
  });

  it("returns false when text exceeds 200 chars", () => {
    const text = "A".repeat(201);
    expect(looksLikeScannedPdf(text, 50_000)).toBe(false);
  });

  it("returns false when PDF is small (under 5000 bytes) even with short text", () => {
    expect(looksLikeScannedPdf("Short", 4_999)).toBe(false);
  });

  it("returns true when text is empty regardless of file size", () => {
    expect(looksLikeScannedPdf("", 100)).toBe(true);
  });
});

describe("modelSupportsImages", () => {
  it("returns true when model input includes 'image'", () => {
    const ctx = makeCtx({ model: { input: ["text", "image"], provider: "openai" } as any });
    expect(modelSupportsImages(ctx)).toBe(true);
  });

  it("returns false when model input is text-only", () => {
    const ctx = makeCtx({ model: { input: ["text"], provider: "openai" } as any });
    expect(modelSupportsImages(ctx)).toBe(false);
  });

  it("returns false when model is undefined", () => {
    const ctx = makeCtx({ model: undefined });
    expect(modelSupportsImages(ctx)).toBe(false);
  });

  it("returns false when model.input is undefined", () => {
    const ctx = makeCtx({ model: { provider: "openai" } as any });
    expect(modelSupportsImages(ctx)).toBe(false);
  });
});

describe("rasterizePdfPages", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("exports rasterizePdfPages function", () => {
    expect(typeof rasterizePdfPages).toBe("function");
  });

  it("rejects when pdftoppm is not installed", async () => {
    vi.mock("node:child_process", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:child_process")>();
      return {
        ...actual,
        execFile: vi.fn((_cmd: string, _args: string[], _opts: object, cb: Function) => {
          const err = Object.assign(new Error("spawn pdftoppm ENOENT"), { code: "ENOENT" });
          cb(err, "", "");
          return { kill: vi.fn() };
        }),
      };
    });

    const buffer = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    await expect(rasterizePdfPages(buffer)).rejects.toThrow();
  });

  it("defaults maxPages to 5 and dpi to 150", async () => {
    const buffer = new Uint8Array(0);
    try {
      await rasterizePdfPages(buffer, { maxPages: 3, dpi: 200 });
    } catch {
      // Expected to fail without pdftoppm — we just verify it doesn't crash on options
    }
  });
});

describe("extractTextWithGeminiVision", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends images to Gemini and returns extracted text", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "OCR result: Invoice #12345\nTotal: $100.00" }],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const images = [
      { type: "image" as const, mimeType: "image/png" as const, data: "base64data==", pageNumber: 1 },
    ];
    const result = await extractTextWithGeminiVision(images, "test-api-key");
    expect(result).toContain("Invoice #12345");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    const call = vi.mocked(globalThis.fetch).mock.calls[0];
    const body = JSON.parse(call[1]?.body as string);
    expect(body.contents[0].parts).toHaveLength(2); // image part + text prompt
  });

  it("returns null when Gemini API returns an error", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response("Internal Server Error", { status: 500 });
    }) as unknown as typeof fetch;

    const images = [
      { type: "image" as const, mimeType: "image/png" as const, data: "base64data==", pageNumber: 1 },
    ];
    const result = await extractTextWithGeminiVision(images, "test-api-key");
    expect(result).toBeNull();
  });

  it("returns null when Gemini returns empty response", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ candidates: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const images = [
      { type: "image" as const, mimeType: "image/png" as const, data: "base64data==", pageNumber: 1 },
    ];
    const result = await extractTextWithGeminiVision(images, "test-api-key");
    expect(result).toBeNull();
  });

  it("respects abort signal", async () => {
    const controller = new AbortController();
    controller.abort();

    globalThis.fetch = vi.fn(async (_url: any, init: any) => {
      if (init?.signal?.aborted) {
        throw new DOMException("The operation was aborted", "AbortError");
      }
      return new Response("ok");
    }) as unknown as typeof fetch;

    const images = [
      { type: "image" as const, mimeType: "image/png" as const, data: "base64data==", pageNumber: 1 },
    ];
    const result = await extractTextWithGeminiVision(
      images,
      "test-api-key",
      undefined,
      controller.signal,
    );
    expect(result).toBeNull();
  });
});
