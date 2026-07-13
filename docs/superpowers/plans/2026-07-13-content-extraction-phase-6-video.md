# Content Extraction Phase 6: Local Video File Detection & Analysis

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `src/extract/video.ts` — local video file detection, Gemini Files API upload, and video content analysis via Gemini API/Web fallback.

**Architecture:** Two-step pattern: `isVideoFile()` detects and validates local video files, `extractVideo()` uploads to Gemini Files API for analysis with Gemini Web as fallback. Auto-thumbnail extraction via ffmpeg is non-blocking bonus output.

**Tech Stack:** TypeScript, Vitest, native `fetch`, `node:fs`, `node:path`, `node:child_process` (execFileSync for ffmpeg)

**Spec:** `docs/superpowers/specs/2026-07-13-content-extraction-design.md` (Local Video Extraction section)

---

## Prerequisites

- Phases 1-5 complete (config types, gemini-api, gemini-web, youtube, frames)
- Available from Phase 1: `VideoConfig`, `DEFAULT_VIDEO_CONFIG` from `src/config.ts`
- Available from Phase 1: `ExtractedContent`, `ExtractOptions` from `src/extract/pipeline.ts`
- Available from Phase 2: `queryGeminiApi`, `getApiKey`, `getVersionedApiBase` from `src/extract/gemini-api.ts`
- Available from Phase 3: `isGeminiWebAvailable`, `queryWithCookies` from `src/extract/gemini-web.ts`
- All tests passing: `pnpm test`

## Exports

```typescript
export interface VideoFileInfo {
  absolutePath: string;
  mimeType: string;
  sizeBytes: number;
}

export function isVideoFile(input: string): VideoFileInfo | null;
export function isVideoEnabled(): boolean;
export async function extractVideo(
  info: VideoFileInfo,
  signal?: AbortSignal,
  options?: ExtractOptions,
): Promise<ExtractedContent | null>;
```

## Verification Commands

```bash
pnpm vitest run tests/extract/video.test.ts   # video unit tests
pnpm test                                      # full suite
pnpm run lint
pnpm run typecheck
```

---

## Task 1: Create `src/extract/video.ts` with Video Extensions and `isVideoFile()`

**Files:** `src/extract/video.ts`

- [ ] **Step 1:** Create `src/extract/video.ts` with imports, VIDEO_EXTENSIONS map, and `isVideoFile()` function

```typescript
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig } from "../config.ts";
import type { ExtractedContent, ExtractOptions } from "./pipeline.ts";
import { queryGeminiApi, getApiKey, getVersionedApiBase } from "./gemini-api.ts";
import { isGeminiWebAvailable, queryWithCookies } from "./gemini-web.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VideoFileInfo {
  absolutePath: string;
  mimeType: string;
  sizeBytes: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VIDEO_EXTENSIONS: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
  ".wmv": "video/x-ms-wmv",
  ".flv": "video/x-flv",
  ".3gp": "video/3gpp",
};

const DEFAULT_PROMPT = `Extract the complete content of this video. Include:
1. Video title (infer from content if not explicit), duration
2. A brief summary (2-3 sentences)
3. Full transcript with timestamps
4. Descriptions of any code, terminal commands, diagrams, slides, or UI shown on screen

Format as markdown.`;

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Check if video extraction is enabled in config.
 */
export function isVideoEnabled(): boolean {
  const config = loadConfig();
  return config.video?.enabled !== false;
}

/**
 * Detect whether an input string refers to a valid local video file.
 * Returns file info if valid, null otherwise.
 *
 * Checks:
 * 1. Config enabled
 * 2. Path starts with `/`, `./`, `../`, or `file://`
 * 3. Extension matches VIDEO_EXTENSIONS
 * 4. File exists on disk
 * 5. Size within config.video.maxSizeMB limit
 */
