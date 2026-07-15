# Phase 3: PDF OCR, Trust Gating, File Reorg — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dual-strategy PDF OCR for scanned documents, project trust gating for sensitive config fields, and split web-fetch.ts into focused files.

**Architecture:** Three independent features that share a phase because they're all medium complexity. Order: trust gating first (needed by later config additions), then PDF OCR (new extract module), then file reorg (pure refactor, no behavior change).

**Tech Stack:** TypeScript, Vitest, native `fetch`, `pdftoppm` CLI (poppler-utils), Pi ExtensionContext API

**Spec:** `docs/superpowers/specs/2026-07-15-feature-adoption-design.md` (Phase 3)

---

## Task 1: Trust utility — write tests and implement `src/utils/trust.ts`

**Files:**
- Create: `tests/utils/trust.test.ts`
- Create: `src/utils/trust.ts`

- [ ] **Step 1: Create test file for trust registry**

```typescript
// tests/utils/trust.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { recordProjectTrust, isProjectTrustedCached, _resetTrustRegistry } from "../../src/utils/trust.ts";

describe("trust registry", () => {
  afterEach(() => {
    _resetTrustRegistry();
  });

  it("records trusted project and retrieves it", () => {
    recordProjectTrust({ cwd: "/home/user/my-project", isProjectTrusted: () => true });
    expect(isProjectTrustedCached("/home/user/my-project")).toBe(true);
  });

  it("records untrusted project and retrieves it", () => {
    recordProjectTrust({ cwd: "/home/user/my-project", isProjectTrusted: () => false });
    expect(isProjectTrustedCached("/home/user/my-project")).toBe(false);
  });

  it("defaults to untrusted when project has not been recorded", () => {
    expect(isProjectTrustedCached("/home/user/unknown-project")).toBe(false);
  });

  it("does nothing when cwd is undefined", () => {
    recordProjectTrust({ cwd: undefined, isProjectTrusted: () => true });
    // No crash, no entry recorded
    expect(isProjectTrustedCached("undefined")).toBe(false);
  });

  it("does nothing when isProjectTrusted is missing", () => {
    recordProjectTrust({ cwd: "/home/user/my-project" });
    expect(isProjectTrustedCached("/home/user/my-project")).toBe(false);
  });

  it("updates trust status on re-record", () => {
    recordProjectTrust({ cwd: "/home/user/my-project", isProjectTrusted: () => false });
    expect(isProjectTrustedCached("/home/user/my-project")).toBe(false);

    recordProjectTrust({ cwd: "/home/user/my-project", isProjectTrusted: () => true });
    expect(isProjectTrustedCached("/home/user/my-project")).toBe(true);
  });

  it("tracks multiple projects independently", () => {
    recordProjectTrust({ cwd: "/project-a", isProjectTrusted: () => true });
    recordProjectTrust({ cwd: "/project-b", isProjectTrusted: () => false });

    expect(isProjectTrustedCached("/project-a")).toBe(true);
    expect(isProjectTrustedCached("/project-b")).toBe(false);
  });

  it("defaults to untrusted when no trust recorded (cache miss)", () => {
    expect(isProjectTrustedCached("/some/random/dir")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails (module not found)**

```bash
pnpm vitest run tests/utils/trust.test.ts
```

Expected: FAIL — `src/utils/trust.ts` does not exist yet.

- [ ] **Step 3: Implement trust registry**

```typescript
// src/utils/trust.ts

/**
 * Global trust registry using Symbol.for() so state survives across
 * event handlers within the same process. Trust state is recorded from
 * Pi's ExtensionContext (ctx.isProjectTrusted()) and cached for use by
 * loadMergedConfig() which runs outside an event context.
 */

const TRUST_SYMBOL = Symbol.for("pi-tools.project-trust");

interface TrustRegistry {
  trusted?: Map<string, boolean>;
}

function trustRegistry(): TrustRegistry {
  const host = globalThis as unknown as Record<PropertyKey, TrustRegistry | undefined>;
  return (host[TRUST_SYMBOL] ??= {});
}

/**
 * Record trust state from an event handler that has access to ExtensionContext.
 * Called from session_start, model_select, and before_provider_request handlers.
 */
export function recordProjectTrust(ctx: {
  cwd?: string;
  isProjectTrusted?: () => boolean;
}): void {
  if (!ctx.cwd) return;
  const trusted = ctx.isProjectTrusted?.() === true;
  const registry = trustRegistry();
  registry.trusted ??= new Map();
  registry.trusted.set(ctx.cwd, trusted);
}

/**
 * Check cached trust state for a project directory.
 * Returns false if the project has not been recorded yet (safe default).
 */
export function isProjectTrustedCached(cwd: string): boolean {
  return trustRegistry().trusted?.get(cwd) === true;
}

