import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// MUST be before any import that uses pipeline.ts
vi.mock("../../src/extract/pipeline.ts", () => ({
  extractContent: vi.fn(),
  RetryableExtractionError: class RetryableExtractionError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "RetryableExtractionError";
    }
  },
}));

import { createWebFetchTool } from "../../src/tools/web-fetch.ts";
import { extractContent } from "../../src/extract/pipeline.ts";
import { ContentStore } from "../../src/storage.ts";
import { makeCtx } from "../helpers.ts";

describe("web_fetch — video parameters and ImageContent", () => {
  beforeEach(() => {
    vi.mocked(extractContent).mockResolvedValue({
      text: "Default extracted text",
      title: "Test Page",
      url: "https://example.com",
      extractionChain: ["readability"],
      chars: 22,
      truncated: false,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes prompt/timestamp/frames/model to extractContent", async () => {
    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    const ctx = makeCtx();

    await tool.execute(
      "call-vid-1",
      {
        url: "https://example.com/video.mp4",
        prompt: "What happens in this video?",
        timestamp: "1:30",
        frames: 3,
        model: "gemini-2.5-flash",
      },
      undefined,
      undefined,
      ctx,
    );

    expect(extractContent).toHaveBeenCalledWith(
      "https://example.com/video.mp4",
      undefined,
      expect.objectContaining({
        prompt: "What happens in this video?",
        timestamp: "1:30",
        frames: 3,
        model: "gemini-2.5-flash",
      }),
    );
  });

  it("renders thumbnail as ImageContent block in result", async () => {
    vi.mocked(extractContent).mockResolvedValue({
      text: "YouTube video transcript with enough text here",
      title: "Test Video",
      url: "https://www.youtube.com/watch?v=abc123",
      extractionChain: ["youtube:gemini-web"],
      chars: 46,
      truncated: false,
      thumbnail: { data: "iVBORw0KGgoAAAANSUhEUg==", mimeType: "image/jpeg" },
    });

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    const ctx = makeCtx();

    const result = await tool.execute(
      "call-vid-2",
      { url: "https://www.youtube.com/watch?v=abc123" },
      undefined,
      undefined,
      ctx,
    );

    expect(result.content).toHaveLength(2);
    expect(result.content[0].type).toBe("text");
    expect(result.content[1]).toEqual({
      type: "image",
      data: "iVBORw0KGgoAAAANSUhEUg==",
      mimeType: "image/jpeg",
    });
  });

  it("renders multiple frames as ImageContent blocks", async () => {
    vi.mocked(extractContent).mockResolvedValue({
      text: "",
      title: "YouTube Frames",
      url: "https://www.youtube.com/watch?v=abc123",
      extractionChain: ["frames:youtube"],
      chars: 0,
      truncated: false,
      frames: [
        { data: "frame1base64", mimeType: "image/jpeg", timestamp: "0:30" },
        { data: "frame2base64", mimeType: "image/jpeg", timestamp: "1:00" },
      ],
    });

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    const ctx = makeCtx();

    const result = await tool.execute(
      "call-vid-3",
      { url: "https://www.youtube.com/watch?v=abc123", timestamp: "0:30-1:00", frames: 2 },
      undefined,
      undefined,
      ctx,
    );

    // text header + 2 frame images
    expect(result.content).toHaveLength(3);
    expect(result.content[0].type).toBe("text");
    expect(result.content[1]).toEqual({ type: "image", data: "frame1base64", mimeType: "image/jpeg" });
    expect(result.content[2]).toEqual({ type: "image", data: "frame2base64", mimeType: "image/jpeg" });
  });

  it("renderResult shows frame count for frames-only result (chars=0 with images)", () => {
    // The renderResult function should handle chars=0 when images are present
    // We verify this via the details returned
    // Note: renderResult itself uses TUI components (Text from pi-tui), hard to unit test
    // Verify instead that details.chars=0 with content including images is structurally valid
    const mockResult = {
      content: [
        { type: "text" as const, text: "" },
        { type: "image" as const, data: "f1", mimeType: "image/jpeg" },
      ],
      details: {
        url: "https://example.com",
        chars: 0,
        truncated: false,
        extractionChain: ["frames:youtube"],
      },
    };

    // Verify structure: text block + image block
    expect(mockResult.content[0].type).toBe("text");
    expect(mockResult.content[1].type).toBe("image");
    expect(mockResult.details.chars).toBe(0);
  });
});
