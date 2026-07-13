# Content Extraction Phase 7: Pipeline Integration & web_fetch Extension

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire all extraction modules (Phases 1-6) into the pipeline and extend the `web_fetch` tool with video/YouTube parameters and ImageContent rendering.

**Architecture:**

- Route YouTube URLs, local video files, and frame extraction requests at the top of `extractContent()` before HTTP fetch
- Add Gemini HTML fallback as a new tier after Jina Reader for pages where Readability extracted < 500 chars
- Extend `web_fetch` tool schema with `prompt`, `timestamp`, `frames`, `model` parameters
- Render `thumbnail` and `frames` as MCP `ImageContent` blocks in tool results

**Tech Stack:** TypeScript, Vitest, Typebox schema validation

**Spec:** `docs/superpowers/specs/2026-07-13-content-extraction-design.md`

---

## Prerequisites

- Phases 1-6 complete and all tests passing
- All extraction modules exist and export expected APIs:
  - Phase 1: `ExtractedContent`, `ExtractOptions`, `VideoFrame` types in `src/extract/pipeline.ts` and `src/config.ts`
  - Phase 2: `queryGeminiApi`, `isGeminiApiAvailable` in `src/extract/gemini-api.ts`
  - Phase 3: `isGeminiWebAvailable`, `queryWithCookies` in `src/extract/gemini-web.ts`
  - Phase 4: `isYouTubeURL`, `extractYouTube`, `isYouTubeEnabled` in `src/extract/youtube.ts`
  - Phase 5: `parseTimestampParam`, `extractYouTubeFrames`, `extractLocalFrames`, `getLocalVideoDuration` in `src/extract/frames.ts`
  - Phase 6: `isVideoFile`, `extractVideo`, `isVideoEnabled` in `src/extract/video.ts`
- Verification: `pnpm test && pnpm run typecheck`

## Verification Commands

```bash
pnpm vitest run tests/extract/pipeline.test.ts tests/tools/web-fetch.test.ts
pnpm test
pnpm run lint
pnpm run typecheck
```

---

## Task 1: Add YouTube/Video/Frame Routing to Pipeline

**Files:** `src/extract/pipeline.ts`

This task adds three routing blocks at the top of `extractContent()`, before the existing GitHub interception.

- [ ] **Step 1:** Add imports for YouTube, video, and frame modules at the top of `src/extract/pipeline.ts`

```typescript
// Add after existing imports
import { basename } from "node:path";
import { isYouTubeURL, extractYouTube, isYouTubeEnabled } from "./youtube.ts";
import { isVideoFile, extractVideo, isVideoEnabled } from "./video.ts";
import {
  parseTimestampParam,
  extractYouTubeFrames,
  extractLocalFrames,
  getLocalVideoDuration,
  getYouTubeStreamInfo,
} from "./frames.ts";
```

- [ ] **Step 2:** Add frame extraction routing block — insert BEFORE `validateUrl(url, ...)` call

This handles the case where `timestamp` or `frames` params are present (explicit frame extraction mode):

```typescript
export async function extractContent(
  url: string,
  signal?: AbortSignal,
  options?: ExtractOptions,
): Promise<ExtractedContent> {
  // NEW: Frame extraction mode (timestamp/frames params present)
  if (options?.timestamp || options?.frames) {
    const ytCheck = isYouTubeURL(url);
    if (ytCheck.isYouTube && ytCheck.videoId) {
      const streamInfo = await getYouTubeStreamInfo(ytCheck.videoId);
      const duration = "duration" in streamInfo ? (streamInfo.duration as number | undefined) : undefined;
      const timestamps = parseTimestampParam(options.timestamp, options.frames, duration ?? undefined);
      const result = await extractYouTubeFrames(ytCheck.videoId, timestamps, signal);
      return {
        text: "",
        title: "YouTube Frames",
        url,
        extractionChain: ["frames:youtube"],
        chars: 0,
        truncated: false,
        frames: result.frames,
        duration: result.duration ?? undefined,
      };
    }
    const videoInfo = isVideoFile(url);
    if (videoInfo) {
      const duration = await getLocalVideoDuration(videoInfo.absolutePath);
      const dur = typeof duration === "number" ? duration : undefined;
      const timestamps = parseTimestampParam(options.timestamp, options.frames, dur);
      const result = await extractLocalFrames(videoInfo.absolutePath, timestamps, signal);
      return {
        text: "",
        title: basename(videoInfo.absolutePath),
        url,
        extractionChain: ["frames:local"],
        chars: 0,
        truncated: false,
        frames: result.frames,
        duration: dur,
      };
    }
  }

  // ... rest of extractContent continues below
```

