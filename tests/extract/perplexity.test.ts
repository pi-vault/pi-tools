import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubFetch, type FetchStub } from "../helpers.ts";

// Mock config.ts to control key resolution without hitting the filesystem.
vi.mock("../../src/config.ts", () => ({
  resolveProviderKey: vi.fn(),
  FALLBACK_ENV_MAP: { perplexity: "PERPLEXITY_API_KEY" },
}));

import { resolveProviderKey } from "../../src/config.ts";
import {
  isPerplexityAvailable,
  queryPerplexity,
} from "../../src/extract/perplexity.ts";

describe("perplexity", () => {
  const mockResolveProviderKey = vi.mocked(resolveProviderKey);
  let fetchStub: FetchStub;

  beforeEach(() => {
    fetchStub = stubFetch();
    mockResolveProviderKey.mockReturnValue(undefined);
  });

  afterEach(() => {
    fetchStub.restore();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // isPerplexityAvailable
  // -------------------------------------------------------------------------

  describe("isPerplexityAvailable", () => {
    it("returns false when no API key is configured", () => {
      mockResolveProviderKey.mockReturnValue(undefined);
      expect(isPerplexityAvailable()).toBe(false);
    });

    it("returns true when API key is available", () => {
      mockResolveProviderKey.mockReturnValue("pplx-test-key");
      expect(isPerplexityAvailable()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // queryPerplexity
  // -------------------------------------------------------------------------

  describe("queryPerplexity", () => {
    it("throws when no API key is available", async () => {
      mockResolveProviderKey.mockReturnValue(undefined);
      await expect(queryPerplexity("test query")).rejects.toThrow(
        "Perplexity API key not found",
      );
    });

    it("sends correct request and returns response content", async () => {
      mockResolveProviderKey.mockReturnValue("pplx-test-key");
      fetchStub.addResponse("api.perplexity.ai", {
        body: {
          choices: [{ message: { content: "This is a summary of the video." } }],
        },
      });

      const result = await queryPerplexity("Summarize this video");

      expect(result).toBe("This is a summary of the video.");

      const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
      const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(calledUrl).toBe("https://api.perplexity.ai/chat/completions");
      expect(calledInit.method).toBe("POST");
      expect(
        (calledInit.headers as Record<string, string>).Authorization,
      ).toBe("Bearer pplx-test-key");

      const body = JSON.parse(calledInit.body as string) as {
        model: string;
        messages: Array<{ role: string; content: string }>;
        max_tokens: number;
      };
      expect(body.model).toBe("sonar");
      expect(body.messages[0].content).toBe("Summarize this video");
      expect(body.max_tokens).toBe(4096);
    });

    it("throws on HTTP error response", async () => {
      mockResolveProviderKey.mockReturnValue("pplx-test-key");
      fetchStub.addResponse("api.perplexity.ai", {
        status: 429,
        body: "rate limited",
      });

      await expect(queryPerplexity("test")).rejects.toThrow(
        "Perplexity API error 429",
      );
    });

    it("throws on empty response content", async () => {
      mockResolveProviderKey.mockReturnValue("pplx-test-key");
      fetchStub.addResponse("api.perplexity.ai", {
        body: { choices: [] },
      });

      await expect(queryPerplexity("test")).rejects.toThrow(
        "Perplexity API returned empty response",
      );
    });

    it("throws on network error", async () => {
      mockResolveProviderKey.mockReturnValue("pplx-test-key");
      // Override fetch to throw a network error (stubFetch returns 404 for unmatched URLs)
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network failure"));

      await expect(queryPerplexity("test")).rejects.toThrow("Network failure");
    });
  });
});
