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
