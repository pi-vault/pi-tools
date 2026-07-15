# Content Extraction Phase 7: Pipeline Integration & web_fetch Extension

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire all extraction modules (Phases 1-6) into the pipeline and extend the `web_fetch` tool with video/YouTube parameters and ImageContent rendering.

**Architecture:**

- Route YouTube URLs, local video files, and frame extraction requests at the top of `extractContent()` before HTTP fetch
- Add Gemini HTML fallback (via `url_context` tool and Gemini Web) as a new tier after Jina Reader for pages where Readability extracted < 500 chars
- Extend `web_fetch` tool schema with `prompt`, `timestamp`, `frames`, `model` parameters
- Render `thumbnail` and `frames` as MCP `ImageContent` blocks in tool results

**Tech Stack:** TypeScript, Vitest, Typebox schema validation

**Spec:** `docs/superpowers/specs/2026-07-13-content-extraction-design.md`

---

## Prerequisites

- Phases 1-6 complete and all tests passing
- All extraction modules exist and export expected APIs:
  - Phase 1: `ExtractedContent`, `ExtractOptions`, `VideoFrame` types in `src/extract/pipeline.ts` and `src/config.ts`
  - Phase 2: `queryGeminiApi(prompt, videoUri, options?) -> Promise<string>`, `isGeminiApiAvailable() -> boolean`, `getApiKey() -> string|null`, `getVersionedApiBase() -> string` in `src/extract/gemini-api.ts`
  - Phase 3: `isGeminiWebAvailable() -> Promise<CookieMap|null>`, `queryWithCookies(prompt, cookieMap, options?) -> Promise<string>` in `src/extract/gemini-web.ts`
  - Phase 4: `isYouTubeURL(url) -> {isYouTube, videoId}`, `extractYouTube(url, signal?, options?) -> Promise<ExtractedContent|null>`, `isYouTubeEnabled() -> boolean` in `src/extract/youtube.ts`
  - Phase 5: `parseTimestampParam(timestamp?, frames?, duration?) -> number[]`, `extractYouTubeFrames(videoId, timestamps, signal?) -> Promise<{frames, duration, error}>`, `extractLocalFrames(filePath, timestamps, signal?) -> Promise<{frames, duration, error}>`, `getLocalVideoDuration(filePath) -> Promise<number|{error}>`, `getYouTubeStreamInfo(videoId) -> Promise<{streamUrl, duration}|{error}>` in `src/extract/frames.ts`
  - Phase 6: `isVideoFile(input) -> VideoFileInfo|null`, `extractVideo(info, signal?, options?) -> Promise<ExtractedContent|null>`, `isVideoEnabled() -> boolean` in `src/extract/video.ts`
- Verification: `pnpm test && pnpm run typecheck`

## Verification Commands

```bash
pnpm vitest run tests/extract/pipeline.test.ts tests/extract/gemini-url-context.test.ts tests/tools/web-fetch.test.ts
pnpm test
pnpm run lint
pnpm run typecheck
```

---

## Task 1: Restructure Pipeline with YouTube/Video/Frame Routing

**Files:** `src/extract/pipeline.ts`

This task moves `validateUrl()` down and adds three routing blocks at the top of `extractContent()`.

- [ ] **Step 1:** Add imports for YouTube, video, and frame modules

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

- [ ] **Step 2:** Restructure `extractContent()` — move `validateUrl()` after the new routing blocks

Replace the current function body structure. The new flow:

```typescript
export async function extractContent(
  url: string,
  signal?: AbortSignal,
  options?: ExtractOptions,
): Promise<ExtractedContent> {
  // --- Frame extraction mode (timestamp/frames params present) ---
  if (options?.timestamp || options?.frames) {
    const ytCheck = isYouTubeURL(url);
    if (ytCheck.isYouTube && ytCheck.videoId) {
      const streamInfo = await getYouTubeStreamInfo(ytCheck.videoId);
      if ("error" in streamInfo) {
        throw new Error(streamInfo.error);
      }
      const dur = typeof streamInfo.duration === "number" ? streamInfo.duration : undefined;
      const timestamps = parseTimestampParam(options.timestamp, options.frames, dur);
      const result = await extractYouTubeFrames(ytCheck.videoId, timestamps, signal);
      if (result.error && result.frames.length === 0) {
        throw new Error(result.error);
      }
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
      const durationResult = await getLocalVideoDuration(videoInfo.absolutePath);
      const dur = typeof durationResult === "number" ? durationResult : undefined;
      const timestamps = parseTimestampParam(options.timestamp, options.frames, dur);
      const result = await extractLocalFrames(videoInfo.absolutePath, timestamps, signal);
      if (result.error && result.frames.length === 0) {
        throw new Error(result.error);
      }
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
    // If neither YouTube nor local video, fall through to normal pipeline
  }

  // --- Local video file detection ---
  const videoInfo = isVideoFile(url);
  if (videoInfo && isVideoEnabled()) {
    const result = await extractVideo(videoInfo, signal, options);
    if (result) return result;
    // If extractVideo returns null, fall through to regular pipeline
  }

  // --- YouTube URL detection ---
  const ytParsed = isYouTubeURL(url);
  if (ytParsed.isYouTube && isYouTubeEnabled()) {
    const result = await extractYouTube(url, signal, options);
    if (result) return result;
    // If all YouTube extractors failed, fall through to regular HTTP fetch
  }

  // --- SSRF validation (after video/YouTube routing, before HTTP fetch) ---
  validateUrl(url, { allowRanges: options?.allowRanges });

  // GitHub interception: ... (existing code unchanged)
```

- [ ] **Step 3:** Verify the file compiles

```bash
pnpm run typecheck
```

- [ ] **Step 4:** Commit

```bash
git add src/extract/pipeline.ts
git commit -m "feat(pipeline): add YouTube/video/frame routing before HTTP fetch"
```

---

## Task 2: Add Gemini URL Context Module

**Files:** `src/extract/gemini-url-context.ts` (new file)

The Gemini `url_context` tool lets Gemini fetch and analyze a URL directly. This is the correct mechanism for HTML fallback (not `fileUri` which is for uploaded files/YouTube).

Reference: `nicobailon-pi-web-access/gemini-url-context.ts`

- [ ] **Step 1:** Create `src/extract/gemini-url-context.ts`

```typescript
import { getApiKey, getVersionedApiBase, isGeminiApiAvailable } from "./gemini-api.ts";
import { isGeminiWebAvailable, queryWithCookies } from "./gemini-web.ts";
import type { ExtractedContent } from "./pipeline.ts";

const EXTRACTION_PROMPT = `Extract the complete readable content from this URL as clean markdown.
Include the page title, all text content, code blocks, and tables.
Do not summarize — extract the full content.

URL: `;

interface UrlContextResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    url_context_metadata?: {
      url_metadata?: Array<{
        retrieved_url?: string;
        url_retrieval_status?: string;
      }>;
    };
  }>;
}

/**
 * Extract page content using Gemini API's url_context tool.
 * Gemini fetches the URL itself and returns extracted content.
 * Returns null if API is unavailable or extraction fails.
 */
export async function extractWithUrlContext(
  url: string,
  signal?: AbortSignal,
): Promise<ExtractedContent | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    const body = {
      contents: [{ role: "user", parts: [{ text: EXTRACTION_PROMPT + url }] }],
      tools: [{ url_context: {} }],
    };

    const effectiveSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(60_000)])
      : AbortSignal.timeout(60_000);

    const res = await fetch(
      `${getVersionedApiBase()}/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: effectiveSignal,
      },
    );

    if (!res.ok) return null;

    const data = (await res.json()) as UrlContextResponse;

    // Check URL retrieval status
    const metadata = data.candidates?.[0]?.url_context_metadata;
    if (metadata?.url_metadata?.length) {
      const status = metadata.url_metadata[0].url_retrieval_status;
      if (status === "URL_RETRIEVAL_STATUS_UNSAFE" || status === "URL_RETRIEVAL_STATUS_ERROR") {
        return null;
      }
    }

    const text = data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text)
      .filter(Boolean)
      .join("\n") ?? "";

    if (!text || text.length < 100) return null;

    const title = extractTitle(text, url);
    return {
      text,
      title,
      url,
      extractionChain: ["html:gemini-url-context"],
      chars: text.length,
      truncated: false,
    };
  } catch {
    return null;
  }
}