export function isVideoFile(input: string): VideoFileInfo | null {
  if (!isVideoEnabled()) return null;

  // Must look like a local path
  const isLocalPath =
    input.startsWith("/") ||
    input.startsWith("./") ||
    input.startsWith("../") ||
    input.startsWith("file://");
  if (!isLocalPath) return null;

  // Handle file:// URL decoding
  let filePath = input;
  if (filePath.startsWith("file://")) {
    try {
      filePath = decodeURIComponent(filePath.slice("file://".length));
    } catch {
      return null;
    }
  }

  // Unicode space normalization (non-breaking space → regular space)
  filePath = filePath.replace(/\u00A0/g, " ");

  // Check extension
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = VIDEO_EXTENSIONS[ext];
  if (!mimeType) return null;

  // Resolve to absolute path
  const absolutePath = path.resolve(filePath);

  // Check file exists and get size
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absolutePath);
  } catch {
    return null;
  }

  if (!stat.isFile()) return null;

  // Check size limit
  const config = loadConfig();
  const maxSizeMB = config.video?.maxSizeMB ?? 50;
  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  if (stat.size > maxSizeBytes) return null;

  return { absolutePath, mimeType, sizeBytes: stat.size };
}
```

- [ ] **Step 2:** Verify file compiles

```bash
pnpm run typecheck
```

---

## Task 2: Implement `uploadToFilesApi()` and `pollFileState()`

**Files:** `src/extract/video.ts`

- [ ] **Step 1:** Add `uploadToFilesApi()` — resumable upload to Gemini Files API

```typescript
// ---------------------------------------------------------------------------
// Gemini Files API Helpers (internal)
// ---------------------------------------------------------------------------

interface FileUploadResult {
  name: string;
  uri: string;
}

/**
 * Upload a video file to Gemini Files API using resumable upload protocol.
 * Returns the file name and URI for use in generateContent requests.
 */
async function uploadToFilesApi(
  info: VideoFileInfo,
  apiKey: string,
  signal?: AbortSignal,
): Promise<FileUploadResult> {
  const uploadBase = "https://generativelanguage.googleapis.com/upload/v1beta/files";

  // Step 1: Initiate resumable upload
  const initResponse = await fetch(`${uploadBase}?key=${apiKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(info.sizeBytes),
      "X-Goog-Upload-Header-Content-Type": info.mimeType,
    },
    body: JSON.stringify({
      file: { displayName: path.basename(info.absolutePath) },
    }),
    signal,
  });

  if (!initResponse.ok) {
    throw new Error(
      `Files API upload init failed: ${initResponse.status} ${initResponse.statusText}`,
    );
  }

  const uploadUrl = initResponse.headers.get("x-goog-upload-url");
  if (!uploadUrl) {
    throw new Error("Files API upload init: missing x-goog-upload-url header");
  }

  // Step 2: Upload file data
  const fileData = fs.readFileSync(info.absolutePath);
  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Length": String(info.sizeBytes),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: fileData,
    signal,
  });

  if (!uploadResponse.ok) {
    throw new Error(
      `Files API upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`,
    );
  }

  const result = (await uploadResponse.json()) as { file?: { name?: string; uri?: string } };
  const name = result.file?.name;
  const uri = result.file?.uri;
  if (!name || !uri) {
    throw new Error("Files API upload: missing name or uri in response");
  }

  return { name, uri };
}
```

- [ ] **Step 2:** Add `pollFileState()` — poll until file is ACTIVE or timeout

```typescript
/**
 * Poll Gemini Files API until file state is ACTIVE.
 * Throws on FAILED state or timeout.
 */
async function pollFileState(
  fileName: string,
  apiKey: string,
  signal?: AbortSignal,
  timeoutMs = 120_000,
): Promise<void> {
  const apiBase = getVersionedApiBase();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (signal?.aborted) {
      throw new Error("pollFileState aborted");
    }

    const response = await fetch(`${apiBase}/${fileName}?key=${apiKey}`, {
      signal,
    });

    if (!response.ok) {
      throw new Error(`pollFileState: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { state?: string; error?: { message?: string } };

    if (data.state === "ACTIVE") return;
    if (data.state === "FAILED") {
      throw new Error(`File processing failed: ${data.error?.message ?? "unknown error"}`);
    }

    // Wait 5 seconds before next poll
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }

  throw new Error(`pollFileState: timed out after ${timeoutMs}ms`);
}
```

- [ ] **Step 3:** Add `deleteGeminiFile()` — fire-and-forget cleanup

```typescript
/**
 * Delete an uploaded file from Gemini Files API.
 * Fire-and-forget: errors are logged but not thrown.
 */
function deleteGeminiFile(fileName: string, apiKey: string): void {
  const apiBase = getVersionedApiBase();
  fetch(`${apiBase}/${fileName}?key=${apiKey}`, { method: "DELETE" }).catch((err) => {
    console.error(`[video] Failed to delete file ${fileName}:`, err?.message ?? err);
  });
}
```

- [ ] **Step 4:** Verify file compiles

```bash
pnpm run typecheck
```

---

## Task 3: Implement `extractVideoFrame()` and `extractHeadingTitle()`

**Files:** `src/extract/video.ts`

- [ ] **Step 1:** Add `extractVideoFrame()` — ffmpeg thumbnail at given timestamp

```typescript
// ---------------------------------------------------------------------------
// Auto-Thumbnail
// ---------------------------------------------------------------------------

