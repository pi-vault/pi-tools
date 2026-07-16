# Phase 3: Extraction Pipeline Config Self-Resolution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the extraction pipeline resolve its own config internally via `loadMergedConfig()` instead of receiving config through parameters. `ExtractOptions` drops 4 config fields (`github`, `allowRanges`, `pdf`, `gemini`), and the tool layer (`web-fetch.ts`, `web-fetch-multi.ts`, `index.ts`) stops threading config into the extraction layer.

**Architecture:** The extraction submodules (`youtube.ts`, `gemini-api.ts`, `video.ts`) already resolve config internally via direct import. `pipeline.ts` is the only holdout — it receives config from the tool layer, creating a 3-file change requirement for every new config option. After this phase, all extraction code is self-contained for config resolution. No new dependencies. No behavioral change.

**Tech Stack:** TypeScript (ES2022, Node16 modules), Vitest, native `fetch`, Pi ExtensionAPI (`@earendil-works/pi-coding-agent`)

**Spec:** `docs/superpowers/specs/2026-07-16-architecture-deepening-design.md` (Phase 3)

---

## Task 1: Update `ExtractOptions` and `extractContent()` in pipeline.ts

**Files:**
- Modify: `src/extract/pipeline.ts`

- [ ] **Step 1: Add `loadMergedConfig` to the existing config import**

In `src/extract/pipeline.ts`, line 2 currently reads:

```typescript
import { DEFAULT_GITHUB_CONFIG, resolveApiKey, type GitHubConfig, type GeminiConfig, type PdfConfig } from "../config.ts";
```

Replace with:

```typescript
import { DEFAULT_GITHUB_CONFIG, loadMergedConfig, resolveApiKey, type GitHubConfig, type GeminiConfig, type PdfConfig } from "../config.ts";
```

- [ ] **Step 2: Remove the 4 config fields from `ExtractOptions`**

In `src/extract/pipeline.ts`, replace the `ExtractOptions` interface (lines 153-164):

```typescript
export interface ExtractOptions {
  raw?: boolean;
  github?: GitHubConfig;
  allowRanges?: string[];
  prompt?: string;
  timestamp?: string;
  frames?: number;
  model?: string;
  pdf?: PdfConfig;
  gemini?: GeminiConfig;
  ctx?: import("@earendil-works/pi-coding-agent").ExtensionContext;
}
```

With:

```typescript
export interface ExtractOptions {
  raw?: boolean;
  prompt?: string;
  timestamp?: string;
  frames?: number;
  model?: string;
  ctx?: import("@earendil-works/pi-coding-agent").ExtensionContext;
}
```

- [ ] **Step 3: Add config self-resolution at the top of `extractContent()`**

In `src/extract/pipeline.ts`, after the function signature of `extractContent()` (line 170), before the first comment `// --- Frame extraction mode`, insert config resolution:

```typescript
export async function extractContent(
  url: string,
  signal?: AbortSignal,
  options?: ExtractOptions,
): Promise<ExtractedContent> {
  const config = loadMergedConfig();
  const githubConfig = config.github ?? DEFAULT_GITHUB_CONFIG;
  const allowRanges = config.ssrf?.allowRanges ?? [];
  const pdfConfig = config.pdf;
  const geminiConfig = config.gemini;

  // --- Frame extraction mode (timestamp/frames params present) ---
```

- [ ] **Step 4: Replace `options?.allowRanges` with `allowRanges` in SSRF validation**

In `src/extract/pipeline.ts`, replace line 239:

```typescript
  validateUrl(url, { allowRanges: options?.allowRanges });
```

With:

```typescript
  validateUrl(url, { allowRanges });
```

- [ ] **Step 5: Replace `options?.github` with `githubConfig` in GitHub interception**

In `src/extract/pipeline.ts`, replace lines 246-248:

```typescript
    const githubConfig = options?.github ?? DEFAULT_GITHUB_CONFIG;
    if (githubConfig.enabled) {
      const ghResult = await extractGitHub(ghParsed, signal, githubConfig);
```

With (remove the local `githubConfig` assignment since it now exists at function scope):

```typescript
    if (githubConfig.enabled) {
      const ghResult = await extractGitHub(ghParsed, signal, githubConfig);
```

- [ ] **Step 6: Replace `options?.pdf` with `pdfConfig` in PDF OCR section**