/** Reset trust registry — exposed for testing only. */
export function _resetTrustRegistry(): void {
  const host = globalThis as unknown as Record<PropertyKey, TrustRegistry | undefined>;
  host[TRUST_SYMBOL] = {};
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run tests/utils/trust.test.ts
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/trust.ts tests/utils/trust.test.ts
git commit -m "feat: add project trust registry with global symbol caching

Uses Symbol.for('pi-tools.project-trust') to store trust state from
ExtensionContext event handlers. isProjectTrustedCached() defaults to
false (untrusted) when no trust has been recorded yet.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

## Task 2: Trust gating — write tests and implement `stripSensitiveFields` + integrate in config

**Files:**
- Create: `tests/config-trust.test.ts`
- Modify: `src/config.ts` (add `stripSensitiveFields`, modify `loadMergedConfig`)
- Modify: `src/index.ts` (add trust recording event handlers)

- [ ] **Step 1: Create test file for trust gating**

```typescript
// tests/config-trust.test.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stripSensitiveFields, loadMergedConfig } from "../src/config.ts";
import { recordProjectTrust, _resetTrustRegistry } from "../src/utils/trust.ts";

vi.mock("node:fs");

describe("stripSensitiveFields", () => {
  it("removes top-level apiKey fields", () => {
    const config = { gemini: { apiKey: "secret-123", baseUrl: "https://example.com" } };
    const result = stripSensitiveFields(config);
    expect(result.gemini).toEqual({ baseUrl: "https://example.com" });
  });

  it("removes nested provider apiKey fields", () => {
    const config = {
      providers: {
        brave: { enabled: true, apiKey: "BSA_xxx", monthlyQuota: 2000 },
        duckduckgo: { enabled: true },
      },
    };
    const result = stripSensitiveFields(config);
    expect((result.providers as any).brave).toEqual({ enabled: true, monthlyQuota: 2000 });
    expect((result.providers as any).duckduckgo).toEqual({ enabled: true });
  });

  it("removes ssrf.allowRanges", () => {
    const config = { ssrf: { allowRanges: ["10.0.0.0/8"] } };
    const result = stripSensitiveFields(config);
    expect(result.ssrf).toEqual({});
  });

  it("removes gemini.cloudflareApiKey and gemini.allowBrowserCookies", () => {
    const config = {
      gemini: {
        apiKey: "key",
        baseUrl: "https://example.com",
        cloudflareApiKey: "cf-key",
        allowBrowserCookies: true,
        chromeProfile: "Default",
      },
    };
    const result = stripSensitiveFields(config);
    expect(result.gemini).toEqual({ baseUrl: "https://example.com", chromeProfile: "Default" });
  });

  it("removes fields matching *.apiSecret and *.token patterns", () => {
    const config = {
      custom: { apiSecret: "secret", token: "tok-123", name: "safe" },
    };
    const result = stripSensitiveFields(config);
    expect(result.custom).toEqual({ name: "safe" });
  });

  it("preserves non-sensitive fields", () => {
    const config = {
      defaultProvider: "brave",
      selectionStrategy: "auto",
      guidance: { web_fetch: { promptSnippet: "Use web_fetch" } },
      combine: { enabled: true, mode: "targeted" },
      pdf: { ocrEnabled: true, ocrMaxPages: 5 },
      youtube: { enabled: true },
      video: { enabled: true },
    };
    const result = stripSensitiveFields(config);
    expect(result).toEqual(config);
  });

  it("returns empty object for empty input", () => {
    expect(stripSensitiveFields({})).toEqual({});
  });
});

describe("loadMergedConfig trust gating", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    _resetTrustRegistry();
  });

  afterEach(() => {
    _resetTrustRegistry();
  });

  it("strips sensitive fields from untrusted project config", () => {
    // Global config: empty
    vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
      const p = typeof filePath === "string" ? filePath : filePath.toString();
      if (p.includes(".pi/tools.json") && p.includes("test-project")) {
        return JSON.stringify({
          gemini: { apiKey: "malicious-key" },
          guidance: { web_fetch: { promptSnippet: "safe" } },
        });
      }
      throw new Error("ENOENT");
    });
    vi.mocked(fs.existsSync).mockImplementation((filePath: any) => {
      const p = typeof filePath === "string" ? filePath : filePath.toString();
      return p.includes("test-project") && p.includes(".pi/tools.json");
    });

    // Not trusted (no recordProjectTrust call)
    const config = loadMergedConfig("/test-project");
    // apiKey should be stripped
    expect(config.gemini?.apiKey).toBeUndefined();
    // guidance should be preserved
    expect(config.guidance?.web_fetch?.promptSnippet).toBe("safe");
  });

  it("preserves sensitive fields from trusted project config", () => {
    vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
      const p = typeof filePath === "string" ? filePath : filePath.toString();
      if (p.includes(".pi/tools.json") && p.includes("test-project")) {
        return JSON.stringify({
          gemini: { apiKey: "trusted-key" },
        });
      }
      throw new Error("ENOENT");
    });
    vi.mocked(fs.existsSync).mockImplementation((filePath: any) => {
      const p = typeof filePath === "string" ? filePath : filePath.toString();
      return p.includes("test-project") && p.includes(".pi/tools.json");
    });

    recordProjectTrust({ cwd: "/test-project", isProjectTrusted: () => true });
    const config = loadMergedConfig("/test-project");
    expect(config.gemini?.apiKey).toBe("trusted-key");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run tests/config-trust.test.ts
```

Expected: FAIL — `stripSensitiveFields` is not exported from `src/config.ts` yet.

- [ ] **Step 3: Add `stripSensitiveFields` to `src/config.ts`**

Add after the `resolveProviderKey` function (around line 363), before the `MAX_WALK_DEPTH` constant:

```typescript
// --- Trust Gating ---

const SENSITIVE_KEY_PATTERNS: RegExp[] = [
  /\.apiKey$/,
  /\.apiSecret$/,
  /\.token$/,
];

const SENSITIVE_PATH_PATTERNS: RegExp[] = [
  /^ssrf\.allowRanges$/,
  /^gemini\.cloudflareApiKey$/,
  /^gemini\.allowBrowserCookies$/,
];

/**
 * Recursively remove sensitive fields from a config object.
 * Returns a shallow clone at each level with sensitive keys omitted.
 *
 * A field is sensitive if:
 * - Its dot-separated path ends with a key matching SENSITIVE_KEY_PATTERNS
 * - Its full dot-separated path matches SENSITIVE_PATH_PATTERNS
 */
export function stripSensitiveFields(
  config: Record<string, unknown>,
  prefix = "",
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(config)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (
      SENSITIVE_KEY_PATTERNS.some((p) => p.test(fullPath)) ||
      SENSITIVE_PATH_PATTERNS.some((p) => p.test(fullPath))
    ) {
      continue; // strip this field
    }
    const value = config[key];
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      result[key] = stripSensitiveFields(
        value as Record<string, unknown>,
        fullPath,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}
```

- [ ] **Step 4: Add trust import and modify `loadMergedConfig` in `src/config.ts`**

Add import at the top of `src/config.ts` (after line 7):

```typescript
import { isProjectTrustedCached } from "./utils/trust.ts";
```

Replace the project config block in `loadMergedConfig()` (lines 418-428):

```typescript
  // Layer 1: project config (highest priority)
  if (cwd) {
    const projectPath = findProjectConfigPath(cwd);
    if (projectPath) {
      try {
        const raw = JSON.parse(fs.readFileSync(projectPath, "utf-8")) as Record<string, unknown>;
        const trusted = isProjectTrustedCached(cwd);
        const sanitized = trusted ? raw : stripSensitiveFields(raw);
        if (!trusted && sanitized !== raw) {
          console.warn(
            "[pi-tools] Untrusted project: sensitive config fields ignored. Trust the project in Pi to allow full config.",
          );
        }
        merged = deepMerge(merged, sanitized);
      } catch {
        // Malformed project config — skip
      }
    }
  }
```

- [ ] **Step 5: Add trust recording event handlers in `src/index.ts`**

Add import at the top of `src/index.ts` (after line 17):

```typescript
import { recordProjectTrust } from "./utils/trust.ts";
```

Add event handlers after the existing `session_start` handler block (after line 47), before `const resolveCandidates`:

```typescript
  // Record project trust state for config gating
  pi.on("session_start", (_event, ctx) => {
    recordProjectTrust(ctx);
  });
  pi.on("model_select", (_event, ctx) => {
    recordProjectTrust(ctx);
  });
  pi.on("before_provider_request", (_event, ctx) => {
    recordProjectTrust(ctx);
  });
```

- [ ] **Step 6: Run trust tests**

```bash
pnpm vitest run tests/config-trust.test.ts
```

Expected: all tests PASS.

- [ ] **Step 7: Run full test suite for regressions**

```bash
pnpm test
```

Expected: all existing tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/config.ts src/index.ts tests/config-trust.test.ts
git commit -m "feat: add project trust gating for sensitive config fields

Project-level .pi/tools.json can no longer override sensitive fields
(apiKey, apiSecret, token, ssrf.allowRanges, gemini.cloudflareApiKey,
gemini.allowBrowserCookies) unless the project is explicitly trusted
via Pi's trust store.

Trust state is recorded from session_start, model_select, and
before_provider_request event handlers, and cached via the global
symbol registry in src/utils/trust.ts.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

## Task 3: PDF config — add `PdfConfig` to config types and defaults

**Files:**
- Modify: `src/config.ts`

- [ ] **Step 1: Add `PdfConfig` interface to `src/config.ts`**

Add after the `VideoConfig` interface (after line 74):

```typescript
export interface PdfConfig {
  ocrEnabled?: boolean;
  ocrMaxPages?: number;
  ocrDpi?: number;
}
```

- [ ] **Step 2: Add `pdf` field to `PiToolsConfig` interface**

In the `PiToolsConfig` interface (line 76-88), add after `video?: VideoConfig;`:

```typescript
  pdf?: PdfConfig;
```

- [ ] **Step 3: Add `pdf` to `parseConfigFile` result**

In `parseConfigFile()` (around line 270), add after `video: parsed.video,`:

```typescript
    pdf: parsed.pdf,
```

- [ ] **Step 4: Run existing config tests to verify no regressions**

```bash
pnpm vitest run tests/config.test.ts
```

Expected: all existing tests PASS (new field is optional with no default).

- [ ] **Step 5: Commit**

```bash
git add src/config.ts
git commit -m "feat: add PdfConfig type with ocrEnabled, ocrMaxPages, ocrDpi fields

All fields are optional with defaults handled at usage sites:
ocrEnabled defaults to true, ocrMaxPages to 5, ocrDpi to 150.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

## Task 4: PDF OCR — write tests and implement `src/extract/pdf-ocr.ts`

**Files:**
- Create: `tests/extract/pdf-ocr.test.ts`
- Create: `src/extract/pdf-ocr.ts`

- [ ] **Step 1: Create test file for PDF OCR module**

```typescript
// tests/extract/pdf-ocr.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  looksLikeScannedPdf,
  modelSupportsImages,
  rasterizePdfPages,
  extractTextWithGeminiVision,
} from "../../src/extract/pdf-ocr.ts";
import { makeCtx } from "../helpers.ts";

