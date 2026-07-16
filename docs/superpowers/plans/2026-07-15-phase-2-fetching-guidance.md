# Phase 2: Content Negotiation & Dynamic Guidance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a HEAD probe to skip binary/large downloads before fetching, and detect environment capabilities (gh, yt-dlp, ffmpeg) to inject relevant tool guidance at startup.

**Architecture:** HEAD probe is a pure function in pipeline.ts called before the existing GET. Capabilities detection is a new utility that runs once at extension startup; results are merged into guidance arrays before tool registration.

**Tech Stack:** TypeScript, Vitest, native `fetch`, `child_process.spawnSync`

**Spec:** `docs/superpowers/specs/2026-07-15-feature-adoption-design.md` (Phase 2)

**Competitive reference:** supi-web's 4-stage negotiation pipeline and `spawnSync`-based capability detection (best practice among 9 reviewed packages).

---

### Task 1: Write failing tests for HEAD probe

**Files:**
- Create: `tests/extract/head-probe.test.ts`

- [ ] **Step 1: Create test file**

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import { probeUrl } from "../../src/extract/pipeline.ts";

describe("probeUrl", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns skip: true for binary content type (image/png)", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(null, {
        status: 200,
        headers: { "content-type": "image/png", "content-length": "1024" },
      }),
    ) as unknown as typeof fetch;

    const result = await probeUrl("https://example.com/photo.png");
    expect(result.skip).toBe(true);
    expect(result.reason).toBe("binary content type");
  });

  it("returns skip: false for text/html", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(null, {
        status: 200,
        headers: { "content-type": "text/html", "content-length": "5000" },
      }),
    ) as unknown as typeof fetch;

    const result = await probeUrl("https://example.com/page");
    expect(result.skip).toBe(false);
    expect(result.contentType).toBe("text/html");
  });

  it("returns skip: false when HEAD returns 405", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(null, { status: 405 }),
    ) as unknown as typeof fetch;

    const result = await probeUrl("https://example.com/page");
    expect(result.skip).toBe(false);
  });

  it("returns skip: false when HEAD times out", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("timeout");
    }) as unknown as typeof fetch;

    const result = await probeUrl("https://example.com/page");
    expect(result.skip).toBe(false);
  });

  it("returns skip: true for non-PDF content over 10MB", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(null, {
        status: 200,
        headers: { "content-type": "text/html", "content-length": String(11 * 1024 * 1024) },
      }),
    ) as unknown as typeof fetch;

    const result = await probeUrl("https://example.com/huge");
    expect(result.skip).toBe(true);
    expect(result.reason).toBe("response too large");
  });

  it("allows PDF under 50MB", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(null, {
        status: 200,
        headers: { "content-type": "application/pdf", "content-length": String(30 * 1024 * 1024) },
      }),
    ) as unknown as typeof fetch;

    const result = await probeUrl("https://example.com/doc.pdf");
    expect(result.skip).toBe(false);
  });

  it("returns skip: true for PDF over 50MB", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(null, {
        status: 200,
        headers: { "content-type": "application/pdf", "content-length": String(55 * 1024 * 1024) },
      }),
    ) as unknown as typeof fetch;

    const result = await probeUrl("https://example.com/huge.pdf");
    expect(result.skip).toBe(true);
    expect(result.reason).toBe("PDF too large");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run tests/extract/head-probe.test.ts
```

Expected: FAIL — `probeUrl` is not exported from pipeline.ts yet.

---

### Task 2: Implement HEAD probe

**Files:**
- Modify: `src/extract/pipeline.ts`

- [ ] **Step 3: Add probeUrl function**

Add this after `HONEST_USER_AGENT` (line 66) in `src/extract/pipeline.ts`:

```typescript
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB for non-PDF
const MAX_PDF_SIZE_BYTES = 50 * 1024 * 1024; // 50MB for PDF
const HEAD_TIMEOUT_MS = 5_000;

export interface ProbeResult {
  skip: boolean;
  reason?: string;
  contentType?: string;
  contentLength?: number;
}

