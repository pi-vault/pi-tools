# Content Extraction Phase 5 — Frame Extraction via ffmpeg/yt-dlp

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `src/extract/frames.ts` — timestamp parsing and frame extraction from YouTube videos and local files via ffmpeg/yt-dlp.

**Architecture:** This module provides the low-level frame extraction primitives used by the YouTube and video analysis phases (Phase 4, 6, 7). It shells out to `yt-dlp` for YouTube stream resolution and `ffmpeg`/`ffprobe` for frame capture and duration detection. All external tool failures produce graceful error messages rather than thrown exceptions.

**Tech Stack:** TypeScript, Vitest, `node:child_process` (`execFileSync`), ffmpeg, ffprobe, yt-dlp

**Parent plan:** `docs/superpowers/plans/2026-07-13-content-extraction.md`

**Spec:** `docs/superpowers/specs/2026-07-13-content-extraction-design.md` (Frame Extraction section)

**Reference implementation:** `nicobailon-pi-web-access` — `youtube-extract.ts`, `video-extract.ts`, `utils.ts`

**Dependencies from earlier phases:**
- `VideoFrame` interface from `src/extract/pipeline.ts` (already exists)

---

## Task 1 — Write failing tests for timestamp parsing and formatting

**Files:**

- `tests/extract/frames.test.ts`

### Steps

- [ ] **1.1** Create the test file with imports and the `parseTimestampParam` describe block:

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  parseTimestampParam,
  formatSeconds,
  getYouTubeStreamInfo,
  getLocalVideoDuration,
  extractYouTubeFrames,
  extractLocalFrames,
} from "../../src/extract/frames.ts";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFileSync: vi.fn(actual.execFileSync),
  };
});

import { execFileSync } from "node:child_process";

describe("parseTimestampParam", () => {
  it("returns empty array when no timestamp and no frames", () => {
    expect(parseTimestampParam(undefined)).toEqual([]);
  });

  it("parses single seconds-only timestamp", () => {
    expect(parseTimestampParam("85")).toEqual([85]);
  });

  it("parses MM:SS format", () => {
    expect(parseTimestampParam("23:45")).toEqual([1425]);
  });

  it("parses H:MM:SS format", () => {
    expect(parseTimestampParam("1:23:45")).toEqual([5025]);
  });

  it("parses range and returns 6 evenly-spaced points by default", () => {
    const result = parseTimestampParam("0:00-1:00");
    expect(result).toHaveLength(6);
    expect(result[0]).toBe(0);
    expect(result[result.length - 1]).toBe(60);
  });

  it("parses range with custom frame count", () => {
    const result = parseTimestampParam("10-20", 3);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe(10);
    expect(result[1]).toBe(15);
    expect(result[2]).toBe(20);
  });

  it("generates timestamps at 5s intervals from single timestamp with frames", () => {
    const result = parseTimestampParam("5:00", 3);
    expect(result).toEqual([300, 305, 310]);
  });

  it("distributes evenly across duration when frames only (no timestamp)", () => {
    const result = parseTimestampParam(undefined, 4, 120);
    expect(result).toHaveLength(4);
    expect(result[0]).toBe(0);
    expect(result[3]).toBe(120);
  });

  it("returns empty when frames requested but no duration available", () => {
    expect(parseTimestampParam(undefined, 4)).toEqual([]);
  });

  it("handles range with same start and end", () => {
    const result = parseTimestampParam("30-30");
    expect(result).toEqual([30]);
  });

  it("clamps frames to 12 maximum", () => {
    const result = parseTimestampParam("0-60", 20);
    expect(result.length).toBeLessThanOrEqual(12);
  });
});

