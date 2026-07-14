# Content Extraction Phase 1 — Config Schema & Type Extensions

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend pi-tools' type system and config to support video/YouTube features. Add `VideoFrame` interface, extend `ExtractedContent` and `ExtractOptions` with video fields, add `GeminiConfig`/`YouTubeConfig`/`VideoConfig` interfaces with defaults, and wire `GEMINI_API_KEY` into `FALLBACK_ENV_MAP`.

**Architecture:** This is Phase 1 of the Content Extraction feature (7 phases total). It modifies `src/extract/pipeline.ts` (type definitions only) and `src/config.ts` (new interfaces, defaults, FALLBACK_ENV_MAP entry, PiToolsConfig extension). All changes are additive — no existing behavior changes. Later phases consume these types.

**Tech Stack:** TypeScript, Vitest, existing config infrastructure

**Parent plan:** `docs/superpowers/plans/2026-07-13-content-extraction.md`

---

## Task 1 — Add VideoFrame interface and extend ExtractedContent + ExtractOptions

**Files:**

- `src/extract/pipeline.ts`

### Steps

- [ ] **1.1** Add the `VideoFrame` interface immediately after the `ExtractedContent` interface (after line 28):

```typescript
export interface VideoFrame {
  data: string;
  mimeType: string;
  timestamp: string;
}
```

- [ ] **1.2** Extend `ExtractedContent` with optional video fields. Add these fields before the closing brace of the interface (after `contentId?: string;`):

```typescript
export interface ExtractedContent {
  text: string;
  title?: string;
  url: string;
  extractionChain: string[];
  chars: number;
  truncated: boolean;
  contentId?: string;
  thumbnail?: { data: string; mimeType: string };
  frames?: VideoFrame[];
  duration?: number;
}
```

- [ ] **1.3** Extend `ExtractOptions` with video-related fields. Add these fields before the closing brace of the interface (after `allowRanges?: string[];`):

```typescript
export interface ExtractOptions {
  raw?: boolean;
  github?: GitHubConfig;
  allowRanges?: string[];
  prompt?: string;
  timestamp?: string;
  frames?: number;
  model?: string;
}
```

- [ ] **1.4** Verify typecheck passes with the new interfaces:

```bash
pnpm run typecheck
```

Expected: No type errors. The new fields are all optional so existing callers are unaffected.

---

## Task 2 — Add Gemini/YouTube/Video config interfaces and defaults

**Files:**

- `src/config.ts`

### Steps

- [ ] **2.1** Add the three new config interfaces after the existing `DeepResearchConfig` interface (after line 55, before `export interface PiToolsConfig`):

```typescript
export interface GeminiConfig {
  apiKey?: string;
  baseUrl?: string;
  cloudflareApiKey?: string;
  allowBrowserCookies?: boolean;
  chromeProfile?: string;
}

export interface YouTubeConfig {
  enabled?: boolean;
  preferredModel?: string;
}

export interface VideoConfig {
  enabled?: boolean;
  preferredModel?: string;
  maxSizeMB?: number;
}
```

- [ ] **2.2** Extend the `PiToolsConfig` interface to include the three new optional sections. Add after `deepResearch: DeepResearchConfig;`:

```typescript
export interface PiToolsConfig {
  defaultProvider: string;
  selectionStrategy: SelectionStrategy;
  providers: Record<string, ProviderConfigEntry>;
  github: GitHubConfig;
  guidance?: Record<string, GuidanceOverride>;
  ssrf: SsrfConfig;
  combine: CombineConfig;
  deepResearch: DeepResearchConfig;
  gemini?: GeminiConfig;
  youtube?: YouTubeConfig;
  video?: VideoConfig;
}
```

- [ ] **2.3** Add default config constants after `DEFAULT_DEEP_RESEARCH_CONFIG` (after line 120):

```typescript
export const DEFAULT_GEMINI_CONFIG: Required<Pick<GeminiConfig, 'baseUrl' | 'allowBrowserCookies' | 'chromeProfile'>> = {
  baseUrl: "https://generativelanguage.googleapis.com",
  allowBrowserCookies: false,
  chromeProfile: "Default",
};

export const DEFAULT_YOUTUBE_CONFIG: Required<YouTubeConfig> = {
  enabled: true,
  preferredModel: "gemini-3-flash-preview",
};

export const DEFAULT_VIDEO_CONFIG: Required<VideoConfig> = {
  enabled: true,
  preferredModel: "gemini-3-flash-preview",
  maxSizeMB: 50,
};
```

- [ ] **2.4** Add `gemini` to `FALLBACK_ENV_MAP`. Insert after the `"openai-codex": "OPENAI_API_KEY"` entry:

```typescript
export const FALLBACK_ENV_MAP: Record<string, string> = {
  brave: "BRAVE_API_KEY",
  "brave-llm": "BRAVE_API_KEY",
  exa: "EXA_API_KEY",
  jina: "JINA_API_KEY",
  tavily: "TAVILY_API_KEY",
  serper: "SERPER_API_KEY",
  firecrawl: "FIRECRAWL_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  langsearch: "LANGSEARCH_API_KEY",
  linkup: "LINKUP_API_KEY",
  youcom: "YOUCOM_API_KEY",
  fastcrw: "FASTCRW_API_KEY",
  sofya: "SOFYA_API_KEY",
  websearchapi: "WEBSEARCHAPI_API_KEY",
  marginalia: "MARGINALIA_API_KEY",
  context7: "CONTEXT7_API_KEY",
  parallel: "PARALLEL_API_KEY",
  "openai-native": "OPENAI_API_KEY",
  "openai-codex": "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
};
```

- [ ] **2.5** Modify `parseConfigFile` to pass through the new optional sections. `parseConfigFile` constructs its return value field-by-field (no spread of the raw JSON), so new fields must be explicitly included. Add after the `deepResearch` line in the return object:

```typescript
function parseConfigFile(raw: string): PiToolsConfig {
  const parsed = JSON.parse(raw);

  const strategy =
    parsed.selectionStrategy === "auto" || parsed.selectionStrategy === "best-performing"
      ? (parsed.selectionStrategy as SelectionStrategy)
      : DEFAULT_CONFIG.selectionStrategy;

  return {
    defaultProvider: parsed.defaultProvider ?? DEFAULT_CONFIG.defaultProvider,
    selectionStrategy: strategy,
    providers: {
      ...DEFAULT_CONFIG.providers,
      ...parsed.providers,
    },
    github: {
      ...DEFAULT_CONFIG.github,
      ...parsed.github,
    },
    guidance: parsed.guidance,
    ssrf: validateSsrfConfig(parsed.ssrf),
    combine: validateCombineConfig(parsed.combine),
    deepResearch: validateDeepResearchConfig(parsed.deepResearch),
    gemini: parsed.gemini,
    youtube: parsed.youtube,
    video: parsed.video,
  };
}
```

The new fields are passed through raw (no validation) — validation will be added in Phase 2 when the Gemini client consumes them.

- [ ] **2.6** Verify typecheck passes:

```bash
pnpm run typecheck
```

Expected: No type errors. New `PiToolsConfig` fields are optional, so `DEFAULT_CONFIG` remains valid without them.

---

## Task 3 — Write tests for new config loading

**Files:**

- `tests/extract/config-video.test.ts` (new file)

### Steps

- [ ] **3.1** Create the test file `tests/extract/config-video.test.ts` with the following content:

```typescript
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
  type GeminiConfig,
  type YouTubeConfig,
  type VideoConfig,
  type PiToolsConfig,
} from "../../src/config.ts";
import type { ExtractOptions, VideoFrame, ExtractedContent } from "../../src/extract/pipeline.ts";

describe("FALLBACK_ENV_MAP — gemini entry", () => {
  it("maps gemini to GEMINI_API_KEY", () => {
    expect(FALLBACK_ENV_MAP.gemini).toBe("GEMINI_API_KEY");
  });

  it("preserves all existing provider mappings", () => {
    expect(FALLBACK_ENV_MAP.brave).toBe("BRAVE_API_KEY");
    expect(FALLBACK_ENV_MAP.exa).toBe("EXA_API_KEY");
    expect(FALLBACK_ENV_MAP["openai-codex"]).toBe("OPENAI_API_KEY");
  });
});

describe("DEFAULT_GEMINI_CONFIG", () => {
  it("has correct baseUrl", () => {
    expect(DEFAULT_GEMINI_CONFIG.baseUrl).toBe(
      "https://generativelanguage.googleapis.com",
    );
  });

  it("disables browser cookies by default", () => {
    expect(DEFAULT_GEMINI_CONFIG.allowBrowserCookies).toBe(false);
  });

  it("uses Default chrome profile", () => {
    expect(DEFAULT_GEMINI_CONFIG.chromeProfile).toBe("Default");
  });
});

describe("DEFAULT_YOUTUBE_CONFIG", () => {
  it("is enabled by default", () => {
    expect(DEFAULT_YOUTUBE_CONFIG.enabled).toBe(true);
  });

  it("uses gemini-3-flash-preview as preferred model", () => {
    expect(DEFAULT_YOUTUBE_CONFIG.preferredModel).toBe("gemini-3-flash-preview");
  });
});

describe("DEFAULT_VIDEO_CONFIG", () => {
  it("is enabled by default", () => {
    expect(DEFAULT_VIDEO_CONFIG.enabled).toBe(true);
  });

  it("uses gemini-3-flash-preview as preferred model", () => {
    expect(DEFAULT_VIDEO_CONFIG.preferredModel).toBe("gemini-3-flash-preview");
  });

  it("has 50MB max size", () => {
    expect(DEFAULT_VIDEO_CONFIG.maxSizeMB).toBe(50);
  });
});

describe("PiToolsConfig — new optional sections", () => {
  it("loadConfig returns config without gemini/youtube/video when not in file", () => {
    // loadConfig with no file returns defaults — new fields should be undefined
    const config = loadConfig("/nonexistent/path/tools.json");
    expect(config.gemini).toBeUndefined();
    expect(config.youtube).toBeUndefined();
    expect(config.video).toBeUndefined();
  });

  it("loadConfig passes through gemini/youtube/video when present in file", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-tools-test-"));
    const configPath = path.join(tmpDir, "tools.json");
    fs.writeFileSync(configPath, JSON.stringify({
      gemini: { apiKey: "test-key", baseUrl: "https://custom.example.com" },
      youtube: { enabled: false, preferredModel: "gemini-2.5-pro" },
      video: { enabled: true, maxSizeMB: 100 },
    }));
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

describe("ExtractOptions — video fields (type-level)", () => {
  it("accepts prompt field", () => {
    const opts: ExtractOptions = { prompt: "Summarize this video" };
    expect(opts.prompt).toBe("Summarize this video");
  });

  it("accepts timestamp field", () => {
    const opts: ExtractOptions = { timestamp: "1:23" };
    expect(opts.timestamp).toBe("1:23");
  });

  it("accepts frames field", () => {
    const opts: ExtractOptions = { frames: 5 };
    expect(opts.frames).toBe(5);
  });

  it("accepts model field", () => {
    const opts: ExtractOptions = { model: "gemini-3-flash-preview" };
    expect(opts.model).toBe("gemini-3-flash-preview");
  });

  it("remains backward-compatible with existing fields", () => {
    const opts: ExtractOptions = {
      raw: true,
      github: { enabled: true, maxRepoSizeMB: 100, cloneTimeoutSeconds: 30 },
      allowRanges: ["10.0.0.0/8"],
    };
    expect(opts.raw).toBe(true);
  });
});

describe("VideoFrame interface (type-level)", () => {
  it("accepts valid VideoFrame shape", () => {
    const frame: VideoFrame = {
      data: "base64data",
      mimeType: "image/jpeg",
      timestamp: "0:30",
    };
    expect(frame.data).toBe("base64data");
    expect(frame.mimeType).toBe("image/jpeg");
    expect(frame.timestamp).toBe("0:30");
  });
});

describe("ExtractedContent — video fields (type-level)", () => {
  it("accepts thumbnail field", () => {
    const content: ExtractedContent = {
      text: "transcript",
      url: "https://youtube.com/watch?v=abc",
      extractionChain: ["youtube"],
      chars: 10,
      truncated: false,
      thumbnail: { data: "base64thumb", mimeType: "image/jpeg" },
    };
    expect(content.thumbnail?.mimeType).toBe("image/jpeg");
  });

  it("accepts frames field", () => {
    const frame: VideoFrame = {
      data: "base64",
      mimeType: "image/png",
      timestamp: "1:00",
    };
    const content: ExtractedContent = {
      text: "analysis",
      url: "file:///video.mp4",
      extractionChain: ["video"],
      chars: 8,
      truncated: false,
      frames: [frame],
    };
    expect(content.frames).toHaveLength(1);
  });

  it("accepts duration field", () => {
    const content: ExtractedContent = {
      text: "video content",
      url: "https://example.com/video.mp4",
      extractionChain: ["video"],
      chars: 13,
      truncated: false,
      duration: 120.5,
    };
    expect(content.duration).toBe(120.5);
  });
});

describe("Config interfaces — type shapes", () => {
  it("GeminiConfig accepts all optional fields", () => {
    const config: GeminiConfig = {
      apiKey: "test-key",
      baseUrl: "https://custom.endpoint.com",
      cloudflareApiKey: "cf-key",
      allowBrowserCookies: true,
      chromeProfile: "Profile 1",
    };
    expect(config.apiKey).toBe("test-key");
    expect(config.cloudflareApiKey).toBe("cf-key");
  });

  it("YouTubeConfig accepts all optional fields", () => {
    const config: YouTubeConfig = {
      enabled: false,
      preferredModel: "gemini-2.5-pro",
    };
    expect(config.enabled).toBe(false);
  });

  it("VideoConfig accepts all optional fields", () => {
    const config: VideoConfig = {
      enabled: false,
      preferredModel: "gemini-2.5-pro",
      maxSizeMB: 100,
    };
    expect(config.maxSizeMB).toBe(100);
  });
});
```

