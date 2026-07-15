import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the extraction modules before importing pipeline
vi.mock("../../src/extract/youtube.ts", () => ({
  isYouTubeURL: vi.fn(),
  extractYouTube: vi.fn(),
  isYouTubeEnabled: vi.fn(),
}));

vi.mock("../../src/extract/video.ts", () => ({
  isVideoFile: vi.fn(),
  extractVideo: vi.fn(),
  isVideoEnabled: vi.fn(),
}));

vi.mock("../../src/extract/frames.ts", () => ({
  parseTimestampParam: vi.fn(),
  extractYouTubeFrames: vi.fn(),
  extractLocalFrames: vi.fn(),
  getLocalVideoDuration: vi.fn(),
  getYouTubeStreamInfo: vi.fn(),
}));

vi.mock("../../src/extract/gemini-url-context.ts", () => ({
  extractWithUrlContext: vi.fn(),
  extractWithGeminiWeb: vi.fn(),
}));

import { extractContent } from "../../src/extract/pipeline.ts";
import { isYouTubeURL, extractYouTube, isYouTubeEnabled } from "../../src/extract/youtube.ts";
import { isVideoFile, extractVideo, isVideoEnabled } from "../../src/extract/video.ts";
import {
  parseTimestampParam,
  extractYouTubeFrames,
  extractLocalFrames,
  getLocalVideoDuration,
  getYouTubeStreamInfo,
} from "../../src/extract/frames.ts";
import { extractWithUrlContext, extractWithGeminiWeb } from "../../src/extract/gemini-url-context.ts";

async function withMockFetch(response: Response, fn: () => Promise<void>) {
  const orig = globalThis.fetch;
  globalThis.fetch = vi.fn().mockResolvedValue(response) as unknown as typeof fetch;
  try { await fn(); } finally { globalThis.fetch = orig; }
}