export async function probeUrl(
  url: string,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "HEAD",
      headers: BROWSER_HEADERS,
      signal: signal ?? AbortSignal.timeout(HEAD_TIMEOUT_MS),
      redirect: "follow",
    });
  } catch {
    return { skip: false };
  }

  // HEAD not supported or error — fall through to GET
  if (!response.ok) return { skip: false };

  const contentType = response.headers.get("content-type") ?? "";
  const contentLengthStr = response.headers.get("content-length");
  const contentLength = contentLengthStr ? Number.parseInt(contentLengthStr, 10) : undefined;

  // Block binary content (except PDF)
  if (!contentType.includes("application/pdf")) {
    for (const prefix of BINARY_CONTENT_TYPES) {
      if (contentType.startsWith(prefix)) {
        return { skip: true, reason: "binary content type" };
      }
    }
  }

  // Size limits
  if (contentLength !== undefined && !Number.isNaN(contentLength)) {
    const isPdf = contentType.includes("application/pdf");
    const limit = isPdf ? MAX_PDF_SIZE_BYTES : MAX_SIZE_BYTES;
    if (contentLength > limit) {
      return { skip: true, reason: isPdf ? "PDF too large" : "response too large" };
    }
  }

  return { skip: false, contentType: contentType || undefined, contentLength };
}
```

- [ ] **Step 4: Integrate probeUrl into extractContent**

In `src/extract/pipeline.ts`, add the HEAD probe call before the existing `fetch()`. Insert immediately before `const chain: string[] = [];` (line 165, after the GitHub check block ends at line 163):

```typescript
  // HEAD probe: skip binary / oversized responses before full GET
  const probe = await probeUrl(url, signal);
  if (probe.skip) {
    throw new Error(`Skipped: ${probe.reason} (${url})`);
  }
