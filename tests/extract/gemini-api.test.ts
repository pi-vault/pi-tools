import { afterEach, beforeEach, describe, expect, it, type vi } from "vitest";
import { stubFetch } from "../helpers.ts";
import {
  _resetConfigCache,
  DEFAULT_MODEL,
  getApiKey,
  getVersionedApiBase,
  isGeminiApiAvailable,
  queryGeminiApi,
} from "../../src/extract/gemini-api.ts";

describe("gemini-api", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    _resetConfigCache();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // -------------------------------------------------------------------------
  // getApiKey
  // -------------------------------------------------------------------------

  describe("getApiKey", () => {
    it("returns GEMINI_API_KEY env var when set", () => {
      process.env.GEMINI_API_KEY = "test-gemini-key";
      expect(getApiKey()).toBe("test-gemini-key");
    });

    it("returns null when no key is configured", () => {
      delete process.env.GEMINI_API_KEY;
      expect(getApiKey()).toBeNull();
    });

    it("trims whitespace from env var", () => {
      process.env.GEMINI_API_KEY = "  my-key  ";
      expect(getApiKey()).toBe("my-key");
    });

    it("returns null for whitespace-only env var", () => {
      process.env.GEMINI_API_KEY = "   ";
      expect(getApiKey()).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getVersionedApiBase
  // -------------------------------------------------------------------------

  describe("getVersionedApiBase", () => {
    it("returns default host + /v1beta path", () => {
      delete process.env.GOOGLE_GEMINI_BASE_URL;
      expect(getVersionedApiBase()).toBe(
        "https://generativelanguage.googleapis.com/v1beta",
      );
    });

    it("uses custom host when GOOGLE_GEMINI_BASE_URL is set", () => {
      process.env.GOOGLE_GEMINI_BASE_URL = "https://custom.host.com";
      expect(getVersionedApiBase()).toBe("https://custom.host.com/v1beta");
    });

    it("strips trailing slashes from custom host", () => {
      process.env.GOOGLE_GEMINI_BASE_URL = "https://example.com/api///";
      expect(getVersionedApiBase()).toBe("https://example.com/api/v1beta");
    });
  });

  // -------------------------------------------------------------------------
  // isGeminiApiAvailable
  // -------------------------------------------------------------------------

  describe("isGeminiApiAvailable", () => {
    it("returns true when API key is set", () => {
      process.env.GEMINI_API_KEY = "test-key";
      expect(isGeminiApiAvailable()).toBe(true);
    });

    it("returns false when no key and no gateway", () => {
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_GEMINI_BASE_URL;
      delete process.env.CLOUDFLARE_API_KEY;
      expect(isGeminiApiAvailable()).toBe(false);
    });

    it("returns true when Cloudflare gateway is fully configured", () => {
      delete process.env.GEMINI_API_KEY;
      process.env.GOOGLE_GEMINI_BASE_URL =
        "https://gateway.ai.cloudflare.com/v1/acc/gw/google-ai-studio";
      process.env.CLOUDFLARE_API_KEY = "cf-key";
      expect(isGeminiApiAvailable()).toBe(true);
    });

    it("returns false when Cloudflare gateway URL set but no CF key", () => {
      delete process.env.GEMINI_API_KEY;
      process.env.GOOGLE_GEMINI_BASE_URL =
        "https://gateway.ai.cloudflare.com/v1/acc/gw/google-ai-studio";
      delete process.env.CLOUDFLARE_API_KEY;
      expect(isGeminiApiAvailable()).toBe(false);
    });

    it("does not treat non-Cloudflare URL with gateway substring as CF gateway", () => {
      delete process.env.GEMINI_API_KEY;
      process.env.GOOGLE_GEMINI_BASE_URL =
        "https://example.com/proxy/gateway.ai.cloudflare.com";
      process.env.CLOUDFLARE_API_KEY = "cf-key";
      expect(isGeminiApiAvailable()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // queryGeminiApi
  // -------------------------------------------------------------------------

  describe("queryGeminiApi", () => {
    let fetchStub: ReturnType<typeof stubFetch>;

    beforeEach(() => {
      process.env.GEMINI_API_KEY = "test-key";
      delete process.env.GOOGLE_GEMINI_BASE_URL;
      fetchStub = stubFetch();
    });

    afterEach(() => {
      fetchStub.restore();
    });

    it("sends correct request body and returns response text", async () => {
      fetchStub.addResponse("generateContent", {
        status: 200,
        body: {
          candidates: [
            { content: { parts: [{ text: "Analysis result" }] } },
          ],
        },
      });

      const result = await queryGeminiApi(
        "Describe this video",
        "https://www.youtube.com/watch?v=abc123",
      );

      expect(result).toBe("Analysis result");

      const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
      const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(calledUrl).toContain(`/models/${DEFAULT_MODEL}:generateContent`);
      expect(calledUrl).toContain("?key=test-key");

      const body = JSON.parse(calledInit.body as string) as {
        contents: Array<{
          role: string;
          parts: Array<{ fileData?: { fileUri: string }; text?: string }>;
        }>;
      };
      expect(body.contents[0].role).toBe("user");
      expect(body.contents[0].parts[0].fileData?.fileUri).toBe(
        "https://www.youtube.com/watch?v=abc123",
      );
      expect(body.contents[0].parts[1].text).toBe("Describe this video");
    });

    it("includes mimeType in fileData when specified", async () => {
      fetchStub.addResponse("generateContent", {
        status: 200,
        body: { candidates: [{ content: { parts: [{ text: "OK" }] } }] },
      });

      await queryGeminiApi("Analyze", "files/abc123", { mimeType: "video/mp4" });

      const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
      const [, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(calledInit.body as string) as {
        contents: Array<{
          parts: Array<{ fileData?: { mimeType?: string } }>;
        }>;
      };
      expect(body.contents[0].parts[0].fileData?.mimeType).toBe("video/mp4");
    });

    it("omits mimeType from fileData when not specified", async () => {
      fetchStub.addResponse("generateContent", {
        status: 200,
        body: { candidates: [{ content: { parts: [{ text: "OK" }] } }] },
      });

      await queryGeminiApi("Analyze", "https://youtube.com/watch?v=x");

      const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
      const [, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(calledInit.body as string) as {
        contents: Array<{
          parts: Array<{ fileData?: { mimeType?: string } }>;
        }>;
      };
      expect(body.contents[0].parts[0].fileData?.mimeType).toBeUndefined();
    });

    it("uses custom model when specified", async () => {
      fetchStub.addResponse("generateContent", {
        status: 200,
        body: { candidates: [{ content: { parts: [{ text: "OK" }] } }] },
      });

      await queryGeminiApi("Test", "files/xyz", { model: "gemini-2.5-flash" });

      const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
      const [calledUrl] = fetchMock.mock.calls[0] as [string];
      expect(calledUrl).toContain("/models/gemini-2.5-flash:generateContent");
    });

    it("joins multiple text parts with newline", async () => {
      fetchStub.addResponse("generateContent", {
        status: 200,
        body: {
          candidates: [
            { content: { parts: [{ text: "Part 1" }, { text: "Part 2" }] } },
          ],
        },
      });

      const result = await queryGeminiApi("Test", "files/xyz");
      expect(result).toBe("Part 1\nPart 2");
    });

    it("throws on HTTP error with status and truncated body", async () => {
      fetchStub.addResponse("generateContent", {
        status: 429,
        body: "Rate limit exceeded",
      });

      await expect(queryGeminiApi("Test", "files/xyz")).rejects.toThrow(
        "Gemini API error 429",
      );
    });

    it("throws when response has no candidates", async () => {
      fetchStub.addResponse("generateContent", {
        status: 200,
        body: { candidates: [] },
      });

      await expect(queryGeminiApi("Test", "files/xyz")).rejects.toThrow(
        "Gemini API returned empty response",
      );
    });

    it("throws when all text parts are empty strings", async () => {
      fetchStub.addResponse("generateContent", {
        status: 200,
        body: { candidates: [{ content: { parts: [{ text: "" }] } }] },
      });

      await expect(queryGeminiApi("Test", "files/xyz")).rejects.toThrow(
        "Gemini API returned empty response",
      );
    });

    it("throws when API is not configured", async () => {
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_GEMINI_BASE_URL;
      delete process.env.CLOUDFLARE_API_KEY;

      await expect(queryGeminiApi("Test", "files/xyz")).rejects.toThrow(
        "Gemini API not configured",
      );
    });

    it("omits ?key= param and uses CF headers for Cloudflare gateway", async () => {
      delete process.env.GEMINI_API_KEY;
      process.env.GOOGLE_GEMINI_BASE_URL =
        "https://gateway.ai.cloudflare.com/v1/acc/gw/google-ai-studio";
      process.env.CLOUDFLARE_API_KEY = "cf-secret";

      fetchStub.addResponse("generateContent", {
        status: 200,
        body: { candidates: [{ content: { parts: [{ text: "CF result" }] } }] },
      });

      const result = await queryGeminiApi("Test", "files/xyz");
      expect(result).toBe("CF result");

      const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
      const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(calledUrl).not.toContain("?key=");
      expect(calledUrl).toContain("gateway.ai.cloudflare.com");
      expect((calledInit.headers as Record<string, string>)[
        "cf-aig-authorization"
      ]).toBe("Bearer cf-secret");
    });
  });
});
