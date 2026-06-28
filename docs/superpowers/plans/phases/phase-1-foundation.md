# Phase 1: Foundation (Types, Config, Errors, Test Utilities)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish all shared types, configuration loading, error sanitization, and test helpers. After this phase, config loads from disk/env, errors are safely redacted, and the test harness is ready for all subsequent phases.

**Architecture:** Foundation modules are pure utilities with no inter-dependencies beyond standard Node APIs. Each module is independently testable.

**Tech Stack:** TypeScript, vitest, native `fetch()` (Node 22+), `@mozilla/readability`, `linkedom`, `turndown`, `unpdf`

**Spec:** `docs/superpowers/specs/2026-06-27-pi-tools-design.md`

**Depends on:** Nothing (first phase)

**Produces:** `src/providers/types.ts`, `src/utils/errors.ts`, `src/config.ts`, `tests/helpers.ts`, `src/storage.ts`, `src/utils/truncate.ts`, `src/utils/ssrf.ts`, production dependencies installed

---

## Task 1.1: Provider Interfaces and Result Types

**Files:**
- Create: `src/providers/types.ts`
- Test: `tests/providers/types.test.ts`

- [ ] **Step 1: Create provider interfaces and result types**

```typescript
// src/providers/types.ts

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface CodeSearchResult {
  title: string;
  url: string;
  snippet: string;
  language?: string;
}

export interface FetchResult {
  text: string;
  title?: string;
  contentType?: string;
}

export interface SearchProvider {
  readonly name: string;
  readonly label: string;
  search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
  ): Promise<SearchResult[]>;
}

export interface FetchProvider {
  readonly name: string;
  fetch(url: string, signal?: AbortSignal): Promise<FetchResult>;
}

export interface CodeSearchProvider {
  readonly name: string;
  codeSearch(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
  ): Promise<CodeSearchResult[]>;
}

export interface ProviderCapabilities {
  search?: boolean;
  fetch?: boolean;
  codeSearch?: boolean;
}

export interface ProviderConfig {
  enabled: boolean;
  monthlyQuota?: number;
  apiKey?: string;
}

export type ProviderTier = 1 | 2 | 3;

export interface ProviderMeta {
  name: string;
  label: string;
  tier: ProviderTier;
  requiresKey: boolean;
  defaultMonthlyQuota: number | null; // null = unlimited
  capabilities: ProviderCapabilities;
}
```

- [ ] **Step 2: Write type validation tests**

```typescript
// tests/providers/types.test.ts
import { describe, expect, it } from "vitest";
import type {
  CodeSearchProvider,
  CodeSearchResult,
  FetchProvider,
  FetchResult,
  ProviderMeta,
  SearchProvider,
  SearchResult,
} from "../../src/providers/types.ts";

describe("provider types", () => {
  it("SearchResult satisfies the interface shape", () => {
    const result: SearchResult = {
      title: "Example",
      url: "https://example.com",
      snippet: "A snippet",
    };
    expect(result.title).toBe("Example");
    expect(result.url).toBe("https://example.com");
    expect(result.snippet).toBe("A snippet");
  });

  it("CodeSearchResult includes optional language", () => {
    const result: CodeSearchResult = {
      title: "Code Example",
      url: "https://github.com/example",
      snippet: "const x = 1;",
      language: "typescript",
    };
    expect(result.language).toBe("typescript");

    const noLang: CodeSearchResult = {
      title: "Code",
      url: "https://example.com",
      snippet: "code",
    };
    expect(noLang.language).toBeUndefined();
  });

  it("FetchResult includes optional fields", () => {
    const minimal: FetchResult = { text: "content" };
    expect(minimal.title).toBeUndefined();
    expect(minimal.contentType).toBeUndefined();

    const full: FetchResult = {
      text: "content",
      title: "Page Title",
      contentType: "text/html",
    };
    expect(full.title).toBe("Page Title");
  });

  it("ProviderMeta describes provider characteristics", () => {
    const meta: ProviderMeta = {
      name: "brave",
      label: "Brave Search",
      tier: 1,
      requiresKey: true,
      defaultMonthlyQuota: 2000,
      capabilities: { search: true },
    };
    expect(meta.tier).toBe(1);
    expect(meta.requiresKey).toBe(true);
    expect(meta.capabilities.search).toBe(true);
    expect(meta.capabilities.fetch).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm test -- tests/providers/types.test.ts`
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/providers/types.ts tests/providers/types.test.ts
git commit -m "feat: add provider interfaces and result types"
```

## Task 1.2: Error Sanitization

**Files:**
- Create: `src/utils/errors.ts`
- Test: `tests/utils/errors.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/utils/errors.test.ts
import { describe, expect, it } from "vitest";
import { sanitizeError } from "../../src/utils/errors.ts";