interface FrameResult {
  data: string; // base64
  mimeType: "image/jpeg";
}

/**
 * Extract a single video frame at the specified timestamp via ffmpeg.
 * Returns base64 JPEG data or null on failure.
 * Non-blocking: ffmpeg failure does NOT affect the main extraction result.
 */
function extractVideoFrame(
  filePath: string,
  seconds = 1,
): FrameResult | null {
  try {
    const buffer = execFileSync(
      "ffmpeg",
      [
        "-ss", String(seconds),
        "-i", filePath,
        "-frames:v", "1",
        "-f", "image2pipe",
        "-vcodec", "mjpeg",
        "pipe:1",
      ],
      { maxBuffer: 5 * 1024 * 1024, timeout: 10_000 },
    );
    return { data: buffer.toString("base64"), mimeType: "image/jpeg" };
  } catch {
    return null;
  }
}
```

- [ ] **Step 2:** Add `extractHeadingTitle()` — extract first markdown heading as title

```typescript
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the first `# ` heading from markdown text as a title.
 * Returns null if no heading found.
 */
function extractHeadingTitle(text: string): string | null {
  const match = text.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}
```

- [ ] **Step 3:** Verify file compiles

```bash
pnpm run typecheck
```

---

## Task 4: Implement `extractVideo()` Main Function

**Files:** `src/extract/video.ts`

- [ ] **Step 1:** Add the main `extractVideo()` function with Gemini API primary path and Gemini Web fallback

```typescript
// ---------------------------------------------------------------------------
// Main Extraction
// ---------------------------------------------------------------------------

/**
 * Extract content from a local video file using Gemini.
 *
 * Fallback chain:
 * 1. Gemini API (Files API upload → poll → query → delete)
 * 2. Gemini Web (cookie-authenticated, file attachment)
 *
 * Returns ExtractedContent on success, null if all methods fail.
 */
