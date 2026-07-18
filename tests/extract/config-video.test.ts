import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect } from "vitest";
import {
  FALLBACK_ENV_MAP,
  DEFAULT_GEMINI_CONFIG,
  DEFAULT_YOUTUBE_CONFIG,
  DEFAULT_VIDEO_CONFIG,
  loadConfig,
} from "../../src/config.ts";

describe("FALLBACK_ENV_MAP — gemini entry", () => {
  it("maps gemini to GEMINI_API_KEY", () => {
    expect(FALLBACK_ENV_MAP.gemini).toBe("GEMINI_API_KEY");
  });

  it("preserves existing provider mappings", () => {
    expect(FALLBACK_ENV_MAP.brave).toBe("BRAVE_API_KEY");
    expect(FALLBACK_ENV_MAP.exa).toBe("EXA_API_KEY");
    expect(FALLBACK_ENV_MAP["openai-web-search"]).toBe("OPENAI_API_KEY");
  });
});

describe("DEFAULT_GEMINI_CONFIG", () => {
  it("has correct defaults", () => {
    expect(DEFAULT_GEMINI_CONFIG).toEqual({
      baseUrl: "https://generativelanguage.googleapis.com",
      allowBrowserCookies: false,
      chromeProfile: "Default",
    });
  });
});

describe("DEFAULT_YOUTUBE_CONFIG", () => {
  it("has correct defaults", () => {
    expect(DEFAULT_YOUTUBE_CONFIG).toEqual({
      enabled: true,
      preferredModel: "gemini-3-flash-preview",
    });
  });
});

describe("DEFAULT_VIDEO_CONFIG", () => {
  it("has correct defaults", () => {
    expect(DEFAULT_VIDEO_CONFIG).toEqual({
      enabled: true,
      preferredModel: "gemini-3-flash-preview",
      maxSizeMB: 50,
    });
  });
});

describe("loadConfig — video config passthrough", () => {
  it("passes through gemini/youtube/video when present in file", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-tools-test-"));
    const configPath = path.join(tmpDir, "tools.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        gemini: { apiKey: "test-key", baseUrl: "https://custom.example.com" },
        youtube: { enabled: false, preferredModel: "gemini-2.5-pro" },
        video: { enabled: true, maxSizeMB: 100 },
      }),
    );
    try {
      const config = loadConfig(configPath);
      expect(config.gemini).toEqual({ apiKey: "test-key", baseUrl: "https://custom.example.com" });
      expect(config.youtube).toEqual({ enabled: false, preferredModel: "gemini-2.5-pro" });
      expect(config.video).toEqual({ enabled: true, maxSizeMB: 100 });
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});