describe("formatSeconds", () => {
  it("formats seconds < 60 as 0:SS", () => {
    expect(formatSeconds(5)).toBe("0:05");
  });

  it("formats 60 seconds as 1:00", () => {
    expect(formatSeconds(60)).toBe("1:00");
  });

  it("formats minutes and seconds as M:SS", () => {
    expect(formatSeconds(85)).toBe("1:25");
  });

  it("formats large values as H:MM:SS", () => {
    expect(formatSeconds(5025)).toBe("1:23:45");
  });

  it("formats 23:45 correctly", () => {
    expect(formatSeconds(1425)).toBe("23:45");
  });

  it("handles zero", () => {
    expect(formatSeconds(0)).toBe("0:00");
  });

  it("rounds fractional seconds", () => {
    expect(formatSeconds(5.7)).toBe("0:06");
  });
});
```

- [ ] **1.2** Run tests to confirm they fail (module doesn't exist yet):

```bash
pnpm vitest run tests/extract/frames.test.ts
```

Expected: Import/compilation error — `src/extract/frames.ts` does not exist.

---

## Task 2 — Write failing tests for getYouTubeStreamInfo and getLocalVideoDuration

**Files:**

- `tests/extract/frames.test.ts`

### Steps

- [ ] **2.1** Append the `getYouTubeStreamInfo` describe block after the `formatSeconds` tests:

```typescript
describe("getYouTubeStreamInfo", () => {
  beforeEach(() => {
    vi.mocked(execFileSync).mockReset();
  });

  afterEach(() => {
    vi.mocked(execFileSync).mockReset();
  });

  it("returns stream URL and duration on success", async () => {
    vi.mocked(execFileSync).mockReturnValue(
      "120\nhttps://rr4---sn.googlevideo.com/videoplayback?id=abc\n",
    );
    const result = await getYouTubeStreamInfo("dQw4w9WgXcQ");
    expect(result).toEqual({
      streamUrl: "https://rr4---sn.googlevideo.com/videoplayback?id=abc",
      duration: 120,
    });
    expect(vi.mocked(execFileSync)).toHaveBeenCalledWith(
      "yt-dlp",
      expect.arrayContaining(["--print", "duration", "-g"]),
      expect.objectContaining({ timeout: 15000, stdio: ["pipe", "pipe", "pipe"] }),
    );
  });

  it("returns null duration when yt-dlp outputs NA", async () => {
    vi.mocked(execFileSync).mockReturnValue(
      "NA\nhttps://stream.example.com/video\n",
    );
    const result = await getYouTubeStreamInfo("abc123");
    expect(result).toEqual({
      streamUrl: "https://stream.example.com/video",
      duration: null,
    });
  });

  it("returns error when stream URL is missing", async () => {
    vi.mocked(execFileSync).mockReturnValue("120\n");
    const result = await getYouTubeStreamInfo("abc123");
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("missing stream URL");
  });

  it("returns error when yt-dlp is not installed (ENOENT)", async () => {
    const err = Object.assign(new Error("spawn yt-dlp ENOENT"), { code: "ENOENT" });
    vi.mocked(execFileSync).mockImplementation(() => { throw err; });
    const result = await getYouTubeStreamInfo("abc123");
    expect(result).toEqual({
      error: "yt-dlp is not installed. Install with: brew install yt-dlp",
    });
  });

  it("returns error on timeout (killed)", async () => {
    const err = Object.assign(new Error("timed out"), { killed: true });
    vi.mocked(execFileSync).mockImplementation(() => { throw err; });
    const result = await getYouTubeStreamInfo("abc123");
    expect(result).toEqual({
      error: "yt-dlp timed out fetching video info",
    });
  });

  it("returns descriptive error for private video", async () => {
    const err = Object.assign(new Error("yt-dlp error"), {
      stderr: Buffer.from("ERROR: Private video. Sign in if you've been granted access."),
    });
    vi.mocked(execFileSync).mockImplementation(() => { throw err; });
    const result = await getYouTubeStreamInfo("private123");
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("private");
  });

  it("returns descriptive error for unavailable video", async () => {
    const err = Object.assign(new Error("yt-dlp error"), {
      stderr: Buffer.from("ERROR: Video unavailable"),
    });
    vi.mocked(execFileSync).mockImplementation(() => { throw err; });
    const result = await getYouTubeStreamInfo("gone123");
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("unavailable");
  });
});