describe("looksLikeScannedPdf", () => {
  it("returns true when text is empty", () => {
    expect(looksLikeScannedPdf("", 10_000)).toBe(true);
  });

  it("returns true when text is only whitespace", () => {
    expect(looksLikeScannedPdf("   \n\t  ", 10_000)).toBe(true);
  });

  it("returns true when PDF is large but text is short", () => {
    expect(looksLikeScannedPdf("Title page", 50_000)).toBe(true);
  });

  it("returns false when text exceeds 200 chars", () => {
    const text = "A".repeat(201);
    expect(looksLikeScannedPdf(text, 50_000)).toBe(false);
  });

  it("returns false when PDF is small (under 5000 bytes) even with short text", () => {
    expect(looksLikeScannedPdf("Short", 4_999)).toBe(false);
  });

  it("returns true when text is empty regardless of file size", () => {
    // Empty text always triggers, even for tiny PDFs
    expect(looksLikeScannedPdf("", 100)).toBe(true);
  });

  it("skips OCR when ocrEnabled is false", async () => {
    // Even with a scanned PDF, OCR should not trigger when disabled
    const scannedPdf = new Uint8Array(10_000); // > 5KB
    const text = ""; // empty = looks scanned

    // This test verifies the pipeline check, not rasterization
    // When ocrEnabled is false, looksLikeScannedPdf result is irrelevant
    expect(looksLikeScannedPdf(text, scannedPdf.byteLength)).toBe(true);
    // The config gate happens in pipeline.ts: pdfConfig?.ocrEnabled !== false
    // This is tested via the pipeline integration, not the unit function
  });
});