describe("extractContent — YouTube/Video routing", () => {
  beforeEach(() => {
    // Default: not YouTube, not video
    vi.mocked(isYouTubeURL).mockReturnValue({ isYouTube: false, videoId: null });
    vi.mocked(isYouTubeEnabled).mockReturnValue(false);
    vi.mocked(isVideoFile).mockReturnValue(null);
    vi.mocked(isVideoEnabled).mockReturnValue(false);
    vi.mocked(extractWithUrlContext).mockResolvedValue(null);
    vi.mocked(extractWithGeminiWeb).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("routes YouTube URLs to extractYouTube when enabled", async () => {
    vi.mocked(isYouTubeURL).mockReturnValue({ isYouTube: true, videoId: "dQw4w9WgXcQ" });
    vi.mocked(isYouTubeEnabled).mockReturnValue(true);
    vi.mocked(extractYouTube).mockResolvedValue({
      text: "Never Gonna Give You Up transcript content that is long enough",
      title: "Rick Astley - Never Gonna Give You Up",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      extractionChain: ["youtube:gemini-web"],
      chars: 62,
      truncated: false,
    });

    const result = await extractContent("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(result.extractionChain).toContain("youtube:gemini-web");
    expect(result.text).toContain("Never Gonna Give You Up");
    expect(extractYouTube).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      undefined,
      undefined,
    );
  });

  it("falls through to HTTP when YouTube extraction returns null", async () => {
    vi.mocked(isYouTubeURL).mockReturnValue({ isYouTube: true, videoId: "abc123" });
    vi.mocked(isYouTubeEnabled).mockReturnValue(true);
    vi.mocked(extractYouTube).mockResolvedValue(null);

    await withMockFetch(
      new Response(
        `<html><body><article><h1>Title</h1><p>${"Fallback content that is long enough. ".repeat(20)}</p></article></body></html>`,
        { status: 200, headers: { "content-type": "text/html" } },
      ),
      async () => {
        const result = await extractContent("https://www.youtube.com/watch?v=abc123");
        expect(extractYouTube).toHaveBeenCalled();
        expect(result.extractionChain).toContain("readability");
      },
    );
  });

  it("skips YouTube routing when isYouTubeEnabled returns false", async () => {
    vi.mocked(isYouTubeURL).mockReturnValue({ isYouTube: true, videoId: "abc123" });
    vi.mocked(isYouTubeEnabled).mockReturnValue(false);

    await withMockFetch(
      new Response(
        `<html><body><article><p>${"Content. ".repeat(40)}</p></article></body></html>`,
        { status: 200, headers: { "content-type": "text/html" } },
      ),
      async () => {
        await extractContent("https://www.youtube.com/watch?v=abc123");
        expect(extractYouTube).not.toHaveBeenCalled();
      },
    );
  });

  it("routes local video files to extractVideo when enabled", async () => {
    vi.mocked(isYouTubeURL).mockReturnValue({ isYouTube: false, videoId: null });
    vi.mocked(isVideoFile).mockReturnValue({ absolutePath: "/tmp/video.mp4", mimeType: "video/mp4", sizeBytes: 1024 });
    vi.mocked(isVideoEnabled).mockReturnValue(true);
    vi.mocked(extractVideo).mockResolvedValue({
      text: "Video analysis: a cat playing piano on a grand piano",
      title: "video.mp4",
      url: "file:///tmp/video.mp4",
      extractionChain: ["gemini-api"],
      chars: 51,
      truncated: false,
    });

    const result = await extractContent("/tmp/video.mp4");
    expect(result.text).toContain("cat playing piano");
    expect(extractVideo).toHaveBeenCalled();
  });

  it("skips video routing when isVideoEnabled returns false", async () => {
    vi.mocked(isVideoFile).mockReturnValue({ absolutePath: "/tmp/video.mp4", mimeType: "video/mp4", sizeBytes: 1024 });
    vi.mocked(isVideoEnabled).mockReturnValue(false);

    // validateUrl will reject a local path — that's the expected behavior
    await expect(extractContent("/tmp/video.mp4")).rejects.toThrow();
    expect(extractVideo).not.toHaveBeenCalled();
  });
});

describe("extractContent — Frame extraction routing", () => {
  beforeEach(() => {
    vi.mocked(isYouTubeURL).mockReturnValue({ isYouTube: false, videoId: null });
    vi.mocked(isYouTubeEnabled).mockReturnValue(false);
    vi.mocked(isVideoFile).mockReturnValue(null);
    vi.mocked(isVideoEnabled).mockReturnValue(false);
    vi.mocked(extractWithUrlContext).mockResolvedValue(null);
    vi.mocked(extractWithGeminiWeb).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("extracts YouTube frames when timestamp option is present", async () => {
    vi.mocked(isYouTubeURL).mockReturnValue({ isYouTube: true, videoId: "dQw4w9WgXcQ" });
    vi.mocked(getYouTubeStreamInfo).mockResolvedValue({ streamUrl: "https://stream.example.com/video", duration: 212 });
    vi.mocked(parseTimestampParam).mockReturnValue([30, 60, 90]);
    vi.mocked(extractYouTubeFrames).mockResolvedValue({
      frames: [
        { data: "base64frame1", mimeType: "image/jpeg", timestamp: "0:30" },
        { data: "base64frame2", mimeType: "image/jpeg", timestamp: "1:00" },
        { data: "base64frame3", mimeType: "image/jpeg", timestamp: "1:30" },
      ],
      duration: 212,
      error: null,
    });

    const result = await extractContent(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      undefined,
      { timestamp: "0:30-1:30" },
    );

    expect(result.extractionChain).toEqual(["frames:youtube"]);
    expect(result.frames).toHaveLength(3);
    expect(result.text).toBe("");
    expect(result.duration).toBe(212);
    expect(getYouTubeStreamInfo).toHaveBeenCalledWith("dQw4w9WgXcQ");
  });

  it("throws when getYouTubeStreamInfo returns error", async () => {
    vi.mocked(isYouTubeURL).mockReturnValue({ isYouTube: true, videoId: "bad123" });
    vi.mocked(getYouTubeStreamInfo).mockResolvedValue({ error: "Video is private or unavailable" });

    await expect(
      extractContent("https://www.youtube.com/watch?v=bad123", undefined, { timestamp: "0:30" }),
    ).rejects.toThrow("Video is private or unavailable");
  });

  it("extracts local video frames when frames option is present", async () => {
    vi.mocked(isYouTubeURL).mockReturnValue({ isYouTube: false, videoId: null });
    vi.mocked(isVideoFile).mockReturnValue({ absolutePath: "/tmp/video.mp4", mimeType: "video/mp4", sizeBytes: 1024 });
    vi.mocked(getLocalVideoDuration).mockResolvedValue(120);
    vi.mocked(parseTimestampParam).mockReturnValue([15, 30, 45, 60]);
    vi.mocked(extractLocalFrames).mockResolvedValue({
      frames: [
        { data: "f1", mimeType: "image/jpeg", timestamp: "0:15" },
        { data: "f2", mimeType: "image/jpeg", timestamp: "0:30" },
        { data: "f3", mimeType: "image/jpeg", timestamp: "0:45" },
        { data: "f4", mimeType: "image/jpeg", timestamp: "1:00" },
      ],
      duration: 120,
      error: null,
    });

    const result = await extractContent("/tmp/video.mp4", undefined, { frames: 4 });

    expect(result.extractionChain).toEqual(["frames:local"]);
    expect(result.frames).toHaveLength(4);
    expect(result.duration).toBe(120);
    expect(getLocalVideoDuration).toHaveBeenCalledWith("/tmp/video.mp4");
  });

  it("throws when all frames fail to extract (empty frames + error)", async () => {
    vi.mocked(isYouTubeURL).mockReturnValue({ isYouTube: true, videoId: "abc123" });
    vi.mocked(getYouTubeStreamInfo).mockResolvedValue({ streamUrl: "https://stream.example.com/video", duration: 100 });
    vi.mocked(parseTimestampParam).mockReturnValue([30]);
    vi.mocked(extractYouTubeFrames).mockResolvedValue({
      frames: [],
      duration: 100,
      error: "Stream URL returned 403 — may have expired",
    });

    await expect(
      extractContent("https://www.youtube.com/watch?v=abc123", undefined, { timestamp: "0:30" }),
    ).rejects.toThrow("403");
  });
});

describe("extractContent — Gemini HTML fallback", () => {
  beforeEach(() => {
    vi.mocked(isYouTubeURL).mockReturnValue({ isYouTube: false, videoId: null });
    vi.mocked(isYouTubeEnabled).mockReturnValue(false);
    vi.mocked(isVideoFile).mockReturnValue(null);
    vi.mocked(isVideoEnabled).mockReturnValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("uses Gemini URL context when Readability, RSC, and Jina all fail", async () => {
    vi.mocked(extractWithUrlContext).mockResolvedValue({
      text: "# Full Article\n\nThis is the complete content extracted by Gemini URL context.",
      title: "Full Article",
      url: "https://example.com/article",
      extractionChain: ["html:gemini-url-context"],
      chars: 71,
      truncated: false,
    });
    vi.mocked(extractWithGeminiWeb).mockResolvedValue(null);

    // Thin HTML that Readability won't extract
    await withMockFetch(
      new Response("<html><body><p>hi</p></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
      async () => {
        const result = await extractContent("https://example.com/article");
        expect(result.extractionChain).toContain("readability:thin");
        expect(result.extractionChain).toContain("jina-reader:fail");
        expect(result.extractionChain).toContain("html:gemini-url-context");
        expect(result.text).toContain("Full Article");
      },
    );
  });

  it("falls back to Gemini Web when URL context fails", async () => {
    vi.mocked(extractWithUrlContext).mockResolvedValue(null);
    vi.mocked(extractWithGeminiWeb).mockResolvedValue({
      text: "# Page\n\nGemini Web extracted this content from the page.",
      title: "Page",
      url: "https://example.com/page",
      extractionChain: ["html:gemini-web"],
      chars: 56,
      truncated: false,
    });

    await withMockFetch(
      new Response("<html><body><p>short</p></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
      async () => {
        const result = await extractContent("https://example.com/page");
        expect(result.extractionChain).toContain("jina-reader:fail");
        expect(result.extractionChain).toContain("html:gemini-web");
      },
    );
  });

  it("falls through to raw-text when all Gemini options fail", async () => {
    vi.mocked(extractWithUrlContext).mockResolvedValue(null);
    vi.mocked(extractWithGeminiWeb).mockResolvedValue(null);

    await withMockFetch(
      new Response("<html><body>raw content</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
      async () => {
        const result = await extractContent("https://example.com/raw");
        expect(result.extractionChain).toContain("jina-reader:fail");
        expect(result.extractionChain).toContain("raw-text");
        expect(result.extractionChain).not.toContain("html:gemini-url-context");
      },
    );
  });
});
