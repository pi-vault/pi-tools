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
    const statSpy = vi.spyOn(fs, "statSync").mockReturnValue({
      isFile: () => true,
      size: 60 * 1024 * 1024,
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

  it("recognizes all supported extensions", () => {
    const extensions = [".mp4", ".mov", ".webm", ".avi", ".mpeg", ".mpg", ".wmv", ".flv", ".3gp", ".3gpp"];
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

// ============================================================
// extractVideo tests
// ============================================================

import { extractVideo, type VideoFileInfo } from "../../src/extract/video.ts";

vi.mock("../../src/extract/gemini-api.ts", () => ({
  queryGeminiApi: vi.fn(),
  getApiKey: vi.fn(() => "test-api-key"),
  getVersionedApiBase: vi.fn(() => "https://generativelanguage.googleapis.com/v1beta"),
}));

// isGeminiWebAvailable is async, returns CookieMap | null (NOT a boolean)
vi.mock("../../src/extract/gemini-web.ts", () => ({
  isGeminiWebAvailable: vi.fn(async () => null),
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
    mockIsGeminiWebAvailable.mockResolvedValue(null);
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("succeeds via Gemini API: upload → poll → query → delete", async () => {
    const mockFetch = vi.mocked(global.fetch);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "x-goog-upload-url": "https://upload.example.com/resume/123" }),
      text: async () => "",
    } as Response);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ file: { name: "files/abc123", uri: "gs://files/abc123" } }),
    } as Response);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ state: "ACTIVE" }),
    } as Response);

    mockQueryGeminiApi.mockResolvedValueOnce(
      "# Video Analysis\n\nThis is a tutorial about TypeScript.",
    );

    mockFetch.mockResolvedValueOnce({ ok: true } as Response);

    const fsPromises = await import("node:fs/promises");
    vi.spyOn(fsPromises, "readFile").mockResolvedValue(Buffer.alloc(testInfo.sizeBytes) as unknown as string & Buffer);

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

    // Verify queryGeminiApi was called with videoUri as positional second arg
    expect(mockQueryGeminiApi).toHaveBeenCalledWith(
      expect.any(String),
      "gs://files/abc123",
      expect.objectContaining({ mimeType: "video/mp4" }),
    );
  });

  it("returns null when both Gemini API and Web fail", async () => {
    const mockFetch = vi.mocked(global.fetch);

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "server error",
    } as Response);

    mockIsGeminiWebAvailable.mockResolvedValue(null);

    const result = await extractVideo(testInfo);
    expect(result).toBeNull();
  });

  it("falls through to title from filename when no heading found", async () => {
    const mockFetch = vi.mocked(global.fetch);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "x-goog-upload-url": "https://upload.example.com/resume/456" }),
      text: async () => "",
    } as Response);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ file: { name: "files/def456", uri: "gs://files/def456" } }),
    } as Response);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ state: "ACTIVE" }),
    } as Response);
    mockFetch.mockResolvedValueOnce({ ok: true } as Response);

    mockQueryGeminiApi.mockResolvedValueOnce("Just plain text content without a heading.");

    const fsPromises = await import("node:fs/promises");
    vi.spyOn(fsPromises, "readFile").mockResolvedValue(Buffer.alloc(testInfo.sizeBytes) as unknown as string & Buffer);

    const result = await extractVideo(testInfo);
    expect(result).not.toBeNull();
    expect(result!.title).toBe("test-video.mp4");
  });
});

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
    const fakeCookies = { "__Secure-1PSID": "abc", "__Secure-1PSIDTS": "xyz" };
    mockIsGeminiWebAvailable.mockResolvedValue(fakeCookies);
    mockQueryWithCookies.mockResolvedValueOnce(
      "# Screen Recording\n\nUser demonstrates VS Code shortcuts.",
    );

    const result = await extractVideo(testInfo);

    expect(result).not.toBeNull();
    expect(result!.text).toContain("Screen Recording");
    expect(result!.extractionChain).toContain("gemini-web");
    expect(result!.extractionChain).not.toContain("gemini-api");

    // queryWithCookies must receive cookieMap as positional second arg
    expect(mockQueryWithCookies).toHaveBeenCalledWith(
      expect.any(String),
      fakeCookies,
      expect.objectContaining({ files: [testInfo.absolutePath] }),
    );
  });

  it("falls back to Gemini Web when API upload fails", async () => {
    mockGetApiKey.mockReturnValue("test-key");
    const mockFetch = vi.mocked(global.fetch);

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () => "forbidden",
    } as Response);

    const fakeCookies = { "__Secure-1PSID": "abc", "__Secure-1PSIDTS": "xyz" };
    mockIsGeminiWebAvailable.mockResolvedValue(fakeCookies);
    mockQueryWithCookies.mockResolvedValueOnce("# Fallback Result\n\nContent here.");

    const result = await extractVideo(testInfo);

    expect(result).not.toBeNull();
    expect(result!.extractionChain).toContain("gemini-web");
  });

  it("returns null when Gemini Web throws", async () => {
    mockGetApiKey.mockReturnValue(null);
    const fakeCookies = { "__Secure-1PSID": "abc", "__Secure-1PSIDTS": "xyz" };
    mockIsGeminiWebAvailable.mockResolvedValue(fakeCookies);
    mockQueryWithCookies.mockRejectedValueOnce(new Error("Gemini Web returned empty response"));

    const result = await extractVideo(testInfo);
    expect(result).toBeNull();
  });

  it("returns null when no cookies available and no API key", async () => {
    mockGetApiKey.mockReturnValue(null);
    mockIsGeminiWebAvailable.mockResolvedValue(null);

    const result = await extractVideo(testInfo);
    expect(result).toBeNull();
  });
});

