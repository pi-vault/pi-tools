# Content Extraction Phase 4 — YouTube Transcript Extraction & Perplexity Fallback

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `src/extract/youtube.ts` and `src/extract/perplexity.ts` — YouTube URL detection, transcript extraction with Gemini Web → Gemini API → Perplexity fallback chain, and thumbnail fetching.

**Architecture:** This is Phase 4 of the Content Extraction expansion. It implements the YouTube extraction pipeline that uses a three-tier fallback chain (Gemini Web cookies → Gemini API key → Perplexity chat). The Perplexity module is a standalone wrapper around the Perplexity chat/completions API, distinct from the existing search provider in `src/providers/perplexity.ts`. Both modules are pure extractors with no pipeline routing — Phase 7 wires them into `pipeline.ts`.

**Tech Stack:** TypeScript, Vitest, native `fetch`, `stubFetch` from `tests/helpers.ts`, `vi.mock` for dependency isolation

**Parent plan:** `docs/superpowers/plans/2026-07-13-content-extraction.md`

**Spec:** `docs/superpowers/specs/2026-07-13-content-extraction-design.md`

**Dependencies from earlier phases (all already landed on master):**

| Import | Source | Phase |
|--------|--------|-------|
| `resolveProviderKey`, `FALLBACK_ENV_MAP` | `src/config.ts` | 1 |
| `loadConfig`, `DEFAULT_YOUTUBE_CONFIG`, `YouTubeConfig` | `src/config.ts` | 1 |
| `queryGeminiApi`, `isGeminiApiAvailable` | `src/extract/gemini-api.ts` | 2 |
| `isGeminiWebAvailable`, `queryWithCookies` | `src/extract/gemini-web.ts` | 3 |
| `ExtractedContent`, `ExtractOptions` | `src/extract/pipeline.ts` | 1 |

**Reference implementation:** `nicobailon-pi-web-access/youtube-extract.ts` and `perplexity.ts`

**Existing infrastructure already in place:**
- `config.ts` exports `YouTubeConfig` (`enabled?`, `preferredModel?`), `DEFAULT_YOUTUBE_CONFIG` (`{ enabled: true, preferredModel: "gemini-3-flash-preview" }`), and `loadConfig()` which parses `youtube` from tools.json.
- `config-video.test.ts` already validates these defaults.
- `ExtractedContent` in `pipeline.ts` already has `thumbnail?: { data: string; mimeType: string }`, `frames?: VideoFrame[]`, `duration?: number`.
- `FALLBACK_ENV_MAP` already maps `perplexity` → `PERPLEXITY_API_KEY`.

---

## Task 1 — Create `src/extract/perplexity.ts`

**Files:**

- `src/extract/perplexity.ts`

### Steps

- [ ] **1.1** Create `src/extract/perplexity.ts` with the following content:

