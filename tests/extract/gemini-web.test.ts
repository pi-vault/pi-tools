// tests/extract/gemini-web.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubFetch } from "../helpers.ts";

// Mock chrome-cookies so isGeminiWebAvailable tests don't hit the filesystem.
vi.mock("../../src/extract/chrome-cookies.ts", () => ({
  getGoogleCookies: vi.fn(),
}));

// Mock node:fs so readFileSync (used in uploadFile) is controllable.
// ESM native module exports are non-configurable and cannot be spied on inline.
const { mockReadFileSync } = vi.hoisted(() => ({
  mockReadFileSync: vi.fn().mockReturnValue(Buffer.from("fake file content")),
}));

vi.mock("node:fs", () => ({
  readFileSync: mockReadFileSync,
}));

/**
 * Build a mock streaming response matching BardChatUi's actual format.
 *
 * Real structure from parseStreamGenerateResponse:
 *   outer array: each element has stringified JSON at index [2]
 *   inner payload: candidates at index [4]
 *   candidate text: candidate[1][0]
 */
function buildMockStreamResponse(text: string): string {
  // The parser reads: outer[i][2] -> inner string -> inner[4] -> candidates
  // -> firstCandidate = candidates[0]
  // -> firstCandidate[1][0] = text
  //
  // So candidates must be [[null, [text]]] and firstCandidate = [null, [text]].
  const innerPayload = JSON.stringify([
    null, // [0]
    null, // [1]
    null, // [2]
    null, // [3]
    [[null, [text]]], // [4] -> candidates list -> candidates[0] = [null, [text]]
  ]);
  // Outer: one part; inner payload string sits at index [2].
  const outer = JSON.stringify([[null, null, innerPayload]]);
  return outer;
}

/**
 * Build a multi-part streaming response. The parser keeps the latest
 * non-empty text across all parts.
 */
function buildMultiPartStreamResponse(texts: string[]): string {
  const parts = texts.map((text) => {
    const innerPayload = JSON.stringify([
      null,
      null,
      null,
      null,
      [[null, [text]]],
    ]);
    return [null, null, innerPayload];
  });
  return JSON.stringify(parts);
}

/**
 * Build a mock response containing error code 1052 at path [0][5][2][0][1][0].
 * extractErrorCode reads this path from the outer response JSON.
 */
function buildMockErrorResponse(errorCode: number): string {
  // Outer array: first element has error code nested at [5][2][0][1][0]
  const errorPart = [
    null, // [0]
    null, // [1]
    null, // [2]
    null, // [3]
    null, // [4]
    [null, null, [[null, [errorCode]]]], // [5][2][0][1][0] = errorCode
  ];
  return JSON.stringify([errorPart]);
}