describe("uploadToFilesApi (via extractVideo internals)", () => {
  const testInfo: VideoFileInfo = {
    absolutePath: "/tmp/upload-test.mp4",
    mimeType: "video/mp4",
    sizeBytes: 2 * 1024 * 1024,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetApiKey.mockReturnValue("test-api-key");
    mockIsGeminiWebAvailable.mockResolvedValue(null);
    global.fetch = vi.fn();

    const fsPromises = await import("node:fs/promises");
    vi.spyOn(fsPromises, "readFile").mockResolvedValue(Buffer.alloc(testInfo.sizeBytes) as unknown as string & Buffer);
  });

  it("fails gracefully when upload init returns no upload URL header", async () => {
    const mockFetch = vi.mocked(global.fetch);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({}),
      text: async () => "",
    } as Response);

    const result = await extractVideo(testInfo);
    expect(result).toBeNull();
  });

  it("fails gracefully when upload PUT returns non-ok", async () => {
    const mockFetch = vi.mocked(global.fetch);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "x-goog-upload-url": "https://upload.example.com/resume/789" }),
      text: async () => "",
    } as Response);

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 413,
      statusText: "Payload Too Large",
      text: async () => "payload too large",
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

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetApiKey.mockReturnValue("test-api-key");
    mockIsGeminiWebAvailable.mockResolvedValue(null);
    global.fetch = vi.fn();

    const fsPromises = await import("node:fs/promises");
    vi.spyOn(fsPromises, "readFile").mockResolvedValue(Buffer.alloc(testInfo.sizeBytes) as unknown as string & Buffer);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("handles FAILED state from file processing", async () => {
    const mockFetch = vi.mocked(global.fetch);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "x-goog-upload-url": "https://upload.example.com/resume/poll1" }),
      text: async () => "",
    } as Response);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ file: { name: "files/poll1", uri: "gs://files/poll1" } }),
    } as Response);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ state: "FAILED", error: { message: "Unsupported codec" } }),
    } as Response);

    const resultPromise = extractVideo(testInfo);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBeNull();
  });

  it("polls multiple times until ACTIVE", async () => {
    const mockFetch = vi.mocked(global.fetch);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "x-goog-upload-url": "https://upload.example.com/resume/poll2" }),
      text: async () => "",
    } as Response);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ file: { name: "files/poll2", uri: "gs://files/poll2" } }),
    } as Response);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ state: "PROCESSING" }),
    } as Response);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ state: "ACTIVE" }),
    } as Response);

    mockQueryGeminiApi.mockResolvedValueOnce("# Result\n\nVideo content.");

    mockFetch.mockResolvedValueOnce({ ok: true } as Response);

    const resultPromise = extractVideo(testInfo);
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).not.toBeNull();
    expect(result!.extractionChain).toContain("gemini-api");
  });
});

describe("extractVideo — auto-thumbnail", () => {
  const testInfo: VideoFileInfo = {
    absolutePath: "/tmp/thumb-test.mp4",
    mimeType: "video/mp4",
    sizeBytes: 1024,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetApiKey.mockReturnValue("test-api-key");
    mockIsGeminiWebAvailable.mockResolvedValue(null);
    global.fetch = vi.fn();

    const fsPromises = await import("node:fs/promises");
    vi.spyOn(fsPromises, "readFile").mockResolvedValue(Buffer.alloc(testInfo.sizeBytes) as unknown as string & Buffer);
  });

  it("includes thumbnail when ffmpeg succeeds", async () => {
    const mockFetch = vi.mocked(global.fetch);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "x-goog-upload-url": "https://upload.example.com/resume/thumb1" }),
      text: async () => "",
    } as Response);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ file: { name: "files/thumb1", uri: "gs://files/thumb1" } }),
    } as Response);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ state: "ACTIVE" }),
    } as Response);
    mockQueryGeminiApi.mockResolvedValueOnce("# Content\n\nSome analysis.");
    mockFetch.mockResolvedValueOnce({ ok: true } as Response);

    const childProcess = await import("node:child_process");
    vi.spyOn(childProcess, "execFileSync").mockReturnValue(
      Buffer.from("fake-jpeg-thumbnail") as unknown as ReturnType<typeof childProcess.execFileSync>,
    );

    const result = await extractVideo(testInfo);
    expect(result).not.toBeNull();
    expect(result!.thumbnail).toBeDefined();
    expect(result!.thumbnail!.mimeType).toBe("image/jpeg");
    expect(result!.thumbnail!.data).toBeTruthy();
  });

  it("still returns content when ffmpeg fails (thumbnail is optional)", async () => {
    const mockFetch = vi.mocked(global.fetch);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "x-goog-upload-url": "https://upload.example.com/resume/thumb2" }),
      text: async () => "",
    } as Response);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ file: { name: "files/thumb2", uri: "gs://files/thumb2" } }),
    } as Response);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ state: "ACTIVE" }),
    } as Response);
    mockQueryGeminiApi.mockResolvedValueOnce("# Analysis\n\nVideo analyzed.");
    mockFetch.mockResolvedValueOnce({ ok: true } as Response);

    const childProcess = await import("node:child_process");
    vi.spyOn(childProcess, "execFileSync").mockImplementation(() => {
      throw new Error("ffmpeg: command not found");
    });

    const result = await extractVideo(testInfo);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("Analysis");
    expect(result!.thumbnail).toBeUndefined();
  });
});
