# Phase 3: Config Integration + Caller Threading

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `allowRanges` from config into the tools and providers that call `validateUrl`.

**Architecture:** Add `SsrfConfig` to `PiToolsConfig`. Thread `ssrf.allowRanges` from config into `createWebFetchTool` (static param, like `githubConfig`) and into `SearXNGProvider` (via constructor options). The extension entry point passes the config values at registration time.

**Tech Stack:** TypeScript, Vitest

**Prerequisite:** Phases 1 and 2 must be complete (`validateUrl` accepts `allowRanges`).

---

## Context for the Engineer

**Current state after Phase 2:** `validateUrl(url, { allowRanges: ["198.18.0.0/15"] })` works. But no caller passes `allowRanges` yet — it's dead code until this phase wires it up.

**Config system:** Three-layer merge (project `.pi/tools.json` > global `~/.pi/agent/extensions/tools.json` > built-in defaults). Managed by `ConfigManager` in `src/config-manager.ts`. Config is read once at startup and auto-reloaded every 30s.

**How tools get config:** `createWebFetchTool` receives static params at registration time (store, fetchCandidates closure, cache, guidance, githubConfig). We add `ssrfAllowRanges` the same way.

**How SearXNG gets config:** Its `providerMeta.create(_key, providerConfig)` factory builds the provider. The factory currently only accesses per-provider config. We'll pass `allowRanges` through `SearXNGOptions`.

**Run tests:** `npx vitest run`

---

### Task 1: Add SsrfConfig to config types

**Files:**

- Modify: `src/config.ts`

- [ ] **Step 1: Write failing test**

Create `tests/config-ssrf.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";

describe("config ssrf defaults", () => {
  it("returns empty allowRanges by default", () => {
    // loadConfig with no config file returns defaults
    const config = loadConfig("/nonexistent/path.json");
    expect(config.ssrf).toEqual({ allowRanges: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config-ssrf.test.ts`
Expected: FAIL — `config.ssrf` is undefined.

- [ ] **Step 3: Add SsrfConfig interface and wire into PiToolsConfig**

In `src/config.ts`, add the interface after `GuidanceOverride`:

```typescript
export interface SsrfConfig {
  allowRanges: string[];
}
```

Add `ssrf` to `PiToolsConfig`:

```typescript
export interface PiToolsConfig {
  defaultProvider: string;
  selectionStrategy: SelectionStrategy;
  providers: Record<string, ProviderConfigEntry>;
  github: GitHubConfig;
  guidance?: Record<string, GuidanceOverride>;
  ssrf: SsrfConfig;
}
```

Add the default to `DEFAULT_CONFIG`:

```typescript
const DEFAULT_CONFIG: PiToolsConfig = {
  defaultProvider: "auto",
  selectionStrategy: "auto",
  providers: {
    // ...existing provider defaults unchanged...
  },
  github: DEFAULT_GITHUB_CONFIG,
  ssrf: { allowRanges: [] },
};
```

Update `parseConfigFile` to include `ssrf` in the returned object:

```typescript
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
  ssrf: {
    ...DEFAULT_CONFIG.ssrf,
    ...parsed.ssrf,
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config-ssrf.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config-ssrf.test.ts
git commit -m "feat(config): add SsrfConfig with allowRanges to PiToolsConfig"
```

---

### Task 2: Test config loading with ssrf.allowRanges from file

**Files:**

- Modify: `tests/config-ssrf.test.ts`

- [ ] **Step 1: Add test that loads a config file with ssrf.allowRanges**

