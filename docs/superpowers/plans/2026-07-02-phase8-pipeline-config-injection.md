# Phase 8: Pipeline Config Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the `loadConfig()` call from inside `extractContent()` — pass GitHub config through `ExtractOptions` instead, making the pipeline a pure function of its inputs.

**Architecture:** Add `github?: GitHubConfig` to `ExtractOptions`. The caller (`createWebFetchTool` in `index.ts`) passes the already-loaded config. Export `DEFAULT_GITHUB_CONFIG` from `config.ts` as the single source of truth for defaults — remove the duplicate constant from `github.ts`. Pipeline becomes testable without a config file on disk.

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

These are identical to `src/config.ts` lines 57-61 (inside `DEFAULT_CONFIG`). The single source of truth should be an exported constant from `config.ts`.

### Where the duplicate is actually used

The `DEFAULT_GITHUB_CONFIG` in `github.ts` is used as a fallback in `fetchViaClone()` (line 601), NOT in `extractGitHub()`:
```ts
// github.ts line 601
const cfg = config ?? DEFAULT_GITHUB_CONFIG;
```

`extractGitHub()` simply passes its `config` parameter through to `fetchViaClone()` — it has no fallback of its own.

Both `fetchViaClone` and `extractGitHub` are exported and called directly in tests without config:
- `fetchViaClone(parsed)` — 1 test call
- `extractGitHub(parsed)` — 5 test calls

---

### Task 1: Export DEFAULT_GITHUB_CONFIG from config.ts

**Files:**
- Modify: `src/config.ts`

- [x] **Step 1: Extract and export the github defaults as a named constant**

In `src/config.ts`, add an exported constant before `DEFAULT_CONFIG` and reference it:

```ts
export const DEFAULT_GITHUB_CONFIG: GitHubConfig = {
  enabled: true,
  maxRepoSizeMB: 350,
  cloneTimeoutSeconds: 30,
};

const DEFAULT_CONFIG: PiToolsConfig = {
  defaultProvider: "auto",
  selectionStrategy: "auto",
  providers: { ... },
  github: DEFAULT_GITHUB_CONFIG,  // ← reference the exported constant
};
```

This establishes `config.ts` as the single source of truth.

- [x] **Step 2: Run typecheck**

Run: `pnpm vitest run --typecheck.only`
Expected: PASS — no consumers change, `DEFAULT_CONFIG.github` still has the same shape.

- [x] **Step 3: Commit**

```bash
git add src/config.ts
git commit -m "refactor: export DEFAULT_GITHUB_CONFIG from config.ts"
```

---

### Task 2: Add github config to ExtractOptions and use it in pipeline

**Files:**
- Modify: `src/extract/pipeline.ts`
- Test: `tests/extract/pipeline.test.ts`

- [x] **Step 1: Write failing test that passes github config via options**

Add to `tests/extract/pipeline.test.ts`:

```ts
it("accepts github config via options without calling loadConfig", async () => {
  fetchStub.addResponse("example.com/page", {
    body: GOOD_HTML,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  const result = await extractContent("https://example.com/page", undefined, {
    github: { enabled: false, maxRepoSizeMB: 350, cloneTimeoutSeconds: 30 },
  });
  expect(result.text).toContain("Real Article");
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/extract/pipeline.test.ts`
Expected: FAIL — `ExtractOptions` doesn't have a `github` field (TypeScript error)

- [x] **Step 3: Add github field to ExtractOptions and wire it in**

In `src/extract/pipeline.ts`:

1. Replace the `loadConfig` import with `DEFAULT_GITHUB_CONFIG`:
```ts
// Remove:
import { loadConfig } from "../config.ts";
// Add:
import { DEFAULT_GITHUB_CONFIG, type GitHubConfig } from "../config.ts";
```

2. Add `github` to the interface:
```ts
export interface ExtractOptions {
  raw?: boolean;
  github?: GitHubConfig;
}
```

3. Replace the `loadConfig()` call (lines 62-66) with injected config:
```ts
  const ghParsed = parseGitHubUrl(url);
  if (ghParsed && ghParsed.type !== "unknown") {
    const githubConfig = options?.github ?? DEFAULT_GITHUB_CONFIG;
    if (githubConfig.enabled) {
      const ghResult = await extractGitHub(ghParsed, signal, githubConfig);
      if (ghResult) return ghResult;
    }
  }
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/extract/pipeline.test.ts`
Expected: PASS

