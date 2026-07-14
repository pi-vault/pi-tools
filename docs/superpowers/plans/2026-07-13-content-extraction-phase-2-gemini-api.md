# Content Extraction Phase 2 — Gemini REST API Client

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `src/extract/gemini-api.ts` — a thin Gemini REST API client for video/URL content analysis.

**Architecture:** This is Phase 2 of the Content Extraction implementation. It creates a standalone Gemini generateContent client that supports direct API key auth and Cloudflare AI Gateway routing. Config is loaded via `loadConfig()` from `src/config.ts` (reusing Phase 1's `GeminiConfig` type and config infrastructure), with credential indirection through `resolveApiKey()`.

**Tech Stack:** TypeScript, Vitest, native `fetch`, `AbortSignal.any()` / `AbortSignal.timeout()`

**Parent plan:** `docs/superpowers/plans/2026-07-13-content-extraction.md`

**Reference implementation:** `/Users/lanh/Developer/pi-packages/nicobailon-pi-web-access/gemini-api.ts`

---

## Task 1 — Create `src/extract/gemini-api.ts`

**Files:**

- `src/extract/gemini-api.ts`

### Steps

- [ ] **1.1** Create `src/extract/gemini-api.ts` with the full module implementation:

```typescript
import { loadConfig, resolveApiKey, type GeminiConfig } from "../config.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_API_HOST = "https://generativelanguage.googleapis.com";
const API_VERSION = "v1beta";
export const DEFAULT_MODEL = "gemini-3-flash-preview";
const DEFAULT_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GeminiApiOptions {
  model?: string;
  mimeType?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface GenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

// ---------------------------------------------------------------------------
// Config loading (lazy, module-scoped cache via loadConfig)
// ---------------------------------------------------------------------------

let cachedGeminiConfig: GeminiConfig | null = null;

function getGeminiConfig(): GeminiConfig {
  if (cachedGeminiConfig) return cachedGeminiConfig;
  cachedGeminiConfig = loadConfig().gemini ?? {};
  return cachedGeminiConfig;
}

/** Reset config cache — exposed for testing only. */
export function _resetConfigCache(): void {
  cachedGeminiConfig = null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeBaseUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\/+$/, "");
  return normalized.length > 0 ? normalized : null;
}

function isCloudflareGateway(): boolean {
  return getApiHost().includes("gateway.ai.cloudflare.com");
}

function withTimeout(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the Gemini API key.
 *
 * Resolution order:
 * 1. `GEMINI_API_KEY` environment variable
 * 2. `config.gemini.apiKey` (passed through resolveApiKey for shell/env indirection)
 */
export function getApiKey(): string | null {
  return (
    normalizeString(process.env.GEMINI_API_KEY) ??
    normalizeString(resolveApiKey(getGeminiConfig().apiKey)) ??
    null
  );
}

/**
 * Resolve the API host URL.
 *
 * Resolution order:
 * 1. `GOOGLE_GEMINI_BASE_URL` environment variable
 * 2. `config.gemini.baseUrl`
 * 3. Default: `https://generativelanguage.googleapis.com`
 */
export function getApiHost(): string {
  return (
    normalizeBaseUrl(process.env.GOOGLE_GEMINI_BASE_URL) ??
    normalizeBaseUrl(getGeminiConfig().baseUrl) ??
    DEFAULT_API_HOST
  );
}

/**
 * Returns the versioned API base URL (host + version).
 */
export function getVersionedApiBase(): string {
  return `${getApiHost()}/${API_VERSION}`;
}

/**
 * Resolve the Cloudflare API key for AI Gateway routing.
 *
 * Resolution order:
 * 1. `CLOUDFLARE_API_KEY` environment variable
 * 2. `config.gemini.cloudflareApiKey` (passed through resolveApiKey for shell/env indirection)
 */
export function getCloudflareApiKey(): string | null {
  return (
    normalizeString(process.env.CLOUDFLARE_API_KEY) ??
    normalizeString(resolveApiKey(getGeminiConfig().cloudflareApiKey)) ??
    null
  );
}

/**
 * Returns true if the Gemini API is available (direct key or Cloudflare gateway).
 */
export function isGeminiApiAvailable(): boolean {
  return (
    getApiKey() !== null ||
    (isCloudflareGateway() && getCloudflareApiKey() !== null)
  );
}

/**
 * Build authentication headers for the request.
 * For Cloudflare AI Gateway, adds the cf-aig-authorization header.
 * For direct API access, returns empty (key is in URL query param).
 */
export function buildAuthHeaders(): Record<string, string> {
  if (!isCloudflareGateway()) return {};
  const cloudflareApiKey = getCloudflareApiKey();
  return cloudflareApiKey
    ? { "cf-aig-authorization": `Bearer ${cloudflareApiKey}` }
    : {};
}

/**
 * Build the API key query parameter string.
 * Returns empty string for Cloudflare gateway (key is in headers instead).
 */
export function buildKeyParam(apiKey: string | null): string {
  if (!apiKey || isCloudflareGateway()) return "";
  return `?key=${apiKey}`;
}

/**
 * Query the Gemini generateContent API with a prompt and file/URL URI.
 *
 * @param prompt - The text prompt to send
 * @param videoUri - A file URI (from Files API upload) or URL (YouTube/web page)
 * @param options - Model, mimeType, signal, timeout overrides
 * @returns The generated text response
 * @throws Error if API is not configured, HTTP error, or empty response
 */
export async function queryGeminiApi(
  prompt: string,
  videoUri: string,
  options: GeminiApiOptions = {},
): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey && !(isCloudflareGateway() && getCloudflareApiKey() !== null)) {
    throw new Error(
      "Gemini API not configured. Either:\n" +
        "  1. Set GEMINI_API_KEY environment variable or config.gemini.apiKey\n" +
        "  2. Set GOOGLE_GEMINI_BASE_URL + CLOUDFLARE_API_KEY for Cloudflare AI Gateway",
    );
  }

  const model = options.model ?? DEFAULT_MODEL;
  const signal = withTimeout(
    options.signal,
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  const url = `${getVersionedApiBase()}/models/${model}:generateContent${buildKeyParam(apiKey)}`;

  // Build fileData — include mimeType only if specified
  const fileData: Record<string, string> = { fileUri: videoUri };
  if (options.mimeType) fileData.mimeType = options.mimeType;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ fileData }, { text: prompt }],
      },
    ],
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...buildAuthHeaders() },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(
      `Gemini API error ${res.status}: ${errorText.slice(0, 300)}`,
    );
  }

  const data = (await res.json()) as GenerateContentResponse;
  const text = data.candidates?.[0]?.content?.parts
    ?.map((p) => p.text)
    .filter(Boolean)
    .join("\n");

  if (!text) throw new Error("Gemini API returned empty response");
  return text;
}
```

- [ ] **1.2** Verify the file compiles without type errors:

```bash
pnpm run typecheck
```

Expected: No type errors related to `src/extract/gemini-api.ts`.

---

## Task 2 — Write tests for `src/extract/gemini-api.ts`

**Files:**

- `tests/extract/gemini-api.test.ts`

### Steps

- [ ] **2.1** Create `tests/extract/gemini-api.test.ts` with the full test suite:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubFetch } from "../helpers.ts";
import {
  _resetConfigCache,
  buildAuthHeaders,
  buildKeyParam,
  DEFAULT_MODEL,
  getApiHost,
  getApiKey,
  getCloudflareApiKey,
  getVersionedApiBase,
  isGeminiApiAvailable,
  queryGeminiApi,
} from "../../src/extract/gemini-api.ts";

describe("gemini-api", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    _resetConfigCache();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // -------------------------------------------------------------------------
  // getApiKey
  // -------------------------------------------------------------------------

  describe("getApiKey", () => {
    it("returns GEMINI_API_KEY env var when set", () => {
      process.env.GEMINI_API_KEY = "test-gemini-key";
      expect(getApiKey()).toBe("test-gemini-key");
    });

    it("returns null when no key is configured", () => {
      delete process.env.GEMINI_API_KEY;
      expect(getApiKey()).toBeNull();
    });

    it("trims whitespace from env var", () => {
      process.env.GEMINI_API_KEY = "  my-key  ";
      expect(getApiKey()).toBe("my-key");
    });

    it("returns null for empty string env var", () => {
      process.env.GEMINI_API_KEY = "   ";
      expect(getApiKey()).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getApiHost
  // -------------------------------------------------------------------------

  describe("getApiHost", () => {
    it("returns default host when no override is set", () => {
      delete process.env.GOOGLE_GEMINI_BASE_URL;
      expect(getApiHost()).toBe("https://generativelanguage.googleapis.com");
    });

    it("returns GOOGLE_GEMINI_BASE_URL env var when set", () => {
      process.env.GOOGLE_GEMINI_BASE_URL =
        "https://gateway.ai.cloudflare.com/v1/acc/gw/google-ai-studio";
      expect(getApiHost()).toBe(
        "https://gateway.ai.cloudflare.com/v1/acc/gw/google-ai-studio",
      );
    });

    it("strips trailing slashes from base URL", () => {
      process.env.GOOGLE_GEMINI_BASE_URL = "https://example.com/api///";
      expect(getApiHost()).toBe("https://example.com/api");
    });
  });

  // -------------------------------------------------------------------------
  // getVersionedApiBase
  // -------------------------------------------------------------------------

  describe("getVersionedApiBase", () => {
    it("returns host + version path", () => {
      delete process.env.GOOGLE_GEMINI_BASE_URL;
      expect(getVersionedApiBase()).toBe(
        "https://generativelanguage.googleapis.com/v1beta",
      );
    });

    it("uses custom host when set", () => {
      process.env.GOOGLE_GEMINI_BASE_URL = "https://custom.host.com";
      expect(getVersionedApiBase()).toBe("https://custom.host.com/v1beta");
    });
  });

  // -------------------------------------------------------------------------
  // isGeminiApiAvailable
  // -------------------------------------------------------------------------

  describe("isGeminiApiAvailable", () => {
    it("returns true when API key is set", () => {
      process.env.GEMINI_API_KEY = "test-key";
      expect(isGeminiApiAvailable()).toBe(true);
    });

    it("returns false when no key and no gateway", () => {
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_GEMINI_BASE_URL;
      delete process.env.CLOUDFLARE_API_KEY;
      expect(isGeminiApiAvailable()).toBe(false);
    });

    it("returns true when Cloudflare gateway is configured", () => {
      delete process.env.GEMINI_API_KEY;
      process.env.GOOGLE_GEMINI_BASE_URL =
        "https://gateway.ai.cloudflare.com/v1/acc/gw/google-ai-studio";
      process.env.CLOUDFLARE_API_KEY = "cf-key";
      expect(isGeminiApiAvailable()).toBe(true);
    });

    it("returns false when Cloudflare gateway URL set but no CF key", () => {
      delete process.env.GEMINI_API_KEY;
      process.env.GOOGLE_GEMINI_BASE_URL =
        "https://gateway.ai.cloudflare.com/v1/acc/gw/google-ai-studio";
      delete process.env.CLOUDFLARE_API_KEY;
      expect(isGeminiApiAvailable()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // buildKeyParam
  // -------------------------------------------------------------------------

  describe("buildKeyParam", () => {
    it("returns ?key=<apiKey> for direct access", () => {
      delete process.env.GOOGLE_GEMINI_BASE_URL;
      expect(buildKeyParam("my-key")).toBe("?key=my-key");
    });

    it("returns empty string when apiKey is null", () => {
      expect(buildKeyParam(null)).toBe("");
    });

    it("returns empty string for Cloudflare gateway even with key", () => {
      process.env.GOOGLE_GEMINI_BASE_URL =
        "https://gateway.ai.cloudflare.com/v1/acc/gw/google-ai-studio";
      expect(buildKeyParam("my-key")).toBe("");
    });
  });

  // -------------------------------------------------------------------------
  // buildAuthHeaders
  // -------------------------------------------------------------------------

  describe("buildAuthHeaders", () => {
    it("returns empty object for direct API access", () => {
      delete process.env.GOOGLE_GEMINI_BASE_URL;
      expect(buildAuthHeaders()).toEqual({});
    });

    it("returns cf-aig-authorization header for Cloudflare gateway", () => {
      process.env.GOOGLE_GEMINI_BASE_URL =
        "https://gateway.ai.cloudflare.com/v1/acc/gw/google-ai-studio";
      process.env.CLOUDFLARE_API_KEY = "cf-secret";
      expect(buildAuthHeaders()).toEqual({
        "cf-aig-authorization": "Bearer cf-secret",
      });
    });

    it("returns empty object for Cloudflare gateway without CF key", () => {
      process.env.GOOGLE_GEMINI_BASE_URL =
        "https://gateway.ai.cloudflare.com/v1/acc/gw/google-ai-studio";
      delete process.env.CLOUDFLARE_API_KEY;
      expect(buildAuthHeaders()).toEqual({});
    });
  });

  // -------------------------------------------------------------------------
  // getCloudflareApiKey
  // -------------------------------------------------------------------------

  describe("getCloudflareApiKey", () => {
    it("returns CLOUDFLARE_API_KEY env var when set", () => {
      process.env.CLOUDFLARE_API_KEY = "cf-key-123";
      expect(getCloudflareApiKey()).toBe("cf-key-123");
    });

    it("returns null when not configured", () => {
      delete process.env.CLOUDFLARE_API_KEY;
      expect(getCloudflareApiKey()).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // queryGeminiApi
  // -------------------------------------------------------------------------

  describe("queryGeminiApi", () => {
    let fetchStub: ReturnType<typeof stubFetch>;

    beforeEach(() => {
      process.env.GEMINI_API_KEY = "test-key";
      delete process.env.GOOGLE_GEMINI_BASE_URL;
      fetchStub = stubFetch();
    });

    afterEach(() => {
      fetchStub.restore();
    });

    it("sends correct request body and parses response", async () => {
      fetchStub.addResponse("generateContent", {
        status: 200,
        body: {
          candidates: [
            {
              content: {
                parts: [{ text: "Analysis result" }],
              },
            },
          ],
        },
      });

      const result = await queryGeminiApi(
        "Describe this video",
        "https://www.youtube.com/watch?v=abc123",
      );

      expect(result).toBe("Analysis result");

      // Verify the fetch was called with correct URL pattern
      const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
      const [calledUrl, calledInit] = fetchMock.mock.calls[0];
      expect(calledUrl).toContain(`/models/${DEFAULT_MODEL}:generateContent`);
      expect(calledUrl).toContain("?key=test-key");

      const body = JSON.parse(calledInit.body as string);
      expect(body.contents[0].role).toBe("user");
      expect(body.contents[0].parts[0].fileData.fileUri).toBe(
        "https://www.youtube.com/watch?v=abc123",
      );
      expect(body.contents[0].parts[1].text).toBe("Describe this video");
    });

    it("includes mimeType in fileData when specified", async () => {
      fetchStub.addResponse("generateContent", {
        status: 200,
        body: {
          candidates: [{ content: { parts: [{ text: "OK" }] } }],
        },
      });

      await queryGeminiApi("Analyze", "files/abc123", {
        mimeType: "video/mp4",
      });

      const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
      const [, calledInit] = fetchMock.mock.calls[0];
      const body = JSON.parse(calledInit.body as string);
      expect(body.contents[0].parts[0].fileData.mimeType).toBe("video/mp4");
    });

    it("omits mimeType from fileData when not specified", async () => {
      fetchStub.addResponse("generateContent", {
        status: 200,
        body: {
          candidates: [{ content: { parts: [{ text: "OK" }] } }],
        },
      });

      await queryGeminiApi("Analyze", "https://youtube.com/watch?v=x");

      const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
      const [, calledInit] = fetchMock.mock.calls[0];
      const body = JSON.parse(calledInit.body as string);
      expect(body.contents[0].parts[0].fileData.mimeType).toBeUndefined();
    });

    it("uses custom model when specified", async () => {
      fetchStub.addResponse("generateContent", {
        status: 200,
        body: {
          candidates: [{ content: { parts: [{ text: "OK" }] } }],
        },
      });

      await queryGeminiApi("Test", "files/xyz", { model: "gemini-2.5-flash" });

      const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
      const [calledUrl] = fetchMock.mock.calls[0];
      expect(calledUrl).toContain("/models/gemini-2.5-flash:generateContent");
    });

    it("throws on HTTP error with status and message", async () => {
      fetchStub.addResponse("generateContent", {
        status: 429,
        body: "Rate limit exceeded",
      });

      await expect(queryGeminiApi("Test", "files/xyz")).rejects.toThrow(
        "Gemini API error 429",
      );
    });

    it("throws on empty response (no candidates)", async () => {
      fetchStub.addResponse("generateContent", {
        status: 200,
        body: { candidates: [] },
      });

      await expect(queryGeminiApi("Test", "files/xyz")).rejects.toThrow(
        "Gemini API returned empty response",
      );
    });

    it("throws on empty response (null text in parts)", async () => {
      fetchStub.addResponse("generateContent", {
        status: 200,
        body: {
          candidates: [{ content: { parts: [{ text: "" }] } }],
        },
      });

      await expect(queryGeminiApi("Test", "files/xyz")).rejects.toThrow(
        "Gemini API returned empty response",
      );
    });

    it("joins multiple text parts with newline", async () => {
      fetchStub.addResponse("generateContent", {
        status: 200,
        body: {
          candidates: [
            {
              content: {
                parts: [{ text: "Part 1" }, { text: "Part 2" }],
              },
            },
          ],
        },
      });

      const result = await queryGeminiApi("Test", "files/xyz");
      expect(result).toBe("Part 1\nPart 2");
    });

    it("throws when API is not configured", async () => {
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_GEMINI_BASE_URL;
      delete process.env.CLOUDFLARE_API_KEY;

      await expect(queryGeminiApi("Test", "files/xyz")).rejects.toThrow(
        "Gemini API not configured",
      );
    });

    it("omits key param and uses CF headers for Cloudflare gateway", async () => {
      delete process.env.GEMINI_API_KEY;
      process.env.GOOGLE_GEMINI_BASE_URL =
        "https://gateway.ai.cloudflare.com/v1/acc/gw/google-ai-studio";
      process.env.CLOUDFLARE_API_KEY = "cf-secret";

      fetchStub.addResponse("generateContent", {
        status: 200,
        body: {
          candidates: [{ content: { parts: [{ text: "CF result" }] } }],
        },
      });

      const result = await queryGeminiApi("Test", "files/xyz");
      expect(result).toBe("CF result");

      const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
      const [calledUrl, calledInit] = fetchMock.mock.calls[0];
      expect(calledUrl).not.toContain("?key=");
      expect(calledUrl).toContain("gateway.ai.cloudflare.com");
      expect(calledInit.headers["cf-aig-authorization"]).toBe(
        "Bearer cf-secret",
      );
    });
  });
});
```