describe("getLocalVideoDuration", () => {
  beforeEach(() => {
    vi.mocked(execFileSync).mockReset();
  });

  afterEach(() => {
    vi.mocked(execFileSync).mockReset();
  });

  it("returns duration as number on success", async () => {
    vi.mocked(execFileSync).mockReturnValue("123.456\n");
    const result = await getLocalVideoDuration("/path/to/video.mp4");
    expect(result).toBe(123.456);
    expect(vi.mocked(execFileSync)).toHaveBeenCalledWith(
      "ffprobe",
      expect.arrayContaining(["-show_entries", "format=duration", "/path/to/video.mp4"]),
      expect.objectContaining({ timeout: 10000, stdio: ["pipe", "pipe", "pipe"] }),
    );
  });

  it("returns error when ffprobe is not installed (ENOENT)", async () => {
    const err = Object.assign(new Error("spawn ffprobe ENOENT"), { code: "ENOENT" });
    vi.mocked(execFileSync).mockImplementation(() => { throw err; });
    const result = await getLocalVideoDuration("/path/to/video.mp4");
    expect(result).toEqual({
      error: "ffprobe is not installed. Install with: brew install ffmpeg",
    });
  });

  it("returns error on timeout", async () => {
    const err = Object.assign(new Error("timed out"), { killed: true });
    vi.mocked(execFileSync).mockImplementation(() => { throw err; });
    const result = await getLocalVideoDuration("/path/to/video.mp4");
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("timed out");
  });

  it("returns error when output is not a valid number", async () => {
    vi.mocked(execFileSync).mockReturnValue("N/A\n");
    const result = await getLocalVideoDuration("/path/to/video.mp4");
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("invalid duration");
  });
});
```

---

## Task 3 — Write failing tests for extractYouTubeFrames and extractLocalFrames

**Files:**

- `tests/extract/frames.test.ts`

### Steps

- [ ] **3.1** Append the `extractYouTubeFrames` describe block:

```typescript
describe("extractYouTubeFrames", () => {
  beforeEach(() => {
    vi.mocked(execFileSync).mockReset();
  });

  afterEach(() => {
    vi.mocked(execFileSync).mockReset();
  });

  it("extracts frames successfully from YouTube video", async () => {
    const fakeJpeg = Buffer.from("fake-jpeg-data");
    vi.mocked(execFileSync)
      .mockReturnValueOnce("300\nhttps://stream.example.com/video\n") // yt-dlp
      .mockReturnValueOnce(fakeJpeg as unknown as string) // ffmpeg frame 1
      .mockReturnValueOnce(fakeJpeg as unknown as string); // ffmpeg frame 2

    const result = await extractYouTubeFrames("testVideo", [10, 20]);
    expect(result.frames).toHaveLength(2);
    expect(result.frames[0]).toEqual({
      data: fakeJpeg.toString("base64"),
      mimeType: "image/jpeg",
      timestamp: "0:10",
    });
    expect(result.frames[1]).toEqual({
      data: fakeJpeg.toString("base64"),
      mimeType: "image/jpeg",
      timestamp: "0:20",
    });
    expect(result.duration).toBe(300);
    expect(result.error).toBeNull();
  });

  it("returns error when yt-dlp fails", async () => {
    const err = Object.assign(new Error("spawn yt-dlp ENOENT"), { code: "ENOENT" });
    vi.mocked(execFileSync).mockImplementation(() => { throw err; });

    const result = await extractYouTubeFrames("testVideo", [10]);
    expect(result.frames).toEqual([]);
    expect(result.duration).toBeNull();
    expect(result.error).toContain("yt-dlp");
  });

  it("returns partial results when some frames fail", async () => {
    const fakeJpeg = Buffer.from("fake-jpeg-data");
    const ffmpegErr = new Error("ffmpeg failed");

    vi.mocked(execFileSync)
      .mockReturnValueOnce("300\nhttps://stream.example.com/video\n") // yt-dlp
      .mockReturnValueOnce(fakeJpeg as unknown as string) // frame 1 OK
      .mockImplementationOnce(() => { throw ffmpegErr; }); // frame 2 fails

    const result = await extractYouTubeFrames("testVideo", [10, 20]);
    expect(result.frames).toHaveLength(1);
    expect(result.frames[0].timestamp).toBe("0:10");
    expect(result.error).toBeNull(); // partial success = no top-level error
    expect(result.duration).toBe(300);
  });

  it("returns error when all frames fail", async () => {
    const ffmpegErr = new Error("ffmpeg failed");
    vi.mocked(execFileSync)
      .mockReturnValueOnce("300\nhttps://stream.example.com/video\n") // yt-dlp
      .mockImplementation(() => { throw ffmpegErr; }); // all ffmpeg calls fail

    const result = await extractYouTubeFrames("testVideo", [10, 20]);
    expect(result.frames).toEqual([]);
    expect(result.error).toBeTruthy();
  });
});