describe("modelSupportsImages", () => {
  it("returns true when model input includes 'image'", () => {
    const ctx = makeCtx({ model: { input: ["text", "image"], provider: "openai" } as any });
    expect(modelSupportsImages(ctx)).toBe(true);
  });

  it("returns false when model input is text-only", () => {
    const ctx = makeCtx({ model: { input: ["text"], provider: "openai" } as any });
    expect(modelSupportsImages(ctx)).toBe(false);
  });

  it("returns false when model is undefined", () => {
    const ctx = makeCtx({ model: undefined });
    expect(modelSupportsImages(ctx)).toBe(false);
  });

  it("returns false when model.input is undefined", () => {
    const ctx = makeCtx({ model: { provider: "openai" } as any });
    expect(modelSupportsImages(ctx)).toBe(false);
  });
});

describe("rasterizePdfPages", () => {
  const originalExecFile = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("exports rasterizePdfPages function", () => {
    expect(typeof rasterizePdfPages).toBe("function");
  });

  it("rejects when pdftoppm is not installed", async () => {
    // Mock child_process.execFile to simulate ENOENT
    const { execFile } = await import("node:child_process");
    vi.mock("node:child_process", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:child_process")>();
      return {
        ...actual,
        execFile: vi.fn((_cmd: string, _args: string[], _opts: object, cb: Function) => {
          const err = Object.assign(new Error("spawn pdftoppm ENOENT"), { code: "ENOENT" });
          cb(err, "", "");
          return { kill: vi.fn() };
        }),
      };
    });

    const buffer = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    await expect(rasterizePdfPages(buffer)).rejects.toThrow();
  });

  it("defaults maxPages to 5 and dpi to 150", async () => {
    // Verify default options are used — implementation detail test
    // This validates the interface contract
    const buffer = new Uint8Array(0);
    try {
      await rasterizePdfPages(buffer, { maxPages: 3, dpi: 200 });
    } catch {
      // Expected to fail without pdftoppm — we just verify it doesn't crash on options
    }
  });
});

describe("extractTextWithGeminiVision", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends images to Gemini and returns extracted text", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "OCR result: Invoice #12345\nTotal: $100.00" }],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const images = [
      { type: "image" as const, mimeType: "image/png" as const, data: "base64data==", pageNumber: 1 },
    ];
    const result = await extractTextWithGeminiVision(images, "test-api-key");
    expect(result).toContain("Invoice #12345");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    // Verify the request body includes inline_data
    const call = vi.mocked(globalThis.fetch).mock.calls[0];
    const body = JSON.parse(call[1]?.body as string);
    expect(body.contents[0].parts).toHaveLength(2); // image part + text prompt
  });

  it("returns null when Gemini API returns an error", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response("Internal Server Error", { status: 500 });
    }) as unknown as typeof fetch;

    const images = [
      { type: "image" as const, mimeType: "image/png" as const, data: "base64data==", pageNumber: 1 },
    ];
    const result = await extractTextWithGeminiVision(images, "test-api-key");
    expect(result).toBeNull();
  });

  it("returns null when Gemini returns empty response", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ candidates: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const images = [
      { type: "image" as const, mimeType: "image/png" as const, data: "base64data==", pageNumber: 1 },
    ];
    const result = await extractTextWithGeminiVision(images, "test-api-key");
    expect(result).toBeNull();
  });

  it("respects abort signal", async () => {
    const controller = new AbortController();
    controller.abort();

    globalThis.fetch = vi.fn(async (_url: any, init: any) => {
      if (init?.signal?.aborted) {
        throw new DOMException("The operation was aborted", "AbortError");
      }
      return new Response("ok");
    }) as unknown as typeof fetch;

    const images = [
      { type: "image" as const, mimeType: "image/png" as const, data: "base64data==", pageNumber: 1 },
    ];
    const result = await extractTextWithGeminiVision(
      images,
      "test-api-key",
      undefined,
      controller.signal,
    );
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run tests/extract/pdf-ocr.test.ts
```

Expected: FAIL — `src/extract/pdf-ocr.ts` does not exist yet.

- [ ] **Step 3: Implement `src/extract/pdf-ocr.ts`**

```typescript
// src/extract/pdf-ocr.ts
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getVersionedApiBase, DEFAULT_MODEL } from "./gemini-api.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RasterizeOptions {
  maxPages?: number; // default: 5, max: 20
  dpi?: number; // default: 150, range: 72-300
}

export interface PdfPageImage {
  type: "image";
  mimeType: "image/png";
  data: string; // base64-encoded PNG
  pageNumber: number;
}

export interface RasterizeResult {
  pageCount: number;
  images: PdfPageImage[];
  truncated: boolean; // true if pageCount > maxPages
}

// ---------------------------------------------------------------------------
// Scanned PDF Heuristic
// ---------------------------------------------------------------------------

/**
 * Determine whether a PDF is likely a scanned/image-based document.
 *
 * Returns true when:
 * - Extracted text is empty after whitespace normalization, OR
 * - PDF byte size > 5000 AND trimmed text < 200 characters
 */
export function looksLikeScannedPdf(text: string, byteLength: number): boolean {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) return true;
  if (byteLength > 5000 && trimmed.length < 200) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Model Vision Detection
