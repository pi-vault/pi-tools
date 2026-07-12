# Search Providers Phase 1 — Credential Caching & Fallback Resolution

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add shell-command result caching, safety checks for sentinel values, a fallback env-var map, and `resolveProviderKey()` to unify credential resolution across all providers.

**Architecture:** This is Phase 1 of the Search Providers Expansion. It modifies `src/config.ts` (credential functions) and `src/config-manager.ts` (cache clearing on refresh). All changes are backward-compatible — existing callers of `resolveApiKey` behave identically for valid inputs.

**Tech Stack:** TypeScript, Vitest, `execSync` for shell commands, `vi.mock` for test isolation

**Parent plan:** `docs/superpowers/plans/2026-07-12-search-providers.md`

---

## Task 1 — Write failing tests for credential caching and safety checks

**Files:**

- `tests/config.test.ts`

### Steps

- [ ] **1.1** Add the following test block at the end of `tests/config.test.ts`:

```typescript
// --- Phase 1: Credential caching, safety checks, resolveProviderKey ---

import {
  clearCredentialCache,
  resolveProviderKey,
  FALLBACK_ENV_MAP,
} from "../src/config.ts";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execSync: vi.fn(actual.execSync),
  };
});

import { execSync } from "node:child_process";

describe("resolveApiKey — shell command caching", () => {
  beforeEach(() => {
    vi.mocked(execSync).mockReturnValue("cached-secret\n");
    clearCredentialCache();
  });

  afterEach(() => {
    vi.mocked(execSync).mockRestore();
  });

  it("caches shell command results (execSync called only once for same command)", () => {
    const result1 = resolveApiKey("!echo cached-secret");
    const result2 = resolveApiKey("!echo cached-secret");
    expect(result1).toBe("cached-secret");
    expect(result2).toBe("cached-secret");
    expect(vi.mocked(execSync)).toHaveBeenCalledTimes(1);
  });

  it("clearCredentialCache causes re-execution on next call", () => {
    resolveApiKey("!echo cached-secret");
    expect(vi.mocked(execSync)).toHaveBeenCalledTimes(1);

    clearCredentialCache();
    resolveApiKey("!echo cached-secret");
    expect(vi.mocked(execSync)).toHaveBeenCalledTimes(2);
  });

  it("caches errors — does not retry failed commands", () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("command failed");
    });
    const result1 = resolveApiKey("!bad-command");
    const result2 = resolveApiKey("!bad-command");
    expect(result1).toBeUndefined();
    expect(result2).toBeUndefined();
    expect(vi.mocked(execSync)).toHaveBeenCalledTimes(1);
  });
});

describe("resolveApiKey — safety checks", () => {
  it('returns undefined for "null"', () => {
    expect(resolveApiKey("null")).toBeUndefined();
  });

  it('returns undefined for "undefined"', () => {
    expect(resolveApiKey("undefined")).toBeUndefined();
  });

  it('returns undefined for "none"', () => {
    expect(resolveApiKey("none")).toBeUndefined();
  });

  it('returns undefined for "NONE" (case-insensitive)', () => {
    // "NONE" matches ENV_VAR_PATTERN but should still be caught by safety check
    expect(resolveApiKey("NONE")).toBeUndefined();
  });
});

describe("resolveApiKey — env var warning", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.mocked(console.warn).mockRestore();
  });

  it("logs warning when ALL_CAPS env var is not set", () => {
    delete process.env.MISSING_PROVIDER_KEY;
    resolveApiKey("MISSING_PROVIDER_KEY");
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("MISSING_PROVIDER_KEY"),
    );
  });

  it("does not warn when env var is set", () => {
    process.env.BRAVE_API_KEY = "some-value";
    resolveApiKey("BRAVE_API_KEY");
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe("resolveProviderKey", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    clearCredentialCache();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("resolves config key when provided and valid", () => {
    process.env.MY_CUSTOM_KEY = "custom-value";
    const result = resolveProviderKey("brave", "MY_CUSTOM_KEY");
    expect(result).toBe("custom-value");
  });

  it("config key takes priority over fallback env", () => {
    process.env.MY_CUSTOM_KEY = "custom-value";
    process.env.BRAVE_API_KEY = "fallback-value";
    const result = resolveProviderKey("brave", "MY_CUSTOM_KEY");
    expect(result).toBe("custom-value");
  });

  it("falls back to FALLBACK_ENV_MAP when config key is undefined", () => {
    process.env.BRAVE_API_KEY = "fallback-value";
    const result = resolveProviderKey("brave", undefined);
    expect(result).toBe("fallback-value");
  });

  it("falls back to FALLBACK_ENV_MAP when config key does not resolve", () => {
    delete process.env.NONEXISTENT_KEY;
    process.env.EXA_API_KEY = "exa-fallback";
    const result = resolveProviderKey("exa", "NONEXISTENT_KEY");
    expect(result).toBe("exa-fallback");
  });

  it("returns undefined when neither config key nor fallback resolves", () => {
    delete process.env.BRAVE_API_KEY;
    const result = resolveProviderKey("brave", undefined);
    expect(result).toBeUndefined();
  });

  it("returns undefined for unknown provider with no config key", () => {
    const result = resolveProviderKey("unknown-provider", undefined);
    expect(result).toBeUndefined();
  });

  it("ignores empty/whitespace fallback env values", () => {
    process.env.BRAVE_API_KEY = "   ";
    const result = resolveProviderKey("brave", undefined);
    expect(result).toBeUndefined();
  });
});

describe("FALLBACK_ENV_MAP", () => {
  it("contains expected provider mappings", () => {
    expect(FALLBACK_ENV_MAP.brave).toBe("BRAVE_API_KEY");
    expect(FALLBACK_ENV_MAP.exa).toBe("EXA_API_KEY");
    expect(FALLBACK_ENV_MAP.tavily).toBe("TAVILY_API_KEY");
    expect(FALLBACK_ENV_MAP["openai-native"]).toBe("OPENAI_API_KEY");
    expect(FALLBACK_ENV_MAP["openai-codex"]).toBe("OPENAI_API_KEY");
  });

  it("maps all expected providers", () => {
    const expected = [
      "brave",
      "exa",
      "jina",
      "tavily",
      "serper",
      "firecrawl",
      "perplexity",
      "langsearch",
      "linkup",
      "youcom",
      "fastcrw",
      "sofya",
      "websearchapi",
      "marginalia",
      "context7",
      "parallel",
      "openai-native",
      "openai-codex",
    ];
    for (const name of expected) {
      expect(FALLBACK_ENV_MAP[name]).toBeDefined();
    }
  });
});
```