```

- [ ] **Step 5: Run HEAD probe tests**

```bash
pnpm vitest run tests/extract/head-probe.test.ts
```

Expected: all 7 tests PASS.

---

### Task 2b: Fix existing tests broken by HEAD probe

The HEAD probe inserts an additional `fetch()` call before every GET. This breaks existing tests that:
1. Use `stubFetch` (URL-matched, method-agnostic) — HEAD gets a response too, which is fine for most tests since `probeUrl` returns `skip: false` for non-binary text/html.
2. Override `globalThis.fetch` with call-count-based mocks — the extra HEAD call shifts call indexes.

**Files:**
- Modify: `tests/extract/pipeline.test.ts`
- Modify: `tests/extract/cloudflare-retry.test.ts`

- [ ] **Step 6: Fix pipeline.test.ts binary/raw tests**

The "raw mode still blocks binary content types" test (line 240) expects error message `/unsupported binary/i`, but the HEAD probe now throws `"Skipped: binary content type"` before the GET even fires. Update the regex:

```typescript
// In "raw mode still blocks binary content types" test:
// OLD: await expect(...).rejects.toThrow(/unsupported binary/i);
// NEW:
await expect(
  extractContent("https://example.com/image", undefined, { raw: true }),
).rejects.toThrow(/binary/i);
```

Similarly, verify the regular binary rejection tests (lines 51, 104) — these already use `/binary/i` which matches both error messages, so they should pass without changes.

- [ ] **Step 7: Fix cloudflare-retry.test.ts**

The Cloudflare retry tests use call-count-based mocks that break when HEAD is added. Fix all three tests to account for the HEAD probe call:

**Test 1: "retries with honest User-Agent on 403 + cf-mitigated: challenge"** (line 18)

The HEAD probe fires first, sees the 403, returns `skip: false` (non-ok). Then GET fires and sees a different response. The mock needs to track method to distinguish HEAD vs GET:

```typescript
it("retries with honest User-Agent on 403 + cf-mitigated: challenge", async () => {
  const getCalls: { url: string; headers?: Record<string, string> }[] = [];
  globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const method = (init as Record<string, unknown>)?.method ?? "GET";

    // HEAD probe — return 200 text/html (non-blocking)
    if (method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    getCalls.push({ url: input as string, headers: init?.headers as Record<string, string> });

    if (getCalls.length === 1) {
      return new Response("challenge", {
        status: 403,
        headers: { "cf-mitigated": "challenge" },
      });
    }
    return new Response(SUCCESS_HTML, {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }) as unknown as typeof fetch;

  const result = await extractContent("https://example.com");

  expect(getCalls).toHaveLength(2);
  expect(getCalls[0].headers?.["User-Agent"]).toContain("Mozilla/5.0");
  expect(getCalls[1].headers?.["User-Agent"]).toContain("pi-tools");
  expect(result.text).toContain("Hello From Retry");
  expect(result.extractionChain).toContain("cf-challenge");
});
```

**Test 2: "does NOT retry on 403 without cf-mitigated header"** (line 46)

```typescript
it("does NOT retry on 403 without cf-mitigated header", async () => {
  let getCallCount = 0;
  globalThis.fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    const method = (init as Record<string, unknown>)?.method ?? "GET";
    if (method === "HEAD") {
      return new Response(null, { status: 200, headers: { "content-type": "text/html" } });
    }
    getCallCount++;
    return new Response("Forbidden", { status: 403, headers: {} });
  }) as unknown as typeof fetch;

  await expect(extractContent("https://example.com")).rejects.toThrow("HTTP 403");
  expect(getCallCount).toBe(1);
});
```

**Test 3: "propagates error if retry also fails"** (line 58)

```typescript
it("propagates error if retry also fails", async () => {
  let getCallCount = 0;
  globalThis.fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    const method = (init as Record<string, unknown>)?.method ?? "GET";
    if (method === "HEAD") {
      return new Response(null, { status: 200, headers: { "content-type": "text/html" } });
    }
    getCallCount++;
    if (getCallCount === 1) {
      return new Response("challenge", {
        status: 403,
        headers: { "cf-mitigated": "challenge" },
      });
    }
    return new Response("Still blocked", { status: 403, headers: {} });
  }) as unknown as typeof fetch;

  await expect(extractContent("https://example.com")).rejects.toThrow("HTTP 403");
  expect(getCallCount).toBe(2);
});
```

- [ ] **Step 8: Run full test suite**

```bash
pnpm test
```

Expected: all tests PASS. If any other tests fail due to the HEAD probe (e.g., `web-fetch.test.ts` via `stubFetch`), the fix is straightforward — `stubFetch` is URL-matched and method-agnostic, so HEAD responses use the same route as GET. The probe sees the same `content-type` header, and since most test responses are `text/html`, it returns `skip: false` and the test proceeds normally.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: HEAD probe to skip binary/large downloads before GET

Sends a HEAD request before the full GET to check content-type and
content-length. Skips binary content (except PDF), non-PDF over 10MB,
and PDF over 50MB. Falls through to GET on HEAD failure or 405.

Updates existing pipeline and Cloudflare retry tests to account for
the additional HEAD call in the fetch sequence.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

### Task 3: Write failing tests for capabilities detection

**Files:**
- Create: `tests/utils/capabilities.test.ts`

- [ ] **Step 10: Create test file**

Uses `spawnSync` for capability detection (matching supi-web's pattern — more portable than `which`, works on all platforms). Tests must call `resetCapabilitiesCache()` in `beforeEach` to prevent stale cached results between test cases.

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  detectCapabilities,
  resetCapabilitiesCache,
  type EnvironmentCapabilities,
} from "../../src/utils/capabilities.ts";
import * as childProcess from "node:child_process";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

describe("detectCapabilities", () => {
  const mockSpawnSync = childProcess.spawnSync as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSpawnSync.mockReset();
    resetCapabilitiesCache();
  });

  it("detects all tools when available", () => {
    mockSpawnSync.mockReturnValue({ status: 0 });

    const caps = detectCapabilities();

    expect(caps.hasGhCli).toBe(true);
    expect(caps.hasYtDlp).toBe(true);
    expect(caps.hasFfmpeg).toBe(true);
    expect(mockSpawnSync).toHaveBeenCalledTimes(3);
  });

  it("returns false for tools that throw or have non-zero status", () => {
    mockSpawnSync.mockImplementation((cmd: string) => {
      if (cmd === "gh") return { status: 0 };
      return { status: 1 };
    });

    const caps = detectCapabilities();

    expect(caps.hasGhCli).toBe(true);
    expect(caps.hasYtDlp).toBe(false);
    expect(caps.hasFfmpeg).toBe(false);
  });

  it("returns all false when no tools available", () => {
    mockSpawnSync.mockReturnValue({ status: 1 });

    const caps = detectCapabilities();

    expect(caps.hasGhCli).toBe(false);
    expect(caps.hasYtDlp).toBe(false);
    expect(caps.hasFfmpeg).toBe(false);
  });

  it("returns all false when spawnSync throws", () => {
    mockSpawnSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const caps = detectCapabilities();

    expect(caps.hasGhCli).toBe(false);
    expect(caps.hasYtDlp).toBe(false);
    expect(caps.hasFfmpeg).toBe(false);
  });

  it("caches results after first call", () => {
    mockSpawnSync.mockReturnValue({ status: 0 });

    detectCapabilities();
    detectCapabilities();

    // Only 3 calls (one per tool), not 6
    expect(mockSpawnSync).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 11: Run test to verify it fails**

```bash
pnpm vitest run tests/utils/capabilities.test.ts
```

Expected: FAIL — `detectCapabilities` is not exported yet.

---

### Task 4: Implement capabilities detection

**Files:**
- Create: `src/utils/capabilities.ts`

- [ ] **Step 12: Create capabilities module**

Uses `spawnSync(name, ["--version"])` instead of `execFileSync("which", [name])` — this is more portable (works on Windows where `which` isn't available) and follows the pattern used by supi-web (the best practice among reviewed packages).

```typescript
import { spawnSync } from "node:child_process";

