# Phase 8: Pipeline Config Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the `loadConfig()` call from inside `extractContent()` — pass GitHub config through `ExtractOptions` instead, making the pipeline a pure function of its inputs.

**Architecture:** Add `github?: GitHubConfig` to `ExtractOptions`. The caller (`createWebFetchTool` in `index.ts`) passes the already-loaded config. Remove duplicate default constants from `github.ts`. Pipeline becomes testable without a config file on disk.

**Tech Stack:** TypeScript 6, Vitest 4, Node 24+

---

## Context

`src/extract/pipeline.ts` currently does this on line 62:

```ts
const config = loadConfig();
if (config.github.enabled) {
  const ghResult = await extractGitHub(ghParsed, signal, config.github);
  ...
}
```

This couples the pipeline to the filesystem. It also means config is re-read on every `extractContent()` call.

`src/extract/github.ts` line 385-389 defines duplicate defaults:
```ts
const DEFAULT_GITHUB_CONFIG: GitHubConfig = {
  enabled: true,
  maxRepoSizeMB: 350,
  cloneTimeoutSeconds: 30,
};
```

These are identical to `src/config.ts` line 57-61. The single source of truth should be `config.ts`.

---

### Task 1: Add github config to ExtractOptions interface

**Files:**
- Modify: `src/extract/pipeline.ts`
- Test: `tests/extract/pipeline.test.ts`

- [ ] **Step 1: Write failing test that passes github config via options**

Add to `tests/extract/pipeline.test.ts`:

```ts
it("accepts github config via options without calling loadConfig", async () => {
  fetchStub.addResponse("example.com/page", {
    body: GOOD_HTML,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  // Pass github: { enabled: false } — should skip GitHub interception
  const result = await extractContent("https://example.com/page", undefined, {
    github: { enabled: false, maxRepoSizeMB: 350, cloneTimeoutSeconds: 30 },
  });
  expect(result.text).toContain("Real Article");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/extract/pipeline.test.ts`
Expected: FAIL — `ExtractOptions` doesn't have a `github` field (TypeScript error or runtime mismatch)

- [ ] **Step 3: Add github field to ExtractOptions**

In `src/extract/pipeline.ts`, update the interface:

```ts
import type { GitHubConfig } from "../config.ts";

export interface ExtractOptions {
  raw?: boolean;
  github?: GitHubConfig;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/extract/pipeline.test.ts`