- [ ] **2.2** Run the tests to verify they pass:

```bash
pnpm vitest run tests/extract/gemini-api.test.ts
```

Expected: All tests pass.

---

## Task 3 — Verify integration with existing codebase

**Files:** (none modified)

### Steps

- [ ] **3.1** Run the full test suite to check for regressions:

```bash
pnpm test
```

Expected: All existing tests continue to pass.

- [ ] **3.2** Run type checking:

```bash
pnpm run typecheck
```

Expected: No type errors.

- [ ] **3.3** Run linting:

```bash
pnpm run lint
```

Expected: No lint errors (biome).

---

## Task 4 — Commit

**Files:** (none modified)

### Steps

- [ ] **4.1** Commit the new files:

```bash
git add src/extract/gemini-api.ts tests/extract/gemini-api.test.ts
git commit -m "feat(extract): add Gemini REST API client

Phase 2 of content extraction:
- Add src/extract/gemini-api.ts with generateContent client
- Use loadConfig() + resolveApiKey() from config.ts for credential resolution
- Reuse GeminiConfig type from Phase 1
- Support direct API key auth (GEMINI_API_KEY / config.gemini.apiKey)
- Support Cloudflare AI Gateway routing (GOOGLE_GEMINI_BASE_URL + CLOUDFLARE_API_KEY)
- Export: getApiKey, getApiHost, getVersionedApiBase, getCloudflareApiKey,
  isGeminiApiAvailable, buildAuthHeaders, buildKeyParam, queryGeminiApi
- Add comprehensive test suite covering all auth modes and error cases

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

## Implementation Notes

### Config loading pattern

The module delegates config loading to `loadConfig()` from `src/config.ts`, which handles:

- Global config path (`~/.pi/agent/extensions/tools.json`)
- Legacy path fallback (`pi-tools.json`)
- JSON parsing with proper error handling

The loaded `PiToolsConfig.gemini` section (typed as `GeminiConfig` from Phase 1) is cached at module scope in `cachedGeminiConfig` for performance. The `_resetConfigCache()` export (underscore prefix signals test-only) clears this cache so tests can set env vars and have them take effect.

Credentials from the config are passed through `resolveApiKey()` for shell command (`!op read ...`) and env var name (`GEMINI_API_KEY`) indirection — matching the resolution pattern used by all other pi-tools providers.

### Relationship to Phase 1 dependencies

This module uses two things from Phase 1:

1. `loadConfig()` — returns `PiToolsConfig` which includes `gemini?: GeminiConfig`
2. `resolveApiKey()` — handles shell commands, env var references, and literal strings
3. `GeminiConfig` type — imported directly from `src/config.ts`

No local config type definitions are needed since Phase 1 already defined `GeminiConfig` with `apiKey?`, `baseUrl?`, `cloudflareApiKey?`, `allowBrowserCookies?`, and `chromeProfile?` fields.

### Cloudflare AI Gateway detection

The gateway is detected by checking if the resolved host URL contains `gateway.ai.cloudflare.com`. When detected:

- The API key is **not** added as a `?key=` query parameter
- Instead, `cf-aig-authorization: Bearer <cloudflare-api-key>` header is used
- The Gemini API key itself may not even be needed (the gateway proxies auth)

### Error handling

- **Not configured:** Throws with setup instructions (matches pi-web-access behavior)
- **HTTP error:** Throws with status code and first 300 chars of error body
- **Empty response:** Throws when candidates array is empty or all text parts are falsy
- **Timeout:** Uses `AbortSignal.any([userSignal, AbortSignal.timeout(120000)])` — aborts on whichever fires first

### Design decisions diverging from pi-web-access

| Topic                  | pi-web-access                             | This plan                                   | Rationale                                                                        |
| ---------------------- | ----------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------- |
| Function name          | `queryGeminiApiWithVideo`                 | `queryGeminiApi`                            | Simpler — "with video" is implied by the videoUri param                          |
| Config loading         | Own `readFileSync` from `web-search.json` | `loadConfig()` from `src/config.ts`         | Reuse existing config infrastructure (path resolution, parsing, legacy fallback) |
| Config field names     | `geminiApiKey` (flat)                     | `gemini.apiKey` (nested via `GeminiConfig`) | Matches pi-tools nested config style; reuses Phase 1 type                        |
| Config type            | Local `GeminiApiConfig` (unknown fields)  | Imported `GeminiConfig` (typed fields)      | Type-safe; single source of truth from Phase 1                                   |
| Credential indirection | Direct string from config                 | `resolveApiKey()` for all config values     | Supports `!shell` commands and env var names in config                           |
| Export `API_BASE`      | Yes (constant)                            | No (use `getVersionedApiBase()`)            | Dynamic — supports runtime host override                                         |
| Test config reset      | Not needed (single-run)                   | `_resetConfigCache()`                       | Vitest runs in single process, needs cache reset between tests                   |

---

## Summary of Changes

| File                               | Change                                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/extract/gemini-api.ts`        | New file — Gemini REST API client with key resolution via `loadConfig()` + `resolveApiKey()`, Cloudflare gateway support, and generateContent query function |
| `tests/extract/gemini-api.test.ts` | New file — Full test coverage for all exports, auth modes, request building, response parsing, and error cases                                               |