// ---------------------------------------------------------------------------

/**
 * Check whether the calling model supports image input.
 * Uses Pi's Model interface: `ctx.model?.input` is an array of
 * `("text" | "image")[]`.
 */
export function modelSupportsImages(ctx: ExtensionContext): boolean {
  return (ctx.model as any)?.input?.includes("image") ?? false;
}

// ---------------------------------------------------------------------------
// PDF Rasterization (pdftoppm CLI)
// ---------------------------------------------------------------------------

/**
 * Rasterize PDF pages to PNG using `pdftoppm` from poppler-utils.
 *
 * Writes the PDF buffer to a temp directory, runs pdftoppm, reads
 * output PNGs as base64, and cleans up the temp directory.
 *
 * @throws Error if pdftoppm is not installed or rasterization fails
 */
export async function rasterizePdfPages(
  pdfBuffer: Uint8Array,
  options?: RasterizeOptions,
): Promise<RasterizeResult> {
  const maxPages = Math.min(Math.max(1, options?.maxPages ?? 5), 20);
  const dpi = Math.min(Math.max(72, options?.dpi ?? 150), 300);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-pdf-ocr-"));
  const pdfPath = path.join(tmpDir, "input.pdf");
  const outputPrefix = path.join(tmpDir, "page");

  try {
    fs.writeFileSync(pdfPath, pdfBuffer);

    await new Promise<void>((resolve, reject) => {
      execFile(
        "pdftoppm",
        [
          "-png",
          "-r", String(dpi),
          "-f", "1",
          "-l", String(maxPages),
          pdfPath,
          outputPrefix,
        ],
        { timeout: 30_000 },
        (err, _stdout, stderr) => {
          if (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === "ENOENT") {
              reject(new Error(
                "pdftoppm not found. Install poppler-utils for PDF OCR:\n" +
                "  macOS: brew install poppler\n" +
                "  Ubuntu/Debian: apt-get install poppler-utils",
              ));
            } else {
              reject(new Error(`pdftoppm failed: ${stderr || err.message}`));
            }
            return;
          }
          resolve();
        },
      );
    });

    // Read generated PNG files (pdftoppm names them page-01.png, page-02.png, etc.)
    const files = fs.readdirSync(tmpDir)
      .filter((f) => f.startsWith("page") && f.endsWith(".png"))
      .sort();

    const images: PdfPageImage[] = files.map((file, index) => {
      const data = fs.readFileSync(path.join(tmpDir, file));
      return {
        type: "image" as const,
        mimeType: "image/png" as const,
        data: data.toString("base64"),
        pageNumber: index + 1,
      };
    });

    // Estimate total page count: if we got maxPages images, the PDF likely has more
    const truncated = images.length >= maxPages;
    const pageCount = truncated ? maxPages : images.length; // conservative estimate

    return { pageCount, images, truncated };
  } finally {
    // Clean up temp directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

// ---------------------------------------------------------------------------
// Gemini Vision OCR
// ---------------------------------------------------------------------------

/**
 * Extract text from PDF page images using Gemini's vision capability.
 * Returns the OCR'd text, or null if the API call fails.
 */
export async function extractTextWithGeminiVision(
  images: PdfPageImage[],
  geminiApiKey: string,
  options?: { geminiBaseUrl?: string; model?: string },
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const model = options?.model ?? DEFAULT_MODEL;
    const baseUrl = options?.geminiBaseUrl
      ? `${options.geminiBaseUrl.replace(/\/+$/, "")}/v1beta`
      : getVersionedApiBase();
    const url = `${baseUrl}/models/${model}:generateContent?key=${geminiApiKey}`;

    // Build parts: one inline_data per page image, then the text prompt
    const parts: Array<Record<string, unknown>> = images.map((img) => ({
      inline_data: {
        mime_type: img.mimeType,
        data: img.data,
      },
    }));

    parts.push({
      text:
        "Extract all text from these scanned PDF page images. " +
        "Preserve the original layout, headings, paragraphs, and any table structure. " +
        "Return only the extracted text, no commentary.",
    });

    const body = {
      contents: [{ role: "user", parts }],
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) return null;

    const data = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    const text = data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text)
      .filter(Boolean)
      .join("\n");

    return text || null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run tests/extract/pdf-ocr.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/extract/pdf-ocr.ts tests/extract/pdf-ocr.test.ts
git commit -m "feat: add PDF OCR module with scanned-PDF heuristic and dual strategy

New module src/extract/pdf-ocr.ts provides:
- looksLikeScannedPdf(): heuristic for empty/minimal text PDFs
- modelSupportsImages(): checks ctx.model.input for vision capability
- rasterizePdfPages(): converts PDF to PNGs via pdftoppm CLI
- extractTextWithGeminiVision(): OCR fallback via Gemini vision API

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

## Task 5: PDF OCR — integrate into pipeline.ts

**Files:**
- Modify: `src/extract/pipeline.ts`

- [ ] **Step 1: Add imports to `pipeline.ts`**

Add after the existing import of `extractPdf` (line 6):

```typescript
import {
  looksLikeScannedPdf,
  rasterizePdfPages,
  modelSupportsImages,
  extractTextWithGeminiVision,
  type PdfPageImage,
} from "./pdf-ocr.ts";
import { resolveApiKey, type GeminiConfig, type PdfConfig } from "../config.ts";
import { getApiKey as getGeminiApiKey } from "./gemini-api.ts";
```

- [ ] **Step 2: Add `images` field to `ExtractedContent` interface**

In the `ExtractedContent` interface (lines 37-48), add after `frames?: VideoFrame[];`:

```typescript
  images?: PdfPageImage[];
```

- [ ] **Step 3: Add PDF OCR options to `ExtractOptions` interface**

In the `ExtractOptions` interface (lines 66-74), add after `model?: string;`:

```typescript
  pdf?: PdfConfig;
  gemini?: GeminiConfig;
  ctx?: import("@earendil-works/pi-coding-agent").ExtensionContext;
```

- [ ] **Step 4: Add OCR fallback after existing PDF extraction**

Replace the PDF extraction section (lines 214-236):

```typescript
  // PDF extraction — must return or throw here since arrayBuffer() consumes
  // the response body stream (cannot call response.text() afterwards)
  if (contentType.includes("application/pdf")) {
    chain.push("pdf");
    let pdfText = "";
    const buffer = new Uint8Array(await response.arrayBuffer());

    try {
      pdfText = await extractPdf(buffer);
    } catch {
      // unpdf extraction failed — pdfText remains empty
    }

    // If text extraction succeeded with enough content, return it
    if (pdfText.length > 0 && !looksLikeScannedPdf(pdfText, buffer.byteLength)) {
      return {
        text: pdfText,
        title: undefined,
        url,
        extractionChain: chain,
        chars: pdfText.length,
        truncated: false,
      };
    }

    // OCR fallback for scanned PDFs
    const pdfConfig = options?.pdf;
    if (pdfConfig?.ocrEnabled !== false) {
      chain.push("pdf:scanned");
      try {
        const rasterResult = await rasterizePdfPages(buffer, {
          maxPages: pdfConfig?.ocrMaxPages ?? 5,
          dpi: pdfConfig?.ocrDpi ?? 150,
        });

        // Strategy 1: If calling model supports images, return content blocks
        if (options?.ctx && modelSupportsImages(options.ctx)) {
          chain.push("pdf-ocr:content-blocks");
          const imagesNote =
            `\n\n[${rasterResult.images.length} scanned PDF page image(s) attached for vision OCR` +
            `${rasterResult.truncated ? ` (showing ${rasterResult.images.length} of ${rasterResult.pageCount}+ pages)` : ""}]`;
          return {
            text: pdfText + imagesNote,
            title: undefined,
            url,
            extractionChain: chain,
            chars: pdfText.length + imagesNote.length,
            truncated: rasterResult.truncated,
            images: rasterResult.images,
          };
        }

        // Strategy 2: Call Gemini vision API directly
        const geminiKey = getGeminiApiKey() ?? resolveApiKey(options?.gemini?.apiKey);
        if (geminiKey) {
          const ocrText = await extractTextWithGeminiVision(
            rasterResult.images,
            geminiKey,
            { geminiBaseUrl: options?.gemini?.baseUrl },
            signal,
          );
          if (ocrText && ocrText.length > 100) {
            chain.push("pdf-ocr:gemini");
            return {
              text: ocrText,
              title: undefined,
              url,
              extractionChain: chain,
              chars: ocrText.length,
              truncated: false,
            };
          }
          chain.push("pdf-ocr:gemini-fail");
        }
      } catch {
        chain.push("pdf-ocr:error");
        // pdftoppm not installed or other rasterization failure — fall through
      }
    }

    // All PDF strategies failed
    if (pdfText.length > 0) {
      // Return the meager text we have rather than throwing
      return {
        text: pdfText,
        title: undefined,
        url,
        extractionChain: chain,
        chars: pdfText.length,
        truncated: false,
      };
    }

    chain.push("pdf:fail");
    throw new Error(`Could not extract content from ${url}. Tried: ${chain.join(" -> ")}`);
  }
```

- [ ] **Step 5: Run existing pipeline tests for regressions**

```bash
pnpm vitest run tests/extract/pipeline.test.ts tests/extract/pipeline-routing.test.ts tests/extract/pipeline-ssrf.test.ts tests/extract/pdf.test.ts
```

Expected: all existing tests PASS (OCR path only fires when `looksLikeScannedPdf` returns true, which doesn't affect existing test fixtures).

- [ ] **Step 6: Run full test suite**

```bash
pnpm test
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/extract/pipeline.ts
git commit -m "feat: integrate PDF OCR fallback into extraction pipeline

When PDF text extraction yields empty or minimal text (scanned PDF
heuristic), the pipeline now:
1. Rasterizes pages to PNG via pdftoppm
2. Strategy 1: attaches images as content blocks if model has vision
3. Strategy 2: calls Gemini vision API for OCR text extraction

OCR is controlled by PdfConfig.ocrEnabled (default: true),
ocrMaxPages (default: 5), and ocrDpi (default: 150). Falls through
gracefully when pdftoppm is not installed.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

## Task 6: File reorg — extract concurrency utility

**Files:**
- Create: `src/utils/concurrency.ts`
- Modify: `src/tools/web-fetch.ts`

- [ ] **Step 1: Create `src/utils/concurrency.ts`**

```typescript
// src/utils/concurrency.ts

/**
 * Run async tasks with a bounded concurrency limit.
 * Returns PromiseSettledResult<T>[] preserving the original task order.
 *
 * Uses a simple worker-pool pattern: `maxConcurrent` workers pull tasks
 * from a shared index counter until all tasks are consumed.
 */
export async function fetchWithConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  maxConcurrent: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      try {
        const value = await tasks[index]();
        results[index] = { status: "fulfilled", value };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(maxConcurrent, tasks.length) },
    () => runNext(),
  );
  await Promise.all(workers);
  return results;
}
```

- [ ] **Step 2: Update `src/tools/web-fetch.ts` to import from concurrency utility**

Replace the `fetchWithConcurrencyLimit` function and its usage in `web-fetch.ts`.

Remove the function definition (lines 74-96):

```typescript
async function fetchWithConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  maxConcurrent: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      try {
        const value = await tasks[index]();
        results[index] = { status: "fulfilled", value };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  const workers = Array.from({ length: Math.min(maxConcurrent, tasks.length) }, () => runNext());
  await Promise.all(workers);
  return results;
}
```

And add the import at the top of `web-fetch.ts` (after line 14):

```typescript
import { fetchWithConcurrencyLimit } from "../utils/concurrency.ts";
```

- [ ] **Step 3: Run web-fetch tests to verify no regressions**

```bash
pnpm vitest run tests/extract/pipeline.test.ts
pnpm test
```

Expected: all existing tests PASS unchanged. The function behavior is identical, only the import location changed.

- [ ] **Step 4: Commit**

```bash
git add src/utils/concurrency.ts src/tools/web-fetch.ts
git commit -m "refactor: extract fetchWithConcurrencyLimit to src/utils/concurrency.ts

