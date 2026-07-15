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

  it("returns error on AbortError", async () => {
    const err = Object.assign(new Error("aborted"), { name: "AbortError" });
    vi.mocked(execFileSync).mockImplementation(() => { throw err; });
    const result = await getYouTubeStreamInfo("abc123");
    expect(result).toEqual({
      error: "yt-dlp timed out fetching video info",
    });
  });

  it("returns error on ETIMEDOUT", async () => {
    const err = Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
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

  it("returns 403 error for expired stream URL", async () => {
    const err = Object.assign(new Error("ffmpeg failed"), {
      stderr: Buffer.from("HTTP 403: Forbidden"),
    });
    vi.mocked(execFileSync)
      .mockReturnValueOnce("300\nhttps://stream.example.com/video\n") // yt-dlp
      .mockImplementation(() => { throw err; }); // ffmpeg gets 403

    const result = await extractYouTubeFrames("testVideo", [10]);
    expect(result.frames).toEqual([]);
    expect(result.error).toContain("403");
    expect(result.error).toContain("expired");
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