Expected: PASS (the field exists now, and the existing code still calls `loadConfig()` internally — the test passes because the URL isn't a GitHub URL)

- [ ] **Step 5: Commit**

```bash
git add src/extract/pipeline.ts tests/extract/pipeline.test.ts
git commit -m "feat: add github field to ExtractOptions interface"
```

---

### Task 2: Use options.github instead of loadConfig() in pipeline

**Files:**
- Modify: `src/extract/pipeline.ts`
- Test: `tests/extract/pipeline.test.ts`

- [ ] **Step 1: Write failing test that verifies GitHub interception uses injected config**

Add to `tests/extract/pipeline.test.ts`:

```ts
import { vi } from "vitest";

it("skips GitHub interception when options.github.enabled is false", async () => {
  // A GitHub blob URL that would normally trigger interception
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

it("uses default github config (enabled) when options.github is not provided", async () => {
  // Non-GitHub URL — just verify no crash when github option is omitted
  fetchStub.addResponse("example.com/page", {
    body: GOOD_HTML,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  const result = await extractContent("https://example.com/page");
  expect(result.text).toContain("Real Article");
});
```

- [ ] **Step 2: Run test to verify the first test fails**

Run: `pnpm vitest run tests/extract/pipeline.test.ts`
Expected: First test FAILS — pipeline still calls `loadConfig()` and config.github.enabled defaults to true

- [ ] **Step 3: Replace loadConfig() with options.github in extractContent**

In `src/extract/pipeline.ts`, update the function:

```ts
// Remove this import:
// import { loadConfig } from "../config.ts";

// Add default at top of file:
const DEFAULT_GITHUB_CONFIG: GitHubConfig = {
  enabled: true,
  maxRepoSizeMB: 350,
  cloneTimeoutSeconds: 30,
};

export async function extractContent(
  url: string,
  signal?: AbortSignal,
  options?: ExtractOptions,
): Promise<ExtractedContent> {
  validateUrl(url);

  // GitHub interception: use injected config or default
  const ghParsed = parseGitHubUrl(url);
  if (ghParsed && ghParsed.type !== "unknown") {
    const githubConfig = options?.github ?? DEFAULT_GITHUB_CONFIG;
    if (githubConfig.enabled) {
      const ghResult = await extractGitHub(ghParsed, signal, githubConfig);
      if (ghResult) return ghResult;
    }
  }

  // ... rest of function unchanged
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/extract/pipeline.test.ts`
Expected: PASS

- [ ] **Step 5: Remove the loadConfig import from pipeline.ts**

Verify that `loadConfig` is no longer imported in `src/extract/pipeline.ts`:

```bash
grep "loadConfig" src/extract/pipeline.ts
```

Expected: no matches. If there's still an import, remove it.

- [ ] **Step 6: Commit**

```bash
git add src/extract/pipeline.ts tests/extract/pipeline.test.ts
git commit -m "refactor: inject github config via ExtractOptions, remove loadConfig from pipeline"
```

---

### Task 3: Remove duplicate defaults from github.ts

**Files:**
- Modify: `src/extract/github.ts`
- Test: `tests/extract/github.test.ts`

- [ ] **Step 1: Check where DEFAULT_GITHUB_CONFIG is used in github.ts**

In `src/extract/github.ts`, the `DEFAULT_GITHUB_CONFIG` constant (line 385-389) is used as a fallback in `extractGitHub()` when no config is passed. Since `extractContent()` now always passes config, this fallback is only needed if `extractGitHub` is called directly (e.g., in tests).

Find usages:
```bash
grep -n "DEFAULT_GITHUB_CONFIG" src/extract/github.ts
```

- [ ] **Step 2: Remove the duplicate constant and use the config parameter**

In `src/extract/github.ts`, remove the `DEFAULT_GITHUB_CONFIG` constant (lines 385-389). Update `extractGitHub` to require the config parameter (it already receives it from pipeline.ts):

If `extractGitHub` has a fallback like `cfg = config ?? DEFAULT_GITHUB_CONFIG`, change it to just use the passed config directly since pipeline.ts always passes it.

- [ ] **Step 3: Run github tests**

Run: `pnpm vitest run tests/extract/github.test.ts`
Expected: PASS — if any tests relied on the default, update them to pass config explicitly:

```ts
const ghConfig = { enabled: true, maxRepoSizeMB: 350, cloneTimeoutSeconds: 30 };
const result = await extractGitHub(parsed, undefined, ghConfig);
```

- [ ] **Step 4: Commit**

```bash
git add src/extract/github.ts tests/extract/github.test.ts
git commit -m "refactor: remove duplicate DEFAULT_GITHUB_CONFIG from github.ts"
```

---

### Task 4: Thread github config from index.ts to web-fetch

**Files:**
- Modify: `src/tools/web-fetch.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Update createWebFetchTool to accept github config**

In `src/tools/web-fetch.ts`, update the function signature:

```ts
import type { GitHubConfig } from "../config.ts";

export function createWebFetchTool(
  store: ContentStore,
  resolveFetchCandidates?: () => FetchProvider[],
  cache?: ContentCache,
  guidance?: GuidanceOverride,
  githubConfig?: GitHubConfig,
): ToolDefinition<typeof WebFetchParams, WebFetchDetails> {
```

Then in `executeSingleUrl`, pass it through to `extractContent`:

```ts
const extracted = await extractContent(
  url,
  signal,
  params.raw ? { raw: true, github: githubConfig } : { github: githubConfig },
);
```

And in the multi-URL path:

```ts
const extracted = await extractContent(
  u,
  signal ?? undefined,
  params.raw ? { raw: true, github: githubConfig } : { github: githubConfig },
);
```

- [ ] **Step 2: Pass github config from index.ts**

In `src/index.ts`, update the `createWebFetchTool` call:

```ts
pi.registerTool(
  createWebFetchTool(
    store,
    () => registry.selectFetchCandidates(),
    fetchCache,
    config.guidance?.web_fetch,
    config.github,
  ),
);
```

- [ ] **Step 3: Run full verification**

Run: `pnpm check`
Expected: lint PASS, typecheck PASS, tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/tools/web-fetch.ts src/index.ts
git commit -m "refactor: thread github config from index.ts through web-fetch to pipeline"
```