- [x] **Step 5: Write test that verifies injected config controls GitHub interception**

Add to `tests/extract/pipeline.test.ts`:

```ts
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

it("uses default github config (enabled) when options.github is not provided", async () => {
  fetchStub.addResponse("example.com/page", {
    body: GOOD_HTML,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  const result = await extractContent("https://example.com/page");
  expect(result.text).toContain("Real Article");
});
```

- [x] **Step 6: Run tests and verify**

Run: `pnpm vitest run tests/extract/pipeline.test.ts`
Expected: PASS

- [x] **Step 7: Verify loadConfig is fully removed from pipeline.ts**

```bash
grep "loadConfig" src/extract/pipeline.ts
```

Expected: no matches.

- [x] **Step 8: Commit**

```bash
git add src/extract/pipeline.ts tests/extract/pipeline.test.ts
git commit -m "refactor: inject github config via ExtractOptions, remove loadConfig from pipeline"
```

---

### Task 3: Remove duplicate defaults from github.ts

**Files:**
- Modify: `src/extract/github.ts`
- Test: `tests/extract/github.test.ts`

The `DEFAULT_GITHUB_CONFIG` in `github.ts` (line 385-389) is used as a fallback in `fetchViaClone()` (line 601: `const cfg = config ?? DEFAULT_GITHUB_CONFIG`). Now that `config.ts` exports the canonical constant, we replace the local duplicate with an import.

- [x] **Step 1: Replace local DEFAULT_GITHUB_CONFIG with import from config.ts**

In `src/extract/github.ts`:

1. Update the import:
```ts
// Change:
import type { GitHubConfig } from "../config.ts";
// To:
import { DEFAULT_GITHUB_CONFIG, type GitHubConfig } from "../config.ts";
```

2. Remove the local constant (lines 385-389):
```ts
// Remove:
const DEFAULT_GITHUB_CONFIG: GitHubConfig = {
  enabled: true,
  maxRepoSizeMB: 350,
  cloneTimeoutSeconds: 30,
};
```

The `fetchViaClone` fallback (`const cfg = config ?? DEFAULT_GITHUB_CONFIG` at line 601) continues to work — it now references the imported constant.

- [x] **Step 2: Run github tests**

Run: `pnpm vitest run tests/extract/github.test.ts`
Expected: PASS — no test behavior changes, only the source of the default constant changed. Tests that call `fetchViaClone(parsed)` or `extractGitHub(parsed)` without config still work because the fallback still resolves via the import.

- [x] **Step 3: Commit**

```bash
git add src/extract/github.ts
git commit -m "refactor: replace local DEFAULT_GITHUB_CONFIG with import from config.ts"
```

---

### Task 4: Thread github config from index.ts to web-fetch

**Files:**
- Modify: `src/tools/web-fetch.ts`
- Modify: `src/index.ts`

- [x] **Step 1: Update createWebFetchTool to accept github config**

In `src/tools/web-fetch.ts`, update the function signature:

```ts
import type { GitHubConfig, GuidanceOverride } from "../config.ts";

export function createWebFetchTool(
  store: ContentStore,
  resolveFetchCandidates?: () => FetchProvider[],
  cache?: ContentCache,
  guidance?: GuidanceOverride,
  githubConfig?: GitHubConfig,
): ToolDefinition<typeof WebFetchParams, WebFetchDetails> {
```

Then in `executeSingleUrl` (line 102), pass it through to `extractContent`:

```ts
const extracted = await extractContent(
  url,
  signal,
  params.raw ? { raw: true, github: githubConfig } : { github: githubConfig },
);
```

And in the multi-URL path (line 208):

```ts
const extracted = await extractContent(
  u,
  signal ?? undefined,
  params.raw ? { raw: true, github: githubConfig } : { github: githubConfig },
);
```

- [x] **Step 2: Pass github config from index.ts**

In `src/index.ts` (line 189), update the `createWebFetchTool` call:

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

- [x] **Step 3: Run full verification**

Run: `pnpm check`
Expected: lint PASS, typecheck PASS, tests PASS

- [x] **Step 4: Commit**

```bash
git add src/tools/web-fetch.ts src/index.ts
git commit -m "refactor: thread github config from index.ts through web-fetch to pipeline"
```
