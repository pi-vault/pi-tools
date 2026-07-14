import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubFetch, type FetchStub } from "../helpers.ts";

// Mock dependencies from earlier phases
vi.mock("../../src/extract/gemini-api.ts", () => ({
  isGeminiApiAvailable: vi.fn(),
  queryGeminiApi: vi.fn(),
}));

vi.mock("../../src/extract/gemini-web.ts", () => ({
  isGeminiWebAvailable: vi.fn(),
  queryWithCookies: vi.fn(),
}));

vi.mock("../../src/extract/perplexity.ts", () => ({
  isPerplexityAvailable: vi.fn(),
  queryPerplexity: vi.fn(),
}));

// Mock config to control isYouTubeEnabled / getPreferredModel behavior.
// Default: return empty config (matches "no tools.json found" in real env).
vi.mock("../../src/config.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config.ts")>();
  return { ...actual, loadConfig: vi.fn().mockReturnValue({}) };
});

import {
  isGeminiApiAvailable,
  queryGeminiApi,
} from "../../src/extract/gemini-api.ts";
import {
  isGeminiWebAvailable,
  queryWithCookies,
} from "../../src/extract/gemini-web.ts";
import {
  isPerplexityAvailable,
  queryPerplexity,
} from "../../src/extract/perplexity.ts";
import { loadConfig, type PiToolsConfig } from "../../src/config.ts";
import {
  extractHeadingTitle,
  extractYouTube,
  fetchYouTubeThumbnail,
  isYouTubeEnabled,
  isYouTubeURL,
} from "../../src/extract/youtube.ts";

const mockCfg = (cfg: Partial<PiToolsConfig>) =>
  vi.mocked(loadConfig).mockReturnValue(cfg as PiToolsConfig);