describe("gemini-web", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
    vi.stubEnv("PI_ALLOW_BROWSER_COOKIES", "");
  });

  afterEach(() => {
    fetchStub.restore();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  // ---------------------------------------------------------------------------
  // isBrowserCookieAccessAllowed
  // ---------------------------------------------------------------------------

  describe("isBrowserCookieAccessAllowed", () => {
    it("returns true when PI_ALLOW_BROWSER_COOKIES=1", async () => {
      vi.stubEnv("PI_ALLOW_BROWSER_COOKIES", "1");

      const { isBrowserCookieAccessAllowed } = await import(
        "../../src/extract/gemini-web.ts"
      );
      expect(isBrowserCookieAccessAllowed()).toBe(true);
    });

    it("returns false when env var is absent", async () => {
      vi.stubEnv("PI_ALLOW_BROWSER_COOKIES", "");

      const { isBrowserCookieAccessAllowed } = await import(
        "../../src/extract/gemini-web.ts"
      );
      expect(isBrowserCookieAccessAllowed()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // isGeminiWebAvailable
  // ---------------------------------------------------------------------------

  describe("isGeminiWebAvailable", () => {
    it("returns null when cookie access is not allowed", async () => {
      vi.stubEnv("PI_ALLOW_BROWSER_COOKIES", "");

      const { isGeminiWebAvailable } = await import(
        "../../src/extract/gemini-web.ts"
      );
      expect(await isGeminiWebAvailable()).toBeNull();
    });

    it("returns cookie map when access is allowed and cookies exist", async () => {
      vi.stubEnv("PI_ALLOW_BROWSER_COOKIES", "1");

      const { getGoogleCookies } = await import(
        "../../src/extract/chrome-cookies.ts"
      );
      (getGoogleCookies as ReturnType<typeof vi.fn>).mockResolvedValue({
        cookies: {
          "__Secure-1PSID": "sid-value",
          "__Secure-1PSIDTS": "sidts-value",
        },
        warnings: [],
      });

      const { isGeminiWebAvailable } = await import(
        "../../src/extract/gemini-web.ts"
      );
      const result = await isGeminiWebAvailable();
      expect(result).toEqual({
        "__Secure-1PSID": "sid-value",
        "__Secure-1PSIDTS": "sidts-value",
      });
    });

    it("returns null when cookies cannot be extracted", async () => {
      vi.stubEnv("PI_ALLOW_BROWSER_COOKIES", "1");

      const { getGoogleCookies } = await import(
        "../../src/extract/chrome-cookies.ts"
      );
      (getGoogleCookies as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const { isGeminiWebAvailable } = await import(
        "../../src/extract/gemini-web.ts"
      );
      expect(await isGeminiWebAvailable()).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // queryWithCookies
  // ---------------------------------------------------------------------------

  describe("queryWithCookies", () => {
    const mockCookies = {
      "__Secure-1PSID": "test-sid",
      "__Secure-1PSIDTS": "test-sidts",
      SID: "test-general-sid",
    };

    it("fetches access token from gemini.google.com/app and returns response text", async () => {
      fetchStub.addResponse("gemini.google.com/app", {
        body: `<html>"SNlM0e":"test-token-123"</html>`,
        headers: { "content-type": "text/html" },
      });
      fetchStub.addResponse("BardChatUi", {
        body: buildMockStreamResponse("Hello from Gemini!"),
      });

      const { queryWithCookies } = await import(
        "../../src/extract/gemini-web.ts"
      );
      const result = await queryWithCookies("test prompt", mockCookies);
      expect(result).toBe("Hello from Gemini!");
    });

    it("appends YouTube URL to prompt when provided", async () => {
      fetchStub.addResponse("gemini.google.com/app", {
        body: `"SNlM0e":"token-456"`,
        headers: { "content-type": "text/html" },
      });
      fetchStub.addResponse("BardChatUi", {
        body: buildMockStreamResponse("Video summary"),
      });

      const { queryWithCookies } = await import(
        "../../src/extract/gemini-web.ts"
      );
      await queryWithCookies("summarize", mockCookies, {
        youtubeUrl: "https://youtube.com/watch?v=abc123",
      });

      // Inspect the body sent to StreamGenerate
      const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const streamCall = fetchCalls.find(
        (call: unknown[]) =>
          typeof call[0] === "string" &&
          (call[0] as string).includes("BardChatUi"),
      );
      expect(streamCall).toBeDefined();
      const body = streamCall![1].body as string;
      expect(body).toContain("youtube.com");
    });

    it("sends the correct model header for gemini-2.5-pro", async () => {
      fetchStub.addResponse("gemini.google.com/app", {
        body: `"SNlM0e":"token"`,
        headers: { "content-type": "text/html" },
      });
      fetchStub.addResponse("BardChatUi", {
        body: buildMockStreamResponse("response"),
      });

      const { queryWithCookies } = await import(
        "../../src/extract/gemini-web.ts"
      );
      await queryWithCookies("test", mockCookies, { model: "gemini-2.5-pro" });

      const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const streamCall = fetchCalls.find(
        (call: unknown[]) =>
          typeof call[0] === "string" &&
          (call[0] as string).includes("BardChatUi"),
      );
      expect(streamCall).toBeDefined();
      expect(streamCall![1].headers["x-goog-ext-525001261-jspb"]).toBe(
        '[1,null,null,null,"4af6c7f5da75d65d",null,null,0,[4]]',
      );
    });

    it("falls back to gemini-2.5-flash header for unknown model names", async () => {
      fetchStub.addResponse("gemini.google.com/app", {
        body: `"SNlM0e":"token"`,
        headers: { "content-type": "text/html" },
      });
      fetchStub.addResponse("BardChatUi", {
        body: buildMockStreamResponse("response"),
      });

      const { queryWithCookies } = await import(
        "../../src/extract/gemini-web.ts"
      );
      await queryWithCookies("test", mockCookies, { model: "gemini-unknown" });

      const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const streamCall = fetchCalls.find(
        (call: unknown[]) =>
          typeof call[0] === "string" &&
          (call[0] as string).includes("BardChatUi"),
      );
      // flash header used when model is unknown
      expect(streamCall![1].headers["x-goog-ext-525001261-jspb"]).toBe(
        '[1,null,null,null,"9ec249fc9ad08861",null,null,0,[4]]',
      );
    });

    it("throws when access token cannot be extracted from app page", async () => {
      fetchStub.addResponse("gemini.google.com/app", {
        body: "<html>No token here</html>",
        headers: { "content-type": "text/html" },
      });

      const { queryWithCookies } = await import(
        "../../src/extract/gemini-web.ts"
      );
      await expect(
        queryWithCookies("test", mockCookies),
      ).rejects.toThrow("Unable to authenticate with Gemini");
    });

    it("throws on non-2xx response from StreamGenerate", async () => {
      fetchStub.addResponse("gemini.google.com/app", {
        body: `"SNlM0e":"token"`,
        headers: { "content-type": "text/html" },
      });
      fetchStub.addResponse("BardChatUi", {
        status: 429,
        body: "Rate limited",
      });

      const { queryWithCookies } = await import(
        "../../src/extract/gemini-web.ts"
      );
      await expect(
        queryWithCookies("test", mockCookies),
      ).rejects.toThrow("Gemini Web request failed: 429");
    });

    it("sends required headers (x-same-domain, user-agent, host, cookie)", async () => {
      fetchStub.addResponse("gemini.google.com/app", {
        body: `"SNlM0e":"token"`,
        headers: { "content-type": "text/html" },
      });
      fetchStub.addResponse("BardChatUi", {
        body: buildMockStreamResponse("response"),
      });

      const { queryWithCookies } = await import(
        "../../src/extract/gemini-web.ts"
      );
      await queryWithCookies("test", mockCookies);

      const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const streamCall = fetchCalls.find(
        (call: unknown[]) =>
          typeof call[0] === "string" &&
          (call[0] as string).includes("BardChatUi"),
      );
      const headers = streamCall![1].headers;
      expect(headers["x-same-domain"]).toBe("1");
      expect(headers["user-agent"]).toBeDefined();
      expect(headers.host).toBe("gemini.google.com");
      expect(headers.cookie).toContain("__Secure-1PSID=test-sid");
    });

    it("respects timeoutMs option and aborts slow requests", async () => {
      fetchStub.addResponse("gemini.google.com/app", {
        body: `"SNlM0e":"token"`,
        headers: { "content-type": "text/html" },
      });

      // Replace fetch with one that hangs until signal aborts
      fetchStub.restore();
      globalThis.fetch = vi.fn(
        async (url: string | URL, init?: RequestInit) => {
          const urlStr = url instanceof URL ? url.href : url;
          if (urlStr.includes("gemini.google.com/app")) {
            return new Response(`"SNlM0e":"token"`, { status: 200 });
          }
          await new Promise((_, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          });
          return new Response("", { status: 200 });
        },
      ) as unknown as typeof fetch;

      const { queryWithCookies } = await import(
        "../../src/extract/gemini-web.ts"
      );
      await expect(
        queryWithCookies("test", mockCookies, { timeoutMs: 50 }),
      ).rejects.toThrow();
    });

    it("retries with gemini-2.5-flash when model returns error code 1052", async () => {
      // Replace fetch to track per-call responses: first StreamGenerate
      // returns 1052 error, second returns success with flash.
      fetchStub.restore();
      let streamCallCount = 0;
      globalThis.fetch = vi.fn(
        async (url: string | URL, init?: RequestInit) => {
          const urlStr = url instanceof URL ? url.href : url;
          if (urlStr.includes("gemini.google.com/app")) {
            return new Response(`"SNlM0e":"token"`, { status: 200 });
          }
          if (urlStr.includes("BardChatUi")) {
            streamCallCount++;
            if (streamCallCount === 1) {
              // First call: error code 1052 (model unavailable)
              return new Response(buildMockErrorResponse(1052), {
                status: 200,
              });
            }
            // Second call (fallback): success
            return new Response(
              buildMockStreamResponse("Fallback response"),
              { status: 200 },
            );
          }
          return new Response("Not Found", { status: 404 });
        },
      ) as unknown as typeof fetch;

      const { queryWithCookies } = await import(
        "../../src/extract/gemini-web.ts"
      );
      const result = await queryWithCookies("test", mockCookies, {
        model: "gemini-2.5-pro",
      });
      expect(result).toBe("Fallback response");
      expect(streamCallCount).toBe(2);

      // Verify second call used flash model header
      const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls;
      const streamCalls = fetchCalls.filter(
        (call: unknown[]) =>
          typeof call[0] === "string" &&
          (call[0] as string).includes("BardChatUi"),
      );
      expect(streamCalls[1]![1].headers["x-goog-ext-525001261-jspb"]).toBe(
        '[1,null,null,null,"9ec249fc9ad08861",null,null,0,[4]]',
      );
    });

    it("follows redirects preserving cookies during token fetch", async () => {
      // Replace fetch to simulate a 302 redirect on the token page.
      fetchStub.restore();
      globalThis.fetch = vi.fn(
        async (url: string | URL, init?: RequestInit) => {
          const urlStr = url instanceof URL ? url.href : url;
          if (urlStr === "https://gemini.google.com/app") {
            // First fetch: 302 redirect
            return new Response("", {
              status: 302,
              headers: { location: "https://accounts.google.com/auth-bounce" },
            });
          }
          if (urlStr === "https://accounts.google.com/auth-bounce") {
            // Second fetch: 302 redirect back
            return new Response("", {
              status: 302,
              headers: {
                location: "https://gemini.google.com/app?authuser=0",
              },
            });
          }
          if (urlStr.includes("gemini.google.com/app?authuser=0")) {
            // Final fetch: returns the page with the token
            return new Response(`"SNlM0e":"redirect-token"`, { status: 200 });
          }
          if (urlStr.includes("BardChatUi")) {
            return new Response(
              buildMockStreamResponse("After redirect"),
              { status: 200 },
            );
          }
          return new Response("Not Found", { status: 404 });
        },
      ) as unknown as typeof fetch;

      const { queryWithCookies } = await import(
        "../../src/extract/gemini-web.ts"
      );
      const result = await queryWithCookies("test", mockCookies);
      expect(result).toBe("After redirect");

      // Verify all 3 token-page fetches had the cookie header
      const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls;
      const tokenCalls = fetchCalls.filter(
        (call: unknown[]) => {
          const u = typeof call[0] === "string" ? call[0] : "";
          return (
            u.includes("gemini.google.com/app") ||
            u.includes("accounts.google.com/auth-bounce")
          );
        },
      );
      expect(tokenCalls.length).toBe(3);
      for (const call of tokenCalls) {
        expect(call[1].headers.cookie).toContain("__Secure-1PSID=test-sid");
      }
    });

    it("returns latest non-empty text from multi-part streaming response", async () => {
      fetchStub.addResponse("gemini.google.com/app", {
        body: `"SNlM0e":"token"`,
        headers: { "content-type": "text/html" },
      });
      fetchStub.addResponse("BardChatUi", {
        body: buildMultiPartStreamResponse([
          "First chunk",
          "Second chunk",
          "Final answer",
        ]),
      });

      const { queryWithCookies } = await import(
        "../../src/extract/gemini-web.ts"
      );
      const result = await queryWithCookies("test", mockCookies);
      expect(result).toBe("Final answer");
    });

    it("uploads files via multipart when files option is provided", async () => {
      mockReadFileSync.mockReturnValue(Buffer.from("fake file content"));

      fetchStub.addResponse("gemini.google.com/app", {
        body: `"SNlM0e":"token"`,
        headers: { "content-type": "text/html" },
      });
      // content-push upload response
      fetchStub.addResponse("content-push.googleapis.com", {
        status: 200,
        body: "upload-id-123",
      });
      fetchStub.addResponse("BardChatUi", {
        body: buildMockStreamResponse("File analyzed"),
      });

      const { queryWithCookies } = await import(
        "../../src/extract/gemini-web.ts"
      );
      const result = await queryWithCookies("analyze this", mockCookies, {
        files: ["/tmp/test.png"],
      });
      expect(result).toBe("File analyzed");
    });
  });
});