export async function extractVideo(
  info: VideoFileInfo,
  signal?: AbortSignal,
  options?: ExtractOptions,
): Promise<ExtractedContent | null> {
  const config = loadConfig();
  const effectivePrompt = (options as Record<string, unknown>)?.prompt as string | undefined
    ?? DEFAULT_PROMPT;
  const effectiveModel = config.video?.preferredModel ?? "gemini-3-flash-preview";

  let text: string | null = null;
  const chain: string[] = [];

  // ----- Strategy 1: Gemini API (Files API) -----
  const apiKey = getApiKey();
  if (apiKey) {
    try {
      // Upload
      const uploaded = await uploadToFilesApi(info, apiKey, signal);
      chain.push("gemini-files-upload");

      // Poll until ready
      await pollFileState(uploaded.name, apiKey, signal);
      chain.push("gemini-files-poll");

      // Query with file reference
      const response = await queryGeminiApi(effectivePrompt, {
        model: effectiveModel,
        apiKey,
        signal,
        fileUri: uploaded.uri,
        fileMimeType: info.mimeType,
      });
      text = response;
      chain.push("gemini-api");

      // Cleanup (fire-and-forget)
      deleteGeminiFile(uploaded.name, apiKey);
    } catch (err) {
      console.error(
        `[video] Gemini API failed for ${info.absolutePath}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // ----- Strategy 2: Gemini Web fallback -----
  if (!text && isGeminiWebAvailable()) {
    try {
      const webResult = await queryWithCookies(effectivePrompt, {
        files: [info.absolutePath],
        signal,
      });
      if (webResult) {
        text = webResult;
        chain.push("gemini-web");
      }
    } catch (err) {
      console.error(
        `[video] Gemini Web failed for ${info.absolutePath}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (!text) return null;

  // ----- Auto-thumbnail (non-blocking) -----
  const thumbnail = extractVideoFrame(info.absolutePath, 1);

  // ----- Build result -----
  const title = extractHeadingTitle(text) ?? path.basename(info.absolutePath);

  const result: ExtractedContent = {
    text,
    title,
    url: `file://${info.absolutePath}`,
    extractionChain: chain,
    chars: text.length,
    truncated: false,
  };

  // Attach thumbnail if available (extended field)
  if (thumbnail) {
    (result as Record<string, unknown>).thumbnail = thumbnail;
  }

  return result;
}
```

- [ ] **Step 2:** Verify file compiles

```bash
pnpm run typecheck
```

---

## Task 5: Create `tests/extract/video.test.ts` — `isVideoFile()` Tests

**Files:** `tests/extract/video.test.ts`

- [ ] **Step 1:** Create test file with `isVideoFile()` test suite

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { isVideoFile, isVideoEnabled } from "../../src/extract/video.ts";

// Mock config module
vi.mock("../../src/config.ts", () => ({
  loadConfig: vi.fn(() => ({
    video: { enabled: true, maxSizeMB: 50 },
  })),
}));

// We need to import the mock to change return values per test
import { loadConfig } from "../../src/config.ts";
const mockLoadConfig = vi.mocked(loadConfig);

describe("isVideoFile", () => {
  beforeEach(() => {
    mockLoadConfig.mockReturnValue({
      video: { enabled: true, maxSizeMB: 50 },
    } as ReturnType<typeof loadConfig>);
  });

  it("detects a valid .mp4 path", () => {
    const testPath = "/tmp/test-video.mp4";
    // Create a temporary file for the test
    fs.writeFileSync(testPath, Buffer.alloc(1024));

    try {
      const result = isVideoFile(testPath);
      expect(result).not.toBeNull();
      expect(result!.absolutePath).toBe(testPath);
      expect(result!.mimeType).toBe("video/mp4");
      expect(result!.sizeBytes).toBe(1024);
    } finally {
      fs.unlinkSync(testPath);
    }
  });

  it("detects relative paths starting with ./", () => {
    const testPath = "/tmp/test-rel-video.webm";
    fs.writeFileSync(testPath, Buffer.alloc(512));

    // Mock path.resolve to handle relative paths
    const spy = vi.spyOn(path, "resolve").mockReturnValue(testPath);

    try {
      const result = isVideoFile("./test-rel-video.webm");
      expect(result).not.toBeNull();
      expect(result!.mimeType).toBe("video/webm");
    } finally {
      spy.mockRestore();
      fs.unlinkSync(testPath);
    }
  });

  it("handles file:// URLs with decoding", () => {
    const testPath = "/tmp/my video file.mp4";
    fs.writeFileSync(testPath, Buffer.alloc(256));

    try {
      const result = isVideoFile("file:///tmp/my%20video%20file.mp4");
      expect(result).not.toBeNull();
      expect(result!.absolutePath).toBe(testPath);
      expect(result!.mimeType).toBe("video/mp4");
    } finally {
      fs.unlinkSync(testPath);
    }
  });

  it("returns null for non-video extensions", () => {
    expect(isVideoFile("/tmp/document.pdf")).toBeNull();
    expect(isVideoFile("/tmp/image.png")).toBeNull();
    expect(isVideoFile("/tmp/script.ts")).toBeNull();
  });

  it("returns null for HTTP URLs", () => {
    expect(isVideoFile("https://example.com/video.mp4")).toBeNull();
    expect(isVideoFile("http://example.com/file.mov")).toBeNull();
  });

  it("returns null when file does not exist", () => {
    expect(isVideoFile("/nonexistent/path/video.mp4")).toBeNull();
  });

  it("returns null when file exceeds maxSizeMB", () => {
    const testPath = "/tmp/test-big-video.mp4";
    // Write file larger than 50MB limit (write just enough to test the check)
    // We'll mock statSync instead to avoid creating a large file
    const statSpy = vi.spyOn(fs, "statSync").mockReturnValue({
      isFile: () => true,
      size: 60 * 1024 * 1024, // 60MB > 50MB limit
    } as unknown as fs.Stats);

    try {
      const result = isVideoFile(testPath);
      expect(result).toBeNull();
    } finally {
      statSpy.mockRestore();
    }
  });

  it("returns null when video is disabled in config", () => {
    mockLoadConfig.mockReturnValue({
      video: { enabled: false, maxSizeMB: 50 },
    } as ReturnType<typeof loadConfig>);

    expect(isVideoFile("/tmp/video.mp4")).toBeNull();
  });

  it("handles Unicode non-breaking spaces in paths", () => {
    const testPath = "/tmp/test video.mp4"; // regular space
    fs.writeFileSync(testPath, Buffer.alloc(128));

    try {
      // Input has non-breaking space (\u00A0) which should be normalized
      const result = isVideoFile("/tmp/test\u00A0video.mp4");
      expect(result).not.toBeNull();
      expect(result!.absolutePath).toBe(testPath);
    } finally {
      fs.unlinkSync(testPath);
    }
  });

  it("recognizes all supported extensions", () => {
    const extensions = [".mp4", ".mov", ".webm", ".avi", ".mpeg", ".mpg", ".wmv", ".flv", ".3gp"];
    const statSpy = vi.spyOn(fs, "statSync").mockReturnValue({
      isFile: () => true,
      size: 1024,
    } as unknown as fs.Stats);

    try {
      for (const ext of extensions) {
        const result = isVideoFile(`/tmp/video${ext}`);
        expect(result).not.toBeNull();
        expect(result!.mimeType).toBeTruthy();
      }
    } finally {
      statSpy.mockRestore();
    }
  });
});

describe("isVideoEnabled", () => {
  it("returns true when video.enabled is true", () => {
    mockLoadConfig.mockReturnValue({
      video: { enabled: true, maxSizeMB: 50 },
    } as ReturnType<typeof loadConfig>);
    expect(isVideoEnabled()).toBe(true);
  });

  it("returns true when video config is undefined (defaults to enabled)", () => {
    mockLoadConfig.mockReturnValue({} as ReturnType<typeof loadConfig>);
    expect(isVideoEnabled()).toBe(true);
  });

  it("returns false when video.enabled is false", () => {
    mockLoadConfig.mockReturnValue({
      video: { enabled: false },
    } as ReturnType<typeof loadConfig>);
    expect(isVideoEnabled()).toBe(false);
  });
});
```

- [ ] **Step 2:** Verify tests pass

```bash
pnpm vitest run tests/extract/video.test.ts
```

---

## Task 6: Add `extractVideo()` Tests — Gemini API Success Path

**Files:** `tests/extract/video.test.ts`

- [ ] **Step 1:** Add test suite for `extractVideo()` with mocked Gemini API flow

```typescript
import { extractVideo, type VideoFileInfo } from "../../src/extract/video.ts";

// Mock gemini-api module
vi.mock("../../src/extract/gemini-api.ts", () => ({
  queryGeminiApi: vi.fn(),
  getApiKey: vi.fn(() => "test-api-key"),
  getVersionedApiBase: vi.fn(() => "https://generativelanguage.googleapis.com/v1beta"),
}));

// Mock gemini-web module
vi.mock("../../src/extract/gemini-web.ts", () => ({
  isGeminiWebAvailable: vi.fn(() => false),
  queryWithCookies: vi.fn(),
}));

import { queryGeminiApi, getApiKey, getVersionedApiBase } from "../../src/extract/gemini-api.ts";
import { isGeminiWebAvailable, queryWithCookies } from "../../src/extract/gemini-web.ts";

const mockQueryGeminiApi = vi.mocked(queryGeminiApi);
const mockGetApiKey = vi.mocked(getApiKey);
const mockGetVersionedApiBase = vi.mocked(getVersionedApiBase);
const mockIsGeminiWebAvailable = vi.mocked(isGeminiWebAvailable);
const mockQueryWithCookies = vi.mocked(queryWithCookies);

describe("extractVideo", () => {
  const testInfo: VideoFileInfo = {
    absolutePath: "/tmp/test-video.mp4",
    mimeType: "video/mp4",
    sizeBytes: 10 * 1024 * 1024,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetApiKey.mockReturnValue("test-api-key");
    mockGetVersionedApiBase.mockReturnValue(
      "https://generativelanguage.googleapis.com/v1beta",
    );
    mockIsGeminiWebAvailable.mockReturnValue(false);

    // Mock global fetch for Files API operations
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("succeeds via Gemini API: upload → poll → query → delete", async () => {
    const mockFetch = vi.mocked(global.fetch);

    // Mock upload init response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({
        "x-goog-upload-url": "https://upload.example.com/resume/123",
      }),
    } as Response);

    // Mock upload PUT response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        file: { name: "files/abc123", uri: "gs://files/abc123" },
      }),
    } as Response);

    // Mock poll response (ACTIVE immediately)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ state: "ACTIVE" }),
    } as Response);

    // Mock queryGeminiApi response
    mockQueryGeminiApi.mockResolvedValueOnce(
      "# Video Analysis\n\nThis is a tutorial about TypeScript.",
    );

    // Mock delete (fire-and-forget)
    mockFetch.mockResolvedValueOnce({ ok: true } as Response);

    // Mock ffmpeg (extractVideoFrame) — execFileSync
    const { execFileSync } = await import("node:child_process");
    vi.mock("node:child_process", () => ({
      execFileSync: vi.fn(() => Buffer.from("fake-jpeg-data")),
    }));

    // Mock fs.readFileSync for file upload
    vi.spyOn(fs, "readFileSync").mockReturnValue(Buffer.alloc(testInfo.sizeBytes));

    const result = await extractVideo(testInfo);

    expect(result).not.toBeNull();
    expect(result!.text).toContain("Video Analysis");
    expect(result!.title).toBe("Video Analysis");
    expect(result!.url).toBe("file:///tmp/test-video.mp4");
    expect(result!.extractionChain).toContain("gemini-files-upload");
    expect(result!.extractionChain).toContain("gemini-files-poll");
    expect(result!.extractionChain).toContain("gemini-api");
    expect(result!.chars).toBeGreaterThan(0);
    expect(result!.truncated).toBe(false);
  });

  it("returns null when both Gemini API and Web fail", async () => {
    const mockFetch = vi.mocked(global.fetch);

    // Upload init fails
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    } as Response);

    // No web available
    mockIsGeminiWebAvailable.mockReturnValue(false);

    const result = await extractVideo(testInfo);
    expect(result).toBeNull();
  });

  it("falls through to title from filename when no heading found", async () => {
    const mockFetch = vi.mocked(global.fetch);

    // Mock successful upload flow
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({
        "x-goog-upload-url": "https://upload.example.com/resume/456",
      }),
    } as Response);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        file: { name: "files/def456", uri: "gs://files/def456" },
      }),
    } as Response);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ state: "ACTIVE" }),
    } as Response);
    mockFetch.mockResolvedValueOnce({ ok: true } as Response); // delete

    // Response without markdown heading
    mockQueryGeminiApi.mockResolvedValueOnce("Just plain text content without a heading.");

    vi.spyOn(fs, "readFileSync").mockReturnValue(Buffer.alloc(testInfo.sizeBytes));

    const result = await extractVideo(testInfo);
    expect(result).not.toBeNull();
    expect(result!.title).toBe("test-video.mp4");
  });
});
```

- [ ] **Step 2:** Verify tests pass

```bash
pnpm vitest run tests/extract/video.test.ts
```

---

## Task 7: Add `extractVideo()` Tests — Gemini Web Fallback

**Files:** `tests/extract/video.test.ts`

- [ ] **Step 1:** Add test cases for Gemini Web fallback path

```typescript
describe("extractVideo — Gemini Web fallback", () => {
  const testInfo: VideoFileInfo = {
    absolutePath: "/tmp/fallback-video.mov",
    mimeType: "video/quicktime",
    sizeBytes: 5 * 1024 * 1024,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("uses Gemini Web when API key is unavailable", async () => {
    mockGetApiKey.mockReturnValue(null);
    mockIsGeminiWebAvailable.mockReturnValue(true);
    mockQueryWithCookies.mockResolvedValueOnce(
      "# Screen Recording\n\nUser demonstrates VS Code shortcuts.",
    );

    const result = await extractVideo(testInfo);

    expect(result).not.toBeNull();
    expect(result!.text).toContain("Screen Recording");
    expect(result!.extractionChain).toContain("gemini-web");
    expect(result!.extractionChain).not.toContain("gemini-api");

    // Verify queryWithCookies was called with file path
    expect(mockQueryWithCookies).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ files: [testInfo.absolutePath] }),
    );
  });

  it("falls back to Gemini Web when API upload fails", async () => {
    mockGetApiKey.mockReturnValue("test-key");
    const mockFetch = vi.mocked(global.fetch);

    // Upload init fails
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    } as Response);

    // Gemini Web succeeds
    mockIsGeminiWebAvailable.mockReturnValue(true);
    mockQueryWithCookies.mockResolvedValueOnce("# Fallback Result\n\nContent here.");

    const result = await extractVideo(testInfo);

    expect(result).not.toBeNull();
    expect(result!.extractionChain).toContain("gemini-web");
  });

  it("returns null when Gemini Web also fails", async () => {
    mockGetApiKey.mockReturnValue(null);
    mockIsGeminiWebAvailable.mockReturnValue(true);
    mockQueryWithCookies.mockResolvedValueOnce(null);

    const result = await extractVideo(testInfo);
    expect(result).toBeNull();
  });

  it("returns null when Gemini Web throws", async () => {
    mockGetApiKey.mockReturnValue(null);
    mockIsGeminiWebAvailable.mockReturnValue(true);
    mockQueryWithCookies.mockRejectedValueOnce(new Error("Cookie expired"));

    const result = await extractVideo(testInfo);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2:** Verify tests pass

```bash
pnpm vitest run tests/extract/video.test.ts
```

---

## Task 8: Add Tests for `uploadToFilesApi()` and `pollFileState()`

**Files:** `tests/extract/video.test.ts`

- [ ] **Step 1:** Add tests for the resumable upload flow and polling state machine

```typescript
describe("uploadToFilesApi (via extractVideo internals)", () => {
  const testInfo: VideoFileInfo = {
    absolutePath: "/tmp/upload-test.mp4",
    mimeType: "video/mp4",
    sizeBytes: 2 * 1024 * 1024,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetApiKey.mockReturnValue("test-api-key");
    mockIsGeminiWebAvailable.mockReturnValue(false);
    global.fetch = vi.fn();
    vi.spyOn(fs, "readFileSync").mockReturnValue(Buffer.alloc(testInfo.sizeBytes));
  });

  it("throws when upload init returns no upload URL header", async () => {
    const mockFetch = vi.mocked(global.fetch);

    // Init response missing x-goog-upload-url
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({}),
    } as Response);

    const result = await extractVideo(testInfo);
    // Should fail gracefully (caught internally) → null result
    expect(result).toBeNull();
  });

  it("throws when upload PUT returns non-ok", async () => {
    const mockFetch = vi.mocked(global.fetch);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({
        "x-goog-upload-url": "https://upload.example.com/resume/789",
      }),
    } as Response);

    // PUT fails
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 413,
      statusText: "Payload Too Large",
    } as Response);

    const result = await extractVideo(testInfo);
    expect(result).toBeNull();
  });
});

