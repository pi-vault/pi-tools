# Phase 2: Content Negotiation & Dynamic Guidance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a HEAD probe to skip binary/large downloads before fetching, and detect environment capabilities (gh, yt-dlp, ffmpeg) to inject relevant tool guidance at startup.

**Architecture:** HEAD probe is a pure function in pipeline.ts called before the existing GET. Capabilities detection is a new utility that runs once at extension startup; results are merged into guidance arrays before tool registration.

**Tech Stack:** TypeScript, Vitest, native `fetch`, `child_process.execFileSync`

**Spec:** `docs/superpowers/specs/2026-07-15-feature-adoption-design.md` (Phase 2)

---

### Task 1: Write failing tests for HEAD probe

**Files:**
- Create: `tests/extract/head-probe.test.ts`

- [ ] **Step 1: Create test file**

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

Add this after the `BROWSER_HEADERS` constant (after line 64) in `src/extract/pipeline.ts`:

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

In `src/extract/pipeline.ts`, add the HEAD probe call before the existing `fetch()`. Insert this immediately before the `let response: Response;` line (around line 165, after the GitHub check at line 161):

```typescript
  // HEAD probe: skip binary / oversized responses before full GET
  const probe = await probeUrl(url, signal);
  if (probe.skip) {
    throw new Error(`Skipped: ${probe.reason} (${url})`);
  }
```

- [ ] **Step 5: Run tests**

```bash
pnpm vitest run tests/extract/head-probe.test.ts
```

Expected: all 7 tests PASS.

- [ ] **Step 6: Run all tests to check for regressions**

```bash
pnpm test
```

Expected: all existing tests PASS. Some pipeline tests may send HEAD requests to the mock — if any fail, update the mock to handle HEAD requests the same as GET (return the same headers/status).

- [ ] **Step 7: Commit**

```bash
git add src/extract/pipeline.ts tests/extract/head-probe.test.ts
git commit -m "feat: HEAD probe to skip binary/large downloads before GET

Sends a HEAD request before the full GET to check content-type and
content-length. Skips binary content (except PDF), non-PDF over 10MB,
and PDF over 50MB. Falls through to GET on HEAD failure or 405.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

### Task 3: Write failing tests for capabilities detection

**Files:**
- Create: `tests/utils/capabilities.test.ts`
- Create: `src/utils/capabilities.ts`

- [ ] **Step 8: Create test file**

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectCapabilities, type EnvironmentCapabilities } from "../../src/utils/capabilities.ts";
import * as childProcess from "node:child_process";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

describe("detectCapabilities", () => {
  const mockExecFileSync = childProcess.execFileSync as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  it("detects all tools when available", () => {
    mockExecFileSync.mockReturnValue(Buffer.from("/usr/bin/tool"));

    const caps = detectCapabilities();

    expect(caps.hasGhCli).toBe(true);
    expect(caps.hasYtDlp).toBe(true);
    expect(caps.hasFfmpeg).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalledTimes(3);
  });

  it("returns false for tools that throw", () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      const tool = args?.[0] ?? cmd;
      if (tool === "gh") return Buffer.from("/usr/bin/gh");
      throw new Error("not found");
    });

    const caps = detectCapabilities();

    expect(caps.hasGhCli).toBe(true);
    expect(caps.hasYtDlp).toBe(false);
    expect(caps.hasFfmpeg).toBe(false);
  });

  it("returns all false when no tools available", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });

    const caps = detectCapabilities();

    expect(caps.hasGhCli).toBe(false);
    expect(caps.hasYtDlp).toBe(false);
    expect(caps.hasFfmpeg).toBe(false);
  });
});
```

- [ ] **Step 9: Run test to verify it fails**

```bash
pnpm vitest run tests/utils/capabilities.test.ts
```

Expected: FAIL — `detectCapabilities` is not exported yet.

---

### Task 4: Implement capabilities detection

**Files:**
- Create: `src/utils/capabilities.ts`

- [ ] **Step 10: Create capabilities module**

```typescript
import { execFileSync } from "node:child_process";

export interface EnvironmentCapabilities {
  hasGhCli: boolean;
  hasYtDlp: boolean;
  hasFfmpeg: boolean;
}

function isToolAvailable(name: string): boolean {
  try {
    execFileSync("which", [name], { timeout: 2_000, stdio: "pipe" });
    return true;
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

- [ ] **Step 11: Run tests**

```bash
pnpm vitest run tests/utils/capabilities.test.ts
```

Expected: all 3 tests PASS.

- [ ] **Step 12: Commit**

```bash
git add src/utils/capabilities.ts tests/utils/capabilities.test.ts
git commit -m "feat: detect environment CLI capabilities at startup

Detect gh, yt-dlp, and ffmpeg availability via 'which'. Result is
cached after first call. Used by dynamic guidance injection.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

### Task 5: Write failing tests for dynamic guidance injection

**Files:**
- Create: `tests/index-guidance.test.ts`

- [ ] **Step 13: Create test for guidance merging**

```typescript
import { describe, expect, it, vi } from "vitest";
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

- [ ] **Step 14: Run test to verify it fails**

```bash
pnpm vitest run tests/index-guidance.test.ts
```

Expected: FAIL — `buildAugmentedGuidance` is not exported yet.

---

### Task 6: Implement guidance merging and integrate

**Files:**
- Modify: `src/utils/capabilities.ts`
- Modify: `src/index.ts`

- [ ] **Step 15: Add buildAugmentedGuidance to capabilities.ts**

Append to `src/utils/capabilities.ts`:

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

- [ ] **Step 16: Integrate in index.ts**

In `src/index.ts`, add the import at the top (after existing imports):

```typescript
import { detectCapabilities, buildAugmentedGuidance } from "./utils/capabilities.ts";
```

Then, inside `createExtension()`, add capabilities detection before tool registration (after `configManager` initialization, before the `resolveCandidates` function):

```typescript
  // Detect environment capabilities once at startup
  const caps = detectCapabilities();
```

Then update the `web_fetch` registration to use augmented guidance. Replace the existing guidance parameter:

```typescript
      configManager.current.guidance?.web_fetch,
```

with:

```typescript
      buildAugmentedGuidance(configManager.current.guidance?.web_fetch, caps),
```

That's the only tool that gets capability-based guidelines (gh, yt-dlp, ffmpeg are all fetch-related).

- [ ] **Step 17: Run all tests**

```bash
pnpm vitest run tests/index-guidance.test.ts && pnpm test
```

Expected: all tests PASS.

- [ ] **Step 18: Commit**

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