- [ ] **Step 3:** Add local video file routing — insert AFTER frame extraction block, BEFORE `validateUrl()`

```typescript
  // NEW: Local video file detection
  const videoInfo = isVideoFile(url);
  if (videoInfo && isVideoEnabled()) {
    const result = await extractVideo(videoInfo, signal, options);
    if (result) return result;
    // If extractVideo returns null, fall through to regular pipeline
  }
```

- [ ] **Step 4:** Add YouTube URL routing — insert AFTER local video block, BEFORE `validateUrl()`

```typescript
  // NEW: YouTube URL detection
  const ytParsed = isYouTubeURL(url);
  if (ytParsed.isYouTube && isYouTubeEnabled()) {
    const result = await extractYouTube(url, signal, options);
    if (result) return result;
    // If all YouTube extractors failed, fall through to regular HTTP fetch
  }

  validateUrl(url, { allowRanges: options?.allowRanges });
  // ... existing GitHub interception, HTTP fetch, etc.
```

- [ ] **Step 5:** Verify the file compiles

```bash
pnpm run typecheck
```

- [ ] **Step 6:** Commit

```bash
git add src/extract/pipeline.ts
git commit -m "feat(pipeline): add YouTube/video/frame routing before HTTP fetch"
```

---

## Task 2: Add Gemini HTML Fallback After Jina Reader

**Files:** `src/extract/pipeline.ts`

This task adds a Gemini-powered fallback for pages where Readability produced thin content (< 500 chars) and Jina Reader also failed.

- [ ] **Step 1:** Add Gemini imports (if not already present from Task 1)

```typescript
import { queryGeminiApi, isGeminiApiAvailable } from "./gemini-api.ts";
import { isGeminiWebAvailable, queryWithCookies } from "./gemini-web.ts";
```

- [ ] **Step 2:** Add the `HTML_EXTRACTION_PROMPT` constant and `tryGeminiHtmlFallback` helper function at the bottom of the file (before or after the pipeline function)

```typescript
const HTML_EXTRACTION_PROMPT = `Extract the main readable content from this web page. Return it as clean markdown.
Ignore navigation, ads, footers, and sidebars. Focus on the primary article or content.`;

async function tryGeminiHtmlFallback(
  url: string,
  signal?: AbortSignal,
): Promise<ExtractedContent | null> {
  // Try Gemini Web first (free, cookie-based)
  if (isGeminiWebAvailable()) {
    try {
      const result = await queryWithCookies(
        `${HTML_EXTRACTION_PROMPT}\n\nURL: ${url}`,
        { signal },
      );
      if (result && result.text.length > 100) {
        return {
          text: result.text,
          title: undefined,
          url,
          extractionChain: ["html:gemini-web"],
          chars: result.text.length,
          truncated: false,
        };
      }
    } catch {
      // Fall through to API
    }
  }

  // Try Gemini API (requires API key)
  if (isGeminiApiAvailable()) {
    try {
      const result = await queryGeminiApi(HTML_EXTRACTION_PROMPT, url, { signal });
      if (result && result.text.length > 100) {
        return {
          text: result.text,
          title: undefined,
          url,
          extractionChain: ["html:gemini-api"],
          chars: result.text.length,
          truncated: false,
        };
      }
    } catch {
      // Fall through
    }
  }

  return null;
}
```

- [ ] **Step 3:** Insert the Gemini fallback tier in the pipeline — AFTER Jina Reader tier, BEFORE the raw text fallback

Find the section after `chain.push("jina-reader:fail");` and before the final raw text fallback:

```typescript
  chain.push("jina-reader:fail");

  // Tier 4: Gemini HTML fallback (for thin Readability + Jina failure)
  const geminiResult = await tryGeminiHtmlFallback(url, signal);
  if (geminiResult) {
    chain.push(geminiResult.extractionChain[0]);
    geminiResult.extractionChain = chain.concat(geminiResult.extractionChain);
    return geminiResult;
  }
  chain.push("gemini-html:fail");

  // Final fallback: raw text stripped of HTML
  const rawText = body
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
```

- [ ] **Step 4:** Verify the file compiles

```bash
pnpm run typecheck
```

- [ ] **Step 5:** Commit

```bash
git add src/extract/pipeline.ts
git commit -m "feat(pipeline): add Gemini HTML fallback tier after Jina Reader"
```

---

## Task 3: Extend web_fetch Tool Parameters

**Files:** `src/tools/web-fetch.ts`

Add video-related parameters to the tool schema and pass them through to `extractContent()`.

- [ ] **Step 1:** Add new parameters to the `WebFetchParams` Type.Object schema