```typescript
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("config ssrf from file", () => {
  it("loads allowRanges from config file", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-tools-test-"));
    const configPath = path.join(tmpDir, "tools.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        ssrf: { allowRanges: ["198.18.0.0/15", "fd00::/8"] },
      }),
    );

    const config = loadConfig(configPath);
    expect(config.ssrf.allowRanges).toEqual(["198.18.0.0/15", "fd00::/8"]);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it("defaults to empty when ssrf key is absent in file", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-tools-test-"));
    const configPath = path.join(tmpDir, "tools.json");
    fs.writeFileSync(configPath, JSON.stringify({ defaultProvider: "brave" }));

    const config = loadConfig(configPath);
    expect(config.ssrf).toEqual({ allowRanges: [] });

    fs.rmSync(tmpDir, { recursive: true });
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run tests/config-ssrf.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/config-ssrf.test.ts
git commit -m "test(config): verify ssrf.allowRanges loading from file"
```

---

### Task 3: Thread allowRanges into extractContent

**Files:**

- Modify: `src/extract/pipeline.ts`

- [ ] **Step 1: Write failing test**

Create `tests/extract/pipeline-ssrf.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { extractContent } from "../../src/extract/pipeline.ts";
import { SSRFError } from "../../src/utils/ssrf.ts";

describe("extractContent SSRF with allowRanges", () => {
  it("blocks a private IP by default", async () => {
    await expect(extractContent("http://198.18.1.1/page")).rejects.toThrow(
      SSRFError,
    );
  });

  it("allows a private IP when in allowRanges", async () => {
    // This will fail at the fetch level (no server), but should NOT throw SSRFError
    const result = extractContent("http://198.18.1.1/page", undefined, {
      allowRanges: ["198.18.0.0/15"],
    });
    // Expect a network error, not an SSRFError
    await expect(result).rejects.not.toThrow(SSRFError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/extract/pipeline-ssrf.test.ts`
Expected: FAIL — `allowRanges` is not a valid property of `ExtractOptions`.

- [ ] **Step 3: Add `allowRanges` to ExtractOptions and pass to validateUrl**

In `src/extract/pipeline.ts`, update the `ExtractOptions` interface:

```typescript
export interface ExtractOptions {
  raw?: boolean;
  github?: GitHubConfig;
  allowRanges?: string[];
}
```

Then update the `extractContent` function where `validateUrl` is called (currently line 56):

Change:

```typescript
validateUrl(url);
```

To:

```typescript
validateUrl(url, { allowRanges: options?.allowRanges });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/extract/pipeline-ssrf.test.ts`
Expected: PASS (first test passes because 198.18 is blocked; second test throws a fetch/network error but not SSRFError)

- [ ] **Step 5: Commit**

```bash
git add src/extract/pipeline.ts tests/extract/pipeline-ssrf.test.ts
git commit -m "feat(extract): thread allowRanges through extractContent to validateUrl"
```

---

### Task 4: Thread allowRanges into createWebFetchTool

**Files:**

- Modify: `src/tools/web-fetch.ts`

- [ ] **Step 1: Add `ssrfAllowRanges` parameter to `createWebFetchTool`**

Update the function signature:

```typescript
export function createWebFetchTool(
  store: ContentStore,
  resolveFetchCandidates?: () => FetchProvider[],
  cache?: ContentCache,
  guidance?: GuidanceOverride,
  githubConfig?: GitHubConfig,
  ssrfAllowRanges?: string[],
): ToolDefinition<typeof WebFetchParams, WebFetchDetails> {
```

- [ ] **Step 2: Pass `ssrfAllowRanges` into all `extractContent` calls**

In `executeSingleUrl`, update the `extractContent` call (around line 104):

Change:

```typescript
const extracted = await extractContent(url, signal, {
  raw: params.raw,
  github: githubConfig,
});
```

To:

```typescript
const extracted = await extractContent(url, signal, {
  raw: params.raw,
  github: githubConfig,
  allowRanges: ssrfAllowRanges,
});
```

In the multi-URL path (around line 204), update the second `extractContent` call:

Change:

```typescript
const extracted = await extractContent(u, signal ?? undefined, {
  raw: params.raw,
  github: githubConfig,
});
```

To:

```typescript
const extracted = await extractContent(u, signal ?? undefined, {
  raw: params.raw,
  github: githubConfig,
  allowRanges: ssrfAllowRanges,
});
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/tools/web-fetch.ts
git commit -m "feat(web-fetch): accept and forward ssrfAllowRanges"
```

---

### Task 5: Thread allowRanges into SearXNGProvider

**Files:**

- Modify: `src/providers/searxng.ts`

- [ ] **Step 1: Write failing test**

Create `tests/providers/searxng-ssrf.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { SearXNGProvider } from "../../src/providers/searxng.ts";

describe("SearXNGProvider allowRanges", () => {
  it("accepts allowRanges in constructor without error", () => {
    // SearXNG already uses allowedBaseUrls for its own instanceUrl, so
    // allowRanges provides defense-in-depth for consistency with other callers.
    // This test verifies the option is accepted at the type/constructor level.
    const provider = new SearXNGProvider({
      instanceUrl: "http://localhost:8080",
      allowRanges: ["198.18.0.0/15"],
    });
    expect(provider).toBeDefined();
    expect(provider.instanceUrl).toBe("http://localhost:8080");
  });

  it("works without allowRanges (backward compatible)", () => {
    const provider = new SearXNGProvider({
      instanceUrl: "http://localhost:9090",
    });
    expect(provider).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/providers/searxng-ssrf.test.ts`
Expected: FAIL — `allowRanges` is not in `SearXNGOptions`.

- [ ] **Step 3: Add `allowRanges` to SearXNGOptions and wire through**

In `src/providers/searxng.ts`, update the interface:

```typescript
interface SearXNGOptions {
  instanceUrl?: string;
  apiKey?: string;
  allowRanges?: string[];
}
```

Add the field to the class:

```typescript
export class SearXNGProvider implements SearchProvider {
  readonly name = "searxng";
  readonly label = "SearXNG";
  readonly instanceUrl: string;
  private apiKey?: string;
  private allowRanges?: string[];

  constructor(options?: SearXNGOptions) {
    this.instanceUrl =
      options?.instanceUrl ??
      process.env.SEARXNG_URL ??
      DEFAULT_INSTANCE_URL;
    this.apiKey = options?.apiKey;
    this.allowRanges = options?.allowRanges;
  }
```

Update the `validateUrl` call in `search()`:

Change:

```typescript
validateUrl(url, { allowedBaseUrls: [this.instanceUrl] });
```

To:

```typescript
validateUrl(url, {
  allowedBaseUrls: [this.instanceUrl],
  allowRanges: this.allowRanges,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/providers/searxng-ssrf.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/providers/searxng.ts tests/providers/searxng-ssrf.test.ts
git commit -m "feat(searxng): accept allowRanges for SSRF exemptions"
```

---

### Task 6: Wire config into extension entry point

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 1: Pass `ssrf.allowRanges` to `createWebFetchTool`**

In `src/index.ts`, find the `createWebFetchTool` call (around line 74):

Change:

```typescript
pi.registerTool(
  createWebFetchTool(
    store,
    () => {
      configManager.refresh();
      return registry.selectFetchCandidates();
    },
    fetchCache,
    configManager.current.guidance?.web_fetch,
    configManager.current.github,
  ),
);
```

To:

```typescript
pi.registerTool(
  createWebFetchTool(
    store,
    () => {
      configManager.refresh();
      return registry.selectFetchCandidates();
    },
    fetchCache,
    configManager.current.guidance?.web_fetch,
    configManager.current.github,
    configManager.current.ssrf.allowRanges,
  ),
);
```

- [ ] **Step 2: Pass `allowRanges` to SearXNG provider via its factory**

In `src/providers/searxng.ts`, update the `providerMeta.create` factory to accept and forward `allowRanges`. The factory currently only gets `providerConfig` (per-provider config), but we need the global `ssrf` config.

Update the `ProviderMeta` create signature usage. Since `ProviderMeta.create` only receives `(key, providerConfig)`, the cleanest approach is to store `allowRanges` in `SearXNGOptions` and have the caller pass it.