```typescript
import { resolveProviderKey } from "../config.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";
const DEFAULT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether a Perplexity API key is available.
 * Uses resolveProviderKey which checks config + FALLBACK_ENV_MAP ("perplexity" → "PERPLEXITY_API_KEY").
 */
export function isPerplexityAvailable(): boolean {
  return !!getPerplexityKey();
}

/**
 * Query Perplexity chat/completions with a single user message.
 * Returns the assistant's response text.
 *
 * Used as the last-resort YouTube transcript fallback — provides a text summary
 * without visual understanding. Distinct from the search provider in
 * src/providers/perplexity.ts which returns structured SearchResult[].
 */
export async function queryPerplexity(
  query: string,
  signal?: AbortSignal,
): Promise<string> {
  const key = getPerplexityKey();
  if (!key) {
    throw new Error(
      "Perplexity API key not found. Set PERPLEXITY_API_KEY environment variable " +
        "or configure perplexity provider key in tools.json",
    );
  }

  const timeoutSignal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  const response = await fetch(PERPLEXITY_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar",
      messages: [{ role: "user", content: query }],
      max_tokens: 4096,
    }),
    signal: combinedSignal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Perplexity API error ${response.status}: ${errorText || response.statusText}`,
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Perplexity API returned empty response");
  }

  return content;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPerplexityKey(): string | undefined {
  return resolveProviderKey("perplexity");
}
```

- [ ] **1.2** Verify the file compiles without type errors:

```bash
pnpm run typecheck
```

Expected: No type errors. This file only imports from `config.ts` which is already on master.

---

## Task 2 — Create `src/extract/youtube.ts`

**Files:**

- `src/extract/youtube.ts`

### Steps

- [ ] **2.1** Create `src/extract/youtube.ts` with URL detection, config loading, and the full extraction pipeline:

```typescript
import {
  DEFAULT_YOUTUBE_CONFIG,
  loadConfig,
} from "../config.ts";
import { isGeminiApiAvailable, queryGeminiApi } from "./gemini-api.ts";
import { isGeminiWebAvailable, queryWithCookies } from "./gemini-web.ts";
import { isPerplexityAvailable, queryPerplexity } from "./perplexity.ts";
import type { ExtractedContent, ExtractOptions } from "./pipeline.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const YOUTUBE_REGEX =
  /(?:(?:www\.|m\.)?youtube\.com\/(?:watch\?.*v=|shorts\/|live\/|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

const YOUTUBE_PROMPT = `Extract the complete content of this YouTube video. Include:
1. Video title, channel name, and duration
2. A brief summary (2-3 sentences)
3. Full transcript with timestamps
4. Descriptions of any code, terminal commands, diagrams, slides, or UI shown on screen

Format as markdown.`;

const THUMBNAIL_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// URL Detection
// ---------------------------------------------------------------------------

/**
 * Detect whether a URL is a YouTube video URL and extract the video ID.
 * Returns { isYouTube: false, videoId: null } for non-YouTube URLs and playlist URLs.
 */
export function isYouTubeURL(url: string): {
  isYouTube: boolean;
  videoId: string | null;
} {
  try {
    const parsed = new URL(url);
    if (parsed.pathname === "/playlist") {
      return { isYouTube: false, videoId: null };
    }
  } catch {
    // Not a valid URL — still try regex match (handles bare patterns)
  }

  const match = url.match(YOUTUBE_REGEX);
  if (!match) return { isYouTube: false, videoId: null };
  return { isYouTube: true, videoId: match[1] };
}

/**
 * Check whether YouTube extraction is enabled via config.
 * Reads youtube.enabled from tools.json (defaults to true).
 */
export function isYouTubeEnabled(): boolean {
  try {
    return loadConfig().youtube?.enabled ?? DEFAULT_YOUTUBE_CONFIG.enabled;
  } catch {
    return DEFAULT_YOUTUBE_CONFIG.enabled;
  }
}

// ---------------------------------------------------------------------------
// Main Extraction
// ---------------------------------------------------------------------------

/**
 * Extract YouTube video content using a three-tier fallback chain:
 * 1. Gemini Web (cookie-auth, free)
 * 2. Gemini API (key-based, metered)
 * 3. Perplexity (text-only summary, last resort)
 *
 * Returns null if all methods fail or no extraction method is available.
 */
export async function extractYouTube(
  url: string,
  signal?: AbortSignal,
  options?: ExtractOptions,
): Promise<ExtractedContent | null> {
  const { videoId } = isYouTubeURL(url);
  const canonicalUrl = videoId
    ? `https://www.youtube.com/watch?v=${videoId}`
    : url;
  const effectivePrompt = options?.prompt ?? YOUTUBE_PROMPT;
  const effectiveModel =
    options?.model ?? getPreferredModel();

  // Tier 1: Gemini Web (cookie auth)
  const webResult = await tryGeminiWeb(
    canonicalUrl,
    effectivePrompt,
    effectiveModel,
    signal,
  );
  if (webResult) return finalizeResult(webResult, url, videoId);

  // Tier 2: Gemini API (key auth)
  const apiResult = await tryGeminiApi(
    canonicalUrl,
    effectivePrompt,
    effectiveModel,
    signal,
  );
  if (apiResult) return finalizeResult(apiResult, url, videoId);

  // Tier 3: Perplexity (text-only fallback)
  const perplexityResult = await tryPerplexity(
    url,
    effectivePrompt,
    signal,
  );
  if (perplexityResult) return finalizeResult(perplexityResult, url, videoId);

  // All methods failed
  return null;
}

// ---------------------------------------------------------------------------
// Thumbnail
// ---------------------------------------------------------------------------

/**
 * Fetch YouTube video thumbnail as base64-encoded JPEG.
 * Returns null on any failure (non-blocking, best-effort).
 */
export async function fetchYouTubeThumbnail(
  videoId: string,
): Promise<{ data: string; mimeType: string } | null> {
  try {
    const res = await fetch(
      `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      { signal: AbortSignal.timeout(THUMBNAIL_TIMEOUT_MS) },
    );
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) return null;
    return { data: buffer.toString("base64"), mimeType: "image/jpeg" };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the first markdown heading (# Title) from text.
 */
export function extractHeadingTitle(text: string): string | null {
  const match = text.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function getPreferredModel(): string {
  try {
    return (
      loadConfig().youtube?.preferredModel ??
      DEFAULT_YOUTUBE_CONFIG.preferredModel
    );
  } catch {
    return DEFAULT_YOUTUBE_CONFIG.preferredModel;
  }
}

async function finalizeResult(
  result: { text: string; extractionChain: string[] },
  originalUrl: string,
  videoId: string | null,
): Promise<ExtractedContent> {
  const title = extractHeadingTitle(result.text) ?? "YouTube Video";

  const content: ExtractedContent = {
    text: result.text,
    title,
    url: originalUrl,
    extractionChain: result.extractionChain,
    chars: result.text.length,
    truncated: false,
  };

  if (videoId) {
    const thumbnail = await fetchYouTubeThumbnail(videoId);
    if (thumbnail) content.thumbnail = thumbnail;
  }

  return content;
}

// ---------------------------------------------------------------------------
// Fallback Tier Functions
// ---------------------------------------------------------------------------

async function tryGeminiWeb(
  url: string,
  prompt: string,
  model: string,
  signal: AbortSignal | undefined,
): Promise<{ text: string; extractionChain: string[] } | null> {
  try {
    const cookies = await isGeminiWebAvailable();
    if (!cookies) return null;

    if (signal?.aborted) return null;

    const text = await queryWithCookies(prompt, cookies, {
      youtubeUrl: url,
      model,
      signal,
      timeoutMs: 120_000,
    });

    return { text, extractionChain: ["youtube:gemini-web"] };
  } catch {
    return null;
  }
}

async function tryGeminiApi(
  url: string,
  prompt: string,
  model: string,
  signal: AbortSignal | undefined,
): Promise<{ text: string; extractionChain: string[] } | null> {
  try {
    if (!isGeminiApiAvailable()) return null;

    if (signal?.aborted) return null;

    const text = await queryGeminiApi(prompt, url, {
      model,
      signal,
      timeoutMs: 120_000,
    });

    return { text, extractionChain: ["youtube:gemini-api"] };
  } catch {
    return null;
  }
}

async function tryPerplexity(
  url: string,
  prompt: string,
  signal: AbortSignal | undefined,
): Promise<{ text: string; extractionChain: string[] } | null> {
  try {
    if (signal?.aborted || !isPerplexityAvailable()) return null;

    const perplexityQuery =
      prompt === YOUTUBE_PROMPT
        ? `Summarize this YouTube video in detail: ${url}`
        : `${prompt} YouTube video: ${url}`;

    const answer = await queryPerplexity(perplexityQuery, signal);
    if (!answer) return null;

    const text =
      `# Video Summary (via Perplexity)\n\n${answer}\n\n` +
      `*Full video understanding requires Gemini access. Set GEMINI_API_KEY or sign into Google in Chrome.*`;

    return { text, extractionChain: ["youtube:perplexity"] };
  } catch {
    return null;
  }
}
```

- [ ] **2.2** Verify the file compiles:

```bash
pnpm run typecheck
```

Expected: No type errors. All imports (`loadConfig`, `DEFAULT_YOUTUBE_CONFIG`, `queryGeminiApi`, `isGeminiWebAvailable`, etc.) are already on master from Phases 1-3.

---

## Task 3 — Write tests for `src/extract/perplexity.ts`

**Files:**

- `tests/extract/perplexity.test.ts`

### Steps

- [ ] **3.1** Create `tests/extract/perplexity.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubFetch, type FetchStub } from "../helpers.ts";

// Mock config.ts to control key resolution without hitting the filesystem.
vi.mock("../../src/config.ts", () => ({
  resolveProviderKey: vi.fn(),
  FALLBACK_ENV_MAP: { perplexity: "PERPLEXITY_API_KEY" },
}));

import { resolveProviderKey } from "../../src/config.ts";
import {
  isPerplexityAvailable,
  queryPerplexity,
} from "../../src/extract/perplexity.ts";

describe("perplexity", () => {
  const mockResolveProviderKey = vi.mocked(resolveProviderKey);
  let fetchStub: FetchStub;

  beforeEach(() => {
    fetchStub = stubFetch();
    mockResolveProviderKey.mockReturnValue(undefined);
  });

  afterEach(() => {
    fetchStub.restore();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // isPerplexityAvailable
  // -------------------------------------------------------------------------

  describe("isPerplexityAvailable", () => {
    it("returns false when no API key is configured", () => {
      mockResolveProviderKey.mockReturnValue(undefined);
      expect(isPerplexityAvailable()).toBe(false);
    });

    it("returns true when API key is available", () => {
      mockResolveProviderKey.mockReturnValue("pplx-test-key");
      expect(isPerplexityAvailable()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // queryPerplexity
  // -------------------------------------------------------------------------

  describe("queryPerplexity", () => {
    it("throws when no API key is available", async () => {
      mockResolveProviderKey.mockReturnValue(undefined);
      await expect(queryPerplexity("test query")).rejects.toThrow(
        "Perplexity API key not found",
      );
    });

    it("sends correct request and returns response content", async () => {
      mockResolveProviderKey.mockReturnValue("pplx-test-key");
      fetchStub.addResponse("api.perplexity.ai", {
        body: {
          choices: [{ message: { content: "This is a summary of the video." } }],
        },
      });

      const result = await queryPerplexity("Summarize this video");

      expect(result).toBe("This is a summary of the video.");

      const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
      const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(calledUrl).toBe("https://api.perplexity.ai/chat/completions");
      expect(calledInit.method).toBe("POST");
      expect(
        (calledInit.headers as Record<string, string>).Authorization,
      ).toBe("Bearer pplx-test-key");

      const body = JSON.parse(calledInit.body as string) as {
        model: string;
        messages: Array<{ role: string; content: string }>;
        max_tokens: number;
      };
      expect(body.model).toBe("sonar");
      expect(body.messages[0].content).toBe("Summarize this video");
      expect(body.max_tokens).toBe(4096);
    });

    it("throws on HTTP error response", async () => {
      mockResolveProviderKey.mockReturnValue("pplx-test-key");
      fetchStub.addResponse("api.perplexity.ai", {
        status: 429,
        body: "rate limited",
      });

      await expect(queryPerplexity("test")).rejects.toThrow(
        "Perplexity API error 429",
      );
    });

    it("throws on empty response content", async () => {
      mockResolveProviderKey.mockReturnValue("pplx-test-key");
      fetchStub.addResponse("api.perplexity.ai", {
        body: { choices: [] },
      });

      await expect(queryPerplexity("test")).rejects.toThrow(
        "Perplexity API returned empty response",
      );
    });

    it("throws on network error", async () => {
      mockResolveProviderKey.mockReturnValue("pplx-test-key");
      // stubFetch returns 404 for unmatched URLs; override fetch to throw
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network failure"));

      await expect(queryPerplexity("test")).rejects.toThrow("Network failure");
    });
  });
});
```

The `tests/extract/` directory already exists (it contains `gemini-api.test.ts`, `gemini-web.test.ts`, etc.).

---

## Task 4 — Write tests for `src/extract/youtube.ts`

**Files:**

- `tests/extract/youtube.test.ts`

### Steps

- [ ] **4.1** Create `tests/extract/youtube.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubFetch, type FetchStub } from "../helpers.ts";

// Mock dependencies from earlier phases
vi.mock("../../src/extract/gemini-api.ts", () => ({
  isGeminiApiAvailable: vi.fn(),
  queryGeminiApi: vi.fn(),
}));

vi.mock("../../src/extract/gemini-web.ts", () => ({
  isGeminiWebAvailable: vi.fn(),
  queryWithCookies: vi.fn(),
}));

vi.mock("../../src/extract/perplexity.ts", () => ({
  isPerplexityAvailable: vi.fn(),
  queryPerplexity: vi.fn(),
}));

import {
  isGeminiApiAvailable,
  queryGeminiApi,
} from "../../src/extract/gemini-api.ts";
import {
  isGeminiWebAvailable,
  queryWithCookies,
} from "../../src/extract/gemini-web.ts";
import {
  isPerplexityAvailable,
  queryPerplexity,
} from "../../src/extract/perplexity.ts";
import {
  extractHeadingTitle,
  extractYouTube,
  fetchYouTubeThumbnail,
  isYouTubeEnabled,
  isYouTubeURL,
} from "../../src/extract/youtube.ts";

describe("youtube", () => {
  let fetchStub: FetchStub;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // isYouTubeURL
  // -------------------------------------------------------------------------

  describe("isYouTubeURL", () => {
    it("detects standard watch URL", () => {
      const result = isYouTubeURL(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      );
      expect(result).toEqual({ isYouTube: true, videoId: "dQw4w9WgXcQ" });
    });

    it("detects watch URL without www", () => {
      const result = isYouTubeURL(
        "https://youtube.com/watch?v=dQw4w9WgXcQ",
      );
      expect(result).toEqual({ isYouTube: true, videoId: "dQw4w9WgXcQ" });
    });

    it("detects mobile URL", () => {
      const result = isYouTubeURL(
        "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
      );
      expect(result).toEqual({ isYouTube: true, videoId: "dQw4w9WgXcQ" });
    });

    it("detects shorts URL", () => {
      const result = isYouTubeURL(
        "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      );
      expect(result).toEqual({ isYouTube: true, videoId: "dQw4w9WgXcQ" });
    });

    it("detects live URL", () => {
      const result = isYouTubeURL(
        "https://www.youtube.com/live/dQw4w9WgXcQ",
      );
      expect(result).toEqual({ isYouTube: true, videoId: "dQw4w9WgXcQ" });
    });

    it("detects embed URL", () => {
      const result = isYouTubeURL(
        "https://www.youtube.com/embed/dQw4w9WgXcQ",
      );
      expect(result).toEqual({ isYouTube: true, videoId: "dQw4w9WgXcQ" });
    });

    it("detects /v/ URL", () => {
      const result = isYouTubeURL(
        "https://www.youtube.com/v/dQw4w9WgXcQ",
      );
      expect(result).toEqual({ isYouTube: true, videoId: "dQw4w9WgXcQ" });
    });

    it("detects youtu.be short URL", () => {
      const result = isYouTubeURL("https://youtu.be/dQw4w9WgXcQ");
      expect(result).toEqual({ isYouTube: true, videoId: "dQw4w9WgXcQ" });
    });

    it("detects watch URL with extra query params", () => {
      const result = isYouTubeURL(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
      );
      expect(result).toEqual({ isYouTube: true, videoId: "dQw4w9WgXcQ" });
    });

    it("excludes playlist URLs", () => {
      const result = isYouTubeURL(
        "https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
      );
      expect(result).toEqual({ isYouTube: false, videoId: null });
    });

    it("returns false for non-YouTube URL", () => {
      const result = isYouTubeURL("https://www.google.com/search?q=hello");
      expect(result).toEqual({ isYouTube: false, videoId: null });
    });

    it("returns false for empty string", () => {
      const result = isYouTubeURL("");
      expect(result).toEqual({ isYouTube: false, videoId: null });
    });

    it("returns false for YouTube channel URL", () => {
      const result = isYouTubeURL("https://www.youtube.com/@channelname");
      expect(result).toEqual({ isYouTube: false, videoId: null });
    });

    it("handles video ID with hyphens and underscores", () => {
      const result = isYouTubeURL("https://youtu.be/a-B_c1D2e3f");
      expect(result).toEqual({ isYouTube: true, videoId: "a-B_c1D2e3f" });
    });
  });

  // -------------------------------------------------------------------------
  // isYouTubeEnabled
  // -------------------------------------------------------------------------

  describe("isYouTubeEnabled", () => {
    it("returns true by default", () => {
      expect(isYouTubeEnabled()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // extractHeadingTitle
  // -------------------------------------------------------------------------

  describe("extractHeadingTitle", () => {
    it("extracts first heading from markdown", () => {
      const text = "# My Video Title\n\nSome content here.";
      expect(extractHeadingTitle(text)).toBe("My Video Title");
    });

    it("returns null when no heading exists", () => {
      const text = "No heading here, just text.";
      expect(extractHeadingTitle(text)).toBeNull();
    });

    it("extracts first heading when multiple exist", () => {
      const text = "# First Title\n\n## Second\n\n# Third";
      expect(extractHeadingTitle(text)).toBe("First Title");
    });

    it("trims whitespace from heading", () => {
      const text = "#   Spaced Title   \n\nContent";
      expect(extractHeadingTitle(text)).toBe("Spaced Title");
    });
  });

  // -------------------------------------------------------------------------
  // extractYouTube
  // -------------------------------------------------------------------------

  describe("extractYouTube", () => {
    it("uses Gemini Web when available (tier 1)", async () => {
      const mockCookies = { "__Secure-1PSID": "test" };
      vi.mocked(isGeminiWebAvailable).mockResolvedValue(mockCookies);
      vi.mocked(queryWithCookies).mockResolvedValue(
        "# Video Title\n\nTranscript content here.",
      );
      // Thumbnail fetch
      fetchStub.addResponse("img.youtube.com", {
        body: "fake-jpeg-data",
        headers: { "content-type": "image/jpeg" },
      });

      const result = await extractYouTube(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      );

      expect(result).not.toBeNull();
      expect(result!.text).toContain("Transcript content here.");
      expect(result!.title).toBe("Video Title");
      expect(result!.extractionChain).toEqual(["youtube:gemini-web"]);
      expect(result!.url).toBe(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      );

      expect(queryWithCookies).toHaveBeenCalledWith(
        expect.stringContaining("Extract the complete content"),
        mockCookies,
        expect.objectContaining({
          youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        }),
      );
    });

    it("falls back to Gemini API when Web unavailable (tier 2)", async () => {
      vi.mocked(isGeminiWebAvailable).mockResolvedValue(null);
      vi.mocked(isGeminiApiAvailable).mockReturnValue(true);
      vi.mocked(queryGeminiApi).mockResolvedValue(
        "# API Video\n\nAPI transcript.",
      );
      fetchStub.addResponse("img.youtube.com", {
        body: "fake-jpeg-data",
        headers: { "content-type": "image/jpeg" },
      });

      const result = await extractYouTube("https://youtu.be/dQw4w9WgXcQ");

      expect(result).not.toBeNull();
      expect(result!.title).toBe("API Video");
      expect(result!.extractionChain).toEqual(["youtube:gemini-api"]);
      expect(queryGeminiApi).toHaveBeenCalledWith(
        expect.stringContaining("Extract the complete content"),
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        expect.objectContaining({
          model: expect.any(String),
        }),
      );
    });

    it("falls back to Perplexity when both Gemini methods fail (tier 3)", async () => {
      vi.mocked(isGeminiWebAvailable).mockResolvedValue(null);
      vi.mocked(isGeminiApiAvailable).mockReturnValue(false);
      vi.mocked(isPerplexityAvailable).mockReturnValue(true);
      vi.mocked(queryPerplexity).mockResolvedValue(
        "This video discusses the history of rickrolling.",
      );
      fetchStub.addResponse("img.youtube.com", {
        body: "fake-jpeg-data",
        headers: { "content-type": "image/jpeg" },
      });

      const result = await extractYouTube(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      );

      expect(result).not.toBeNull();
      expect(result!.extractionChain).toEqual(["youtube:perplexity"]);
      expect(result!.text).toContain("Video Summary (via Perplexity)");
      expect(result!.text).toContain("history of rickrolling");
      expect(queryPerplexity).toHaveBeenCalledWith(
        "Summarize this YouTube video in detail: https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        undefined,
      );
    });

    it("returns null when all methods fail", async () => {
      vi.mocked(isGeminiWebAvailable).mockResolvedValue(null);
      vi.mocked(isGeminiApiAvailable).mockReturnValue(false);
      vi.mocked(isPerplexityAvailable).mockReturnValue(false);

      const result = await extractYouTube(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      );

      expect(result).toBeNull();
    });

    it("uses custom prompt when provided in options", async () => {
      vi.mocked(isGeminiWebAvailable).mockResolvedValue(null);
      vi.mocked(isGeminiApiAvailable).mockReturnValue(true);
      vi.mocked(queryGeminiApi).mockResolvedValue(
        "# Custom Analysis\n\nFocused content.",
      );
      fetchStub.addResponse("img.youtube.com", {
        body: "fake-jpeg-data",
        headers: { "content-type": "image/jpeg" },
      });

      const result = await extractYouTube(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        undefined,
        { prompt: "What programming language is used?" },
      );

      expect(result).not.toBeNull();
      expect(queryGeminiApi).toHaveBeenCalledWith(
        "What programming language is used?",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        expect.anything(),
      );
    });

    it("uses custom model when provided in options", async () => {
      vi.mocked(isGeminiWebAvailable).mockResolvedValue(null);
      vi.mocked(isGeminiApiAvailable).mockReturnValue(true);
      vi.mocked(queryGeminiApi).mockResolvedValue("# Title\n\nContent.");
      fetchStub.addResponse("img.youtube.com", {
        body: "fake-jpeg-data",
        headers: { "content-type": "image/jpeg" },
      });

      await extractYouTube(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        undefined,
        { model: "gemini-2.5-pro" },
      );

      expect(queryGeminiApi).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ model: "gemini-2.5-pro" }),
      );
    });

    it("handles abort signal", async () => {
      const controller = new AbortController();
      controller.abort();

      vi.mocked(isGeminiWebAvailable).mockResolvedValue(null);
      vi.mocked(isGeminiApiAvailable).mockReturnValue(true);

      const result = await extractYouTube(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        controller.signal,
      );

      expect(queryGeminiApi).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it("catches Gemini Web errors and falls through to API", async () => {
      const mockCookies = { "__Secure-1PSID": "test" };
      vi.mocked(isGeminiWebAvailable).mockResolvedValue(mockCookies);
      vi.mocked(queryWithCookies).mockRejectedValue(
        new Error("Cookie expired"),
      );
      vi.mocked(isGeminiApiAvailable).mockReturnValue(true);
      vi.mocked(queryGeminiApi).mockResolvedValue("# Fallback\n\nContent.");
      fetchStub.addResponse("img.youtube.com", {
        body: "fake-jpeg-data",
        headers: { "content-type": "image/jpeg" },
      });

      const result = await extractYouTube(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      );

      expect(result).not.toBeNull();
      expect(result!.extractionChain).toEqual(["youtube:gemini-api"]);
    });

    it("canonicalizes youtu.be URLs before passing to extractors", async () => {
      vi.mocked(isGeminiWebAvailable).mockResolvedValue(null);
      vi.mocked(isGeminiApiAvailable).mockReturnValue(true);
      vi.mocked(queryGeminiApi).mockResolvedValue("# Title\n\nContent.");
      fetchStub.addResponse("img.youtube.com", {
        body: "fake-jpeg-data",
        headers: { "content-type": "image/jpeg" },
      });

      await extractYouTube("https://youtu.be/abc123DEF-_");

      expect(queryGeminiApi).toHaveBeenCalledWith(
        expect.anything(),
        "https://www.youtube.com/watch?v=abc123DEF-_",
        expect.anything(),
      );
    });

    it("uses custom Perplexity query for custom prompts", async () => {
      vi.mocked(isGeminiWebAvailable).mockResolvedValue(null);
      vi.mocked(isGeminiApiAvailable).mockReturnValue(false);
      vi.mocked(isPerplexityAvailable).mockReturnValue(true);
      vi.mocked(queryPerplexity).mockResolvedValue("Custom answer.");
      fetchStub.addResponse("img.youtube.com", {
        body: "fake-jpeg-data",
        headers: { "content-type": "image/jpeg" },
      });

      await extractYouTube(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        undefined,
        { prompt: "What language is used?" },
      );

      expect(queryPerplexity).toHaveBeenCalledWith(
        "What language is used? YouTube video: https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        undefined,
      );
    });
  });

  // -------------------------------------------------------------------------
  // fetchYouTubeThumbnail
  // -------------------------------------------------------------------------

  describe("fetchYouTubeThumbnail", () => {
    it("returns base64 thumbnail on success", async () => {
      fetchStub.addResponse("img.youtube.com", {
        body: "fake-jpeg-data",
        headers: { "content-type": "image/jpeg" },
      });

      const result = await fetchYouTubeThumbnail("dQw4w9WgXcQ");

      expect(result).not.toBeNull();
      expect(result!.mimeType).toBe("image/jpeg");
      expect(result!.data.length).toBeGreaterThan(0);
    });

    it("returns null on HTTP error", async () => {
      fetchStub.addResponse("img.youtube.com", { status: 404 });

      const result = await fetchYouTubeThumbnail("invalid_id__");
      expect(result).toBeNull();
    });

    it("returns null on network error", async () => {
      // No route registered in stubFetch → returns 404, but we need a real error.
      // Override fetch to throw a network error.
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("timeout"));

      const result = await fetchYouTubeThumbnail("dQw4w9WgXcQ");
      expect(result).toBeNull();
    });
  });
});
```

---

## Task 5 — Run tests and verify

**Files:** (none modified)

### Steps

- [ ] **5.1** Run the Perplexity tests:

```bash
pnpm vitest run tests/extract/perplexity.test.ts
```

Expected: All tests pass.

- [ ] **5.2** Run the YouTube tests:

```bash
pnpm vitest run tests/extract/youtube.test.ts
```

Expected: All tests pass (dependencies are fully mocked via `vi.mock`).

- [ ] **5.3** Run the full test suite to check for regressions:

```bash
pnpm test
```

Expected: All existing tests continue to pass.

- [ ] **5.4** Run type checking:

```bash
pnpm run typecheck
```

Expected: No type errors.

- [ ] **5.5** Run linting:

```bash
pnpm run lint
```

Expected: No lint errors. Fix any formatting issues with `pnpm run format`.

---

## Task 6 — Commit

**Files:** (none modified)

### Steps

- [ ] **6.1** Stage and commit:

```bash
git add src/extract/perplexity.ts src/extract/youtube.ts tests/extract/perplexity.test.ts tests/extract/youtube.test.ts
git commit -m "feat(extract): add YouTube transcript extraction and Perplexity fallback

Phase 4 of content extraction expansion:
- Add src/extract/perplexity.ts: Perplexity chat/completions wrapper
  - isPerplexityAvailable() checks key via resolveProviderKey
  - queryPerplexity() sends single-message chat request (30s timeout)
- Add src/extract/youtube.ts: YouTube extraction pipeline
  - isYouTubeURL() detects watch/shorts/live/embed/youtu.be, excludes playlists
  - isYouTubeEnabled() reads youtube.enabled from config (defaults true)
  - extractYouTube() with 3-tier fallback: Gemini Web -> Gemini API -> Perplexity
  - Reads preferredModel from config via loadConfig().youtube
  - fetchYouTubeThumbnail() fetches hqdefault.jpg as base64
  - extractHeadingTitle() parses first markdown heading
- Comprehensive test coverage for both modules using stubFetch

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

## Implementation Notes

### Separation from existing Perplexity search provider

The `src/extract/perplexity.ts` module is distinct from the existing Perplexity search provider in `src/providers/perplexity.ts`. The search provider uses `createHttpSearchProvider` and returns structured `SearchResult[]` parsed from Perplexity's citation-based response format. This module returns raw answer text (up to 4096 tokens) — suitable for video content summarization where length matters.

### YouTube config integration

`config.ts` already exports `YouTubeConfig` (`enabled`, `preferredModel`), `DEFAULT_YOUTUBE_CONFIG`, and `loadConfig()` which parses the `youtube` key from tools.json. Phase 1 landed all of this. The `youtube.ts` module reads both fields:
- `isYouTubeEnabled()` checks `loadConfig().youtube?.enabled`
- `getPreferredModel()` checks `loadConfig().youtube?.preferredModel`

Both fall back to `DEFAULT_YOUTUBE_CONFIG` on missing config or parse errors.

### ExtractedContent already has thumbnail/frames/duration

Phase 1 extended `ExtractedContent` with `thumbnail?: { data: string; mimeType: string }`, `frames?: VideoFrame[]`, and `duration?: number`. No type assertions needed — `finalizeResult` assigns `content.thumbnail` directly.

### AbortSignal.any compatibility

`AbortSignal.any()` requires Node.js >= 20.3.0. The project requires Node >= 24.15.0, so this is safe.

### Why extractYouTube returns null instead of throwing

Following the pipeline design: extraction functions return `null` to signal "cannot handle" so the pipeline can try the next tier. Errors within each tier are caught silently (matching how `extractGitHub` behaves). The caller (pipeline.ts in Phase 7) sees `null` = "try something else."

### Why try* functions don't track attemptErrors

The original plan collected errors per-tier into an `attemptErrors` array but never surfaced them. Since `extractYouTube` returns `null` on all-fail (consistent with the pipeline pattern where `extractGitHub` does the same), tracking per-tier errors is unnecessary complexity. Errors from the underlying modules (`queryGeminiApi`, `queryWithCookies`, etc.) are already self-descriptive if they propagate. If error aggregation is needed later (e.g., for debugging output in Phase 7), it can be added at the pipeline level.

### Design decisions diverging from pi-web-access reference

| Topic | pi-web-access | This plan | Rationale |
|-------|--------------|-----------|-----------|
| Config loading | Reads custom JSON file on disk | Uses existing `loadConfig()` / `resolveProviderKey` | Unified config via tools.json |
| Activity monitor | Custom `activityMonitor` logging | Not included (Phase 7 handles logging) | Keep extractors pure |
| Error return | Returns `ExtractedContent` with `error` field | Returns `null` on all-fail | Matches pi-tools pipeline pattern (`extractGitHub` also returns null) |
| Error aggregation | Collects per-tier errors in `attemptErrors` | Not collected (dead code removed) | No consumer for the data |
| Perplexity model | `"sonar"` with `max_tokens: 1024` | `"sonar"` with `max_tokens: 4096` | More room for video transcripts |
| Timeout | Uses AbortSignal per-request | 30s timeout for Perplexity, 120s for Gemini | Appropriate per-service limits |
| Config rethrow | `shouldRethrow()` for JSON parse errors | Not needed (config loaded via loadConfig) | loadConfig handles its own errors |
| Frame extraction | yt-dlp + ffmpeg frame extraction | Not included (separate concern) | Can be added when pipeline.ts wires frames |

### Test patterns

Tests follow existing conventions:
- `stubFetch()` from `tests/helpers.ts` for HTTP mocking (returns real `Response` objects)
- `vi.mock()` for inter-module dependency isolation (same pattern as `gemini-web.test.ts` mocking `chrome-cookies.ts`)
- `vi.mocked()` for typed mock access
- Section dividers matching the `// ---` style in test files

---

## Summary of Changes

| File | Change |
|------|--------|
| `src/extract/perplexity.ts` | NEW — Perplexity chat/completions client: `isPerplexityAvailable()`, `queryPerplexity()` |
| `src/extract/youtube.ts` | NEW — YouTube extraction pipeline: URL detection, config-driven enabled/model, 3-tier fallback, thumbnail fetch, heading parser |
| `tests/extract/perplexity.test.ts` | NEW — Tests for key availability, successful query, HTTP errors, empty response, network errors |
| `tests/extract/youtube.test.ts` | NEW — Tests for URL detection (13 cases), extraction fallback chain (9 cases), thumbnail fetch (3 cases), heading parser (4 cases), config integration |