describe("extractLocalFrames", () => {
  beforeEach(() => {
    vi.mocked(execFileSync).mockReset();
  });

  afterEach(() => {
    vi.mocked(execFileSync).mockReset();
  });

  it("extracts frames successfully from local file", async () => {
    const fakeJpeg = Buffer.from("local-frame-data");
    vi.mocked(execFileSync)
      .mockReturnValueOnce("60.5\n") // ffprobe duration
      .mockReturnValueOnce(fakeJpeg as unknown as string) // ffmpeg frame 1
      .mockReturnValueOnce(fakeJpeg as unknown as string); // ffmpeg frame 2

    const result = await extractLocalFrames("/tmp/video.mp4", [5, 30]);
    expect(result.frames).toHaveLength(2);
    expect(result.frames[0]).toEqual({
      data: fakeJpeg.toString("base64"),
      mimeType: "image/jpeg",
      timestamp: "0:05",
    });
    expect(result.frames[1]).toEqual({
      data: fakeJpeg.toString("base64"),
      mimeType: "image/jpeg",
      timestamp: "0:30",
    });
    expect(result.duration).toBe(60.5);
    expect(result.error).toBeNull();
  });

  it("returns error when ffprobe fails (ENOENT)", async () => {
    const err = Object.assign(new Error("spawn ffprobe ENOENT"), { code: "ENOENT" });
    vi.mocked(execFileSync).mockImplementation(() => { throw err; });

    const result = await extractLocalFrames("/tmp/video.mp4", [5]);
    expect(result.frames).toEqual([]);
    expect(result.error).toContain("ffprobe");
  });

  it("returns error when ffmpeg ENOENT (ffprobe works)", async () => {
    const ffmpegErr = Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" });
    vi.mocked(execFileSync)
      .mockReturnValueOnce("60\n") // ffprobe OK
      .mockImplementation(() => { throw ffmpegErr; }); // ffmpeg ENOENT

    const result = await extractLocalFrames("/tmp/video.mp4", [5]);
    expect(result.frames).toEqual([]);
    expect(result.error).toContain("ffmpeg");
  });

  it("returns partial results when some frames fail", async () => {
    const fakeJpeg = Buffer.from("frame-data");
    const ffmpegErr = new Error("ffmpeg decode error");

    vi.mocked(execFileSync)
      .mockReturnValueOnce("120\n") // ffprobe
      .mockReturnValueOnce(fakeJpeg as unknown as string) // frame 1 OK
      .mockImplementationOnce(() => { throw ffmpegErr; }); // frame 2 fails

    const result = await extractLocalFrames("/tmp/video.mp4", [10, 90]);
    expect(result.frames).toHaveLength(1);
    expect(result.frames[0].timestamp).toBe("0:10");
    expect(result.duration).toBe(120);
    expect(result.error).toBeNull(); // partial success
  });
});
```

- [ ] **3.2** Run tests to confirm all fail:

```bash
pnpm vitest run tests/extract/frames.test.ts
```

Expected: Import/compilation error — `src/extract/frames.ts` does not exist.

---

## Task 4 — Implement `src/extract/frames.ts` — error utilities and timestamp functions

**Files:**

- `src/extract/frames.ts`

### Steps

- [ ] **4.1** Create the file with imports, error utilities, and timestamp functions:

```typescript
import { execFileSync } from "node:child_process";
import type { VideoFrame } from "./pipeline.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FRAMES = 12;
const DEFAULT_RANGE_FRAMES = 6;
const FRAME_INTERVAL_S = 5;
const FFMPEG_FRAME_TIMEOUT = 30_000;
const FFMPEG_MAX_BUFFER = 5 * 1024 * 1024; // 5MB
const YTDLP_TIMEOUT = 15_000;
const FFPROBE_TIMEOUT = 10_000;