However, `ConfigManager.registerProvider` calls `meta.create(resolvedKey, providerConfig)` — it doesn't pass global ssrf config. We need to change how SearXNG's factory gets this data.

**Solution:** Have `providerMeta` for searxng close over nothing extra — instead, the `ConfigManager` will pass `allowRanges` through the existing `providerConfig` shape by adding an optional `ssrfAllowRanges` field to `ProviderConfigEntry`.

In `src/config.ts`, add to `ProviderConfigEntry`:

```typescript
export interface ProviderConfigEntry {
  enabled: boolean;
  monthlyQuota?: number;
  apiKey?: string;
  instanceUrl?: string;
  ssrfAllowRanges?: string[];
}
```

In `src/config-manager.ts`, update `registerProvider` to inject `ssrf.allowRanges` into the provider config:

Change (in `registerProvider` method, around line 112-113):

```typescript
const providerConfig = config.providers[name];
const resolvedKey = resolveApiKey(providerConfig?.apiKey);
```

To:

```typescript
const providerConfig = config.providers[name];
const resolvedKey = resolveApiKey(providerConfig?.apiKey);
const configWithSsrf = {
  ...providerConfig,
  ssrfAllowRanges: config.ssrf.allowRanges,
};
```

Then change the `meta.create` call:

Change:

```typescript
instances = meta.create(resolvedKey, providerConfig);
```

To:

```typescript
instances = meta.create(resolvedKey, configWithSsrf);
```

Finally, update `src/providers/searxng.ts` `providerMeta.create` to use it:

Change:

```typescript
  create: (_key, providerConfig) => ({
    search: new SearXNGProvider({
      instanceUrl: providerConfig?.instanceUrl,
      apiKey: providerConfig?.apiKey ? resolveApiKey(providerConfig.apiKey) : undefined,
    }),
  }),
```

To:

```typescript
  create: (_key, providerConfig) => ({
    search: new SearXNGProvider({
      instanceUrl: providerConfig?.instanceUrl,
      apiKey: providerConfig?.apiKey ? resolveApiKey(providerConfig.apiKey) : undefined,
      allowRanges: providerConfig?.ssrfAllowRanges,
    }),
  }),
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/config.ts src/config-manager.ts src/providers/searxng.ts
git commit -m "feat: wire ssrf.allowRanges from config into web-fetch and searxng"
```

---

### Task 7: End-to-end config integration test

**Files:**

- Modify: `tests/config-ssrf.test.ts`

- [ ] **Step 1: Add integration test verifying config flows to validateUrl**

```typescript
import { loadMergedConfig } from "../src/config.ts";
import { validateUrl } from "../src/utils/ssrf.ts";

describe("ssrf config end-to-end", () => {
  it("config allowRanges can be passed to validateUrl", () => {
    // Simulate: load config with allowRanges, pass to validateUrl
    const config = loadConfig("/nonexistent/path.json");
    // Default config has empty allowRanges — 198.18 should be blocked
    expect(() =>
      validateUrl("http://198.18.1.1", {
        allowRanges: config.ssrf.allowRanges,
      }),
    ).toThrow("Blocked private/reserved IP");
  });

  it("config allowRanges exempts matching IPs", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-tools-test-"));
    const configPath = path.join(tmpDir, "tools.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ ssrf: { allowRanges: ["198.18.0.0/15"] } }),
    );

    const config = loadConfig(configPath);
    const result = validateUrl("http://198.18.1.1", {
      allowRanges: config.ssrf.allowRanges,
    });
    expect(result.hostname).toBe("198.18.1.1");

    fs.rmSync(tmpDir, { recursive: true });
  });
});
```

- [ ] **Step 2: Run test**

Run: `npx vitest run tests/config-ssrf.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/config-ssrf.test.ts
git commit -m "test: add end-to-end config → validateUrl integration test"
```

---

### Task 8: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Review the diff**

Run: `git diff master --stat`
Verify only expected files were modified/created.