describe("youtube", () => {
  let fetchStub: FetchStub;

  beforeEach(() => {
    fetchStub = stubFetch();
    vi.clearAllMocks();
    mockCfg({});
  });

  afterEach(() => {
    fetchStub.restore();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // isYouTubeURL
  // -------------------------------------------------------------------------

  describe("isYouTubeURL", () => {
    const valid: [string, string, string][] = [
      ["standard watch", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      ["without www", "https://youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      ["mobile", "https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      ["shorts", "https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      ["live", "https://www.youtube.com/live/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      ["embed", "https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      ["/v/", "https://www.youtube.com/v/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      ["youtu.be", "https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      ["extra query params", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf", "dQw4w9WgXcQ"],
      ["hyphens and underscores", "https://youtu.be/a-B_c1D2e3f", "a-B_c1D2e3f"],
    ];

    for (const [label, url, videoId] of valid) {
      it(`detects ${label} URL`, () => {
        expect(isYouTubeURL(url)).toEqual({ isYouTube: true, videoId });
      });
    }

    const invalid: [string, string][] = [
      ["playlist", "https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf"],
      ["non-YouTube", "https://www.google.com/search?q=hello"],
      ["empty string", ""],
      ["channel URL", "https://www.youtube.com/@channelname"],
    ];

    for (const [label, url] of invalid) {
      it(`rejects ${label}`, () => {
        expect(isYouTubeURL(url)).toEqual({ isYouTube: false, videoId: null });
      });
    }
  });

  // -------------------------------------------------------------------------
  // isYouTubeEnabled
  // -------------------------------------------------------------------------

  describe("isYouTubeEnabled", () => {
    it("returns true by default (empty config)", () => {
      mockCfg({});
      expect(isYouTubeEnabled()).toBe(true);
    });

    it("returns false when youtube.enabled is false", () => {
      mockCfg({ youtube: { enabled: false } });
      expect(isYouTubeEnabled()).toBe(false);
    });

    it("returns default when loadConfig throws", () => {
      vi.mocked(loadConfig).mockImplementation(() => {
        throw new Error("config parse error");
      });
      expect(isYouTubeEnabled()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // extractHeadingTitle
  // -------------------------------------------------------------------------

  describe("extractHeadingTitle", () => {
    it("extracts first heading from markdown", () => {
      const text = "# My Video Title\n\nSome content here.";
      expect(extractHeadingTitle(text)).toBe("My Video Title");
    });

    it("returns null when no heading exists", () => {
      const text = "No heading here, just text.";
      expect(extractHeadingTitle(text)).toBeNull();
    });

    it("extracts first heading when multiple exist", () => {
      const text = "# First Title\n\n## Second\n\n# Third";
      expect(extractHeadingTitle(text)).toBe("First Title");
    });

    it("trims whitespace from heading", () => {
      const text = "#   Spaced Title   \n\nContent";
      expect(extractHeadingTitle(text)).toBe("Spaced Title");
    });
  });

  // -------------------------------------------------------------------------
  // extractYouTube
  // -------------------------------------------------------------------------

  describe("extractYouTube", () => {
    it("uses Gemini Web when available (tier 1)", async () => {
      const mockCookies = { "__Secure-1PSID": "test" };
      vi.mocked(isGeminiWebAvailable).mockResolvedValue(mockCookies);
      vi.mocked(queryWithCookies).mockResolvedValue(
        "# Video Title\n\nTranscript content here.",
      );
      fetchStub.addResponse("img.youtube.com", {
        body: "fake-jpeg-data",
        headers: { "content-type": "image/jpeg" },
      });

      const result = await extractYouTube(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      );

      expect(result).not.toBeNull();
      expect(result?.text).toContain("Transcript content here.");
      expect(result?.title).toBe("Video Title");
      expect(result?.extractionChain).toEqual(["youtube:gemini-web"]);
      expect(result?.url).toBe(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      );

      expect(queryWithCookies).toHaveBeenCalledWith(
        expect.stringContaining("Extract the complete content"),
        mockCookies,
        expect.objectContaining({
          youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        }),
      );
    });

    it("falls back to Gemini API when Web unavailable (tier 2)", async () => {
      vi.mocked(isGeminiWebAvailable).mockResolvedValue(null);
      vi.mocked(isGeminiApiAvailable).mockReturnValue(true);
      vi.mocked(queryGeminiApi).mockResolvedValue(
        "# API Video\n\nAPI transcript.",
      );
      fetchStub.addResponse("img.youtube.com", {
        body: "fake-jpeg-data",
        headers: { "content-type": "image/jpeg" },
      });

      const result = await extractYouTube("https://youtu.be/dQw4w9WgXcQ");

      expect(result).not.toBeNull();
      expect(result?.title).toBe("API Video");
      expect(result?.extractionChain).toEqual(["youtube:gemini-api"]);
      expect(queryGeminiApi).toHaveBeenCalledWith(
        expect.stringContaining("Extract the complete content"),
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        expect.objectContaining({
          model: expect.any(String),
        }),
      );
    });

    it("falls back to Perplexity when both Gemini methods fail (tier 3)", async () => {
      vi.mocked(isGeminiWebAvailable).mockResolvedValue(null);
      vi.mocked(isGeminiApiAvailable).mockReturnValue(false);
      vi.mocked(isPerplexityAvailable).mockReturnValue(true);
      vi.mocked(queryPerplexity).mockResolvedValue(
        "This video discusses the history of rickrolling.",
      );
      fetchStub.addResponse("img.youtube.com", {
        body: "fake-jpeg-data",
        headers: { "content-type": "image/jpeg" },
      });

      const result = await extractYouTube(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      );

      expect(result).not.toBeNull();
      expect(result?.extractionChain).toEqual(["youtube:perplexity"]);
      expect(result?.text).toContain("Video Summary (via Perplexity)");
      expect(result?.text).toContain("history of rickrolling");
      expect(queryPerplexity).toHaveBeenCalledWith(
        "Summarize this YouTube video in detail: https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        undefined,
      );
    });

    it("returns null when all methods fail", async () => {
      vi.mocked(isGeminiWebAvailable).mockResolvedValue(null);
      vi.mocked(isGeminiApiAvailable).mockReturnValue(false);
      vi.mocked(isPerplexityAvailable).mockReturnValue(false);

      const result = await extractYouTube(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      );

      expect(result).toBeNull();
    });

    it("returns null when YouTube is disabled via config", async () => {
      mockCfg({ youtube: { enabled: false } });

      const result = await extractYouTube(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      );

      expect(result).toBeNull();
      expect(isGeminiWebAvailable).not.toHaveBeenCalled();
      expect(isGeminiApiAvailable).not.toHaveBeenCalled();
      expect(isPerplexityAvailable).not.toHaveBeenCalled();
    });

    it("uses custom prompt when provided in options", async () => {
      vi.mocked(isGeminiWebAvailable).mockResolvedValue(null);
      vi.mocked(isGeminiApiAvailable).mockReturnValue(true);
      vi.mocked(queryGeminiApi).mockResolvedValue(
        "# Custom Analysis\n\nFocused content.",
      );
      fetchStub.addResponse("img.youtube.com", {
        body: "fake-jpeg-data",
        headers: { "content-type": "image/jpeg" },
      });

      const result = await extractYouTube(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        undefined,
        { prompt: "What programming language is used?" },
      );

      expect(result).not.toBeNull();
      expect(queryGeminiApi).toHaveBeenCalledWith(
        "What programming language is used?",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        expect.anything(),
      );
    });

    it("uses custom model when provided in options", async () => {
      vi.mocked(isGeminiWebAvailable).mockResolvedValue(null);
      vi.mocked(isGeminiApiAvailable).mockReturnValue(true);
      vi.mocked(queryGeminiApi).mockResolvedValue("# Title\n\nContent.");
      fetchStub.addResponse("img.youtube.com", {
        body: "fake-jpeg-data",
        headers: { "content-type": "image/jpeg" },
      });

      await extractYouTube(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        undefined,
        { model: "gemini-2.5-pro" },
      );

      expect(queryGeminiApi).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ model: "gemini-2.5-pro" }),
      );
    });

    it("handles abort signal", async () => {
      const controller = new AbortController();
      controller.abort();

      vi.mocked(isGeminiWebAvailable).mockResolvedValue(null);
      vi.mocked(isGeminiApiAvailable).mockReturnValue(true);

      const result = await extractYouTube(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        controller.signal,
      );

      expect(queryGeminiApi).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it("catches Gemini Web errors and falls through to API", async () => {
      const mockCookies = { "__Secure-1PSID": "test" };
      vi.mocked(isGeminiWebAvailable).mockResolvedValue(mockCookies);
      vi.mocked(queryWithCookies).mockRejectedValue(
        new Error("Cookie expired"),
      );
      vi.mocked(isGeminiApiAvailable).mockReturnValue(true);
      vi.mocked(queryGeminiApi).mockResolvedValue("# Fallback\n\nContent.");
      fetchStub.addResponse("img.youtube.com", {
        body: "fake-jpeg-data",
        headers: { "content-type": "image/jpeg" },
      });

      const result = await extractYouTube(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      );

      expect(result).not.toBeNull();
      expect(result?.extractionChain).toEqual(["youtube:gemini-api"]);
    });

    it("canonicalizes youtu.be URLs before passing to extractors", async () => {
      vi.mocked(isGeminiWebAvailable).mockResolvedValue(null);
      vi.mocked(isGeminiApiAvailable).mockReturnValue(true);
      vi.mocked(queryGeminiApi).mockResolvedValue("# Title\n\nContent.");
      fetchStub.addResponse("img.youtube.com", {
        body: "fake-jpeg-data",
        headers: { "content-type": "image/jpeg" },
      });

      await extractYouTube("https://youtu.be/abc123DEF-_");

      expect(queryGeminiApi).toHaveBeenCalledWith(
        expect.anything(),
        "https://www.youtube.com/watch?v=abc123DEF-_",
        expect.anything(),
      );
    });

    it("uses custom Perplexity query for custom prompts", async () => {
      vi.mocked(isGeminiWebAvailable).mockResolvedValue(null);
      vi.mocked(isGeminiApiAvailable).mockReturnValue(false);
      vi.mocked(isPerplexityAvailable).mockReturnValue(true);
      vi.mocked(queryPerplexity).mockResolvedValue("Custom answer.");
      fetchStub.addResponse("img.youtube.com", {
        body: "fake-jpeg-data",
        headers: { "content-type": "image/jpeg" },
      });

      await extractYouTube(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        undefined,
        { prompt: "What language is used?" },
      );

      expect(queryPerplexity).toHaveBeenCalledWith(
        "What language is used? YouTube video: https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        undefined,
      );
    });
  });

  // -------------------------------------------------------------------------
  // fetchYouTubeThumbnail
  // -------------------------------------------------------------------------

  describe("fetchYouTubeThumbnail", () => {
    it("returns base64 thumbnail on success", async () => {
      fetchStub.addResponse("img.youtube.com", {
        body: "fake-jpeg-data",
        headers: { "content-type": "image/jpeg" },
      });

      const result = await fetchYouTubeThumbnail("dQw4w9WgXcQ");

      expect(result).not.toBeNull();
      expect(result?.mimeType).toBe("image/jpeg");
      expect(result?.data.length).toBeGreaterThan(0);
    });

    it("returns null on HTTP error", async () => {
      fetchStub.addResponse("img.youtube.com", { status: 404 });

      const result = await fetchYouTubeThumbnail("invalid_id__");
      expect(result).toBeNull();
    });

    it("returns null on empty response body", async () => {
      fetchStub.addResponse("img.youtube.com", { body: "" });

      const result = await fetchYouTubeThumbnail("dQw4w9WgXcQ");
      expect(result).toBeNull();
    });

    it("returns null on network error", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("timeout"));

      const result = await fetchYouTubeThumbnail("dQw4w9WgXcQ");
      expect(result).toBeNull();
    });
  });
});