/**
 * Extract page content using Gemini Web (cookie-authenticated).
 * Appends the URL to the prompt — Gemini Web can browse URLs when given them in text.
 * Returns null if cookies are unavailable or extraction fails.
 */
export async function extractWithGeminiWeb(
  url: string,
  signal?: AbortSignal,
): Promise<ExtractedContent | null> {
  const cookies = await isGeminiWebAvailable();
  if (!cookies) return null;

  try {
    const text = await queryWithCookies(EXTRACTION_PROMPT + url, cookies, {
      model: "gemini-3-flash-preview",
      signal,
      timeoutMs: 60_000,
    });

    if (!text || text.length < 100) return null;

    const title = extractTitle(text, url);
    return {
      text,
      title,
      url,
      extractionChain: ["html:gemini-web"],
      chars: text.length,
      truncated: false,
    };
  } catch {
    return null;
  }
}

function extractTitle(text: string, url: string): string {
  const match = text.match(/^#\s+(.+)$/m);
  if (match) return match[1].trim();
  try {
    return new URL(url).pathname.split("/").pop() || url;
  } catch {
    return url;
  }
}
```

- [ ] **Step 2:** Verify compiles

```bash
pnpm run typecheck
```

- [ ] **Step 3:** Commit

```bash
git add src/extract/gemini-url-context.ts
git commit -m "feat(extract): add Gemini url_context module for HTML fallback"
```

---

## Task 3: Add Gemini HTML Fallback Tier to Pipeline

**Files:** `src/extract/pipeline.ts`

Insert the Gemini fallback tier after Jina Reader, before the raw text fallback.

- [ ] **Step 1:** Add import at the top of pipeline.ts

```typescript
import { extractWithUrlContext, extractWithGeminiWeb } from "./gemini-url-context.ts";
```

- [ ] **Step 2:** Insert the Gemini fallback tier after `chain.push("jina-reader:fail")`

Find the section after `chain.push("jina-reader:fail");` and before the raw text fallback:

```typescript
  chain.push("jina-reader:fail");

  // Tier 4: Gemini HTML fallback (for thin Readability + Jina failure)
  const geminiResult = await extractWithUrlContext(url, signal)
    ?? await extractWithGeminiWeb(url, signal);
  if (geminiResult) {
    chain.push(geminiResult.extractionChain[0]);
    return {
      ...geminiResult,
      extractionChain: chain,
    };
  }
  chain.push("gemini-html:fail");

  // Final fallback: raw text stripped of HTML
  const rawText = body
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
```

- [ ] **Step 3:** Verify

```bash
pnpm run typecheck
```

- [ ] **Step 4:** Commit

```bash
git add src/extract/pipeline.ts
git commit -m "feat(pipeline): add Gemini HTML fallback tier after Jina Reader"
```

---

## Task 4: Extend web_fetch Tool Parameters

**Files:** `src/tools/web-fetch.ts`

Add video-related parameters to the tool schema and pass them through to `extractContent()`.

- [ ] **Step 1:** Add new parameters to `WebFetchParams`

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

- [ ] **Step 2:** Update `executeSingleUrl` parameter type and `extractContent()` call

Update the `params` type in `executeSingleUrl` to include the new fields, and pass them through:

```typescript
  async function executeSingleUrl(
    url: string,
    params: { raw?: boolean; fresh?: boolean; prompt?: string; timestamp?: string; frames?: number; model?: string },
    signal: AbortSignal | undefined,
  ) {
    try {
      if (!params.fresh) {
        const cached = cache?.get(url);
        if (cached) {
          return buildResult(cached, url, store);
        }
      }

      const extracted = await extractContent(url, signal, {
        raw: params.raw,
        github: githubConfig,
        allowRanges: ssrfAllowRanges,
        prompt: params.prompt,
        timestamp: params.timestamp,
        frames: params.frames,
        model: params.model,
      });
      // ...rest unchanged
```

- [ ] **Step 3:** Update multi-URL path similarly

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

- [ ] **Step 4:** Update tool description

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

## Task 5: Add ImageContent Rendering to web_fetch Results

**Files:** `src/tools/web-fetch.ts`

When `extractContent()` returns a thumbnail or frames, render them as MCP `ImageContent` blocks alongside the text.

- [ ] **Step 1:** Update `buildResult` to accept and render image fields

Note: `ExtractedContent.frames` is `VideoFrame[]` where `VideoFrame = { data: string; mimeType: string; timestamp: string }`.

```typescript
function buildResult(
  extracted: ExtractedContent,
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

- [ ] **Step 2:** Update `renderResult` to handle frames-only results (chars === 0 but images present)

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
        const imageCount = result.content.filter((c: { type: string }) => c.type === "image").length;
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
        text.setText(lines.map((l: string) => theme.fg("toolOutput", l)).join("\n"));
      } else {
        const imageCount = result.content.filter((c: { type: string }) => c.type === "image").length;
        const imageSuffix = imageCount > 0 ? ` + ${imageCount} image(s)` : "";
        const truncNote = details.truncated ? theme.fg("warning", " (truncated)") : "";
        text.setText(theme.fg("toolOutput", `${details.chars} chars${imageSuffix}`) + truncNote);
      }
      return text;
    },
```

- [ ] **Step 3:** Verify

```bash
pnpm run typecheck
```

- [ ] **Step 4:** Commit

```bash
git add src/tools/web-fetch.ts
git commit -m "feat(web-fetch): render thumbnail and frames as ImageContent in results"
```

---

## Task 6: Add Gemini URL Context Tests

**Files:** `tests/extract/gemini-url-context.test.ts` (new file)

- [ ] **Step 1:** Create test file for the new module

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stubFetch } from "../helpers.ts";

describe("extractWithUrlContext", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
    process.env.GEMINI_API_KEY = "test-key";
  });

  afterEach(() => {
    fetchStub.restore();
    delete process.env.GEMINI_API_KEY;
  });

  it("returns extracted content on success", async () => {
    const { extractWithUrlContext } = await import("../../src/extract/gemini-url-context.ts");

    fetchStub.addResponse("generativelanguage.googleapis.com", {
      body: {
        candidates: [{
          content: {
            parts: [{ text: "# Page Title\n\nExtracted page content with enough text to pass the threshold check easily." }],
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
  });

  it("returns null when API key is missing", async () => {
    delete process.env.GEMINI_API_KEY;
    // Need fresh import to pick up env change
    const { _resetConfigCache } = await import("../../src/extract/gemini-api.ts");
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
});

describe("extractWithGeminiWeb", () => {
  // These tests require mocking isGeminiWebAvailable and queryWithCookies
  // which depend on Chrome cookie access. Skip in CI, test manually.
  it.skip("returns content when Gemini Web is available", () => {
    // Integration test: requires real cookies
  });
});
```

- [ ] **Step 2:** Run tests

```bash
pnpm vitest run tests/extract/gemini-url-context.test.ts
```

- [ ] **Step 3:** Commit

```bash
git add tests/extract/gemini-url-context.test.ts
git commit -m "test(extract): add tests for gemini-url-context module"
```

---

## Task 7: Add Pipeline Routing Tests

**Files:** `tests/extract/pipeline-routing.test.ts` (new file — separate from existing pipeline.test.ts to avoid mock conflicts)

Tests covering the new routing paths. Uses `vi.mock()` to intercept module imports.

- [ ] **Step 1:** Create the test file

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
  formatSeconds: vi.fn((s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`),
}));

vi.mock("../../src/extract/gemini-url-context.ts", () => ({
  extractWithUrlContext: vi.fn(),
  extractWithGeminiWeb: vi.fn(),
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

    // Re-import after reset so mocks are applied
    const ytMod = await import("../../src/extract/youtube.ts");
    isYouTubeURL = ytMod.isYouTubeURL as ReturnType<typeof vi.fn>;
    extractYouTube = ytMod.extractYouTube as ReturnType<typeof vi.fn>;
    isYouTubeEnabled = ytMod.isYouTubeEnabled as ReturnType<typeof vi.fn>;

    const videoMod = await import("../../src/extract/video.ts");
    isVideoFile = videoMod.isVideoFile as ReturnType<typeof vi.fn>;
    extractVideo = videoMod.extractVideo as ReturnType<typeof vi.fn>;
    isVideoEnabled = videoMod.isVideoEnabled as ReturnType<typeof vi.fn>;

    // Default: not YouTube, not video
    isYouTubeURL.mockReturnValue({ isYouTube: false, videoId: null });
    isYouTubeEnabled.mockReturnValue(false);
    isVideoFile.mockReturnValue(null);
    isVideoEnabled.mockReturnValue(false);

    const pipeline = await import("../../src/extract/pipeline.ts");
    extractContent = pipeline.extractContent;
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
      extractionChain: ["youtube:gemini-web"],
      chars: 37,
      truncated: false,
    });

    const result = await extractContent("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(result.extractionChain).toContain("youtube:gemini-web");
    expect(result.text).toContain("Never Gonna Give You Up");
    expect(extractYouTube).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      undefined, // signal
      undefined, // options (no prompt/model passed)
    );
  });

  it("falls through when YouTube extraction returns null", async () => {
    isYouTubeURL.mockReturnValue({ isYouTube: true, videoId: "abc123" });
    isYouTubeEnabled.mockReturnValue(true);
    extractYouTube.mockResolvedValue(null);

    // Should fall through to validateUrl -> HTTP fetch
    // Mock fetch to return HTML for the fallthrough path
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        `<html><body><article><p>${"Fallback content. ".repeat(30)}</p></article></body></html>`,
        { status: 200, headers: { "content-type": "text/html" } },
      ),
    ) as unknown as typeof fetch;

    try {
      const result = await extractContent("https://www.youtube.com/watch?v=abc123");
      expect(result.extractionChain).not.toContain("youtube:gemini-web");
      expect(result.extractionChain).toContain("http:200");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("skips YouTube routing when disabled", async () => {
    isYouTubeURL.mockReturnValue({ isYouTube: true, videoId: "abc123" });
    isYouTubeEnabled.mockReturnValue(false);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        `<html><body><article><p>${"Page content. ".repeat(30)}</p></article></body></html>`,
        { status: 200, headers: { "content-type": "text/html" } },
      ),
    ) as unknown as typeof fetch;

    try {
      const result = await extractContent("https://www.youtube.com/watch?v=abc123");
      expect(extractYouTube).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("routes local video files to extractVideo when enabled", async () => {
    isVideoFile.mockReturnValue({ absolutePath: "/tmp/video.mp4", mimeType: "video/mp4", sizeBytes: 1024 });
    isVideoEnabled.mockReturnValue(true);
    extractVideo.mockResolvedValue({
      text: "Video analysis: a cat playing piano",
      title: "video.mp4",
      url: "file:///tmp/video.mp4",
      extractionChain: ["gemini-api"],
      chars: 36,
      truncated: false,
    });

    const result = await extractContent("/tmp/video.mp4");
    expect(result.text).toContain("cat playing piano");
    expect(extractVideo).toHaveBeenCalled();
  });

  it("falls through when extractVideo returns null", async () => {
    isVideoFile.mockReturnValue({ absolutePath: "/tmp/broken.mp4", mimeType: "video/mp4", sizeBytes: 1024 });
    isVideoEnabled.mockReturnValue(true);
    extractVideo.mockResolvedValue(null);

    // After video fallthrough, validateUrl will reject the local path
    await expect(extractContent("/tmp/broken.mp4")).rejects.toThrow();
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

    const ytMod = await import("../../src/extract/youtube.ts");
    isYouTubeURL = ytMod.isYouTubeURL as ReturnType<typeof vi.fn>;
    (ytMod.isYouTubeEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const framesMod = await import("../../src/extract/frames.ts");
    getYouTubeStreamInfo = framesMod.getYouTubeStreamInfo as ReturnType<typeof vi.fn>;
    parseTimestampParam = framesMod.parseTimestampParam as ReturnType<typeof vi.fn>;
    extractYouTubeFrames = framesMod.extractYouTubeFrames as ReturnType<typeof vi.fn>;
    getLocalVideoDuration = framesMod.getLocalVideoDuration as ReturnType<typeof vi.fn>;
    extractLocalFrames = framesMod.extractLocalFrames as ReturnType<typeof vi.fn>;

    const videoMod = await import("../../src/extract/video.ts");
    isVideoFile = videoMod.isVideoFile as ReturnType<typeof vi.fn>;
    (videoMod.isVideoEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false);

    // Default
    isYouTubeURL.mockReturnValue({ isYouTube: false, videoId: null });
    isVideoFile.mockReturnValue(null);

    const pipeline = await import("../../src/extract/pipeline.ts");
    extractContent = pipeline.extractContent;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("extracts YouTube frames when timestamp param is present", async () => {
    isYouTubeURL.mockReturnValue({ isYouTube: true, videoId: "dQw4w9WgXcQ" });
    getYouTubeStreamInfo.mockResolvedValue({ streamUrl: "https://stream.example.com/video", duration: 212 });
    parseTimestampParam.mockReturnValue([30, 60, 90]);
    extractYouTubeFrames.mockResolvedValue({
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
      { timestamp: "0:30-1:30", frames: 3 },
    );

    expect(result.extractionChain).toEqual(["frames:youtube"]);
    expect(result.frames).toHaveLength(3);
    expect(result.text).toBe("");
    expect(result.duration).toBe(212);
  });

  it("throws when getYouTubeStreamInfo returns error", async () => {
    isYouTubeURL.mockReturnValue({ isYouTube: true, videoId: "bad123" });
    getYouTubeStreamInfo.mockResolvedValue({ error: "Video is private or unavailable" });

    await expect(
      extractContent("https://www.youtube.com/watch?v=bad123", undefined, { timestamp: "0:30" }),
    ).rejects.toThrow("Video is private or unavailable");
  });

  it("extracts local video frames when frames param is present", async () => {
    isYouTubeURL.mockReturnValue({ isYouTube: false, videoId: null });
    isVideoFile.mockReturnValue({ absolutePath: "/tmp/video.mp4", mimeType: "video/mp4", sizeBytes: 1024 });
    getLocalVideoDuration.mockResolvedValue(120);
    parseTimestampParam.mockReturnValue([15, 30, 45, 60]);
    extractLocalFrames.mockResolvedValue({
      frames: [
        { data: "f1", mimeType: "image/jpeg", timestamp: "0:15" },
        { data: "f2", mimeType: "image/jpeg", timestamp: "0:30" },
        { data: "f3", mimeType: "image/jpeg", timestamp: "0:45" },
        { data: "f4", mimeType: "image/jpeg", timestamp: "1:00" },
      ],
      duration: 120,
      error: null,
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

  it("throws when all frames fail to extract", async () => {
    isYouTubeURL.mockReturnValue({ isYouTube: true, videoId: "abc123" });
    getYouTubeStreamInfo.mockResolvedValue({ streamUrl: "https://stream.example.com/video", duration: 100 });
    parseTimestampParam.mockReturnValue([30]);
    extractYouTubeFrames.mockResolvedValue({
      frames: [],
      duration: 100,
      error: "Stream URL returned 403 — may have expired, try again",
    });

    await expect(
      extractContent("https://www.youtube.com/watch?v=abc123", undefined, { timestamp: "0:30" }),
    ).rejects.toThrow("403");
  });
});
```

- [ ] **Step 2:** Verify tests pass

```bash
pnpm vitest run tests/extract/pipeline-routing.test.ts
```

- [ ] **Step 3:** Commit

```bash
git add tests/extract/pipeline-routing.test.ts
git commit -m "test(pipeline): add routing tests for YouTube/video/frame paths"
```

---

## Task 8: Add web_fetch Tool Tests for Video Parameters

**Files:** `tests/tools/web-fetch.test.ts`

Add tests for the new parameters and ImageContent rendering to the existing test file.

- [ ] **Step 1:** Add new describe block at the end of `tests/tools/web-fetch.test.ts`

```typescript
describe("web_fetch — video parameters and ImageContent", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("passes prompt/timestamp/frames/model through to extractContent", async () => {
    // Mock a YouTube-like response with thumbnail
    // extractContent is called internally — we test end-to-end via the tool
    // by checking that YouTube routing activates and returns expected fields
    fetchStub.addResponse("youtube.com", {
      status: 200,
      body: `<html><body><article><p>${"Content. ".repeat(30)}</p></article></body></html>`,
      headers: { "content-type": "text/html" },
    });

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    const ctx = makeCtx();

    // This tests the parameter schema accepts the new fields without error
    const result = await tool.execute(
      "call-vid-1",
      { url: "https://example.com/page", prompt: "Summarize", model: "gemini-3-flash-preview" },
      undefined,
      undefined,
      ctx,
    );
    // Should succeed (normal extraction since it's not actually a video)
    expect(result.content[0]).toHaveProperty("type", "text");
  });

  it("renders thumbnail as ImageContent when present", async () => {
    // This requires mocking extractContent to return a thumbnail
    // We'll use vi.mock for this specific test
    const { extractContent: realExtract } = await import("../../src/extract/pipeline.ts");
    const extractSpy = vi.spyOn(
      await import("../../src/extract/pipeline.ts"),
      "extractContent",
    ).mockResolvedValue({
      text: "YouTube video transcript",
      title: "Test Video",
      url: "https://www.youtube.com/watch?v=abc123",
      extractionChain: ["youtube:gemini-web"],
      chars: 24,
      truncated: false,
      thumbnail: {
        data: "iVBORw0KGgoAAAANSUhEUg==",
        mimeType: "image/jpeg",
      },
    });

    try {
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

      // Should have text + thumbnail image
      expect(result.content.length).toBe(2);
      expect(result.content[0].type).toBe("text");
      expect(result.content[1]).toEqual({
        type: "image",
        data: "iVBORw0KGgoAAAANSUhEUg==",
        mimeType: "image/jpeg",
      });
    } finally {
      extractSpy.mockRestore();
    }
  });

  it("renders frames as ImageContent blocks", async () => {
    const extractSpy = vi.spyOn(
      await import("../../src/extract/pipeline.ts"),
      "extractContent",
    ).mockResolvedValue({
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

    try {
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

      // text + 2 frame images
      expect(result.content.length).toBe(3);
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
    } finally {
      extractSpy.mockRestore();
    }
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

## Task 9: Final Integration Verification

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
   -> YouTube frames OR local video frames -> return
2. Local video file detection
   -> extractVideo -> return (or fall through)
3. YouTube URL detection
   -> extractYouTube -> return (or fall through)
4. SSRF validation (validateUrl)
5. GitHub interception
6. HTTP fetch
7. Binary blocking (except PDF)
8. Raw mode
9. PDF extraction
10. Tier 1: Readability
11. Tier 2: RSC
12. Tier 3: Jina Reader
13. Tier 4: Gemini HTML fallback (url_context + Gemini Web)
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
- Gemini HTML fallback uses `url_context` tool (API) or cookie-based browsing (Web) to extract thin-content pages
- `web_fetch` accepts `prompt`, `timestamp`, `frames`, `model` parameters
- Thumbnails and frames render as MCP `ImageContent` blocks alongside text
- All routing gracefully falls through when extractors return null or are disabled