describe("sanitizeError", () => {
  it("redacts Bearer tokens", () => {
    const msg = "Authorization: Bearer sk-abc123456789xyz";
    expect(sanitizeError(msg)).not.toContain("sk-abc123456789xyz");
    expect(sanitizeError(msg)).toContain("[redacted]");
  });

  it("redacts api_key values", () => {
    const msg = "api_key=supersecretkey123";
    expect(sanitizeError(msg)).not.toContain("supersecretkey123");
    expect(sanitizeError(msg)).toContain("[redacted]");
  });

  it("redacts apiKey values", () => {
    const msg = "apiKey: my-secret-api-key-value";
    expect(sanitizeError(msg)).not.toContain("my-secret-api-key-value");
    expect(sanitizeError(msg)).toContain("[redacted]");
  });

  it("redacts token values", () => {
    const msg = "token=abcdefghijklmnop";
    expect(sanitizeError(msg)).not.toContain("abcdefghijklmnop");
    expect(sanitizeError(msg)).toContain("[redacted]");
  });

  it("redacts secret values", () => {
    const msg = "secret: mysecretvalue123456";
    expect(sanitizeError(msg)).not.toContain("mysecretvalue123456");
    expect(sanitizeError(msg)).toContain("[redacted]");
  });

  it("redacts password values", () => {
    const msg = "password=hunter2ishunter2";
    expect(sanitizeError(msg)).not.toContain("hunter2ishunter2");
    expect(sanitizeError(msg)).toContain("[redacted]");
  });

  it("truncates to 300 chars max", () => {
    const msg = "a".repeat(500);
    expect(sanitizeError(msg).length).toBeLessThanOrEqual(300);
  });

  it("preserves short safe messages", () => {
    const msg = "Network timeout after 30s";
    expect(sanitizeError(msg)).toBe("Network timeout after 30s");
  });

  it("handles Error objects", () => {
    const err = new Error("token=mysecrettoken12345");
    expect(sanitizeError(err)).toContain("[redacted]");
    expect(sanitizeError(err)).not.toContain("mysecrettoken12345");
  });

  it("handles non-string non-Error values", () => {
    expect(sanitizeError(42)).toBe("42");
    expect(sanitizeError(null)).toBe("Unknown error");
    expect(sanitizeError(undefined)).toBe("Unknown error");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- tests/utils/errors.test.ts`
Expected: FAIL — `sanitizeError` does not exist yet.

- [ ] **Step 3: Implement sanitizeError**

```typescript
// src/utils/errors.ts

const SECRETS_PATTERN =
  /(bearer|token|api[-_]?key|authorization|secret|password)\s*[:=]?\s*[\w.\/-]{8,}/gi;
const MAX_LENGTH = 300;

export function sanitizeError(error: unknown): string {
  let msg: string;
  if (error === null || error === undefined) {
    return "Unknown error";
  }
  if (error instanceof Error) {
    msg = error.message;
  } else if (typeof error === "string") {
    msg = error;
  } else {
    msg = String(error);
  }

  msg = msg.replace(SECRETS_PATTERN, "[redacted]");

  if (msg.length > MAX_LENGTH) {
    msg = msg.slice(0, MAX_LENGTH);
  }

  return msg;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/utils/errors.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/errors.ts tests/utils/errors.test.ts
git commit -m "feat: add error sanitization utility"
```

## Task 1.3: Configuration Loading

**Files:**
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/config.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig, resolveApiKey, type PiToolsConfig } from "../src/config.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

vi.mock("node:fs");

describe("loadConfig", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns defaults when config file is missing", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const config = loadConfig();
    expect(config.defaultProvider).toBe("auto");
    expect(config.providers.duckduckgo.enabled).toBe(true);
    expect(config.providers.jina.enabled).toBe(true);
  });

  it("parses valid config file", () => {
    const configData: PiToolsConfig = {
      defaultProvider: "brave",
      providers: {
        brave: { enabled: true, monthlyQuota: 2000, apiKey: "BRAVE_API_KEY" },
        exa: { enabled: false },
        tavily: { enabled: false },
        jina: { enabled: true },
        duckduckgo: { enabled: true },
        serper: { enabled: false },
        perplexity: { enabled: false },
        firecrawl: { enabled: false },
      },
    };
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(configData));
    const config = loadConfig();
    expect(config.defaultProvider).toBe("brave");
    expect(config.providers.brave.enabled).toBe(true);
    expect(config.providers.brave.monthlyQuota).toBe(2000);
  });

  it("returns defaults for malformed JSON", () => {
    vi.mocked(fs.readFileSync).mockReturnValue("not json{{{");
    const config = loadConfig();
    expect(config.defaultProvider).toBe("auto");
  });
});

describe("resolveApiKey", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns undefined when no apiKey configured", () => {
    expect(resolveApiKey(undefined)).toBeUndefined();
  });

  it("resolves env var name (all-caps pattern)", () => {
    process.env.MY_API_KEY = "resolved-value";
    expect(resolveApiKey("MY_API_KEY")).toBe("resolved-value");
  });

  it("returns undefined when env var name does not resolve", () => {
    delete process.env.MISSING_KEY;
    expect(resolveApiKey("MISSING_KEY")).toBeUndefined();
  });

  it("treats non-env-var strings as literal keys", () => {
    expect(resolveApiKey("sk-literal-key-value")).toBe("sk-literal-key-value");
  });

  it("resolves shell commands prefixed with !", () => {
    // Shell command resolution is tested with a simple echo
    const result = resolveApiKey("!echo test-key");
    expect(result).toBe("test-key");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- tests/config.test.ts`
Expected: FAIL — `config.ts` does not exist.

- [ ] **Step 3: Implement config loading**

```typescript
// src/config.ts
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

export interface ProviderConfigEntry {
  enabled: boolean;
  monthlyQuota?: number;
  apiKey?: string;
}

export interface PiToolsConfig {
  defaultProvider: string;
  providers: Record<string, ProviderConfigEntry>;
}

const ENV_VAR_PATTERN = /^[A-Z][A-Z0-9_]+$/;
const SHELL_CMD_PREFIX = "!";
const SHELL_TIMEOUT_MS = 5000;

const DEFAULT_CONFIG: PiToolsConfig = {
  defaultProvider: "auto",
  providers: {
    brave: { enabled: true, monthlyQuota: 2000, apiKey: "BRAVE_API_KEY" },
    exa: { enabled: true, monthlyQuota: 1000, apiKey: "EXA_API_KEY" },
    tavily: { enabled: false, apiKey: "TAVILY_API_KEY" },
    jina: { enabled: true },
    duckduckgo: { enabled: true },
    serper: { enabled: false, apiKey: "SERPER_API_KEY" },
    perplexity: { enabled: true, apiKey: "PERPLEXITY_API_KEY" },
    firecrawl: { enabled: true, apiKey: "FIRECRAWL_API_KEY" },
  },
};

export function getConfigPath(): string {
  return path.join(
    os.homedir(),
    ".pi",
    "agent",
    "extensions",
    "pi-tools.json",
  );
}

export function loadConfig(configPath?: string): PiToolsConfig {
  const filePath = configPath ?? getConfigPath();
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      defaultProvider: parsed.defaultProvider ?? DEFAULT_CONFIG.defaultProvider,
      providers: {
        ...DEFAULT_CONFIG.providers,
        ...parsed.providers,
      },
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function resolveApiKey(apiKey: string | undefined): string | undefined {
  if (!apiKey) return undefined;

  // Shell command: starts with !
  if (apiKey.startsWith(SHELL_CMD_PREFIX)) {
    try {
      const cmd = apiKey.slice(SHELL_CMD_PREFIX.length);
      return execSync(cmd, { timeout: SHELL_TIMEOUT_MS, encoding: "utf-8" }).trim();
    } catch {
      return undefined;
    }
  }

  // Env var name: all uppercase with underscores
  if (ENV_VAR_PATTERN.test(apiKey)) {
    return process.env[apiKey] ?? undefined;
  }

  // Literal key value
  return apiKey;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/config.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: add configuration loading with env var and shell command resolution"
```

## Task 1.4: Test Utilities

**Files:**
- Create: `tests/helpers.ts`

- [ ] **Step 1: Create test helper utilities**

The spec calls for `createMockPi()` (captures registered tools, commands, events), `stubFetch()` (intercept fetch by URL pattern), and `makeCtx()` (minimal ExtensionContext).

```typescript
// tests/helpers.ts
import { vi } from "vitest";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";

export interface MockPi {
  tools: ToolDefinition[];
  events: Map<string, Function[]>;
  entries: Array<{ customType: string; data: unknown }>;
  registerTool: ExtensionAPI["registerTool"];
  on: ExtensionAPI["on"];
  appendEntry: ExtensionAPI["appendEntry"];
}

export function createMockPi(): MockPi {
  const tools: ToolDefinition[] = [];
  const events = new Map<string, Function[]>();
  const entries: Array<{ customType: string; data: unknown }> = [];

  return {
    tools,
    events,
    entries,
    registerTool(tool: ToolDefinition) {
      tools.push(tool);
    },
    on(event: string, handler: Function) {
      if (!events.has(event)) events.set(event, []);
      events.get(event)!.push(handler);
    },
    appendEntry(customType: string, data?: unknown) {
      entries.push({ customType, data });
    },
  } as MockPi;
}

export function makeCtx(overrides?: Partial<ExtensionContext>): ExtensionContext {
  return {
    ui: {
      notify: vi.fn(),
      select: vi.fn(),
      confirm: vi.fn(),
      input: vi.fn(),
      setStatus: vi.fn(),
    },
    mode: "tui",
    hasUI: true,
    cwd: "/tmp/test",
    sessionManager: {
      getEntries: vi.fn().mockReturnValue([]),
    },
    model: undefined,
    isIdle: () => true,
    isProjectTrusted: () => true,
    signal: undefined,
    abort: vi.fn(),
    hasPendingMessages: () => false,
    shutdown: vi.fn(),
    getContextUsage: () => undefined,
    compact: vi.fn(),
    getSystemPrompt: () => "",
    ...overrides,
  } as unknown as ExtensionContext;
}

export interface FetchStub {
  addResponse(urlPattern: string | RegExp, response: {
    status?: number;
    body?: string | object;
    headers?: Record<string, string>;
  }): void;
  restore(): void;
}

export function stubFetch(): FetchStub {
  const routes: Array<{
    pattern: string | RegExp;
    response: { status: number; body: string; headers: Record<string, string> };
  }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const route of routes) {
      const matches =
        typeof route.pattern === "string"
          ? url.includes(route.pattern)
          : route.pattern.test(url);
      if (matches) {
        return new Response(route.response.body, {
          status: route.response.status,
          headers: route.response.headers,
        });
      }
    }
    return new Response("Not Found", { status: 404 });
  }) as typeof fetch;

  return {
    addResponse(urlPattern, response) {
      routes.push({
        pattern: urlPattern,
        response: {
          status: response.status ?? 200,
          body:
            typeof response.body === "object"
              ? JSON.stringify(response.body)
              : response.body ?? "",
          headers: response.headers ?? { "content-type": "application/json" },
        },
      });
    },
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/helpers.ts
git commit -m "feat: add test utilities (createMockPi, makeCtx, stubFetch)"
```

## Task 1.5: Content Storage

**Files:**
- Create: `src/storage.ts`
- Test: `tests/storage.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/storage.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ContentStore, type StoredContent } from "../src/storage.ts";

describe("ContentStore", () => {
  let store: ContentStore;
  const mockAppendEntry = vi.fn();

  beforeEach(() => {
    store = new ContentStore(mockAppendEntry);
    mockAppendEntry.mockClear();
  });

  it("stores and retrieves content by ID", () => {
    const id = store.store({
      url: "https://example.com",
      title: "Example",
      text: "Hello world",
      source: "web_fetch",
    });

    expect(id).toMatch(/^wc-/);
    const retrieved = store.get(id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.text).toBe("Hello world");
    expect(retrieved!.url).toBe("https://example.com");
    expect(retrieved!.title).toBe("Example");
    expect(retrieved!.source).toBe("web_fetch");
    expect(retrieved!.chars).toBe(11);
    expect(retrieved!.storedAt).toBeDefined();
  });

  it("returns undefined for unknown content ID", () => {
    expect(store.get("wc-nonexistent")).toBeUndefined();
  });

  it("calls appendEntry on store", () => {
    store.store({
      url: "https://example.com",
      text: "content",
      source: "web_search",
    });
    expect(mockAppendEntry).toHaveBeenCalledWith(
      "pi-tools-content",
      expect.objectContaining({ url: "https://example.com" }),
    );
  });

  it("restores content from session entries", () => {
    const entry: StoredContent = {
      id: "wc-restored-1",
      url: "https://restored.com",
      title: "Restored",
      text: "restored content",
      chars: 16,
      storedAt: new Date().toISOString(),
      source: "web_fetch",
    };
    store.restore([entry]);
    const retrieved = store.get("wc-restored-1");
    expect(retrieved).toBeDefined();
    expect(retrieved!.text).toBe("restored content");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- tests/storage.test.ts`
Expected: FAIL — `storage.ts` does not exist.

- [ ] **Step 3: Implement ContentStore**

```typescript
// src/storage.ts

export interface StoredContent {
  id: string;
  url: string;
  title?: string;
  text: string;
  chars: number;
  storedAt: string;
  source: "web_fetch" | "web_search";
}

export type AppendEntryFn = (customType: string, data: unknown) => void;

export class ContentStore {
  private items = new Map<string, StoredContent>();
  private appendEntry: AppendEntryFn;

  constructor(appendEntry: AppendEntryFn) {
    this.appendEntry = appendEntry;
  }

  store(input: {
    url: string;
    title?: string;
    text: string;
    source: "web_fetch" | "web_search";
  }): string {
    const id = `wc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const stored: StoredContent = {
      id,
      url: input.url,
      title: input.title,
      text: input.text,
      chars: input.text.length,
      storedAt: new Date().toISOString(),
      source: input.source,
    };
    this.items.set(id, stored);
    this.appendEntry("pi-tools-content", stored);
    return id;
  }

  get(id: string): StoredContent | undefined {
    return this.items.get(id);
  }

  restore(entries: StoredContent[]): void {
    for (const entry of entries) {
      this.items.set(entry.id, entry);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/storage.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/storage.ts tests/storage.test.ts
git commit -m "feat: add session-local content storage"
```

## Task 1.6: Output Truncation

**Files:**
- Create: `src/utils/truncate.ts`
- Test: `tests/utils/truncate.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/utils/truncate.test.ts
import { describe, expect, it } from "vitest";
import { truncateContent } from "../../src/utils/truncate.ts";

const INLINE_LIMIT = 15_000;

describe("truncateContent", () => {
  it("returns content as-is when under limit", () => {
    const result = truncateContent("short text", INLINE_LIMIT);
    expect(result.text).toBe("short text");
    expect(result.truncated).toBe(false);
  });

  it("truncates content over the limit", () => {
    const long = "a".repeat(INLINE_LIMIT + 1000);
    const result = truncateContent(long, INLINE_LIMIT);
    expect(result.text.length).toBeLessThanOrEqual(INLINE_LIMIT);
    expect(result.truncated).toBe(true);
  });

  it("appends truncation notice when truncated", () => {
    const long = "a".repeat(INLINE_LIMIT + 1000);
    const result = truncateContent(long, INLINE_LIMIT);
    expect(result.text).toContain("[truncated]");
  });

  it("reports original character count", () => {
    const text = "a".repeat(20_000);
    const result = truncateContent(text, INLINE_LIMIT);
    expect(result.originalChars).toBe(20_000);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- tests/utils/truncate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement truncateContent**

```typescript
// src/utils/truncate.ts

export interface TruncateResult {
  text: string;
  truncated: boolean;
  originalChars: number;
}

export function truncateContent(
  text: string,
  limit: number,
): TruncateResult {
  const originalChars = text.length;
  if (originalChars <= limit) {
    return { text, truncated: false, originalChars };
  }
  const notice = `\n\n[truncated: showing ${limit} of ${originalChars} chars]`;
  const truncatedText = text.slice(0, limit - notice.length) + notice;
  return { text: truncatedText, truncated: true, originalChars };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test -- tests/utils/truncate.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/truncate.ts tests/utils/truncate.test.ts
git commit -m "feat: add output truncation utility"
```

## Task 1.7: SSRF Guard

**Files:**
- Create: `src/utils/ssrf.ts`
- Test: `tests/utils/ssrf.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/utils/ssrf.test.ts
import { describe, expect, it } from "vitest";
import { validateUrl, SSRFError } from "../../src/utils/ssrf.ts";

describe("validateUrl", () => {
  it("allows valid HTTPS URLs", () => {
    expect(() => validateUrl("https://example.com")).not.toThrow();
    expect(() => validateUrl("https://docs.rs/tokio")).not.toThrow();
  });

  it("allows valid HTTP URLs", () => {
    expect(() => validateUrl("http://example.com")).not.toThrow();
  });

  it("blocks non-http(s) protocols", () => {
    expect(() => validateUrl("ftp://example.com")).toThrow(SSRFError);
    expect(() => validateUrl("file:///etc/passwd")).toThrow(SSRFError);
    expect(() => validateUrl("javascript:alert(1)")).toThrow(SSRFError);
  });

  it("blocks loopback addresses", () => {
    expect(() => validateUrl("http://127.0.0.1")).toThrow(SSRFError);
    expect(() => validateUrl("http://127.0.0.1:8080/path")).toThrow(SSRFError);
    expect(() => validateUrl("http://[::1]")).toThrow(SSRFError);
    expect(() => validateUrl("http://localhost")).toThrow(SSRFError);
    expect(() => validateUrl("http://test.localhost")).toThrow(SSRFError);
  });

  it("blocks RFC 1918 private ranges", () => {
    expect(() => validateUrl("http://10.0.0.1")).toThrow(SSRFError);
    expect(() => validateUrl("http://172.16.0.1")).toThrow(SSRFError);
    expect(() => validateUrl("http://192.168.1.1")).toThrow(SSRFError);
  });

  it("blocks link-local addresses", () => {
    expect(() => validateUrl("http://169.254.1.1")).toThrow(SSRFError);
  });

  it("blocks cloud metadata endpoint", () => {
    expect(() => validateUrl("http://169.254.169.254")).toThrow(SSRFError);
    expect(() => validateUrl("http://169.254.169.254/latest/meta-data")).toThrow(SSRFError);
  });

  it("blocks URLs with credentials", () => {
    expect(() => validateUrl("http://user:pass@example.com")).toThrow(SSRFError);
    expect(() => validateUrl("http://admin@example.com")).toThrow(SSRFError);
  });

  it("blocks invalid URLs", () => {
    expect(() => validateUrl("not-a-url")).toThrow(SSRFError);
    expect(() => validateUrl("")).toThrow(SSRFError);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- tests/utils/ssrf.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement SSRF guard**

```typescript
// src/utils/ssrf.ts

export class SSRFError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SSRFError";
  }
}

const BLOCKED_HOSTNAMES = new Set(["localhost"]);

function isBlockedHostname(hostname: string): boolean {
  if (BLOCKED_HOSTNAMES.has(hostname)) return true;
  if (hostname.endsWith(".localhost")) return true;
  return false;
}

function isPrivateIP(hostname: string): boolean {
  // Remove IPv6 brackets
  const ip = hostname.replace(/^\[|\]$/g, "");

  // IPv6 loopback
  if (ip === "::1") return true;

  // IPv4 checks
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;

  const [a, b] = parts;

  // Loopback: 127.0.0.0/8
  if (a === 127) return true;
  // 10.0.0.0/8
  if (a === 10) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // Link-local: 169.254.0.0/16
  if (a === 169 && b === 254) return true;

  return false;
}

export function validateUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SSRFError(`Invalid URL: ${url}`);
  }

  // Protocol check
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SSRFError(`Blocked protocol: ${parsed.protocol}`);
  }

  // Credentials check
  if (parsed.username || parsed.password) {
    throw new SSRFError("URLs with credentials are not allowed");
  }

  // Hostname checks
  const hostname = parsed.hostname;

  if (isBlockedHostname(hostname)) {
    throw new SSRFError(`Blocked hostname: ${hostname}`);
  }

  if (isPrivateIP(hostname)) {
    throw new SSRFError(`Blocked private/reserved IP: ${hostname}`);
  }

  return parsed;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test -- tests/utils/ssrf.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/ssrf.ts tests/utils/ssrf.test.ts
git commit -m "feat: add SSRF guard for URL validation"
```

## Task 1.8: Install Production Dependencies

- [ ] **Step 1: Install packages**

Run: `pnpm add @mozilla/readability linkedom turndown turndown-plugin-gfm unpdf`

- [ ] **Step 2: Install type declarations**

Run: `pnpm add -D @types/turndown`

Note: `linkedom` ships its own types. `@mozilla/readability` ships types. `turndown-plugin-gfm` may not have types — if `pnpm add -D @types/turndown-plugin-gfm` fails, skip it and add a declaration file.

- [ ] **Step 3: If `@types/turndown-plugin-gfm` is not available, create a declaration**

```typescript
// src/types/turndown-plugin-gfm.d.ts
declare module "turndown-plugin-gfm" {
  import type TurndownService from "turndown";
  export function gfm(service: TurndownService): void;
  export function tables(service: TurndownService): void;
  export function strikethrough(service: TurndownService): void;
  export function taskListItems(service: TurndownService): void;
}
```

- [ ] **Step 4: Run checks**

Run: `pnpm check`
Expected: Lint, typecheck, and tests all pass.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/types/
git commit -m "feat: install production dependencies (readability, linkedom, turndown, unpdf)"
```

## Phase 1 Checkpoint

Run: `pnpm check`
Expected: All lint, typecheck, and tests pass. Foundation modules are ready.