- [ ] **3.2** Run the new test file to confirm all tests pass:

```bash
pnpm vitest run tests/extract/config-video.test.ts
```

Expected: All tests pass.

---

## Task 4 — Full verification

**Files:** (none modified)

### Steps

- [ ] **4.1** Run the full test suite:

```bash
pnpm test
```

Expected: All tests pass including existing ones (no regressions).

- [ ] **4.2** Run type checking:

```bash
pnpm run typecheck
```

Expected: No type errors.

- [ ] **4.3** Run linting:

```bash
pnpm run lint
```

Expected: No lint errors.

- [ ] **4.4** Commit the changes:

```bash
git add src/extract/pipeline.ts src/config.ts tests/extract/config-video.test.ts
git commit -m "feat(extract): add video/YouTube config types and ExtractOptions extensions

Phase 1 of content extraction feature:
- Add VideoFrame interface to pipeline.ts
- Extend ExtractedContent with thumbnail, frames, duration fields
- Extend ExtractOptions with prompt, timestamp, frames, model fields
- Add GeminiConfig, YouTubeConfig, VideoConfig interfaces
- Add DEFAULT_GEMINI_CONFIG, DEFAULT_YOUTUBE_CONFIG, DEFAULT_VIDEO_CONFIG
- Add gemini entry to FALLBACK_ENV_MAP
- Extend PiToolsConfig with gemini?, youtube?, video? sections
- Wire new fields through parseConfigFile (raw passthrough)
- Add comprehensive type-level and config-loading tests

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

## Implementation Notes

### Additive-only changes

All modifications in this phase are purely additive:

- New interfaces (`VideoFrame`, `GeminiConfig`, `YouTubeConfig`, `VideoConfig`) add types but change no runtime behavior
- New fields on `ExtractedContent` and `ExtractOptions` are all optional — no existing caller breaks
- New `PiToolsConfig` fields are optional — `DEFAULT_CONFIG` and `parseConfigFile` remain valid without setting them
- The `FALLBACK_ENV_MAP` addition is a new key — no collision with existing entries

### Why gemini goes in FALLBACK_ENV_MAP

The `gemini` entry allows `resolveProviderKey("gemini")` to automatically resolve from `GEMINI_API_KEY` env var without explicit config. This mirrors how other providers (brave, exa, etc.) get their keys resolved. Phases 2-3 will use this when initializing the Gemini API client.

### Default model choice

`gemini-3-flash-preview` is chosen as the default `preferredModel` for both YouTube and Video configs. This is the fastest multimodal Gemini model suitable for transcript/video analysis. Users can override via config.

### parseConfigFile modified (raw passthrough)

`parseConfigFile` constructs its return value field-by-field (no spread of the raw JSON). Without modification, new config fields like `gemini`, `youtube`, `video` would be silently dropped even when present in the user's `tools.json`. This phase adds them as raw passthrough (`parsed.gemini`, `parsed.youtube`, `parsed.video`) — no validation. Strict validation (similar to `validateCombineConfig`) will be added in Phase 2 when the Gemini client actually consumes these values.

### Test strategy

The tests in `tests/extract/config-video.test.ts` serve two purposes:
1. **Runtime tests** — verify defaults have correct values, FALLBACK_ENV_MAP has the entry, loadConfig handles missing sections
2. **Type-level tests** — verify the interfaces accept the expected shapes (these would fail at compile time if types are wrong, but the runtime assertions provide readable documentation)

---

## Summary of Changes

| File | Change |
| --- | --- |
| `src/extract/pipeline.ts` | Add `VideoFrame` interface; extend `ExtractedContent` with `thumbnail`, `frames`, `duration`; extend `ExtractOptions` with `prompt`, `timestamp`, `frames`, `model` |
| `src/config.ts` | Add `GeminiConfig`, `YouTubeConfig`, `VideoConfig` interfaces; add `DEFAULT_GEMINI_CONFIG`, `DEFAULT_YOUTUBE_CONFIG`, `DEFAULT_VIDEO_CONFIG` constants; add `gemini: "GEMINI_API_KEY"` to `FALLBACK_ENV_MAP`; extend `PiToolsConfig` with `gemini?`, `youtube?`, `video?`; wire new fields through `parseConfigFile` |
| `tests/extract/config-video.test.ts` | New file — tests for defaults, FALLBACK_ENV_MAP, type shapes, config loading |