export interface EnvironmentCapabilities {
  hasGhCli: boolean;
  hasYtDlp: boolean;
  hasFfmpeg: boolean;
}

function isToolAvailable(name: string): boolean {
  try {
    const result = spawnSync(name, ["--version"], {
      timeout: 2_000,
      stdio: "ignore",
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

let cached: EnvironmentCapabilities | null = null;

export function detectCapabilities(): EnvironmentCapabilities {
  if (cached) return cached;
  cached = {
    hasGhCli: isToolAvailable("gh"),
    hasYtDlp: isToolAvailable("yt-dlp"),
    hasFfmpeg: isToolAvailable("ffmpeg"),
  };
  return cached;
}

/** @internal Reset cache for tests */
export function resetCapabilitiesCache(): void {
  cached = null;
}
```

- [ ] **Step 13: Run tests**

```bash
pnpm vitest run tests/utils/capabilities.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 14: Commit**

```bash
git add src/utils/capabilities.ts tests/utils/capabilities.test.ts
git commit -m "feat: detect environment CLI capabilities at startup

Detect gh, yt-dlp, and ffmpeg availability via spawnSync. Result is
cached after first call. Uses spawnSync(name, ['--version']) for
cross-platform portability (following supi-web pattern).

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

### Task 5: Write failing tests for dynamic guidance injection

**Files:**
- Create: `tests/index-guidance.test.ts`

- [ ] **Step 15: Create test for guidance merging**

```typescript
import { describe, expect, it } from "vitest";
import { buildAugmentedGuidance } from "../src/utils/capabilities.ts";
import type { GuidanceOverride } from "../src/config.ts";

describe("buildAugmentedGuidance", () => {
  it("appends gh guideline when hasGhCli is true", () => {
    const base: GuidanceOverride = {
      promptGuidelines: ["Use web_fetch when you have a specific URL to read."],
    };
    const caps = { hasGhCli: true, hasYtDlp: false, hasFfmpeg: false };

    const result = buildAugmentedGuidance(base, caps);

    expect(result.promptGuidelines).toHaveLength(2);
    expect(result.promptGuidelines![1]).toContain("gh");
  });

  it("appends yt-dlp and ffmpeg guidelines when available", () => {
    const caps = { hasGhCli: false, hasYtDlp: true, hasFfmpeg: true };

    const result = buildAugmentedGuidance(undefined, caps);

    expect(result.promptGuidelines).toHaveLength(2);
    expect(result.promptGuidelines!.some((g) => g.includes("yt-dlp"))).toBe(true);
    expect(result.promptGuidelines!.some((g) => g.includes("ffmpeg"))).toBe(true);
  });

  it("returns base guidance unchanged when no capabilities detected", () => {
    const base: GuidanceOverride = {
      promptSnippet: "Custom snippet",
      promptGuidelines: ["Custom guideline"],
    };
    const caps = { hasGhCli: false, hasYtDlp: false, hasFfmpeg: false };

    const result = buildAugmentedGuidance(base, caps);

    expect(result.promptSnippet).toBe("Custom snippet");
    expect(result.promptGuidelines).toEqual(["Custom guideline"]);
  });

  it("returns undefined promptGuidelines when no base and no capabilities", () => {
    const caps = { hasGhCli: false, hasYtDlp: false, hasFfmpeg: false };

    const result = buildAugmentedGuidance(undefined, caps);

    expect(result.promptGuidelines).toBeUndefined();
  });
});
```

- [ ] **Step 16: Run test to verify it fails**

```bash
pnpm vitest run tests/index-guidance.test.ts
```

Expected: FAIL — `buildAugmentedGuidance` is not exported yet.

---

### Task 6: Implement guidance merging and integrate

**Files:**
- Modify: `src/utils/capabilities.ts`
- Modify: `src/index.ts`

- [ ] **Step 17: Add buildAugmentedGuidance to capabilities.ts**

Add the import at the top and append the function after `resetCapabilitiesCache`:

```typescript
import type { GuidanceOverride } from "../config.ts";

const CAPABILITY_GUIDELINES: Array<{
  key: keyof EnvironmentCapabilities;
  guideline: string;
}> = [
  {
    key: "hasGhCli",
    guideline:
      "For GitHub repository URLs, consider using the `gh` CLI directly for richer file access.",
  },
  {
    key: "hasYtDlp",
    guideline: "YouTube frame extraction is available (yt-dlp detected).",
  },
  {
    key: "hasFfmpeg",
    guideline:
      "Local video analysis with frame extraction is available (ffmpeg detected).",
  },
];

export function buildAugmentedGuidance(
  base: GuidanceOverride | undefined,
  caps: EnvironmentCapabilities,
): GuidanceOverride {
  const extras = CAPABILITY_GUIDELINES
    .filter((c) => caps[c.key])
    .map((c) => c.guideline);

  if (extras.length === 0) return base ?? {};

  return {
    ...base,
    promptGuidelines: [
      ...(base?.promptGuidelines ?? []),
      ...extras,
    ],
  };
}
```

- [ ] **Step 18: Integrate in index.ts**

In `src/index.ts`, add the import at the top (after existing imports):

```typescript
import { detectCapabilities, buildAugmentedGuidance } from "./utils/capabilities.ts";
```

Then, inside `createExtension()`, add capabilities detection before tool registration (after `configManager` initialization at line 35, before `resolveCandidates` at line 49):

```typescript
  // Detect environment capabilities once at startup
  const caps = detectCapabilities();
```

Then update the `web_fetch` registration to use augmented guidance. Replace the existing guidance parameter at line 90:

```typescript
      configManager.current.guidance?.web_fetch,
```

with:

```typescript
      buildAugmentedGuidance(configManager.current.guidance?.web_fetch, caps),
```

That's the only tool that gets capability-based guidelines (gh, yt-dlp, ffmpeg are all fetch-related).

- [ ] **Step 19: Run all tests**

```bash
pnpm vitest run tests/index-guidance.test.ts && pnpm test
```

Expected: all tests PASS.

- [ ] **Step 20: Commit**

```bash
git add src/utils/capabilities.ts src/index.ts tests/index-guidance.test.ts
git commit -m "feat: inject capability-based guidance for web_fetch

Detect gh, yt-dlp, and ffmpeg at startup. Append relevant guidelines
to web_fetch's promptGuidelines so the model knows about available
CLI tools. Only affects web_fetch — other tools are unchanged.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

**Phase 2 complete.** Two features delivered:
1. HEAD probe skips binary/large downloads before committing to a full GET
2. Dynamic guidance injects capability-based hints into web_fetch registration