// ---------------------------------------------------------------------------
// Error utilities (aligned with pi-web-access/utils.ts patterns)
// ---------------------------------------------------------------------------

function readExecError(err: unknown): { code?: string; stderr: string; message: string } {
  if (!err || typeof err !== "object") {
    return { stderr: "", message: String(err) };
  }
  const code = (err as { code?: string }).code;
  const message = (err as { message?: string }).message ?? "";
  const stderrRaw = (err as { stderr?: Buffer | string }).stderr;
  const stderr = Buffer.isBuffer(stderrRaw)
    ? stderrRaw.toString("utf-8")
    : typeof stderrRaw === "string"
      ? stderrRaw
      : "";
  return { code, stderr, message };
}

function isTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  if ((err as { killed?: boolean }).killed) return true;
  const name = (err as { name?: string }).name;
  const code = (err as { code?: string }).code;
  const message = (err as { message?: string }).message ?? "";
  return name === "AbortError" || code === "ETIMEDOUT" || message.toLowerCase().includes("timed out");
}

function trimErrorText(text: string, maxLen = 200): string {
  const trimmed = text.trim().split("\n")[0] ?? "";
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}...` : trimmed;
}

// ---------------------------------------------------------------------------
// Error mappers
// ---------------------------------------------------------------------------

function mapYtDlpError(err: unknown): string {
  const { code, stderr, message } = readExecError(err);
  if (code === "ENOENT") return "yt-dlp is not installed. Install with: brew install yt-dlp";
  if (isTimeoutError(err)) return "yt-dlp timed out fetching video info";
  const lower = stderr.toLowerCase();
  if (lower.includes("private")) return "Video is private or unavailable";
  if (lower.includes("sign in")) return "Video is age-restricted and requires authentication";
  if (lower.includes("not available") || lower.includes("unavailable")) {
    return "Video is unavailable in your region or has been removed";
  }
  if (lower.includes("live")) return "Cannot extract frames from a live stream";
  const snippet = trimErrorText(stderr || message);
  return snippet ? `yt-dlp failed: ${snippet}` : "yt-dlp failed";
}

function mapFfmpegError(err: unknown): string {
  const { code, stderr, message } = readExecError(err);
  if (code === "ENOENT") return "ffmpeg is not installed. Install with: brew install ffmpeg";
  if (isTimeoutError(err)) return "ffmpeg timed out extracting frame";
  if (stderr.includes("403")) return "Stream URL returned 403 — may have expired, try again";
  const snippet = trimErrorText(stderr || message);
  return snippet ? `ffmpeg failed: ${snippet}` : "ffmpeg failed";
}

function mapFfprobeError(err: unknown): string {
  const { code, stderr, message } = readExecError(err);
  if (code === "ENOENT") return "ffprobe is not installed. Install with: brew install ffmpeg";
  if (isTimeoutError(err)) return "ffprobe timed out reading video duration";
  const snippet = trimErrorText(stderr || message);
  return snippet ? `ffprobe failed: ${snippet}` : "ffprobe failed";
}

// ---------------------------------------------------------------------------
// Timestamp parsing and formatting
// ---------------------------------------------------------------------------

/**
 * Parse a timestamp string into seconds.
 * Supports: "H:MM:SS", "MM:SS", "SS" (plain number).
 */
function parseTimestamp(ts: string): number {
  const parts = ts.trim().split(":").map(Number);
  if (parts.some(Number.isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

/**
 * Parse the timestamp parameter into an array of seconds to extract frames at.
 *
 * - No timestamp, no frames -> []
 * - Range "start-end" -> evenly-spaced points (default 6 or `frames` count)
 * - Single timestamp + frames -> N timestamps at 5s intervals
 * - Single timestamp only -> [parsedSeconds]
 * - No timestamp + frames + duration -> evenly distributed across duration
 */
export function parseTimestampParam(
  timestamp: string | undefined,
  frames?: number,
  duration?: number,
): number[] {
  const count = frames ? Math.min(frames, MAX_FRAMES) : undefined;

  // No timestamp, no frames -> empty
  if (!timestamp && !count) return [];

  // No timestamp but frames requested -> distribute across duration
  if (!timestamp && count) {
    if (duration == null || duration <= 0) return [];
    if (count === 1) return [0];
    const step = duration / (count - 1);
    return Array.from({ length: count }, (_, i) => Math.round(step * i));
  }

  // Has timestamp — check for range (contains "-" but not just a negative number)
  const rangeMatch = timestamp!.match(/^([^-]+)-(.+)$/);
  if (rangeMatch && rangeMatch[1].length > 0) {
    const start = parseTimestamp(rangeMatch[1]);
    const end = parseTimestamp(rangeMatch[2]);
    if (start === end) return [start];
    const n = count ?? DEFAULT_RANGE_FRAMES;
    const clamped = Math.min(n, MAX_FRAMES);
    if (clamped === 1) return [start];
    const step = (end - start) / (clamped - 1);
    return Array.from({ length: clamped }, (_, i) => Math.round(start + step * i));
  }

  // Single timestamp
  const seconds = parseTimestamp(timestamp!);

  // Single timestamp + frames -> intervals of 5s
  if (count) {
    const clamped = Math.min(count, MAX_FRAMES);
    return Array.from({ length: clamped }, (_, i) => seconds + i * FRAME_INTERVAL_S);
  }

  // Single timestamp only
  return [seconds];
}

/**
 * Format seconds into a human-readable timestamp string.
 * - < 3600: "M:SS" (e.g. "1:25", "23:45")
 * - >= 3600: "H:MM:SS" (e.g. "1:23:45")
 * - < 60: "0:SS" (e.g. "0:05")
 */
export function formatSeconds(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}
```

