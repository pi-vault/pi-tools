# Content Extraction Phase 5 — Frame Extraction via ffmpeg/yt-dlp

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `src/extract/frames.ts` — timestamp parsing and frame extraction from YouTube videos and local files via ffmpeg/yt-dlp.

**Architecture:** This module provides the low-level frame extraction primitives used by the YouTube and video analysis phases (Phase 4, 6, 7). It shells out to `yt-dlp` for YouTube stream resolution and `ffmpeg`/`ffprobe` for frame capture and duration detection. All external tool failures produce graceful error messages rather than thrown exceptions.

**Tech Stack:** TypeScript, Vitest, `node:child_process` (`execFileSync`), ffmpeg, ffprobe, yt-dlp

**Parent plan:** `docs/superpowers/plans/2026-07-13-content-extraction.md`

**Spec:** `docs/superpowers/specs/2026-07-13-content-extraction-design.md` (Frame Extraction section)

**Dependencies from earlier phases:**
- `VideoFrame` interface from `src/extract/pipeline.ts` (Phase 1 extends ExtractedContent with video fields including VideoFrame)

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
    // Evenly spaced across 120s: 0, 40, 80, 120
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
    vi.mocked(execFileSync).mockReturnValue("120\nhttps://rr4---sn.googlevideo.com/videoplayback?id=abc\n");
    const result = await getYouTubeStreamInfo("dQw4w9WgXcQ");
    expect(result).toEqual({
      streamUrl: "https://rr4---sn.googlevideo.com/videoplayback?id=abc",
      duration: 120,
    });
    expect(vi.mocked(execFileSync)).toHaveBeenCalledWith(
      "yt-dlp",
      expect.arrayContaining(["--print", "duration", "-g"]),
      expect.objectContaining({ timeout: 15000 }),
    );
  });

  it("returns null duration when yt-dlp outputs NA", async () => {
    vi.mocked(execFileSync).mockReturnValue("NA\nhttps://stream.example.com/video\n");
    const result = await getYouTubeStreamInfo("abc123");
    expect(result).toEqual({
      streamUrl: "https://stream.example.com/video",
      duration: null,
    });
  });

  it("returns error when yt-dlp is not installed (ENOENT)", async () => {
    const err = Object.assign(new Error("spawn yt-dlp ENOENT"), { code: "ENOENT" });
    vi.mocked(execFileSync).mockImplementation(() => { throw err; });
    const result = await getYouTubeStreamInfo("abc123");
    expect(result).toEqual({
      error: "yt-dlp is not installed. Install with: brew install yt-dlp",
    });
  });

  it("returns error on timeout", async () => {
    const err = Object.assign(new Error("timed out"), { killed: true, signal: "SIGTERM" });
    vi.mocked(execFileSync).mockImplementation(() => { throw err; });
    const result = await getYouTubeStreamInfo("abc123");
    expect(result).toEqual({
      error: "yt-dlp timed out fetching video info",
    });
  });

  it("returns descriptive error for private video", async () => {
    const err = Object.assign(new Error("yt-dlp error"), {
      stderr: "ERROR: Private video. Sign in if you've been granted access.",
    });
    vi.mocked(execFileSync).mockImplementation(() => { throw err; });
    const result = await getYouTubeStreamInfo("private123");
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("private");
  });

  it("returns descriptive error for unavailable video", async () => {
    const err = Object.assign(new Error("yt-dlp error"), {
      stderr: "ERROR: Video unavailable",
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
      expect.objectContaining({ timeout: 10000 }),
    );
  });

  it("returns error when ffprobe is not installed (ENOENT)", async () => {
    const err = Object.assign(new Error("spawn ffprobe ENOENT"), { code: "ENOENT" });
    vi.mocked(execFileSync).mockImplementation(() => { throw err; });
    const result = await getLocalVideoDuration("/path/to/video.mp4");
    expect(result).toEqual({
      error: "ffprobe is not installed. Install ffmpeg which includes ffprobe",
    });
  });

  it("returns error on timeout", async () => {
    const err = Object.assign(new Error("timed out"), { killed: true, signal: "SIGTERM" });
    vi.mocked(execFileSync).mockImplementation(() => { throw err; });
    const result = await getLocalVideoDuration("/path/to/video.mp4");
    expect(result).toHaveProperty("error");
  });

  it("returns error when output is not a valid number", async () => {
    vi.mocked(execFileSync).mockReturnValue("N/A\n");
    const result = await getLocalVideoDuration("/path/to/video.mp4");
    expect(result).toHaveProperty("error");
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
    // First call: yt-dlp for stream info
    // Subsequent calls: ffmpeg for frame extraction
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

  it("returns error when ffmpeg is not installed (ENOENT)", async () => {
    vi.mocked(execFileSync)
      .mockReturnValueOnce("60\n"); // ffprobe works

    const err = Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" });
    vi.mocked(execFileSync).mockImplementationOnce(() => { throw err; });

    // Reset and set up properly: ffprobe success, then ffmpeg ENOENT
    vi.mocked(execFileSync).mockReset();
    vi.mocked(execFileSync)
      .mockReturnValueOnce("60\n") // ffprobe
      .mockImplementation(() => { throw err; }); // ffmpeg ENOENT

    const result = await extractLocalFrames("/tmp/video.mp4", [5]);
    expect(result.frames).toEqual([]);
    expect(result.error).toContain("ffmpeg");
  });

  it("returns error when ffprobe fails", async () => {
    const err = Object.assign(new Error("spawn ffprobe ENOENT"), { code: "ENOENT" });
    vi.mocked(execFileSync).mockImplementation(() => { throw err; });

    const result = await extractLocalFrames("/tmp/video.mp4", [5]);
    expect(result.error).toContain("ffprobe");
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

## Task 4 — Implement `src/extract/frames.ts` — timestamp parsing and formatting

**Files:**

- `src/extract/frames.ts`

### Steps

- [ ] **4.1** Create the file with imports, the `VideoFrame` type import, and the timestamp parsing/formatting utilities:

```typescript
import { execFileSync } from "node:child_process";
import type { VideoFrame } from "./pipeline.ts";

const MAX_FRAMES = 12;
const DEFAULT_RANGE_FRAMES = 6;
const FRAME_INTERVAL_S = 5;

/**
 * Parse a timestamp string into seconds.
 * Supports: "H:MM:SS", "MM:SS", "SS" (plain number).
 */
function parseTimestamp(ts: string): number {
  const parts = ts.trim().split(":").map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

/**
 * Parse the timestamp parameter into an array of seconds to extract frames at.
 *
 * - No timestamp, no frames → []
 * - Range "start-end" → evenly-spaced points (default 6 or `frames` count)
 * - Single timestamp + frames → N timestamps at 5s intervals
 * - Single timestamp only → [parsedSeconds]
 * - No timestamp + frames + duration → evenly distributed across duration
 */
export function parseTimestampParam(
  timestamp: string | undefined,
  frames?: number,
  duration?: number,
): number[] {
  const count = frames ? Math.min(frames, MAX_FRAMES) : undefined;

  // No timestamp, no frames → empty
  if (!timestamp && !count) return [];

  // No timestamp but frames requested → distribute across duration
  if (!timestamp && count) {
    if (duration == null || duration <= 0) return [];
    if (count === 1) return [0];
    const step = duration / (count - 1);
    return Array.from({ length: count }, (_, i) => Math.round(step * i));
  }

  // Has timestamp — check for range (contains "-" but not just a negative number)
  const rangeMatch = timestamp!.match(/^([^-]+)-(.+)$/);
  // Disambiguate: "10-20" is a range, "-5" is not
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

  // Single timestamp + frames → intervals of 5s
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

## Task 5 — Implement error mapping helpers and stream info functions

**Files:**

- `src/extract/frames.ts`

### Steps

- [ ] **5.1** Append the error mapping helpers and `getYouTubeStreamInfo` after `formatSeconds`:

```typescript
// --- Error mapping helpers ---

function isEnoent(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as { code: unknown }).code === "ENOENT"
  );
}

function isTimeout(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const e = err as { killed?: boolean; signal?: string };
  return e.killed === true || e.signal === "SIGTERM";
}

function mapYtDlpError(err: unknown): string {
  if (isEnoent(err)) {
    return "yt-dlp is not installed. Install with: brew install yt-dlp";
  }
  if (isTimeout(err)) {
    return "yt-dlp timed out fetching video info";
  }
  // Check stderr for specific yt-dlp errors
  const stderr = (err as { stderr?: string }).stderr ?? "";
  const message = err instanceof Error ? err.message : String(err);
  const combined = `${stderr} ${message}`.toLowerCase();

  if (combined.includes("private")) {
    return "Video is private. Sign in if you've been granted access.";
  }
  if (combined.includes("sign in") || combined.includes("login")) {
    return "Video requires sign-in to access.";
  }
  if (combined.includes("unavailable") || combined.includes("not available")) {
    return "Video is unavailable.";
  }
  if (combined.includes("live")) {
    return "Live streams are not supported for frame extraction.";
  }
  return `yt-dlp error: ${message}`;
}

function mapFfmpegError(err: unknown): string {
  if (isEnoent(err)) {
    return "ffmpeg required for frame extraction";
  }
  if (isTimeout(err)) {
    return "ffmpeg timed out extracting frame";
  }
  const message = err instanceof Error ? err.message : String(err);
  return `ffmpeg error: ${message}`;
}

// --- Stream info functions ---

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
      { timeout: 15000, encoding: "utf-8" },
    );
    const lines = output.trim().split("\n");
    if (lines.length < 2) {
      return { error: "yt-dlp returned unexpected output format" };
    }
    const durationStr = lines[0].trim();
    const streamUrl = lines[1].trim();
    const duration = durationStr === "NA" ? null : Number(durationStr) || null;
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
      { timeout: 10000, encoding: "utf-8" },
    );
    const duration = parseFloat(output.trim());
    if (isNaN(duration)) {
      return { error: `ffprobe returned invalid duration: ${output.trim()}` };
    }
    return duration;
  } catch (err) {
    if (isEnoent(err)) {
      return { error: "ffprobe is not installed. Install ffmpeg which includes ffprobe" };
    }
    if (isTimeout(err)) {
      return { error: "ffprobe timed out reading video duration" };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { error: `ffprobe error: ${message}` };
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
// --- Frame extraction ---

const FFMPEG_FRAME_TIMEOUT = 30000; // 30s per frame
const FFMPEG_MAX_BUFFER = 5 * 1024 * 1024; // 5MB

/**
 * Extract a single frame from a video source at the given timestamp.
 * Returns the frame as a Buffer, or null on failure.
 */
function extractSingleFrame(
  source: string,
  timestampSec: number,
  signal?: AbortSignal,
): Buffer | null {
  if (signal?.aborted) return null;
  try {
    const result = execFileSync(
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
      },
    );
    // execFileSync returns Buffer when encoding is not specified
    const buf = Buffer.isBuffer(result) ? result : Buffer.from(result, "binary");
    if (buf.length === 0) return null;
    return buf;
  } catch {
    return null;
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
    const buf = extractSingleFrame(info.streamUrl, t, signal);
    if (buf) {
      frames.push({
        data: buf.toString("base64"),
        mimeType: "image/jpeg",
        timestamp: formatSeconds(t),
      });
    } else if (!firstError) {
      firstError = mapFfmpegError(new Error(`Failed to extract frame at ${formatSeconds(t)}`));
    }
  }

  return {
    frames,
    duration: info.duration,
    error: frames.length === 0 ? firstError : null,
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
  let duration: number | null = null;
  if (typeof durationResult === "number") {
    duration = durationResult;
  } else {
    // ffprobe failed — return error immediately
    return { frames: [], duration: null, error: durationResult.error };
  }

  const frames: VideoFrame[] = [];
  let firstError: string | null = null;

  for (const t of timestamps) {
    if (signal?.aborted) break;
    try {
      const result = execFileSync(
        "ffmpeg",
        [
          "-ss", String(t),
          "-i", filePath,
          "-frames:v", "1",
          "-f", "image2pipe",
          "-vcodec", "mjpeg",
          "pipe:1",
        ],
        {
          maxBuffer: FFMPEG_MAX_BUFFER,
          timeout: FFMPEG_FRAME_TIMEOUT,
        },
      );
      const buf = Buffer.isBuffer(result) ? result : Buffer.from(result, "binary");
      if (buf.length > 0) {
        frames.push({
          data: buf.toString("base64"),
          mimeType: "image/jpeg",
          timestamp: formatSeconds(t),
        });
      } else if (!firstError) {
        firstError = `Empty frame at ${formatSeconds(t)}`;
      }
    } catch (err) {
      if (!firstError) {
        firstError = mapFfmpegError(err);
      }
    }
  }

  return {
    frames,
    duration,
    error: frames.length === 0 ? firstError : null,
  };
}
```

- [ ] **6.2** Run the full test file:

```bash
pnpm vitest run tests/extract/frames.test.ts
```

Expected: All tests pass.

---

## Task 7 — Verify VideoFrame type compatibility

**Files:** (none modified)

### Steps

- [ ] **7.1** Confirm that `VideoFrame` is exported from `pipeline.ts`. If Phase 1 has not yet added it, add the interface to `src/extract/pipeline.ts`:

```typescript
export interface VideoFrame {
  data: string; // base64-encoded JPEG
  mimeType: string; // "image/jpeg"
  timestamp: string; // formatted: "1:23:45" or "0:05:30"
}
```

Place this after the `ExtractedContent` interface. If it already exists (from Phase 1), skip this step.

- [ ] **7.2** Run type checking:

```bash
pnpm run typecheck
```

Expected: No type errors. The `import type { VideoFrame } from "./pipeline.ts"` in frames.ts resolves correctly.

---

## Task 8 — Full verification

**Files:** (none modified)

### Steps

- [ ] **8.1** Run the full test suite:

```bash
pnpm test
```

Expected: All tests pass, including the new `tests/extract/frames.test.ts`.

- [ ] **8.2** Run type checking:

```bash
pnpm run typecheck
```

Expected: No type errors.

- [ ] **8.3** Run linting:

```bash
pnpm run lint
```

Expected: No lint errors.

- [ ] **8.4** Commit the changes:

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
- Graceful error handling for missing tools (ENOENT), timeouts,
  private/unavailable videos, and partial frame failures
- Comprehensive test coverage with mocked execFileSync

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

## Implementation Notes

### VideoFrame dependency on Phase 1

This phase imports `VideoFrame` from `pipeline.ts`. If Phase 1 has not yet been implemented, Task 7.1 adds the minimal interface. The interface is intentionally simple (3 string fields) and won't conflict with Phase 1's broader ExtractedContent changes.

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

The project's existing `stubExec()` helper in `tests/helpers.ts` is designed for DuckDuckGo's `execFile` callback pattern, not `execFileSync`, so we use `vi.mock` directly.

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
| `src/extract/frames.ts`      | New file — timestamp parsing, formatting, stream info, frame extraction |
| `tests/extract/frames.test.ts` | New file — comprehensive tests for all exported functions              |
| `src/extract/pipeline.ts`    | Add `VideoFrame` interface if not already present from Phase 1         |