In `src/extract/pipeline.ts`, replace line 359:

```typescript
    const pdfConfig = options?.pdf;
```

With (remove this line entirely — `pdfConfig` already exists at function scope). The `if (pdfConfig?.ocrEnabled !== false)` on the next line and the `pdfConfig?.ocrMaxPages ?? 5` and `pdfConfig?.ocrDpi ?? 150` references on subsequent lines remain unchanged since the variable name is identical.

- [ ] **Step 7: Replace `options?.gemini` with `geminiConfig` in Gemini API key resolution**

In `src/extract/pipeline.ts`, replace line 386:

```typescript
        const geminiKey = getGeminiApiKey() ?? resolveApiKey(options?.gemini?.apiKey);
```

With:

```typescript
        const geminiKey = getGeminiApiKey() ?? resolveApiKey(geminiConfig?.apiKey);
```

- [ ] **Step 8: Replace `options?.gemini?.baseUrl` with `geminiConfig?.baseUrl` in Gemini vision call**

In `src/extract/pipeline.ts`, replace line 391:

```typescript
            { geminiBaseUrl: options?.gemini?.baseUrl },
```

With:

```typescript
            { geminiBaseUrl: geminiConfig?.baseUrl },
```

- [ ] **Step 9: Verify typecheck passes for pipeline.ts**

```bash
pnpm run typecheck
```

Expected: no type errors. The `GitHubConfig`, `GeminiConfig`, and `PdfConfig` type imports are still needed by `loadMergedConfig`'s return type usage, so they stay in the import.

---

## Task 2: Update `createWebFetchTool` in web-fetch.ts

**Files:**
- Modify: `src/tools/web-fetch.ts`

- [ ] **Step 1: Remove the config type imports that are no longer needed**

In `src/tools/web-fetch.ts`, replace line 17:

```typescript
import type { GitHubConfig, GuidanceOverride, PdfConfig, GeminiConfig } from "../config.ts";
```

With:

```typescript
import type { GuidanceOverride } from "../config.ts";
```

- [ ] **Step 2: Remove the 4 config parameters from `createWebFetchTool`**

In `src/tools/web-fetch.ts`, replace the function signature (lines 60-69):

```typescript
export function createWebFetchTool(
  store: ContentStore,
  resolveFetchCandidates?: () => FetchProvider[],
  cache?: ContentCache,
  guidance?: GuidanceOverride,
  githubConfig?: GitHubConfig,
  ssrfAllowRanges?: string[],
  pdfConfig?: PdfConfig,
  geminiConfig?: GeminiConfig,
): ToolDefinition<typeof WebFetchParams, WebFetchDetails> {
```

With:

```typescript
export function createWebFetchTool(
  store: ContentStore,
  resolveFetchCandidates?: () => FetchProvider[],
  cache?: ContentCache,
  guidance?: GuidanceOverride,
): ToolDefinition<typeof WebFetchParams, WebFetchDetails> {
```

- [ ] **Step 3: Simplify the `extractContent` call in `executeSingleUrl`**

In `src/tools/web-fetch.ts`, replace the `extractContent` call inside `executeSingleUrl` (lines 92-103):

```typescript
      const extracted = await extractContent(url, signal, {
        raw: params.raw,
        github: githubConfig,
        allowRanges: ssrfAllowRanges,
        prompt: params.prompt,
        timestamp: params.timestamp,
        frames: params.frames,
        model: params.model,
        pdf: pdfConfig,
        gemini: geminiConfig,
        ctx,
      });
```

With:

```typescript
      const extracted = await extractContent(url, signal, {
        raw: params.raw,
        prompt: params.prompt,
        timestamp: params.timestamp,
        frames: params.frames,
        model: params.model,
        ctx,
      });
```

- [ ] **Step 4: Remove config fields from the `executeMultiUrl` call**

In `src/tools/web-fetch.ts`, replace the `executeMultiUrl` call (lines 186-197):

```typescript
      return executeMultiUrl({
        urls: params.urls!,
        params,
        signal: signal ?? undefined,
        store,
        cache,
        githubConfig,
        ssrfAllowRanges,
        pdfConfig,
        geminiConfig,
        ctx,
      });
```

With:

```typescript
      return executeMultiUrl({
        urls: params.urls!,
        params,
        signal: signal ?? undefined,
        store,
        cache,
        ctx,
      });
```