- [ ] **4.2** Run the timestamp/format tests to confirm they pass:

```bash
pnpm vitest run tests/extract/frames.test.ts -t "parseTimestampParam|formatSeconds"
```

Expected: All `parseTimestampParam` and `formatSeconds` tests pass.

---

## Task 5 — Implement stream info and duration functions

**Files:**

- `src/extract/frames.ts`

### Steps

- [ ] **5.1** Append `getYouTubeStreamInfo` and `getLocalVideoDuration` after `formatSeconds`:

```typescript
// ---------------------------------------------------------------------------
// Stream info functions
// ---------------------------------------------------------------------------

/**
 * Get the direct stream URL and duration for a YouTube video using yt-dlp.
 * Runs: yt-dlp --print duration -g <url>
 * Output: line 1 = duration (or "NA"), line 2 = stream URL
 */
export async function getYouTubeStreamInfo(
  videoId: string,
): Promise<{ streamUrl: string; duration: number | null } | { error: string }> {
  try {
    const output = execFileSync(
      "yt-dlp",
      ["--print", "duration", "-g", `https://www.youtube.com/watch?v=${videoId}`],
      { timeout: YTDLP_TIMEOUT, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    const lines = output.split(/\r?\n/);
    const rawDuration = lines[0]?.trim();
    const streamUrl = lines[1]?.trim();
    if (!streamUrl) return { error: "yt-dlp failed: missing stream URL" };
    const parsedDuration = rawDuration && rawDuration !== "NA"
      ? Number.parseFloat(rawDuration)
      : Number.NaN;
    const duration = Number.isFinite(parsedDuration) ? parsedDuration : null;
    return { streamUrl, duration };
  } catch (err) {
    return { error: mapYtDlpError(err) };
  }
}

/**
 * Get the duration of a local video file using ffprobe.
 * Runs: ffprobe -v quiet -show_entries format=duration -of csv=p=0 <filePath>
 */
