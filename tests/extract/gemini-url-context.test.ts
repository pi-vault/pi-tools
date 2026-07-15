import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stubFetch } from "../helpers.ts";
import { _resetConfigCache } from "../../src/extract/gemini-api.ts";

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