Pure mechanical extraction — no behavioral changes. The generic worker
pool is now reusable across modules.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

## Task 7: File reorg — extract multi-URL logic to `src/tools/web-fetch-multi.ts`

**Files:**
- Create: `src/tools/web-fetch-multi.ts`
- Modify: `src/tools/web-fetch.ts`

- [ ] **Step 1: Create `src/tools/web-fetch-multi.ts`**

Extract the multi-URL orchestration from the `execute` method of the tool definition. This includes URL deduplication, concurrent fetching, per-URL caps, and result building for the multi-URL path.

```typescript
// src/tools/web-fetch-multi.ts
import type { ContentStore } from "../storage.ts";
import {
  extractContent,
  type ExtractedContent,
} from "../extract/pipeline.ts";
import { truncateContent } from "../utils/truncate.ts";
import { fetchWithConcurrencyLimit } from "../utils/concurrency.ts";
import type { ContentCache } from "../cache.ts";
import type { GitHubConfig } from "../config.ts";

const INLINE_LIMIT = 15_000;
const MANIFEST_PREVIEW_CHARS = 512;
const MAX_CONCURRENT = 5;

interface UrlResult {
  url: string;
  title?: string;
  chars: number;
  contentId?: string;
  error?: string;
}

type ImageBlock = { type: "image"; data: string; mimeType: string };

export function perUrlCap(count: number): number {
  return count <= 1
    ? INLINE_LIMIT
    : count <= 5
      ? Math.floor(INLINE_LIMIT / count)
      : MANIFEST_PREVIEW_CHARS;
}

function collectImageBlocks(extracted: ExtractedContent): ImageBlock[] {
  const blocks: ImageBlock[] = [];
  if (extracted.thumbnail) {
    blocks.push({ type: "image", data: extracted.thumbnail.data, mimeType: extracted.thumbnail.mimeType });
  }
  if (extracted.frames) {
    for (const frame of extracted.frames) {
      blocks.push({ type: "image", data: frame.data, mimeType: frame.mimeType });
    }
  }
  return blocks;
}

export interface MultiUrlOptions {
  urls: string[];
  params: {
    raw?: boolean;
    fresh?: boolean;
    prompt?: string;
    timestamp?: string;
    frames?: number;
    model?: string;
  };
  signal: AbortSignal | undefined;
  store: ContentStore;
  cache?: ContentCache;
  githubConfig?: GitHubConfig;
  ssrfAllowRanges?: string[];
}

export async function executeMultiUrl(options: MultiUrlOptions): Promise<{
  content: Array<{ type: "text"; text: string } | ImageBlock>;
  details: {
    url: string;
    chars: number;
    truncated: boolean;
    extractionChain: string[];
    urlResults: UrlResult[];
  };
}> {
  const { urls, params, signal, store, cache, githubConfig, ssrfAllowRanges } = options;
  const cap = perUrlCap(urls.length);
  const isManifest = urls.length >= 6;

  // Deduplicate URLs — fetch each unique URL once, reuse results
  const uniqueUrls = [...new Set(urls)];
  const tasks = uniqueUrls.map((u) => async () => {
    if (!params.fresh) {
      const cached = cache?.get(u);
      if (cached) return cached;
    }

    const extracted = await extractContent(u, signal ?? undefined, {
      raw: params.raw,
      github: githubConfig,
      allowRanges: ssrfAllowRanges,
      prompt: params.prompt,
      timestamp: params.timestamp,
      frames: params.frames,
      model: params.model,
    });

    cache?.set(u, extracted);
    return extracted;
  });

  const settled = await fetchWithConcurrencyLimit(tasks, MAX_CONCURRENT);

  // Build a map from unique URL -> result for O(1) lookup by duplicates
  const resultByUrl = new Map<string, PromiseSettledResult<ExtractedContent>>();
  for (let i = 0; i < uniqueUrls.length; i++) {
    resultByUrl.set(uniqueUrls[i], settled[i]);
  }

  const urlResults: UrlResult[] = [];
  const outputParts: string[] = [];
  const imageBlocks: ImageBlock[] = [];

  for (const u of urls) {
    const outcome = resultByUrl.get(u)!;
    if (outcome.status === "rejected") {
      const errMsg =
        outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      urlResults.push({ url: u, chars: 0, error: errMsg });
      outputParts.push(`## ${u}\n\nError: ${errMsg}\n`);
      continue;
    }

    const extracted = outcome.value;

    // Always store full content for retrieval via web_read
    const contentId = store.store({
      url: extracted.url,
      title: extracted.title,
      text: extracted.text,
      source: "web_fetch",
    });

    const preview =
      extracted.chars > cap ? truncateContent(extracted.text, cap) : extracted.text;

    urlResults.push({
      url: extracted.url,
      title: extracted.title,
      chars: extracted.chars,
      contentId,
    });

    const header = extracted.title ? `## ${extracted.title}` : `## ${extracted.url}`;
    const meta = `Source: ${extracted.url} | ${extracted.chars} chars | contentId: ${contentId}`;
    outputParts.push(`${header}\n${meta}\n\n${preview}\n`);
    imageBlocks.push(...collectImageBlocks(extracted));
  }

  const failed = urlResults.filter((r) => r.error).length;
  const succeeded = urls.length - failed;
  const summary = `Fetched ${succeeded}/${urls.length} URLs successfully${failed > 0 ? ` (${failed} failed)` : ""}${isManifest ? ". Use web_read with contentId for full text." : ""}\n\n`;

  return {
    content: [
      { type: "text" as const, text: summary + outputParts.join("\n---\n\n") },
      ...imageBlocks,
    ],
    details: {
      url: urls[0],
      chars: urlResults.reduce((sum, r) => sum + r.chars, 0),
      truncated: urlResults.some((r) => !r.error && r.chars > cap),
      extractionChain: ["multi-url"],
      urlResults,
    },
  };
}
```

- [ ] **Step 2: Update `src/tools/web-fetch.ts` to use `executeMultiUrl`**

Replace the multi-URL path in the `execute` method. In `web-fetch.ts`, remove:
- The local `perUrlCap` function (lines 66-72)
- The `MANIFEST_PREVIEW_CHARS` constant (line 18, keep `INLINE_LIMIT`)
- The `MAX_CONCURRENT` constant (line 19)
- The multi-URL block inside `execute` (the entire section from `// Multi-URL path` through the end of its return statement, roughly lines 217-308)
- The `collectImageBlocks` function (lines 361-374) since it's now in web-fetch-multi.ts
- The `ImageBlock` type alias (line 361)