- [ ] **Step 5: Verify typecheck passes**

```bash
pnpm run typecheck
```

Expected: type error in `web-fetch-multi.ts` because `MultiUrlOptions` still has the 4 config fields. This is expected — Task 3 fixes it.

---

## Task 3: Update `MultiUrlOptions` and `executeMultiUrl` in web-fetch-multi.ts

**Files:**
- Modify: `src/tools/web-fetch-multi.ts`

- [ ] **Step 1: Remove the config type imports**

In `src/tools/web-fetch-multi.ts`, replace line 13:

```typescript
import type { GitHubConfig, PdfConfig, GeminiConfig } from "../config.ts";
```

Remove this line entirely (delete it).

- [ ] **Step 2: Remove the 4 config fields from `MultiUrlOptions`**

In `src/tools/web-fetch-multi.ts`, replace the `MultiUrlOptions` interface (lines 35-53):

```typescript
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
  pdfConfig?: PdfConfig;
  geminiConfig?: GeminiConfig;
  ctx?: ExtensionContext;
}
```

With:

```typescript
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
  ctx?: ExtensionContext;
}
```

- [ ] **Step 3: Remove config destructuring from `executeMultiUrl`**

In `src/tools/web-fetch-multi.ts`, replace the destructuring block (lines 65-76):

```typescript
  const {
    urls,
    params,
    signal,
    store,
    cache,
    githubConfig,
    ssrfAllowRanges,
    pdfConfig,
    geminiConfig,
    ctx,
  } = options;
```

With:

```typescript
  const {
    urls,
    params,
    signal,
    store,
    cache,
    ctx,
  } = options;
```

- [ ] **Step 4: Simplify the `extractContent` call inside `executeMultiUrl`**

In `src/tools/web-fetch-multi.ts`, replace the `extractContent` call (lines 88-99):

```typescript
    const extracted = await extractContent(u, signal ?? undefined, {
      raw: params.raw,
      github: githubConfig,
      allowRanges: ssrfAllowRanges,
      prompt: params.prompt,
      timestamp: params.timestamp,
      frames: params.frames,
      model: params.model,
      pdf: pdfConfig,
      gemini: geminiConfig,
      ctx,
    });
```

With:

```typescript
    const extracted = await extractContent(u, signal ?? undefined, {
      raw: params.raw,
      prompt: params.prompt,
      timestamp: params.timestamp,
      frames: params.frames,
      model: params.model,
      ctx,
    });
```

- [ ] **Step 5: Verify typecheck passes**

```bash
pnpm run typecheck
```

Expected: no type errors. The chain `web-fetch.ts -> web-fetch-multi.ts -> pipeline.ts` no longer threads config.

---

## Task 4: Simplify `createWebFetchTool` call in index.ts

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Remove the 4 config arguments from `createWebFetchTool` call**

In `src/index.ts`, replace the `createWebFetchTool` registration block (lines 111-125):

```typescript
  pi.registerTool(
    createWebFetchTool(
      store,
      () => {
        configManager.refresh();
        return registry.selectFetchCandidates();
      },
      fetchCache,
      buildAugmentedGuidance(configManager.current.guidance?.web_fetch, caps),
      configManager.current.github,
      configManager.current.ssrf.allowRanges,
      configManager.current.pdf,
      configManager.current.gemini,
    ),
  );
```

With:

```typescript
  pi.registerTool(
    createWebFetchTool(
      store,
      () => {
        configManager.refresh();
        return registry.selectFetchCandidates();
      },
      fetchCache,
      buildAugmentedGuidance(configManager.current.guidance?.web_fetch, caps),
    ),
  );
```

- [ ] **Step 2: Verify typecheck passes**

```bash
pnpm run typecheck
```

Expected: no type errors. All 4 files compile cleanly.

---

## Task 5: Update tests

**Files:**
- Modify: `tests/extract/pipeline.test.ts`
- Modify: `tests/tools/web-fetch.test.ts`

- [ ] **Step 1: Update pipeline test that passes `github` config via `ExtractOptions`**

In `tests/extract/pipeline.test.ts`, the last test (lines 415-427) passes `github: { enabled: false, ... }` through `ExtractOptions`. Since `github` is no longer an `ExtractOptions` field, this test must mock `loadMergedConfig` instead.