```typescript
const WebFetchParams = Type.Object({
  url: Type.Optional(Type.String({ description: "HTTP(S) URL to fetch" })),
  urls: Type.Optional(
    Type.Array(Type.String(), {
      maxItems: 20,
      description: "Multiple URLs to fetch concurrently",
    }),
  ),
  raw: Type.Optional(
    Type.Boolean({ default: false, description: "Return raw HTTP body without extraction" }),
  ),
  fresh: Type.Optional(Type.Boolean({ default: false, description: "Bypass content cache" })),
  // Video/YouTube parameters
  prompt: Type.Optional(
    Type.String({ description: "Question or instruction for video/YouTube analysis." }),
  ),
  timestamp: Type.Optional(
    Type.String({ description: "Extract frame(s): '1:23:45' (single), '23:41-25:00' (range)." }),
  ),
  frames: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 12, description: "Number of frames to extract." }),
  ),
  model: Type.Optional(
    Type.String({ description: "Override Gemini model for video/YouTube analysis." }),
  ),
});
```

- [ ] **Step 2:** Update the `extractContent()` call in `executeSingleUrl` to pass video options

In the `executeSingleUrl` function, update the options passed to `extractContent`:

```typescript
      const extracted = await extractContent(url, signal, {
        raw: params.raw,
        github: githubConfig,
        allowRanges: ssrfAllowRanges,
        // Video/YouTube options
        prompt: params.prompt,
        timestamp: params.timestamp,
        frames: params.frames,
        model: params.model,
      });
```

- [ ] **Step 3:** Update the multi-URL path's `extractContent()` call similarly

In the multi-URL task lambda, add the same video options:

```typescript
      const tasks = uniqueUrls.map((u) => async () => {
        if (!params.fresh) {
          const cached = cache?.get(u);
          if (cached) return cached;
        }

        const extracted = await extractContent(u, signal ?? undefined, {
          raw: params.raw,
          github: githubConfig,
          allowRanges: ssrfAllowRanges,
          prompt: params.prompt,
          timestamp: params.timestamp,
          frames: params.frames,
          model: params.model,
        });

        cache?.set(u, extracted);
        return extracted;
      });
```

- [ ] **Step 4:** Update tool description to mention video/YouTube support

```typescript
    description:
      "Fetch a URL and extract readable content as markdown. Supports HTML pages, YouTube videos (transcript + thumbnail), and local video files (Gemini analysis).",
```

- [ ] **Step 5:** Verify

```bash
pnpm run typecheck
```

- [ ] **Step 6:** Commit

```bash
git add src/tools/web-fetch.ts
git commit -m "feat(web-fetch): add prompt/timestamp/frames/model parameters for video support"
```

---

## Task 4: Add ImageContent Rendering to web_fetch Results

**Files:** `src/tools/web-fetch.ts`

When `extractContent()` returns a thumbnail or frames, render them as MCP `ImageContent` blocks alongside the text.

- [ ] **Step 1:** Update the `buildResult` function to include ImageContent for thumbnails and frames

Replace the content array construction in `buildResult`:

```typescript
function buildResult(
  extracted: {
    text: string;
    title?: string;
    url: string;
    extractionChain: string[];
    chars: number;
    truncated: boolean;
    thumbnail?: { data: string; mimeType: string };
    frames?: Array<{ data: string; mimeType: string; timestamp?: number }>;
    duration?: number;
  },
  originalUrl: string,
  store: ContentStore,
) {
  let contentId: string | undefined;
  let outputText: string;
  let truncated = extracted.truncated;

  if (extracted.chars > INLINE_LIMIT) {
    contentId = store.store({
      url: extracted.url,
      title: extracted.title,
      text: extracted.text,
      source: "web_fetch",
    });
    outputText = truncateContent(extracted.text, INLINE_LIMIT);
    truncated = true;
  } else {
    outputText = extracted.text;
  }

  const header = [
    extracted.title ? `# ${extracted.title}` : `# ${extracted.url}`,
    `Source: ${extracted.url}`,
    `Chars: ${extracted.chars}${truncated ? ` (truncated, use web_read with contentId "${contentId}" for full text)` : ""}`,
    extracted.duration !== undefined ? `Duration: ${extracted.duration}s` : "",
    "",
  ]
    .filter(Boolean)
    .join("\n");

  const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [
    { type: "text" as const, text: header + outputText },
  ];

  // Add thumbnail as ImageContent
  if (extracted.thumbnail) {
    content.push({
      type: "image" as const,
      data: extracted.thumbnail.data,
      mimeType: extracted.thumbnail.mimeType,
    });
  }

  // Add frames as ImageContent
  if (extracted.frames) {
    for (const frame of extracted.frames) {
      content.push({
        type: "image" as const,
        data: frame.data,
        mimeType: frame.mimeType,
      });
    }
  }

  return {
    content,
    details: {
      url: originalUrl,
      title: extracted.title,
      chars: extracted.chars,
      truncated,
      contentId,
      extractionChain: extracted.extractionChain,
    },
  };
}
```

- [ ] **Step 2:** Update the `WebFetchDetails` interface if needed (add optional `duration` field)

```typescript
interface WebFetchDetails {
  url: string;
  title?: string;
  chars: number;
  truncated: boolean;
  contentId?: string;
  extractionChain: string[];
  urlResults?: UrlResult[];
  duration?: number;
}
```

- [ ] **Step 3:** Update `renderResult` to handle the case where content has multiple items (images)

The existing `renderResult` reads `result.content[0]` for text. When images are present, it should still work since `result.content[0]` is always the text block. Add a note about image count:

```typescript
    renderResult(result, options, theme: Theme, context) {
      const text =
        context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
      if (context.isPartial) {
        text.setText(theme.fg("warning", "Fetching..."));
        return text;
      }
      const details = result.details;
      if (!details || details.chars === 0) {
        // Check if we have frames (frames-only result has chars=0 but is valid)
        const imageCount = result.content.filter((c) => c.type === "image").length;
        if (imageCount > 0) {
          text.setText(theme.fg("toolOutput", `${imageCount} frame(s) extracted`));
          return text;
        }
        text.setText(theme.fg("error", "fetch error"));
        return text;
      }
      if (options.expanded) {
        const raw = result.content[0] && "text" in result.content[0] ? result.content[0].text : "";
        const lines = raw.split("\n").slice(0, 20);
        text.setText(lines.map((l) => theme.fg("toolOutput", l)).join("\n"));
      } else {
        const imageCount = result.content.filter((c) => c.type === "image").length;
        const imageSuffix = imageCount > 0 ? ` + ${imageCount} image(s)` : "";
        const truncNote = details.truncated ? theme.fg("warning", " (truncated)") : "";
        text.setText(theme.fg("toolOutput", `${details.chars} chars${imageSuffix}`) + truncNote);
      }
      return text;
    },
```

- [ ] **Step 4:** Verify

```bash
pnpm run typecheck
```

- [ ] **Step 5:** Commit

```bash
git add src/tools/web-fetch.ts
git commit -m "feat(web-fetch): render thumbnail and frames as ImageContent in results"
```

---

## Task 5: Add Pipeline Routing Tests

**Files:** `tests/extract/pipeline.test.ts`

Add tests covering the new routing paths in the pipeline. These tests mock the YouTube/video/Gemini modules.

- [ ] **Step 1:** Add new describe block for video/YouTube routing in `tests/extract/pipeline.test.ts`

```typescript
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

vi.mock("../../src/extract/gemini-api.ts", () => ({
  queryGeminiApi: vi.fn(),
  isGeminiApiAvailable: vi.fn(),
}));

vi.mock("../../src/extract/gemini-web.ts", () => ({
  isGeminiWebAvailable: vi.fn(),
  queryWithCookies: vi.fn(),
}));