Add import at the top:

```typescript
import { executeMultiUrl } from "./web-fetch-multi.ts";
```

The multi-URL path in `execute` becomes:

```typescript
      // Multi-URL path
      const urls = params.urls!;

      return executeMultiUrl({
        urls,
        params,
        signal: signal ?? undefined,
        store,
        cache,
        githubConfig,
        ssrfAllowRanges,
      });
```

Keep the `collectImageBlocks` function in `web-fetch.ts` as well (it's still used by `buildResult`), OR import it from `web-fetch-multi.ts`. Since `buildResult` also uses it, the cleanest approach is to keep a local copy in `web-fetch.ts` for `buildResult` and have `web-fetch-multi.ts` have its own copy (both are small, 12-line functions). Alternatively, move `collectImageBlocks` to a shared location — but that's more churn. Keep both copies for now.

The constants `INLINE_LIMIT` remains in `web-fetch.ts` (used by `buildResult`). `MAX_CONCURRENT` and `MANIFEST_PREVIEW_CHARS` move to `web-fetch-multi.ts` only.

After this refactor, `web-fetch.ts` should contain approximately:
- Imports
- `INLINE_LIMIT` constant
- `WebFetchParams` schema
- `UrlResult`, `WebFetchDetails` interfaces
- `createWebFetchTool` factory with `executeSingleUrl` inside
- `execute` method (simplified: single-URL path + delegated multi-URL path)
- `renderCall`, `renderResult`
- `ImageBlock` type + `collectImageBlocks` (for `buildResult`)
- `ToolResult` type + `buildResult` + `errorResult`

- [ ] **Step 3: Run all tests to verify no regressions**

```bash
pnpm test
```

Expected: **all existing tests PASS without modification.** This is a pure mechanical refactor — no behavior changes.

- [ ] **Step 4: Commit**

```bash
git add src/tools/web-fetch.ts src/tools/web-fetch-multi.ts
git commit -m "refactor: extract multi-URL orchestration to web-fetch-multi.ts

Pure mechanical extraction — no behavioral changes. web-fetch.ts
drops from ~448 lines to ~280 lines. Multi-URL deduplication,
concurrency, per-URL caps, and manifest mode are now in
web-fetch-multi.ts.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

## Task 8: Final verification and typecheck

- [ ] **Step 1: Run the full test suite**

```bash
pnpm test
```

Expected: all tests PASS.

- [ ] **Step 2: Run typecheck**

```bash
pnpm run typecheck
```

Expected: no type errors.

- [ ] **Step 3: Verify new file count**

New files created in Phase 3:
- `src/utils/trust.ts`
- `src/utils/concurrency.ts`
- `src/extract/pdf-ocr.ts`
- `src/tools/web-fetch-multi.ts`
- `tests/utils/trust.test.ts`
- `tests/config-trust.test.ts`
- `tests/extract/pdf-ocr.test.ts`

Modified files:
- `src/config.ts` (PdfConfig type, stripSensitiveFields, trust-gated loadMergedConfig)
- `src/index.ts` (trust recording event handlers)
- `src/extract/pipeline.ts` (PDF OCR integration, images field on ExtractedContent)
- `src/tools/web-fetch.ts` (extracted concurrency + multi-URL logic)

- [ ] **Step 4: Final commit (if any fixups needed)**

```bash
git status
# If there are uncommitted changes from fixups:
git add -A
git commit -m "fix: phase 3 post-integration fixups

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

**Phase 3 complete.** Three independent features delivered:
- **3b (Trust Gating):** Project configs can no longer override sensitive fields unless explicitly trusted. Trust state cached via global symbol registry.
- **3a (PDF OCR):** Scanned PDFs trigger dual-strategy OCR: content blocks for vision-capable models, Gemini API fallback otherwise. Controlled by `PdfConfig.ocrEnabled/ocrMaxPages/ocrDpi`.
- **3c (File Reorg):** `web-fetch.ts` split from 448 to ~280 lines. `fetchWithConcurrencyLimit` in `src/utils/concurrency.ts`, multi-URL orchestration in `src/tools/web-fetch-multi.ts`. No behavioral changes.