export async function getLocalVideoDuration(
  filePath: string,
): Promise<number | { error: string }> {
  try {
    const output = execFileSync(
      "ffprobe",
      ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", filePath],
      { timeout: FFPROBE_TIMEOUT, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    const duration = Number.parseFloat(output);
    if (!Number.isFinite(duration)) {
      return { error: `ffprobe failed: invalid duration output` };
    }
    return duration;
  } catch (err) {
    return { error: mapFfprobeError(err) };
  }
}
```

- [ ] **5.2** Run the stream info tests:

```bash
pnpm vitest run tests/extract/frames.test.ts -t "getYouTubeStreamInfo|getLocalVideoDuration"
```

Expected: All `getYouTubeStreamInfo` and `getLocalVideoDuration` tests pass.

---

## Task 6 — Implement frame extraction functions

**Files:**

- `src/extract/frames.ts`

### Steps

- [ ] **6.1** Append the frame extraction functions after `getLocalVideoDuration`:

```typescript
// ---------------------------------------------------------------------------
// Frame extraction
// ---------------------------------------------------------------------------

/**
 * Extract a single frame from a video source at the given timestamp.
 * Returns the frame as a Buffer, or an error string on failure.
 */
function extractSingleFrame(source: string, timestampSec: number): Buffer | string {
  try {
    const buffer = execFileSync(
      "ffmpeg",
      [
        "-ss", String(timestampSec),
        "-i", source,
        "-frames:v", "1",
        "-f", "image2pipe",
        "-vcodec", "mjpeg",
        "pipe:1",
      ],
      {
        maxBuffer: FFMPEG_MAX_BUFFER,
        timeout: FFMPEG_FRAME_TIMEOUT,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer, "binary");
    if (buf.length === 0) return "ffmpeg failed: empty output";
    return buf;
  } catch (err) {
    return mapFfmpegError(err);
  }
}

/**
 * Extract frames from a YouTube video at the specified timestamps.
 *
 * 1. Resolves stream URL via yt-dlp
 * 2. Extracts each frame via ffmpeg from the stream URL
 * 3. Returns partial results if some frames fail
 */
export async function extractYouTubeFrames(
  videoId: string,
  timestamps: number[],
  signal?: AbortSignal,
): Promise<{ frames: VideoFrame[]; duration: number | null; error: string | null }> {
  const info = await getYouTubeStreamInfo(videoId);
  if ("error" in info) {
    return { frames: [], duration: null, error: info.error };
  }

  const frames: VideoFrame[] = [];
  let firstError: string | null = null;

  for (const t of timestamps) {
    if (signal?.aborted) break;
    const result = extractSingleFrame(info.streamUrl, t);
    if (Buffer.isBuffer(result)) {
      frames.push({
        data: result.toString("base64"),
        mimeType: "image/jpeg",
        timestamp: formatSeconds(t),
      });
    } else if (!firstError) {
      firstError = result;
    }
  }

  return {
    frames,
    duration: info.duration,
    error: frames.length === 0 ? (firstError ?? "All frames failed to extract") : null,
  };
}

/**
 * Extract frames from a local video file at the specified timestamps.
 *
 * 1. Gets video duration via ffprobe
 * 2. Extracts each frame via ffmpeg directly from the file
 * 3. Returns partial results if some frames fail
 */
export async function extractLocalFrames(
  filePath: string,
  timestamps: number[],
  signal?: AbortSignal,
): Promise<{ frames: VideoFrame[]; duration: number | null; error: string | null }> {
  const durationResult = await getLocalVideoDuration(filePath);
  if (typeof durationResult !== "number") {
    return { frames: [], duration: null, error: durationResult.error };
  }

  const frames: VideoFrame[] = [];
  let firstError: string | null = null;

  for (const t of timestamps) {
    if (signal?.aborted) break;
    const result = extractSingleFrame(filePath, t);
    if (Buffer.isBuffer(result)) {
      frames.push({
        data: result.toString("base64"),
        mimeType: "image/jpeg",
        timestamp: formatSeconds(t),
      });
    } else if (!firstError) {
      firstError = result;
    }
  }

  return {
    frames,
    duration: durationResult,
    error: frames.length === 0 ? (firstError ?? "All frames failed to extract") : null,
  };
}
```

- [ ] **6.2** Run the full test file:

```bash
pnpm vitest run tests/extract/frames.test.ts
```

Expected: All tests pass.

---

## Task 7 — Full verification

**Files:** (none modified)

### Steps

- [ ] **7.1** Run the full test suite:

```bash
pnpm test
```

Expected: All tests pass, including the new `tests/extract/frames.test.ts`.

- [ ] **7.2** Run type checking:

```bash
pnpm run typecheck
```

Expected: No type errors. The `import type { VideoFrame } from "./pipeline.ts"` in frames.ts resolves correctly.

- [ ] **7.3** Run linting:

```bash
pnpm run lint
```

Expected: No lint errors.

- [ ] **7.4** Commit the changes:

```bash
git add src/extract/frames.ts tests/extract/frames.test.ts
git commit -m "feat(extract): add frame extraction via ffmpeg/yt-dlp

Phase 5 of content extraction:
- parseTimestampParam: parse single, range, and interval timestamps
- formatSeconds: human-readable timestamp formatting
- getYouTubeStreamInfo: resolve stream URL + duration via yt-dlp
- getLocalVideoDuration: get video duration via ffprobe
- extractYouTubeFrames: extract JPEG frames from YouTube streams
- extractLocalFrames: extract JPEG frames from local video files
- Shared error utilities (readExecError, isTimeoutError, trimErrorText)
- Graceful error handling for missing tools, timeouts, private/unavailable
  videos, expired stream URLs (403), and partial frame failures
- Comprehensive test coverage with mocked execFileSync

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

## Implementation Notes

### Changes from previous plan version

This rewrite addresses 10 issues found by comparing against the source `pi-web-access` implementation:

1. **Added `stdio: ["pipe", "pipe", "pipe"]`** to all `execFileSync` calls — prevents stderr from leaking to the user's terminal
2. **Added shared error utilities** (`readExecError`, `isTimeoutError`, `trimErrorText`) matching `pi-web-access/utils.ts` — properly handles Buffer/string stderr, multiple timeout indicators, and message truncation
3. **Fixed duration parsing** to use `Number.parseFloat`/`Number.isFinite` — previous version treated duration=0 as null due to `|| null` falsy coercion
4. **Fixed line splitting** to use `/\r?\n/` — handles Windows-style line endings from yt-dlp
5. **Added missing `streamUrl` validation** — returns error when yt-dlp output is malformed (only 1 line)
6. **Added 403 detection in `mapFfmpegError`** — expired YouTube stream URLs return HTTP 403, which is a common failure mode
7. **Cleaned up test setup** — removed confusing mid-test `mockReset()` in extractLocalFrames ENOENT test
8. **Aligned error messages** with source — user-facing install instructions now match `pi-web-access`
9. **Added `mapFfprobeError`** as separate function — cleaner than inline error handling
10. **`extractSingleFrame` returns `Buffer | string`** — error as string avoids re-throwing and makes the flow clearer

### VideoFrame dependency

`VideoFrame` is already exported from `pipeline.ts` (added in Phase 1). No modifications needed.

### execFileSync vs execFile

The implementation uses synchronous `execFileSync` wrapped in async functions. This is intentional:
1. Frame extraction is inherently sequential per-frame (pipeline stdout)
2. The `timeout` option on `execFileSync` provides reliable timeout behavior
3. The async wrapper allows future migration to streaming if needed
4. `maxBuffer` prevents memory exhaustion from corrupt/large frames

### Mock strategy

Tests use `vi.mock("node:child_process")` with a factory that wraps the real `execFileSync` in `vi.fn()`. This:
- Allows `.mockReturnValueOnce()` chaining for multi-call sequences (yt-dlp then ffmpeg)
- Preserves the real implementation for any unmocked calls
- Uses `.mockReset()` in beforeEach/afterEach for test isolation

### Partial success behavior

Both `extractYouTubeFrames` and `extractLocalFrames` implement partial success:
- If some frames extract successfully, `error` is `null` (success)
- If ALL frames fail, `error` contains the first failure message
- The caller can check `frames.length` to determine how many succeeded

This matches the spec: "Partial success is acceptable — return whatever frames succeeded."

### Max frames safety

`parseTimestampParam` clamps to 12 frames maximum regardless of input. This prevents excessive ffmpeg invocations from a single request.

---

## Summary of Changes

| File                          | Change                                                                 |
| ----------------------------- | ---------------------------------------------------------------------- |
| `src/extract/frames.ts`      | New file — error utils, timestamp parsing, formatting, stream info, frame extraction |
| `tests/extract/frames.test.ts` | New file — comprehensive tests for all exported functions              |