- [ ] **1.2** Run tests to confirm they fail (exports don't exist yet):

```bash
pnpm vitest run tests/config.test.ts
```

Expected: Compilation/import errors — `clearCredentialCache`, `resolveProviderKey`, `FALLBACK_ENV_MAP` are not exported from `src/config.ts`.

---

## Task 2 — Implement credential caching in `src/config.ts`

**Files:**

- `src/config.ts`

### Steps

- [ ] **2.1** Add the command value cache and `clearCredentialCache` export after line 61 (after `SHELL_TIMEOUT_MS`):

```typescript
const SENTINEL_VALUES = new Set(["null", "undefined", "none"]);

const commandValueCache = new Map<
  string,
  { value?: string; errorMessage?: string }
>();

export function clearCredentialCache(): void {
  commandValueCache.clear();
}
```

- [ ] **2.2** Add the `FALLBACK_ENV_MAP` export after `clearCredentialCache`:

```typescript
export const FALLBACK_ENV_MAP: Record<string, string> = {
  brave: "BRAVE_API_KEY",
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
};
```

- [ ] **2.3** Replace the `resolveApiKey` function body with caching, safety checks, and env-var warning:

```typescript
export function resolveApiKey(apiKey: string | undefined): string | undefined {
  if (!apiKey) return undefined;

  // Safety check: reject sentinel string values
  if (SENTINEL_VALUES.has(apiKey.toLowerCase())) return undefined;

  // Shell command: starts with !
  if (apiKey.startsWith(SHELL_CMD_PREFIX)) {
    const cmd = apiKey.slice(SHELL_CMD_PREFIX.length);
    const cached = commandValueCache.get(cmd);
    if (cached !== undefined) {
      return cached.value;
    }
    try {
      const value = execSync(cmd, {
        timeout: SHELL_TIMEOUT_MS,
        encoding: "utf-8",
      }).trim();
      commandValueCache.set(cmd, { value });
      return value;
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "unknown error";
      commandValueCache.set(cmd, { errorMessage });
      return undefined;
    }
  }

  // Env var name: all uppercase with underscores
  if (ENV_VAR_PATTERN.test(apiKey)) {
    const value = process.env[apiKey] ?? undefined;
    if (!value) {
      console.warn(
        `[pi-tools] Environment variable ${apiKey} is referenced but not set`,
      );
    }
    return value;
  }

  // Literal key value
  return apiKey;
}
```

- [ ] **2.4** Add the `resolveProviderKey` function after `resolveApiKey`:

```typescript
export function resolveProviderKey(
  providerName: string,
  configKey?: string,
): string | undefined {
  if (configKey) {
    const resolved = resolveApiKey(configKey);
    if (resolved) return resolved;
  }

  const fallbackEnv = FALLBACK_ENV_MAP[providerName];
  if (fallbackEnv) {
    const envValue = process.env[fallbackEnv];
    if (envValue && envValue.trim().length > 0) return envValue.trim();
  }

  return undefined;
}
```

- [ ] **2.5** Run tests to verify the new tests pass:

```bash
pnpm vitest run tests/config.test.ts
```

Expected: All tests pass including the new Phase 1 tests.

---

## Task 3 — Wire cache clearing into `config-manager.ts`

**Files:**

- `src/config-manager.ts`

### Steps

- [ ] **3.1** Update the import from `config.ts` to include `clearCredentialCache`:

```typescript
import {
  loadMergedConfig,
  resolveApiKey,
  clearCredentialCache,
} from "./config.ts";
```

- [ ] **3.2** Add `clearCredentialCache()` call at the start of the `refresh()` method body, before `loadMergedConfig`:

```typescript
  refresh(force = false): void {
    const now = Date.now();
    if (!force && now - this.cacheTime < CONFIG_TTL_MS) return;

    clearCredentialCache();

    let nextConfig: PiToolsConfig;
    try {
      nextConfig = loadMergedConfig(this.cwd);
    } catch {
      // Malformed config — keep previous, reset TTL to retry next cycle
      this.cacheTime = now;
      return;
    }

    const changeSet = diffConfig(this._config, nextConfig, resolveApiKey);
    this.applyChanges(changeSet, nextConfig);
    this._config = nextConfig;
    this.cacheTime = now;
  }
```

- [ ] **3.3** Run the config-manager tests to verify no regressions:

```bash
pnpm vitest run tests/config-manager.test.ts
```

Expected: All existing tests pass.

---

## Task 4 — Full verification

**Files:** (none modified)

### Steps

- [ ] **4.1** Run the full test suite:

```bash
pnpm test
```

Expected: All tests pass.

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
git add src/config.ts src/config-manager.ts tests/config.test.ts
git commit -m "feat(config): add credential caching, safety checks, and resolveProviderKey

Phase 1 of search providers expansion:
- Add commandValueCache for shell command results
- Add clearCredentialCache() export
- Add FALLBACK_ENV_MAP for provider env-var fallbacks
- Add resolveProviderKey() with config-key-first, fallback-env strategy
- Safety: reject 'null', 'undefined', 'none' sentinel values
- Warning: log when ALL_CAPS env var reference is unset
- Wire clearCredentialCache() into ConfigManager.refresh()
- Add comprehensive tests for all new behavior"
```

---

## Summary of Changes

| File                    | Change                                                                                                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/config.ts`         | Add `SENTINEL_VALUES`, `commandValueCache`, `clearCredentialCache()`, `FALLBACK_ENV_MAP`, safety checks in `resolveApiKey`, env-var warning, caching in shell branch, `resolveProviderKey()` |
| `src/config-manager.ts` | Import `clearCredentialCache`, call it in `refresh()`                                                                                                                                        |
| `tests/config.test.ts`  | Add tests for caching, cache clearing, safety checks, env-var warnings, `resolveProviderKey`, `FALLBACK_ENV_MAP`                                                                             |
