import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { readFile } from "node:fs/promises";
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
  ".3gpp": "video/3gpp",
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
      filePath = decodeURIComponent(new URL(input).pathname);
    } catch {
      return null;
    }
  }

  // Check extension
  const ext = extname(filePath).toLowerCase();
  const mimeType = VIDEO_EXTENSIONS[ext];
  if (!mimeType) return null;

  // Resolve to absolute path
  const absolutePath = resolve(filePath);

  // Check file exists and get size
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(absolutePath);
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
  const displayName = basename(info.absolutePath);

  // Step 1: Initiate resumable upload
  const initResponse = await fetch(uploadBase, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(info.sizeBytes),
      "X-Goog-Upload-Header-Content-Type": info.mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: displayName } }),
    signal,
  });

  if (!initResponse.ok) {
    const text = await initResponse.text();
    throw new Error(
      `Files API upload init failed: ${initResponse.status} (${text.slice(0, 200)})`,
    );
  }

  const uploadUrl = initResponse.headers.get("x-goog-upload-url");
  if (!uploadUrl) {
    throw new Error("Files API upload init: missing x-goog-upload-url header");
  }

  // Step 2: Upload file data
  const fileData = await readFile(info.absolutePath);
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
    const text = await uploadResponse.text();
    throw new Error(
      `Files API upload failed: ${uploadResponse.status} (${text.slice(0, 200)})`,
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
  const effectivePrompt = options?.prompt ?? DEFAULT_PROMPT;
  const effectiveModel = options?.model ?? config.video?.preferredModel ?? "gemini-3-flash-preview";

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

      // Query with file reference (videoUri positional, mimeType in options)
      const response = await queryGeminiApi(effectivePrompt, uploaded.uri, {
        model: effectiveModel,
        mimeType: info.mimeType,
        signal,
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
  if (!text) {
    const cookies = await isGeminiWebAvailable();
    if (cookies) {
      try {
        const webResult = await queryWithCookies(effectivePrompt, cookies, {
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
  }

  if (!text) return null;

  // ----- Auto-thumbnail (non-blocking) -----
  const thumbnail = extractVideoFrame(info.absolutePath, 1);

  // ----- Build result -----
  const title = extractHeadingTitle(text) ?? basename(info.absolutePath);

  const result: ExtractedContent = {
    text,
    title,
    url: `file://${info.absolutePath}`,
    extractionChain: chain,
    chars: text.length,
    truncated: false,
    thumbnail: thumbnail ?? undefined,
  };

  return result;
}
