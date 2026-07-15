import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubFetch } from "../helpers.ts";
import { _resetConfigCache } from "../../src/extract/gemini-api.ts";
import { isGeminiWebAvailable, queryWithCookies } from "../../src/extract/gemini-web.ts";
import type { CookieMap } from "../../src/extract/chrome-cookies.ts";

vi.mock("../../src/extract/gemini-web.ts", () => ({
  isGeminiWebAvailable: vi.fn(),
  queryWithCookies: vi.fn(),
}));

const mockCookies = { cookie1: "value1" } as unknown as CookieMap;

describe("extractWithUrlContext", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
    process.env.GEMINI_API_KEY = "test-key";
  });

  afterEach(() => {
    fetchStub.restore();
    delete process.env.GEMINI_API_KEY;
    _resetConfigCache();
  });

  it("returns extracted content on success", async () => {
    const { extractWithUrlContext } = await import("../../src/extract/gemini-url-context.ts");

    fetchStub.addResponse("generativelanguage.googleapis.com", {
      body: {
        candidates: [{
          content: {
            parts: [{ text: "# Page Title\n\nExtracted page content with enough text to pass the threshold check and more text to ensure it is over 100 characters." }],
          },
          url_context_metadata: {
            url_metadata: [{ retrieved_url: "https://example.com", url_retrieval_status: "URL_RETRIEVAL_STATUS_SUCCESS" }],
          },
        }],
      },
      headers: { "content-type": "application/json" },
    });

    const result = await extractWithUrlContext("https://example.com/page");
    expect(result).not.toBeNull();
    expect(result!.text).toContain("Page Title");
    expect(result!.extractionChain).toContain("html:gemini-url-context");
    expect(result!.url).toBe("https://example.com/page");
  });

  it("returns null when API key is missing", async () => {
    delete process.env.GEMINI_API_KEY;
    _resetConfigCache();
    const { extractWithUrlContext } = await import("../../src/extract/gemini-url-context.ts");
    const result = await extractWithUrlContext("https://example.com");
    expect(result).toBeNull();
  });

  it("returns null when URL retrieval fails", async () => {
    const { extractWithUrlContext } = await import("../../src/extract/gemini-url-context.ts");

    fetchStub.addResponse("generativelanguage.googleapis.com", {
      body: {
        candidates: [{
          content: { parts: [{ text: "" }] },
          url_context_metadata: {
            url_metadata: [{ url_retrieval_status: "URL_RETRIEVAL_STATUS_ERROR" }],
          },
        }],
      },
      headers: { "content-type": "application/json" },
    });

    const result = await extractWithUrlContext("https://example.com/broken");
    expect(result).toBeNull();
  });

  it("returns null when response text is too short", async () => {
    const { extractWithUrlContext } = await import("../../src/extract/gemini-url-context.ts");

    fetchStub.addResponse("generativelanguage.googleapis.com", {
      body: {
        candidates: [{ content: { parts: [{ text: "Short" }] } }],
      },
      headers: { "content-type": "application/json" },
    });

    const result = await extractWithUrlContext("https://example.com");
    expect(result).toBeNull();
  });

  it("returns null on HTTP error", async () => {
    const { extractWithUrlContext } = await import("../../src/extract/gemini-url-context.ts");

    fetchStub.addResponse("generativelanguage.googleapis.com", {
      status: 400,
      body: { error: { message: "Bad Request" } },
      headers: { "content-type": "application/json" },
    });

    const result = await extractWithUrlContext("https://example.com");
    expect(result).toBeNull();
  });
});

describe("extractWithGeminiWeb", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when Gemini Web is unavailable (no cookies)", async () => {
    vi.mocked(isGeminiWebAvailable).mockResolvedValue(null);
    const { extractWithGeminiWeb } = await import("../../src/extract/gemini-url-context.ts");
    const result = await extractWithGeminiWeb("https://example.com");
    expect(result).toBeNull();
  });

  it("returns extracted content when cookies available and text is long enough", async () => {
    vi.mocked(isGeminiWebAvailable).mockResolvedValue(mockCookies);
    vi.mocked(queryWithCookies).mockResolvedValue(
      "# Page Title\n\nThis is a long enough extracted page content that definitely exceeds the 100 character threshold.",
    );
    const { extractWithGeminiWeb } = await import("../../src/extract/gemini-url-context.ts");
    const result = await extractWithGeminiWeb("https://example.com/article");
    expect(result).not.toBeNull();
    expect(result!.extractionChain).toContain("html:gemini-web");
    expect(result!.text).toContain("Page Title");
    expect(result!.url).toBe("https://example.com/article");
  });

  it("returns null when response text is too short", async () => {
    vi.mocked(isGeminiWebAvailable).mockResolvedValue(mockCookies);
    vi.mocked(queryWithCookies).mockResolvedValue("Brief.");
    const { extractWithGeminiWeb } = await import("../../src/extract/gemini-url-context.ts");
    const result = await extractWithGeminiWeb("https://example.com");
    expect(result).toBeNull();
  });
});