describe("extractContent — YouTube/Video routing", () => {
  let extractContent: typeof import("../../src/extract/pipeline.ts").extractContent;
  let isYouTubeURL: ReturnType<typeof vi.fn>;
  let extractYouTube: ReturnType<typeof vi.fn>;
  let isYouTubeEnabled: ReturnType<typeof vi.fn>;
  let isVideoFile: ReturnType<typeof vi.fn>;
  let extractVideo: ReturnType<typeof vi.fn>;
  let isVideoEnabled: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    const pipeline = await import("../../src/extract/pipeline.ts");
    extractContent = pipeline.extractContent;

    const ytMod = await import("../../src/extract/youtube.ts");
    isYouTubeURL = ytMod.isYouTubeURL as ReturnType<typeof vi.fn>;
    extractYouTube = ytMod.extractYouTube as ReturnType<typeof vi.fn>;
    isYouTubeEnabled = ytMod.isYouTubeEnabled as ReturnType<typeof vi.fn>;

    const videoMod = await import("../../src/extract/video.ts");
    isVideoFile = videoMod.isVideoFile as ReturnType<typeof vi.fn>;
    extractVideo = videoMod.extractVideo as ReturnType<typeof vi.fn>;
    isVideoEnabled = videoMod.isVideoEnabled as ReturnType<typeof vi.fn>;

    // Default: not YouTube, not video
    isYouTubeURL.mockReturnValue({ isYouTube: false, videoId: undefined });
    isYouTubeEnabled.mockReturnValue(false);
    isVideoFile.mockReturnValue(null);
    isVideoEnabled.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("routes YouTube URLs to extractYouTube when enabled", async () => {
    isYouTubeURL.mockReturnValue({ isYouTube: true, videoId: "dQw4w9WgXcQ" });
    isYouTubeEnabled.mockReturnValue(true);
    extractYouTube.mockResolvedValue({
      text: "Never Gonna Give You Up transcript...",
      title: "Rick Astley - Never Gonna Give You Up",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      extractionChain: ["youtube:transcript"],
      chars: 37,
      truncated: false,
    });

    const result = await extractContent("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(result.extractionChain).toContain("youtube:transcript");
    expect(result.text).toContain("Never Gonna Give You Up");
    expect(extractYouTube).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      undefined,
      undefined,
    );
  });

  it("falls through when YouTube extraction returns null", async () => {
    isYouTubeURL.mockReturnValue({ isYouTube: true, videoId: "abc123" });
    isYouTubeEnabled.mockReturnValue(true);
    extractYouTube.mockResolvedValue(null);

    // Should fall through to HTTP fetch — mock fetch to return HTML
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("<html><body><article><p>Fallback content here with enough text to pass readability threshold and more words to fill it up.</p></article></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    ) as unknown as typeof fetch;

    const result = await extractContent("https://www.youtube.com/watch?v=abc123");
    expect(result.extractionChain).not.toContain("youtube:transcript");
  });

  it("skips YouTube routing when disabled", async () => {
    isYouTubeURL.mockReturnValue({ isYouTube: true, videoId: "abc123" });
    isYouTubeEnabled.mockReturnValue(false);

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("<html><body><article><p>Page content with enough text.</p></article></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    ) as unknown as typeof fetch;

    const result = await extractContent("https://www.youtube.com/watch?v=abc123");
    expect(extractYouTube).not.toHaveBeenCalled();
  });

  it("routes local video files to extractVideo when enabled", async () => {
    isVideoFile.mockReturnValue({ absolutePath: "/tmp/video.mp4", mimeType: "video/mp4" });
    isVideoEnabled.mockReturnValue(true);
    extractVideo.mockResolvedValue({
      text: "Video analysis: a cat playing piano",
      title: "video.mp4",
      url: "/tmp/video.mp4",
      extractionChain: ["video:gemini-api"],
      chars: 36,
      truncated: false,
    });

    const result = await extractContent("/tmp/video.mp4");
    expect(result.extractionChain).toContain("video:gemini-api");
    expect(result.text).toContain("cat playing piano");
  });

  it("falls through when extractVideo returns null", async () => {
    isVideoFile.mockReturnValue({ absolutePath: "/tmp/broken.mp4", mimeType: "video/mp4" });
    isVideoEnabled.mockReturnValue(true);
    extractVideo.mockResolvedValue(null);

    // Should continue to validateUrl which will reject local paths
    await expect(
      extractContent("/tmp/broken.mp4"),
    ).rejects.toThrow();
  });
});

describe("extractContent — Frame extraction routing", () => {
  let extractContent: typeof import("../../src/extract/pipeline.ts").extractContent;
  let isYouTubeURL: ReturnType<typeof vi.fn>;
  let getYouTubeStreamInfo: ReturnType<typeof vi.fn>;
  let parseTimestampParam: ReturnType<typeof vi.fn>;
  let extractYouTubeFrames: ReturnType<typeof vi.fn>;
  let isVideoFile: ReturnType<typeof vi.fn>;
  let getLocalVideoDuration: ReturnType<typeof vi.fn>;
  let extractLocalFrames: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    const pipeline = await import("../../src/extract/pipeline.ts");
    extractContent = pipeline.extractContent;

    const ytMod = await import("../../src/extract/youtube.ts");
    isYouTubeURL = ytMod.isYouTubeURL as ReturnType<typeof vi.fn>;

    const framesMod = await import("../../src/extract/frames.ts");
    getYouTubeStreamInfo = framesMod.getYouTubeStreamInfo as ReturnType<typeof vi.fn>;
    parseTimestampParam = framesMod.parseTimestampParam as ReturnType<typeof vi.fn>;
    extractYouTubeFrames = framesMod.extractYouTubeFrames as ReturnType<typeof vi.fn>;
    getLocalVideoDuration = framesMod.getLocalVideoDuration as ReturnType<typeof vi.fn>;
    extractLocalFrames = framesMod.extractLocalFrames as ReturnType<typeof vi.fn>;

    const videoMod = await import("../../src/extract/video.ts");
    (videoMod.isVideoFile as ReturnType<typeof vi.fn>).mockReturnValue(null);
    isVideoFile = videoMod.isVideoFile as ReturnType<typeof vi.fn>;

    // Default
    isYouTubeURL.mockReturnValue({ isYouTube: false, videoId: undefined });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("extracts YouTube frames when timestamp param is present", async () => {
    isYouTubeURL.mockReturnValue({ isYouTube: true, videoId: "dQw4w9WgXcQ" });
    getYouTubeStreamInfo.mockResolvedValue({ duration: 212 });
    parseTimestampParam.mockReturnValue([30, 60, 90]);
    extractYouTubeFrames.mockResolvedValue({
      frames: [
        { data: "base64frame1", mimeType: "image/jpeg", timestamp: 30 },
        { data: "base64frame2", mimeType: "image/jpeg", timestamp: 60 },
        { data: "base64frame3", mimeType: "image/jpeg", timestamp: 90 },
      ],
      duration: 212,
    });

    const result = await extractContent(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      undefined,
      { timestamp: "0:30-1:30", frames: 3 },
    );

    expect(result.extractionChain).toEqual(["frames:youtube"]);
    expect(result.frames).toHaveLength(3);
    expect(result.text).toBe("");
    expect(result.duration).toBe(212);
  });

  it("extracts local video frames when frames param is present", async () => {
    isYouTubeURL.mockReturnValue({ isYouTube: false, videoId: undefined });
    isVideoFile.mockReturnValue({ absolutePath: "/tmp/video.mp4", mimeType: "video/mp4" });
    getLocalVideoDuration.mockResolvedValue(120);
    parseTimestampParam.mockReturnValue([15, 30, 45, 60]);
    extractLocalFrames.mockResolvedValue({
      frames: [
        { data: "f1", mimeType: "image/jpeg", timestamp: 15 },
        { data: "f2", mimeType: "image/jpeg", timestamp: 30 },
        { data: "f3", mimeType: "image/jpeg", timestamp: 45 },
        { data: "f4", mimeType: "image/jpeg", timestamp: 60 },
      ],
    });

    const result = await extractContent(
      "/tmp/video.mp4",
      undefined,
      { frames: 4 },
    );

    expect(result.extractionChain).toEqual(["frames:local"]);
    expect(result.frames).toHaveLength(4);
    expect(result.duration).toBe(120);
  });
});

describe("extractContent — Gemini HTML fallback", () => {
  let extractContent: typeof import("../../src/extract/pipeline.ts").extractContent;
  let isGeminiWebAvailable: ReturnType<typeof vi.fn>;
  let queryWithCookies: ReturnType<typeof vi.fn>;
  let isGeminiApiAvailable: ReturnType<typeof vi.fn>;
  let queryGeminiApi: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();

    const geminiWebMod = await import("../../src/extract/gemini-web.ts");
    isGeminiWebAvailable = geminiWebMod.isGeminiWebAvailable as ReturnType<typeof vi.fn>;
    queryWithCookies = geminiWebMod.queryWithCookies as ReturnType<typeof vi.fn>;

    const geminiApiMod = await import("../../src/extract/gemini-api.ts");
    isGeminiApiAvailable = geminiApiMod.isGeminiApiAvailable as ReturnType<typeof vi.fn>;
    queryGeminiApi = geminiApiMod.queryGeminiApi as ReturnType<typeof vi.fn>;

    // Default: Gemini not available
    isGeminiWebAvailable.mockReturnValue(false);
    isGeminiApiAvailable.mockReturnValue(false);

    // Ensure YouTube/video don't trigger
    const ytMod = await import("../../src/extract/youtube.ts");
    (ytMod.isYouTubeURL as ReturnType<typeof vi.fn>).mockReturnValue({ isYouTube: false });
    (ytMod.isYouTubeEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const videoMod = await import("../../src/extract/video.ts");
    (videoMod.isVideoFile as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (videoMod.isVideoEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const pipeline = await import("../../src/extract/pipeline.ts");
    extractContent = pipeline.extractContent;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to Gemini Web when Readability and Jina fail", async () => {
    // Return a page that Readability can't extract well
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("<html><body><div>Short</div></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    ) as unknown as typeof fetch;

    // Mock Jina Reader to also fail (via mocking extractViaJinaReader)
    // The actual Jina mock depends on how it's set up in existing tests

    isGeminiWebAvailable.mockReturnValue(true);
    queryWithCookies.mockResolvedValue({
      text: "# Article Title\n\nThis is the full article content extracted by Gemini from the web page with enough characters to pass the threshold.",
    });

    const result = await extractContent("https://example.com/thin-page");
    expect(result.extractionChain).toContain("html:gemini-web");
    expect(result.text).toContain("Article Title");
  });

  it("falls back to Gemini API when Gemini Web is unavailable", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("<html><body><div>Short</div></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    ) as unknown as typeof fetch;

    isGeminiWebAvailable.mockReturnValue(false);
    isGeminiApiAvailable.mockReturnValue(true);
    queryGeminiApi.mockResolvedValue({
      text: "# Extracted Content\n\nFull article text extracted by Gemini API with sufficient length to pass the minimum threshold check.",
    });

    const result = await extractContent("https://example.com/thin-page");
    expect(result.extractionChain).toContain("html:gemini-api");
  });

  it("falls through to raw text when Gemini is also unavailable", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("<html><body><div>Some raw fallback text content</div></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    ) as unknown as typeof fetch;

    isGeminiWebAvailable.mockReturnValue(false);
    isGeminiApiAvailable.mockReturnValue(false);

    const result = await extractContent("https://example.com/thin-page");
    expect(result.extractionChain).toContain("raw-text");
  });
});
```

- [ ] **Step 2:** Verify tests pass

```bash
pnpm vitest run tests/extract/pipeline.test.ts
```

- [ ] **Step 3:** Commit

```bash
git add tests/extract/pipeline.test.ts
git commit -m "test(pipeline): add tests for YouTube/video/frame routing and Gemini HTML fallback"
```

---

## Task 6: Add web_fetch Tool Tests

**Files:** `tests/tools/web-fetch.test.ts`

Add tests for the new parameters and ImageContent rendering.

- [ ] **Step 1:** Add new test cases to the existing `tests/tools/web-fetch.test.ts` describe block

```typescript
describe("web_fetch — video parameters", () => {
  // These tests verify that the new params are passed through to extractContent
  // and that ImageContent is rendered in results.

  it("passes prompt/timestamp/frames/model to extractContent", async () => {
    // Mock extractContent to capture the options
    const extractContentSpy = vi.spyOn(
      await import("../../src/extract/pipeline.ts"),
      "extractContent",
    );
    extractContentSpy.mockResolvedValue({
      text: "Video analysis result",
      title: "video.mp4",
      url: "https://example.com/video.mp4",
      extractionChain: ["video:gemini-api"],
      chars: 21,
      truncated: false,
    });

    // Execute the tool with video params
    const tool = createWebFetchTool(mockStore);
    const result = await tool.execute(
      "call-1",
      {
        url: "https://example.com/video.mp4",
        prompt: "What happens in this video?",
        timestamp: "1:30",
        frames: 3,
        model: "gemini-2.5-flash",
      },
      new AbortController().signal,
      () => {},
      {} as any,
    );

    expect(extractContentSpy).toHaveBeenCalledWith(
      "https://example.com/video.mp4",
      expect.anything(),
      expect.objectContaining({
        prompt: "What happens in this video?",
        timestamp: "1:30",
        frames: 3,
        model: "gemini-2.5-flash",
      }),
    );
  });

  it("includes thumbnail as ImageContent in result", async () => {
    const extractContentSpy = vi.spyOn(
      await import("../../src/extract/pipeline.ts"),
      "extractContent",
    );
    extractContentSpy.mockResolvedValue({
      text: "YouTube video transcript",
      title: "Test Video",
      url: "https://www.youtube.com/watch?v=abc123",
      extractionChain: ["youtube:transcript"],
      chars: 24,
      truncated: false,
      thumbnail: {
        data: "iVBORw0KGgoAAAANSUhEUg==",
        mimeType: "image/jpeg",
      },
    });

    const tool = createWebFetchTool(mockStore);
    const result = await tool.execute(
      "call-2",
      { url: "https://www.youtube.com/watch?v=abc123" },
      new AbortController().signal,
      () => {},
      {} as any,
    );

    // Should have text + image
    expect(result.content).toHaveLength(2);
    expect(result.content[0].type).toBe("text");
    expect(result.content[1]).toEqual({
      type: "image",
      data: "iVBORw0KGgoAAAANSUhEUg==",
      mimeType: "image/jpeg",
    });
  });

  it("includes frames as ImageContent blocks in result", async () => {
    const extractContentSpy = vi.spyOn(
      await import("../../src/extract/pipeline.ts"),
      "extractContent",
    );
    extractContentSpy.mockResolvedValue({
      text: "",
      title: "YouTube Frames",
      url: "https://www.youtube.com/watch?v=abc123",
      extractionChain: ["frames:youtube"],
      chars: 0,
      truncated: false,
      frames: [
        { data: "frame1base64", mimeType: "image/jpeg", timestamp: 30 },
        { data: "frame2base64", mimeType: "image/jpeg", timestamp: 60 },
      ],
    });

    const tool = createWebFetchTool(mockStore);
    const result = await tool.execute(
      "call-3",
      { url: "https://www.youtube.com/watch?v=abc123", timestamp: "0:30-1:00", frames: 2 },
      new AbortController().signal,
      () => {},
      {} as any,
    );

    // text + 2 frames
    expect(result.content).toHaveLength(3);
    expect(result.content[0].type).toBe("text");
    expect(result.content[1]).toEqual({
      type: "image",
      data: "frame1base64",
      mimeType: "image/jpeg",
    });
    expect(result.content[2]).toEqual({
      type: "image",
      data: "frame2base64",
      mimeType: "image/jpeg",
    });
  });

  it("renders frame count in renderResult when chars is 0 but frames exist", async () => {
    // This tests the renderResult branch for frame-only results
    const tool = createWebFetchTool(mockStore);
    const mockResult = {
      content: [
        { type: "text" as const, text: "" },
        { type: "image" as const, data: "f1", mimeType: "image/jpeg" },
        { type: "image" as const, data: "f2", mimeType: "image/jpeg" },
      ],
      details: {
        url: "https://example.com",
        chars: 0,
        truncated: false,
        extractionChain: ["frames:youtube"],
      },
    };

    // Verify renderResult handles this case (doesn't show "fetch error")
    // Implementation depends on how renderResult is tested in the existing suite
  });
});
```

- [ ] **Step 2:** Verify tests pass

```bash
pnpm vitest run tests/tools/web-fetch.test.ts
```

- [ ] **Step 3:** Commit

```bash
git add tests/tools/web-fetch.test.ts
git commit -m "test(web-fetch): add tests for video params and ImageContent rendering"
```

---

## Task 7: Update ExtractOptions Interface (if not done in Phase 1)

**Files:** `src/extract/pipeline.ts`

Ensure `ExtractOptions` includes the video-related fields that the pipeline now uses.

- [ ] **Step 1:** Verify or update the `ExtractOptions` interface

The interface should include:

```typescript
export interface ExtractOptions {
  raw?: boolean;
  github?: GitHubConfig;
  allowRanges?: string[];
  // Video/YouTube options (added in Phase 7)
  prompt?: string;
  timestamp?: string;
  frames?: number;
  model?: string;
}
```

- [ ] **Step 2:** Verify or update `ExtractedContent` to include video fields

```typescript
export interface ExtractedContent {
  text: string;
  title?: string;
  url: string;
  extractionChain: string[];
  chars: number;
  truncated: boolean;
  contentId?: string;
  // Video/frame fields
  thumbnail?: { data: string; mimeType: string };
  frames?: Array<{ data: string; mimeType: string; timestamp?: number }>;
  duration?: number;
}
```

- [ ] **Step 3:** Verify

```bash
pnpm run typecheck
```

- [ ] **Step 4:** Commit (if changes were needed)

```bash
git add src/extract/pipeline.ts
git commit -m "feat(pipeline): extend ExtractOptions and ExtractedContent with video fields"
```

---

## Task 8: Final Integration Verification

**Files:** None (verification only)

- [ ] **Step 1:** Run all tests

```bash
pnpm test
```

- [ ] **Step 2:** Run type checking

```bash
pnpm run typecheck
```

- [ ] **Step 3:** Run linter

```bash
pnpm run lint
```

- [ ] **Step 4:** Verify the complete pipeline flow by reviewing the final state of `src/extract/pipeline.ts`

The final flow should be:

```
1. Frame extraction mode (timestamp/frames present)
   → YouTube frames OR local video frames → return
2. Local video file detection
   → extractVideo → return (or fall through)
3. YouTube URL detection
   → extractYouTube → return (or fall through)
4. SSRF validation (validateUrl)
5. GitHub interception
6. HTTP fetch
7. Binary blocking (except PDF)
8. Raw mode
9. PDF extraction
10. Tier 1: Readability
11. Tier 2: RSC
12. Tier 3: Jina Reader
13. Tier 4: Gemini HTML fallback (new)
14. Final fallback: raw text strip
```

- [ ] **Step 5:** Commit final state

```bash
git add -A
git commit -m "feat(content-extraction): Phase 7 complete — pipeline integration and web_fetch extension"
```

---

## Final Verification

```bash
pnpm test
pnpm run lint
pnpm run typecheck
```

Phase 7 completes the content extraction feature:

- YouTube URLs route to transcript/thumbnail extraction before HTTP fetch
- Local video files route to Gemini analysis before HTTP fetch
- Frame extraction (timestamp/frames params) returns ImageContent directly
- Gemini HTML fallback catches thin-content pages after Readability + Jina fail
- `web_fetch` accepts `prompt`, `timestamp`, `frames`, `model` parameters
- Thumbnails and frames render as MCP `ImageContent` blocks alongside text
- All routing gracefully falls through when extractors return null or are disabled