describe("pollFileState (via extractVideo internals)", () => {
  const testInfo: VideoFileInfo = {
    absolutePath: "/tmp/poll-test.mp4",
    mimeType: "video/mp4",
    sizeBytes: 1024,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetApiKey.mockReturnValue("test-api-key");
    mockIsGeminiWebAvailable.mockReturnValue(false);
    global.fetch = vi.fn();
    vi.spyOn(fs, "readFileSync").mockReturnValue(Buffer.alloc(testInfo.sizeBytes));
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("handles FAILED state from file processing", async () => {
    const mockFetch = vi.mocked(global.fetch);

    // Successful upload
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({
        "x-goog-upload-url": "https://upload.example.com/resume/poll1",
      }),
    } as Response);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        file: { name: "files/poll1", uri: "gs://files/poll1" },
      }),
    } as Response);

    // Poll returns FAILED
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        state: "FAILED",
        error: { message: "Unsupported codec" },
      }),
    } as Response);

    const resultPromise = extractVideo(testInfo);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBeNull();
  });

  it("polls multiple times until ACTIVE", async () => {
    const mockFetch = vi.mocked(global.fetch);

    // Successful upload
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({
        "x-goog-upload-url": "https://upload.example.com/resume/poll2",
      }),
    } as Response);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        file: { name: "files/poll2", uri: "gs://files/poll2" },
      }),
    } as Response);

    // First poll: PROCESSING
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ state: "PROCESSING" }),
    } as Response);

    // Second poll: ACTIVE
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ state: "ACTIVE" }),
    } as Response);

    // Query succeeds
    mockQueryGeminiApi.mockResolvedValueOnce("# Result\n\nVideo content.");

    // Delete
    mockFetch.mockResolvedValueOnce({ ok: true } as Response);

    const resultPromise = extractVideo(testInfo);
    await vi.advanceTimersByTimeAsync(5_000); // advance past first poll sleep
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).not.toBeNull();
    expect(result!.extractionChain).toContain("gemini-api");
  });
});
```

- [ ] **Step 2:** Verify tests pass

```bash
pnpm vitest run tests/extract/video.test.ts
```

---

## Task 9: Add Tests for Auto-Thumbnail (ffmpeg Success/Failure)

**Files:** `tests/extract/video.test.ts`

- [ ] **Step 1:** Add test cases verifying thumbnail extraction is non-blocking

```typescript
describe("extractVideo — auto-thumbnail", () => {
  const testInfo: VideoFileInfo = {
    absolutePath: "/tmp/thumb-test.mp4",
    mimeType: "video/mp4",
    sizeBytes: 1024,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetApiKey.mockReturnValue("test-api-key");
    mockIsGeminiWebAvailable.mockReturnValue(false);
    global.fetch = vi.fn();
    vi.spyOn(fs, "readFileSync").mockReturnValue(Buffer.alloc(testInfo.sizeBytes));
  });

  it("includes thumbnail when ffmpeg succeeds", async () => {
    const mockFetch = vi.mocked(global.fetch);

    // Full successful API flow
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({
        "x-goog-upload-url": "https://upload.example.com/resume/thumb1",
      }),
    } as Response);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        file: { name: "files/thumb1", uri: "gs://files/thumb1" },
      }),
    } as Response);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ state: "ACTIVE" }),
    } as Response);
    mockQueryGeminiApi.mockResolvedValueOnce("# Content\n\nSome analysis.");
    mockFetch.mockResolvedValueOnce({ ok: true } as Response); // delete

    // Mock execFileSync to return fake JPEG
    const childProcess = await import("node:child_process");
    vi.spyOn(childProcess, "execFileSync").mockReturnValue(
      Buffer.from("fake-jpeg-thumbnail"),
    );

    const result = await extractVideo(testInfo);
    expect(result).not.toBeNull();
    const thumbnail = (result as Record<string, unknown>).thumbnail as {
      data: string;
      mimeType: string;
    } | undefined;
    expect(thumbnail).toBeDefined();
    expect(thumbnail!.mimeType).toBe("image/jpeg");
    expect(thumbnail!.data).toBeTruthy();
  });

  it("still returns content when ffmpeg fails (thumbnail is optional)", async () => {
    const mockFetch = vi.mocked(global.fetch);

    // Full successful API flow
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({
        "x-goog-upload-url": "https://upload.example.com/resume/thumb2",
      }),
    } as Response);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        file: { name: "files/thumb2", uri: "gs://files/thumb2" },
      }),
    } as Response);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ state: "ACTIVE" }),
    } as Response);
    mockQueryGeminiApi.mockResolvedValueOnce("# Analysis\n\nVideo analyzed.");
    mockFetch.mockResolvedValueOnce({ ok: true } as Response); // delete

    // Mock execFileSync to throw (ffmpeg not installed / fails)
    const childProcess = await import("node:child_process");
    vi.spyOn(childProcess, "execFileSync").mockImplementation(() => {
      throw new Error("ffmpeg: command not found");
    });

    const result = await extractVideo(testInfo);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("Analysis");
    const thumbnail = (result as Record<string, unknown>).thumbnail;
    expect(thumbnail).toBeUndefined();
  });
});
```

- [ ] **Step 2:** Verify tests pass

```bash
pnpm vitest run tests/extract/video.test.ts
```

---

## Task 10: Final Verification and Commit

**Files:** All files from this phase

- [ ] **Step 1:** Run full test suite

```bash
pnpm test
```

- [ ] **Step 2:** Run lint and typecheck

```bash
pnpm run lint
pnpm run typecheck
```

- [ ] **Step 3:** Verify exports are accessible

```typescript
// Quick sanity check — these should resolve without errors:
// import { isVideoFile, isVideoEnabled, extractVideo, VideoFileInfo } from "./src/extract/video.ts"
```

- [ ] **Step 4:** Commit

```bash
git add src/extract/video.ts tests/extract/video.test.ts
git commit -m "feat(extract): add local video file detection and Gemini analysis (Phase 6)"
```

---

## Summary

| File | Purpose |
|------|---------|
| `src/extract/video.ts` | Video detection (`isVideoFile`, `isVideoEnabled`), Gemini Files API upload/poll/delete, `extractVideo()` with API→Web fallback chain, auto-thumbnail |
| `tests/extract/video.test.ts` | Full unit test coverage: detection, upload, polling, fallback, thumbnail |

### Key Design Decisions

1. **Two-step pattern**: `isVideoFile()` is synchronous and cheap (stat only), `extractVideo()` is async and expensive (upload + AI)
2. **Files API is internal**: `uploadToFilesApi`, `pollFileState`, `deleteGeminiFile` are module-private — only `extractVideo` is the public async entry point
3. **Non-blocking thumbnail**: ffmpeg failure is caught silently; text result is always returned if Gemini succeeds
4. **Fire-and-forget cleanup**: `deleteGeminiFile` errors are logged but never block the response
5. **Fallback order**: API key path first (more reliable), cookie-auth Web second (no upload quota)