Replace the entire test (lines 415-427):

```typescript
  it("skips GitHub interception when options.github.enabled is false", async () => {
    fetchStub.addResponse("github.com", {
      body: GOOD_HTML,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    const result = await extractContent(
      "https://github.com/owner/repo/blob/main/file.ts",
      undefined,
      { github: { enabled: false, maxRepoSizeMB: 350, cloneTimeoutSeconds: 30 } },
    );
    // Should fall through to HTTP extraction, not GitHub interception
    expect(result.extractionChain).toContain("http:200");
  });
```

With:

```typescript
  it("skips GitHub interception when config.github.enabled is false", async () => {
    const { loadMergedConfig } = await import("../../src/config.ts");
    const originalConfig = loadMergedConfig();
    const { vi } = await import("vitest");

    const configMock = vi.spyOn(await import("../../src/config.ts"), "loadMergedConfig");
    configMock.mockReturnValue({
      ...originalConfig,
      github: { enabled: false, maxRepoSizeMB: 350, cloneTimeoutSeconds: 30 },
    });

    try {
      fetchStub.addResponse("github.com", {
        body: GOOD_HTML,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
      const result = await extractContent(
        "https://github.com/owner/repo/blob/main/file.ts",
      );
      // Should fall through to HTTP extraction, not GitHub interception
      expect(result.extractionChain).toContain("http:200");
    } finally {
      configMock.mockRestore();
    }
  });
```

- [ ] **Step 2: Add `vi` import to pipeline test file if not already present**

In `tests/extract/pipeline.test.ts`, check line 1. The current import is:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
```

Replace with:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
```

- [ ] **Step 3: Verify pipeline tests pass**

```bash
pnpm vitest run tests/extract/pipeline.test.ts
```

Expected: all tests PASS. The GitHub-disabled test now mocks `loadMergedConfig` instead of passing config through `ExtractOptions`.

- [ ] **Step 4: Verify web-fetch tests pass without changes**

The `web-fetch.test.ts` tests never pass config arguments beyond `store`, `resolveFetchCandidates`, `cache`, and `guidance` — the 4 removed parameters were always optional and defaulted to `undefined` in tests. No changes needed.

```bash
pnpm vitest run tests/tools/web-fetch.test.ts
```

Expected: all tests PASS.

---

## Task 6: Full verification and commit

- [ ] **Step 1: Run full typecheck**

```bash
pnpm run typecheck
```

Expected: no type errors.

- [ ] **Step 2: Run full test suite**

```bash
pnpm test
```

Expected: all tests PASS. No regressions.

- [ ] **Step 3: Run linter**

```bash
pnpm run lint
```

Expected: no lint errors.

- [ ] **Step 4: Review the diff**

```bash
git diff --stat
```

Expected changes:

| File | Change |
|------|--------|
| `src/extract/pipeline.ts` | `ExtractOptions` drops 4 fields; `extractContent()` adds `loadMergedConfig()` call at top; 4 `options?.xxx` references replaced with local variables |
| `src/tools/web-fetch.ts` | `createWebFetchTool()` drops 4 parameters; `extractContent` and `executeMultiUrl` calls simplified |
| `src/tools/web-fetch-multi.ts` | `MultiUrlOptions` drops 4 fields; destructuring and `extractContent` call simplified; config type import removed |
| `src/index.ts` | `createWebFetchTool()` call drops 4 arguments |
| `tests/extract/pipeline.test.ts` | GitHub-disabled test mocks `loadMergedConfig` instead of passing config through `ExtractOptions`; `vi` added to import |

- [ ] **Step 5: Commit**

```bash
git add src/extract/pipeline.ts src/tools/web-fetch.ts src/tools/web-fetch-multi.ts src/index.ts tests/extract/pipeline.test.ts
git commit -m "refactor: extraction pipeline resolves config via loadMergedConfig

ExtractOptions drops 4 config fields (github, allowRanges, pdf, gemini).
extractContent() now calls loadMergedConfig() at the top to resolve
config internally, matching the pattern already used by youtube.ts,
gemini-api.ts, and video.ts.

createWebFetchTool() drops 4 parameters. executeMultiUrl() drops 4
fields from MultiUrlOptions. index.ts no longer threads config into
the extraction layer.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```
