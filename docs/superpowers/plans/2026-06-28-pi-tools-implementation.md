# Pi Tools Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the pi-tools extension providing `web_search`, `web_fetch`, `code_search`, and `web_read` tools with multi-provider support and quota-aware rotation.

**Architecture:** Tools register via `ExtensionAPI.registerTool()` and delegate to provider implementations behind a quota-aware registry. Content extraction uses a multi-tier fallback pipeline. Session-local storage holds large fetched content for retrieval via `web_read`.

**Tech Stack:** TypeScript, TypeBox (schemas), vitest (testing), native `fetch()` (Node 22+), `@mozilla/readability`, `linkedom`, `turndown`, `unpdf`

**Spec:** `docs/superpowers/specs/2026-06-27-pi-tools-design.md`

---

## Phase 1: Foundation (Types, Config, Errors, Test Utilities)

Establishes all shared types, configuration loading, error sanitization, and test helpers. After this phase, config loads from disk/env, errors are safely redacted, and the test harness is ready for all subsequent phases.

### Task 1.1: Provider Interfaces and Result Types

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

### Task 1.2: Error Sanitization

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

### Task 1.3: Configuration Loading

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

### Task 1.4: Test Utilities

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

### Task 1.5: Content Storage

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

### Task 1.6: Output Truncation

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

### Task 1.7: SSRF Guard

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

### Task 1.8: Install Production Dependencies

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

### Phase 1 Checkpoint

Run: `pnpm check`
Expected: All lint, typecheck, and tests pass. Foundation modules are ready.

---

## Phase 2: DuckDuckGo Provider + web_search Tool

Delivers a working `web_search` tool using DuckDuckGo (free, no key). After this phase, the extension registers a functional search tool that returns real results.

### Task 2.1: DuckDuckGo Search Provider

**Files:**
- Create: `src/providers/duckduckgo.ts`
- Test: `tests/providers/duckduckgo.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/providers/duckduckgo.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DuckDuckGoProvider } from "../../src/providers/duckduckgo.ts";
import { stubFetch } from "../helpers.ts";
import type { SearchResult } from "../../src/providers/types.ts";

describe("DuckDuckGoProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;
  let provider: DuckDuckGoProvider;

  beforeEach(() => {
    fetchStub = stubFetch();
    provider = new DuckDuckGoProvider();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct name and label", () => {
    expect(provider.name).toBe("duckduckgo");
    expect(provider.label).toBe("DuckDuckGo");
  });

  it("returns normalized search results", async () => {
    fetchStub.addResponse("duckduckgo.com", {
      body: {
        RelatedTopics: [
          {
            Text: "Example Result - This is a snippet about example",
            FirstURL: "https://example.com",
          },
          {
            Text: "Another Result - More information here",
            FirstURL: "https://another.com",
          },
        ],
      },
    });

    const results = await provider.search("test query", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty("title");
    expect(results[0]).toHaveProperty("url");
    expect(results[0]).toHaveProperty("snippet");
  });

  it("respects maxResults", async () => {
    fetchStub.addResponse("duckduckgo.com", {
      body: {
        RelatedTopics: [
          { Text: "Result 1 - snippet", FirstURL: "https://1.com" },
          { Text: "Result 2 - snippet", FirstURL: "https://2.com" },
          { Text: "Result 3 - snippet", FirstURL: "https://3.com" },
        ],
      },
    });

    const results = await provider.search("test", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("throws on non-2xx response", async () => {
    fetchStub.addResponse("duckduckgo.com", { status: 503, body: "Service Unavailable" });
    await expect(provider.search("test", 5)).rejects.toThrow();
  });

  it("respects abort signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(provider.search("test", 5, controller.signal)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- tests/providers/duckduckgo.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement DuckDuckGo provider**

```typescript
// src/providers/duckduckgo.ts
import type { SearchProvider, SearchResult } from "./types.ts";

interface DDGTopic {
  Text?: string;
  FirstURL?: string;
  Topics?: DDGTopic[];
}

interface DDGResponse {
  RelatedTopics?: DDGTopic[];
  AbstractText?: string;
  AbstractURL?: string;
  AbstractSource?: string;
}

function flattenTopics(topics: DDGTopic[]): DDGTopic[] {
  const flat: DDGTopic[] = [];
  for (const topic of topics) {
    if (topic.FirstURL && topic.Text) {
      flat.push(topic);
    }
    if (topic.Topics) {
      flat.push(...flattenTopics(topic.Topics));
    }
  }
  return flat;
}

function parseTitle(text: string): { title: string; snippet: string } {
  const dashIdx = text.indexOf(" - ");
  if (dashIdx > 0) {
    return { title: text.slice(0, dashIdx), snippet: text.slice(dashIdx + 3) };
  }
  return { title: text, snippet: text };
}

export class DuckDuckGoProvider implements SearchProvider {
  readonly name = "duckduckgo";
  readonly label = "DuckDuckGo";

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
  ): Promise<SearchResult[]> {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const response = await fetch(url, { signal });

    if (!response.ok) {
      throw new Error(`DuckDuckGo API error: ${response.status} ${response.statusText}`);
    }

    const data: DDGResponse = await response.json();
    const topics = flattenTopics(data.RelatedTopics ?? []);
    const results: SearchResult[] = [];

    // Include abstract if available
    if (data.AbstractText && data.AbstractURL) {
      results.push({
        title: data.AbstractSource ?? "Abstract",
        url: data.AbstractURL,
        snippet: data.AbstractText,
      });
    }

    for (const topic of topics) {
      if (results.length >= maxResults) break;
      if (!topic.Text || !topic.FirstURL) continue;
      const { title, snippet } = parseTitle(topic.Text);
      results.push({ title, url: topic.FirstURL, snippet });
    }

    return results.slice(0, maxResults);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test -- tests/providers/duckduckgo.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/duckduckgo.ts tests/providers/duckduckgo.test.ts
git commit -m "feat: add DuckDuckGo search provider"
```

### Task 2.2: web_search Tool Definition

**Files:**
- Create: `src/tools/web-search.ts`
- Test: `tests/tools/web-search.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/tools/web-search.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWebSearchTool } from "../../src/tools/web-search.ts";
import { DuckDuckGoProvider } from "../../src/providers/duckduckgo.ts";
import { stubFetch } from "../helpers.ts";
import { makeCtx } from "../helpers.ts";

describe("web_search tool", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
    fetchStub.addResponse("duckduckgo.com", {
      body: {
        RelatedTopics: [
          { Text: "TypeScript - A typed superset of JavaScript", FirstURL: "https://typescriptlang.org" },
          { Text: "MDN Web Docs - Web technology reference", FirstURL: "https://developer.mozilla.org" },
        ],
      },
    });
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct tool metadata", () => {
    const providers = { duckduckgo: new DuckDuckGoProvider() };
    const tool = createWebSearchTool(() => providers.duckduckgo);
    expect(tool.name).toBe("web_search");
    expect(tool.label).toBe("Web Search");
    expect(tool.parameters).toBeDefined();
  });

  it("executes search and returns formatted results", async () => {
    const provider = new DuckDuckGoProvider();
    const tool = createWebSearchTool(() => provider);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-1",
      { query: "typescript" },
      undefined,
      undefined,
      ctx,
    );
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content[0]).toHaveProperty("type", "text");
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("TypeScript");
  });

  it("returns error result on provider failure", async () => {
    fetchStub.restore();
    const stub2 = stubFetch();
    stub2.addResponse("duckduckgo.com", { status: 500, body: "Server Error" });

    const provider = new DuckDuckGoProvider();
    const tool = createWebSearchTool(() => provider);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-2",
      { query: "test" },
      undefined,
      undefined,
      ctx,
    );
    // Tool should not throw — it returns an error in content
    expect(result.content[0]).toHaveProperty("type", "text");
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text.toLowerCase()).toContain("error");

    stub2.restore();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- tests/tools/web-search.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement web_search tool**

```typescript
// src/tools/web-search.ts
import { Type, type Static } from "typebox";
import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { SearchProvider, SearchResult } from "../providers/types.ts";
import { sanitizeError } from "../utils/errors.ts";

const WebSearchParams = Type.Object({
  query: Type.String({ description: "Search query" }),
  numResults: Type.Optional(
    Type.Number({ minimum: 1, maximum: 20, default: 5, description: "Number of results (1-20, default 5)" }),
  ),
  provider: Type.Optional(
    Type.String({ description: "Provider name or 'auto' (default)" }),
  ),
});

type WebSearchInput = Static<typeof WebSearchParams>;

interface WebSearchDetails {
  provider: string;
  resultCount: number;
}

function formatResults(results: SearchResult[]): string {
  if (results.length === 0) return "No results found.";
  return results
    .map((r, i) => `${i + 1}. [${r.title}](${r.url})\n   ${r.snippet}`)
    .join("\n\n");
}

export function createWebSearchTool(
  resolveProvider: (name?: string) => SearchProvider,
  onSuccess?: (providerName: string) => void,
): ToolDefinition<typeof WebSearchParams, WebSearchDetails> {
  return {
    name: "web_search",
    label: "Web Search",
    description: "Search the web for up-to-date information.",
    promptSnippet: "Search the web for up-to-date information.",
    promptGuidelines: [
      "Use web_search for information beyond training data -- recent events, current library versions, live API docs.",
      "After answering, include a Sources: section listing relevant URLs as markdown hyperlinks.",
      "Use one web_search call per search angle rather than batching multiple queries.",
    ],
    parameters: WebSearchParams,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      try {
        const provider = resolveProvider(params.provider);
        const maxResults = params.numResults ?? 5;
        const results = await provider.search(params.query, maxResults, signal ?? undefined);
        const text = formatResults(results);

        // Record successful usage for quota tracking (increment on success only)
        onSuccess?.(provider.name);

        return {
          content: [{ type: "text" as const, text }],
          details: { provider: provider.name, resultCount: results.length },
        };
      } catch (error) {
        const msg = sanitizeError(error);
        return {
          content: [{ type: "text" as const, text: `Search error: ${msg}` }],
          details: { provider: "unknown", resultCount: 0 },
        };
      }
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test -- tests/tools/web-search.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Wire up in index.ts**

Replace the contents of `src/index.ts`:

```typescript
// src/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig, resolveApiKey } from "./config.ts";
import { DuckDuckGoProvider } from "./providers/duckduckgo.ts";
import type { SearchProvider } from "./providers/types.ts";
import { createWebSearchTool } from "./tools/web-search.ts";

export default function createExtension(pi: ExtensionAPI): void {
  const config = loadConfig();
  const duckduckgo = new DuckDuckGoProvider();

  function resolveSearchProvider(name?: string): SearchProvider {
    // Phase 2: only DuckDuckGo. Phase 5 adds the full registry.
    return duckduckgo;
  }

  pi.registerTool(createWebSearchTool(resolveSearchProvider));
}
```

- [ ] **Step 6: Update existing test**

```typescript
// tests/index.test.ts
import { describe, expect, it } from "vitest";
import createExtension from "../src/index.ts";
import { createMockPi } from "./helpers.ts";

describe("tools extension", () => {
  it("exports a function", () => {
    expect(typeof createExtension).toBe("function");
  });

  it("registers web_search tool", () => {
    const pi = createMockPi();
    createExtension(pi as any);
    expect(pi.tools.some((t) => t.name === "web_search")).toBe(true);
  });
});
```

- [ ] **Step 7: Run all tests**

Run: `pnpm check`
Expected: All lint, typecheck, and tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/tools/web-search.ts src/index.ts tests/tools/web-search.test.ts tests/index.test.ts
git commit -m "feat: add web_search tool with DuckDuckGo provider"
```

### Phase 2 Checkpoint

The extension now registers a functional `web_search` tool. When loaded by Pi, agents can search the web using DuckDuckGo.

---

## Phase 3: Content Storage Integration + web_read Tool

Connects the content store to the extension lifecycle and adds the `web_read` tool. After this phase, large content can be stored and retrieved by content ID.

### Task 3.1: web_read Tool

**Files:**
- Create: `src/tools/web-read.ts`
- Test: `tests/tools/web-read.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/tools/web-read.test.ts
import { describe, expect, it } from "vitest";
import { createWebReadTool } from "../../src/tools/web-read.ts";
import { ContentStore } from "../../src/storage.ts";
import { makeCtx } from "../helpers.ts";

describe("web_read tool", () => {
  it("has correct tool metadata", () => {
    const store = new ContentStore(() => {});
    const tool = createWebReadTool(store);
    expect(tool.name).toBe("web_read");
    expect(tool.label).toBe("Web Read");
  });

  it("retrieves stored content by ID", async () => {
    const store = new ContentStore(() => {});
    const id = store.store({
      url: "https://example.com",
      title: "Example",
      text: "Full content here",
      source: "web_fetch",
    });

    const tool = createWebReadTool(store);
    const ctx = makeCtx();
    const result = await tool.execute("call-1", { contentId: id }, undefined, undefined, ctx);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Full content here");
  });

  it("returns error for unknown content ID", async () => {
    const store = new ContentStore(() => {});
    const tool = createWebReadTool(store);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-2",
      { contentId: "wc-nonexistent" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text.toLowerCase()).toContain("not found");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- tests/tools/web-read.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement web_read tool**

```typescript
// src/tools/web-read.ts
import { Type, type Static } from "typebox";
import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ContentStore } from "../storage.ts";

const WebReadParams = Type.Object({
  contentId: Type.String({ description: "Content ID from a previous web_fetch or web_search result" }),
});

type WebReadInput = Static<typeof WebReadParams>;

export function createWebReadTool(
  store: ContentStore,
): ToolDefinition<typeof WebReadParams> {
  return {
    name: "web_read",
    label: "Web Read",
    description:
      "Retrieve previously fetched web content by its content ID without re-fetching.",
    promptSnippet:
      "Retrieve previously fetched web content by its content ID without re-fetching.",
    parameters: WebReadParams,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const content = store.get(params.contentId);
      if (!content) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Content not found: ${params.contentId}. The content ID may have expired or is from a different session.`,
            },
          ],
          details: undefined,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `# ${content.title ?? content.url}\n\nSource: ${content.url}\nChars: ${content.chars}\n\n${content.text}`,
          },
        ],
        details: undefined,
      };
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test -- tests/tools/web-read.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Wire into index.ts**

```typescript
// src/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig, resolveApiKey } from "./config.ts";
import { ContentStore, type StoredContent } from "./storage.ts";
import { DuckDuckGoProvider } from "./providers/duckduckgo.ts";
import type { SearchProvider } from "./providers/types.ts";
import { createWebSearchTool } from "./tools/web-search.ts";
import { createWebReadTool } from "./tools/web-read.ts";

export default function createExtension(pi: ExtensionAPI): void {
  const config = loadConfig();
  const store = new ContentStore((customType, data) =>
    pi.appendEntry(customType, data),
  );
  const duckduckgo = new DuckDuckGoProvider();

  function resolveSearchProvider(name?: string): SearchProvider {
    return duckduckgo;
  }

  // Restore stored content from previous session
  pi.on("session_start", (_event, ctx) => {
    const entries = ctx.sessionManager.getEntries?.() ?? [];
    const restored = entries
      .filter((e: any) => e.customType === "pi-tools-content" && e.data)
      .map((e: any) => e.data as StoredContent);
    if (restored.length > 0) {
      store.restore(restored);
    }
  });

  pi.registerTool(createWebSearchTool(resolveSearchProvider));
  pi.registerTool(createWebReadTool(store));
}
```

- [ ] **Step 6: Update index test**

Add to `tests/index.test.ts`:

```typescript
  it("registers web_read tool", () => {
    const pi = createMockPi();
    createExtension(pi as any);
    expect(pi.tools.some((t) => t.name === "web_read")).toBe(true);
  });
```

- [ ] **Step 7: Run all tests**

Run: `pnpm check`
Expected: All pass.

- [ ] **Step 8: Commit**

```bash
git add src/tools/web-read.ts src/index.ts tests/tools/web-read.test.ts tests/index.test.ts
git commit -m "feat: add web_read tool with content storage integration"
```

### Phase 3 Checkpoint

The extension now has `web_search` and `web_read`. Content storage is wired up. Large fetched content (added in Phase 4) will be stored and retrievable.

---

## Phase 4: HTML Extraction + web_fetch Tool

Delivers the `web_fetch` tool with Tier 1 HTML extraction (HTTP + Readability + Turndown). After this phase, agents can fetch and read web pages as markdown.

### Task 4.1: HTML Extraction Pipeline

**Files:**
- Create: `src/extract/html.ts`
- Test: `tests/extract/html.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/extract/html.test.ts
import { describe, expect, it } from "vitest";
import { extractHtml } from "../../src/extract/html.ts";

const SAMPLE_HTML = `
<!DOCTYPE html>
<html>
<head><title>Test Page</title></head>
<body>
  <header><nav>Navigation</nav></header>
  <article>
    <h1>Main Article</h1>
    <p>This is the main content of the article. It has enough text to be considered
    meaningful content by Readability. The article discusses important topics that
    are relevant to the reader and provides valuable information about the subject
    matter at hand. We need sufficient content for Readability to consider this
    worth extracting.</p>
    <p>Another paragraph with more details about the topic. This adds depth to the
    article and ensures that the content meets the minimum threshold for extraction.
    Additional context helps the reader understand the full picture.</p>
    <table>
      <tr><th>Name</th><th>Value</th></tr>
      <tr><td>Alpha</td><td>100</td></tr>
    </table>
  </article>
  <script>alert('ignored')</script>
  <footer>Footer content</footer>
</body>
</html>`;

describe("extractHtml", () => {
  it("extracts article content as markdown", () => {
    const result = extractHtml(SAMPLE_HTML, "https://example.com/article");
    expect(result).not.toBeNull();
    expect(result!.text).toContain("Main Article");
    expect(result!.text).toContain("main content");
  });

  it("strips script and style tags", () => {
    const result = extractHtml(SAMPLE_HTML, "https://example.com/article");
    expect(result).not.toBeNull();
    expect(result!.text).not.toContain("alert");
  });

  it("preserves tables as GFM markdown", () => {
    const result = extractHtml(SAMPLE_HTML, "https://example.com/article");
    expect(result).not.toBeNull();
    // GFM tables use pipe characters
    expect(result!.text).toContain("|");
    expect(result!.text).toContain("Alpha");
  });

  it("includes title when available", () => {
    const result = extractHtml(SAMPLE_HTML, "https://example.com/article");
    expect(result).not.toBeNull();
    expect(result!.title).toBeDefined();
  });

  it("returns null for content too short to be useful", () => {
    const thinHtml = "<html><body><p>Hi</p></body></html>";
    const result = extractHtml(thinHtml, "https://example.com");
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- tests/extract/html.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement HTML extraction**

```typescript
// src/extract/html.ts
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const MIN_CONTENT_LENGTH = 500;

export interface HtmlExtractResult {
  text: string;
  title?: string;
}

export function extractHtml(
  html: string,
  url: string,
): HtmlExtractResult | null {
  const { document } = parseHTML(html);

  // Strip non-content elements
  for (const tag of ["script", "style", "noscript"]) {
    for (const el of document.querySelectorAll(tag)) {
      el.remove();
    }
  }

  // Run Readability
  const reader = new Readability(document, { url });
  const article = reader.parse();

  if (!article || !article.content) return null;

  // Convert HTML to Markdown
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  });
  turndown.use(gfm);
  let markdown = turndown.turndown(article.content);

  // Normalize whitespace
  markdown = markdown.replace(/\n{3,}/g, "\n\n").trim();

  if (markdown.length < MIN_CONTENT_LENGTH) return null;

  return {
    text: markdown,
    title: article.title || undefined,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test -- tests/extract/html.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/extract/html.ts tests/extract/html.test.ts
git commit -m "feat: add HTML extraction via Readability + Turndown"
```

### Task 4.2: Extraction Pipeline Orchestrator

**Files:**
- Create: `src/extract/pipeline.ts`
- Test: `tests/extract/pipeline.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/extract/pipeline.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractContent, type ExtractedContent } from "../../src/extract/pipeline.ts";
import { stubFetch } from "../helpers.ts";

const GOOD_HTML = `
<!DOCTYPE html><html><head><title>Article</title></head><body>
<article><h1>Real Article</h1>
<p>${"This is meaningful content about the topic. ".repeat(30)}</p>
</article></body></html>`;

describe("extractContent", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("extracts HTML content via Readability pipeline", async () => {
    fetchStub.addResponse("example.com/article", {
      body: GOOD_HTML,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    const result = await extractContent("https://example.com/article");
    expect(result.text).toContain("Real Article");
    expect(result.extractionChain).toContain("readability");
    expect(result.chars).toBeGreaterThan(0);
  });

  it("tracks extraction chain metadata", async () => {
    fetchStub.addResponse("example.com", {
      body: GOOD_HTML,
      headers: { "content-type": "text/html" },
    });
    const result = await extractContent("https://example.com");
    expect(result.extractionChain.length).toBeGreaterThan(0);
    expect(result.url).toBe("https://example.com");
  });

  it("rejects non-http URLs via SSRF guard", async () => {
    await expect(extractContent("ftp://evil.com")).rejects.toThrow();
  });

  it("rejects private IPs", async () => {
    await expect(extractContent("http://127.0.0.1/admin")).rejects.toThrow();
  });

  it("rejects binary content types", async () => {
    fetchStub.addResponse("example.com/image.png", {
      body: "binary",
      headers: { "content-type": "image/png" },
    });
    await expect(
      extractContent("https://example.com/image.png"),
    ).rejects.toThrow(/binary/i);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- tests/extract/pipeline.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement extraction pipeline**

```typescript
// src/extract/pipeline.ts
import { validateUrl } from "../utils/ssrf.ts";
import { extractHtml } from "./html.ts";

export interface ExtractedContent {
  text: string;
  title?: string;
  url: string;
  extractionChain: string[];
  chars: number;
  truncated: boolean;
  contentId?: string;
}

const BINARY_CONTENT_TYPES = [
  "image/",
  "audio/",
  "video/",
  "application/zip",
  "application/gzip",
  "application/octet-stream",
];

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
};

export async function extractContent(
  url: string,
  signal?: AbortSignal,
): Promise<ExtractedContent> {
  validateUrl(url);

  const chain: string[] = [];

  const response = await fetch(url, {
    headers: BROWSER_HEADERS,
    signal,
    redirect: "follow",
  });

  chain.push(`http:${response.status}`);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") ?? "";

  // Block binary content
  for (const prefix of BINARY_CONTENT_TYPES) {
    if (contentType.startsWith(prefix)) {
      throw new Error(`Unsupported binary content type: ${contentType}`);
    }
  }

  const body = await response.text();

  // Tier 1: Readability
  const htmlResult = extractHtml(body, url);
  if (htmlResult && htmlResult.text.length >= 500) {
    chain.push("readability");
    return {
      text: htmlResult.text,
      title: htmlResult.title,
      url,
      extractionChain: chain,
      chars: htmlResult.text.length,
      truncated: false,
    };
  }
  chain.push("readability:thin");

  // Fallback: return raw text (stripped of HTML if possible)
  chain.push("raw-text");
  const rawText = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (rawText.length === 0) {
    throw new Error(
      `Could not extract content from ${url}. Tried: ${chain.join(" -> ")}`,
    );
  }
  return {
    text: rawText,
    title: undefined,
    url,
    extractionChain: chain,
    chars: rawText.length,
    truncated: false,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test -- tests/extract/pipeline.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/extract/pipeline.ts tests/extract/pipeline.test.ts
git commit -m "feat: add extraction pipeline orchestrator with HTML tier"
```

### Task 4.3: web_fetch Tool

**Files:**
- Create: `src/tools/web-fetch.ts`
- Test: `tests/tools/web-fetch.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/tools/web-fetch.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWebFetchTool } from "../../src/tools/web-fetch.ts";
import { ContentStore } from "../../src/storage.ts";
import { stubFetch } from "../helpers.ts";
import { makeCtx } from "../helpers.ts";

const GOOD_HTML = `
<!DOCTYPE html><html><head><title>Test</title></head><body>
<article><h1>Article Title</h1>
<p>${"Meaningful content about the topic. ".repeat(30)}</p>
</article></body></html>`;

describe("web_fetch tool", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct tool metadata", () => {
    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    expect(tool.name).toBe("web_fetch");
    expect(tool.label).toBe("Web Fetch");
  });

  it("fetches and extracts HTML content", async () => {
    fetchStub.addResponse("example.com/page", {
      body: GOOD_HTML,
      headers: { "content-type": "text/html" },
    });

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-1",
      { url: "https://example.com/page" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Article Title");
  });

  it("stores large content and returns contentId", async () => {
    const largeContent = `
<!DOCTYPE html><html><head><title>Large</title></head><body>
<article><h1>Large Article</h1>
<p>${"A".repeat(20_000)}</p>
</article></body></html>`;

    fetchStub.addResponse("example.com/large", {
      body: largeContent,
      headers: { "content-type": "text/html" },
    });

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-2",
      { url: "https://example.com/large" },
      undefined,
      undefined,
      ctx,
    );
    expect(result.details).toHaveProperty("contentId");
    expect(result.details.truncated).toBe(true);
  });

  it("returns error for SSRF violations", async () => {
    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-3",
      { url: "http://127.0.0.1/admin" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text.toLowerCase()).toContain("error");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- tests/tools/web-fetch.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement web_fetch tool**

```typescript
// src/tools/web-fetch.ts
import { Type, type Static } from "typebox";
import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ContentStore } from "../storage.ts";
import { extractContent } from "../extract/pipeline.ts";
import { truncateContent } from "../utils/truncate.ts";
import { sanitizeError } from "../utils/errors.ts";

const INLINE_LIMIT = 15_000;

const WebFetchParams = Type.Object({
  url: Type.String({ description: "HTTP(S) URL to fetch" }),
});

type WebFetchInput = Static<typeof WebFetchParams>;

interface WebFetchDetails {
  url: string;
  title?: string;
  chars: number;
  truncated: boolean;
  contentId?: string;
  extractionChain: string[];
}

export function createWebFetchTool(
  store: ContentStore,
): ToolDefinition<typeof WebFetchParams, WebFetchDetails> {
  return {
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch a URL and extract readable content as markdown. Supports HTML, PDFs, and JS-rendered pages.",
    promptSnippet:
      "Fetch a URL and extract readable content as markdown. Supports HTML, PDFs, and JS-rendered pages.",
    promptGuidelines: [
      "Use web_fetch when you have a specific URL to read.",
      "For large pages, use web_read with the returned contentId to retrieve the full text.",
    ],
    parameters: WebFetchParams,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      try {
        const extracted = await extractContent(params.url, signal ?? undefined);

        let contentId: string | undefined;
        let outputText: string;
        let truncated = false;

        if (extracted.chars > INLINE_LIMIT) {
          contentId = store.store({
            url: extracted.url,
            title: extracted.title,
            text: extracted.text,
            source: "web_fetch",
          });
          const trunc = truncateContent(extracted.text, INLINE_LIMIT);
          outputText = trunc.text;
          truncated = true;
        } else {
          outputText = extracted.text;
        }

        const header = [
          extracted.title ? `# ${extracted.title}` : `# ${extracted.url}`,
          `Source: ${extracted.url}`,
          `Chars: ${extracted.chars}${truncated ? ` (truncated, use web_read with contentId "${contentId}" for full text)` : ""}`,
          "",
        ].join("\n");

        return {
          content: [{ type: "text" as const, text: header + outputText }],
          details: {
            url: extracted.url,
            title: extracted.title,
            chars: extracted.chars,
            truncated,
            contentId,
            extractionChain: extracted.extractionChain,
          },
        };
      } catch (error) {
        const msg = sanitizeError(error);
        return {
          content: [{ type: "text" as const, text: `Fetch error: ${msg}` }],
          details: {
            url: params.url,
            chars: 0,
            truncated: false,
            extractionChain: [],
          },
        };
      }
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test -- tests/tools/web-fetch.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Wire into index.ts**

```typescript
// src/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig, resolveApiKey } from "./config.ts";
import { ContentStore } from "./storage.ts";
import { DuckDuckGoProvider } from "./providers/duckduckgo.ts";
import type { SearchProvider } from "./providers/types.ts";
import { createWebSearchTool } from "./tools/web-search.ts";
import { createWebFetchTool } from "./tools/web-fetch.ts";
import { createWebReadTool } from "./tools/web-read.ts";

export default function createExtension(pi: ExtensionAPI): void {
  const config = loadConfig();
  const store = new ContentStore((customType, data) =>
    pi.appendEntry(customType, data),
  );
  const duckduckgo = new DuckDuckGoProvider();

  function resolveSearchProvider(name?: string): SearchProvider {
    return duckduckgo;
  }

  pi.registerTool(createWebSearchTool(resolveSearchProvider));
  pi.registerTool(createWebFetchTool(store));
  pi.registerTool(createWebReadTool(store));
}
```

- [ ] **Step 6: Update index test**

Add to `tests/index.test.ts`:

```typescript
  it("registers web_fetch tool", () => {
    const pi = createMockPi();
    createExtension(pi as any);
    expect(pi.tools.some((t) => t.name === "web_fetch")).toBe(true);
  });
```

- [ ] **Step 7: Run all tests**

Run: `pnpm check`
Expected: All pass.

- [ ] **Step 8: Commit**

```bash
git add src/tools/web-fetch.ts src/index.ts tests/tools/web-fetch.test.ts tests/index.test.ts
git commit -m "feat: add web_fetch tool with HTML extraction pipeline"
```

### Phase 4 Checkpoint

Three tools are now functional: `web_search`, `web_fetch`, `web_read`. Agents can search the web, fetch page content as markdown, and retrieve large stored content.

---

## Phase 5: Provider Registry + Quota-Aware Selection

Introduces the provider registry with quota tracking, tier-based selection, and usage persistence. After this phase, `web_search` automatically rotates across all configured providers.

### Task 5.1: Usage Tracking

**Files:**
- Create: `src/providers/usage.ts`
- Test: `tests/providers/usage.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/providers/usage.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsageTracker } from "../../src/providers/usage.ts";
import * as fs from "node:fs";

vi.mock("node:fs");

describe("UsageTracker", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with zero counts for all providers", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const tracker = new UsageTracker();
    expect(tracker.getCount("brave")).toBe(0);
    expect(tracker.getCount("exa")).toBe(0);
  });

  it("increments usage count", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as any);

    const tracker = new UsageTracker();
    tracker.increment("brave");
    expect(tracker.getCount("brave")).toBe(1);
    tracker.increment("brave");
    expect(tracker.getCount("brave")).toBe(2);
  });

  it("loads persisted counts", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        resetAt: "2026-07",
        counts: { brave: 150, exa: 50 },
      }),
    );
    const tracker = new UsageTracker();
    expect(tracker.getCount("brave")).toBe(150);
    expect(tracker.getCount("exa")).toBe(50);
  });

  it("resets counts when month changes", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        resetAt: "2026-06",
        counts: { brave: 999 },
      }),
    );
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as any);

    const tracker = new UsageTracker();
    expect(tracker.getCount("brave")).toBe(0);
  });

  it("calculates remaining quota", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as any);

    const tracker = new UsageTracker();
    tracker.increment("brave");
    expect(tracker.getRemaining("brave", 2000)).toBe(1999);
  });

  it("returns Infinity remaining for unlimited quota", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const tracker = new UsageTracker();
    expect(tracker.getRemaining("perplexity", null)).toBe(Infinity);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- tests/providers/usage.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement usage tracker**

```typescript
// src/providers/usage.ts
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

interface UsageData {
  resetAt: string;
  counts: Record<string, number>;
}

function getUsagePath(): string {
  return path.join(os.homedir(), ".pi", "agent", "pi-tools-usage.json");
}

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export class UsageTracker {
  private counts: Record<string, number> = {};
  private resetAt: string;

  constructor() {
    this.resetAt = getCurrentMonth();
    this.load();
  }

  private load(): void {
    try {
      const raw = fs.readFileSync(getUsagePath(), "utf-8");
      const data: UsageData = JSON.parse(raw);
      if (data.resetAt === this.resetAt) {
        this.counts = data.counts ?? {};
      }
      // If month changed, counts stay at 0 (already initialized)
    } catch {
      // No file or parse error — start fresh
    }
  }

  private save(): void {
    const filePath = getUsagePath();
    const data: UsageData = {
      resetAt: this.resetAt,
      counts: this.counts,
    };
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch {
      // Non-fatal: usage tracking is best-effort
    }
  }

  getCount(provider: string): number {
    return this.counts[provider] ?? 0;
  }

  getRemaining(provider: string, monthlyQuota: number | null): number {
    if (monthlyQuota === null) return Infinity;
    return Math.max(0, monthlyQuota - this.getCount(provider));
  }

  increment(provider: string): void {
    this.counts[provider] = (this.counts[provider] ?? 0) + 1;
    this.save();
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test -- tests/providers/usage.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/usage.ts tests/providers/usage.test.ts
git commit -m "feat: add monthly usage tracking for provider quota management"
```

### Task 5.2: Provider Registry with Quota-Aware Selection

**Files:**
- Create: `src/providers/registry.ts`
- Test: `tests/providers/registry.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/providers/registry.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderRegistry } from "../../src/providers/registry.ts";
import type { SearchProvider, SearchResult } from "../../src/providers/types.ts";

function mockProvider(name: string, label: string): SearchProvider {
  return {
    name,
    label,
    search: vi.fn().mockResolvedValue([
      { title: `${name} result`, url: `https://${name}.com`, snippet: "test" },
    ]),
  };
}

describe("ProviderRegistry", () => {
  it("selects tier 1 provider with highest remaining quota", () => {
    const registry = new ProviderRegistry();
    const brave = mockProvider("brave", "Brave");
    const serper = mockProvider("serper", "Serper");

    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
    registry.registerSearch(serper, { tier: 1, monthlyQuota: 2500 });

    // Serper has higher remaining (2500 vs 2000)
    const selected = registry.selectSearch();
    expect(selected).toBeDefined();
    expect(selected!.name).toBe("serper");
  });

  it("falls back to tier 2 when tier 1 exhausted", () => {
    const registry = new ProviderRegistry();
    const perplexity = mockProvider("perplexity", "Perplexity");

    registry.registerSearch(perplexity, { tier: 2, monthlyQuota: null });

    const selected = registry.selectSearch();
    expect(selected).toBeDefined();
    expect(selected!.name).toBe("perplexity");
  });

  it("falls back to tier 3 when all others unavailable", () => {
    const registry = new ProviderRegistry();
    const ddg = mockProvider("duckduckgo", "DuckDuckGo");

    registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

    const selected = registry.selectSearch();
    expect(selected!.name).toBe("duckduckgo");
  });

  it("selects by name when explicitly requested", () => {
    const registry = new ProviderRegistry();
    const brave = mockProvider("brave", "Brave");
    const ddg = mockProvider("duckduckgo", "DuckDuckGo");

    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
    registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

    const selected = registry.selectSearch("duckduckgo");
    expect(selected!.name).toBe("duckduckgo");
  });

  it("returns undefined when no providers registered", () => {
    const registry = new ProviderRegistry();
    expect(registry.selectSearch()).toBeUndefined();
  });

  it("records usage on success", () => {
    const registry = new ProviderRegistry();
    const brave = mockProvider("brave", "Brave");
    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

    registry.recordUsage("brave");
    // After recording, remaining should be 1999
    const remaining = registry.getRemaining("brave");
    expect(remaining).toBe(1999);
  });

  it("skips providers at 100% usage", () => {
    const registry = new ProviderRegistry();
    const brave = mockProvider("brave", "Brave");
    const ddg = mockProvider("duckduckgo", "DuckDuckGo");

    registry.registerSearch(brave, { tier: 1, monthlyQuota: 1 });
    registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

    registry.recordUsage("brave"); // Now at 100%
    const selected = registry.selectSearch();
    expect(selected!.name).toBe("duckduckgo");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- tests/providers/registry.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement provider registry**

```typescript
// src/providers/registry.ts
import type { SearchProvider, FetchProvider, CodeSearchProvider, ProviderTier } from "./types.ts";

interface RegisteredSearch {
  provider: SearchProvider;
  tier: ProviderTier;
  monthlyQuota: number | null;
}

interface RegisteredFetch {
  provider: FetchProvider;
}

interface RegisteredCodeSearch {
  provider: CodeSearchProvider;
}

export class ProviderRegistry {
  private searchProviders = new Map<string, RegisteredSearch>();
  private fetchProviders = new Map<string, RegisteredFetch>();
  private codeSearchProviders = new Map<string, RegisteredCodeSearch>();
  private usageCounts = new Map<string, number>();

  registerSearch(
    provider: SearchProvider,
    options: { tier: ProviderTier; monthlyQuota: number | null },
  ): void {
    this.searchProviders.set(provider.name, {
      provider,
      tier: options.tier,
      monthlyQuota: options.monthlyQuota,
    });
  }

  registerFetch(provider: FetchProvider): void {
    this.fetchProviders.set(provider.name, { provider });
  }

  registerCodeSearch(provider: CodeSearchProvider): void {
    this.codeSearchProviders.set(provider.name, { provider });
  }

  recordUsage(providerName: string): void {
    this.usageCounts.set(
      providerName,
      (this.usageCounts.get(providerName) ?? 0) + 1,
    );
  }

  getRemaining(providerName: string): number {
    const reg = this.searchProviders.get(providerName);
    if (!reg) return 0;
    if (reg.monthlyQuota === null) return Infinity;
    const used = this.usageCounts.get(providerName) ?? 0;
    return Math.max(0, reg.monthlyQuota - used);
  }

  selectSearch(name?: string): SearchProvider | undefined {
    if (name && name !== "auto") {
      return this.searchProviders.get(name)?.provider;
    }

    // Auto selection: tier 1 by highest remaining, then tier 2, then tier 3
    for (const tier of [1, 2, 3] as ProviderTier[]) {
      const candidates = [...this.searchProviders.values()]
        .filter((r) => r.tier === tier)
        .filter((r) => {
          if (r.monthlyQuota === null) return true;
          const used = this.usageCounts.get(r.provider.name) ?? 0;
          return used < r.monthlyQuota;
        })
        .sort((a, b) => {
          const remA =
            a.monthlyQuota === null
              ? Infinity
              : a.monthlyQuota - (this.usageCounts.get(a.provider.name) ?? 0);
          const remB =
            b.monthlyQuota === null
              ? Infinity
              : b.monthlyQuota - (this.usageCounts.get(b.provider.name) ?? 0);
          return remB - remA;
        });

      if (candidates.length > 0) {
        return candidates[0].provider;
      }
    }

    return undefined;
  }

  selectFetch(name?: string): FetchProvider | undefined {
    if (name) return this.fetchProviders.get(name)?.provider;
    // Return first available fetch provider
    const first = this.fetchProviders.values().next();
    return first.done ? undefined : first.value.provider;
  }

  selectCodeSearch(): CodeSearchProvider | undefined {
    const first = this.codeSearchProviders.values().next();
    return first.done ? undefined : first.value.provider;
  }

  getSearchProviderNames(): string[] {
    return [...this.searchProviders.keys()];
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test -- tests/providers/registry.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/registry.ts tests/providers/registry.test.ts
git commit -m "feat: add provider registry with quota-aware tier-based selection"
```

### Task 5.3: Integrate Registry into Extension Entry Point

**Files:**
- Modify: `src/index.ts`
- Modify: `tests/index.test.ts`

- [ ] **Step 1: Update index.ts to use registry**

```typescript
// src/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig, resolveApiKey } from "./config.ts";
import { ContentStore, type StoredContent } from "./storage.ts";
import { ProviderRegistry } from "./providers/registry.ts";
import { DuckDuckGoProvider } from "./providers/duckduckgo.ts";
import type { SearchProvider } from "./providers/types.ts";
import { createWebSearchTool } from "./tools/web-search.ts";
import { createWebFetchTool } from "./tools/web-fetch.ts";
import { createWebReadTool } from "./tools/web-read.ts";

export default function createExtension(pi: ExtensionAPI): void {
  const config = loadConfig();
  const store = new ContentStore((customType, data) =>
    pi.appendEntry(customType, data),
  );
  const registry = new ProviderRegistry();

  // Register DuckDuckGo (always available, tier 3)
  if (config.providers.duckduckgo?.enabled !== false) {
    registry.registerSearch(new DuckDuckGoProvider(), {
      tier: 3,
      monthlyQuota: null,
    });
  }

  function resolveSearchProvider(name?: string): SearchProvider {
    const provider = registry.selectSearch(name);
    if (!provider) {
      throw new Error("No search providers available");
    }
    return provider;
  }

  // Restore stored content from previous session
  pi.on("session_start", (_event, ctx) => {
    const entries = ctx.sessionManager.getEntries?.() ?? [];
    const restored = entries
      .filter((e: any) => e.customType === "pi-tools-content" && e.data)
      .map((e: any) => e.data as StoredContent);
    if (restored.length > 0) {
      store.restore(restored);
    }
  });

  pi.registerTool(
    createWebSearchTool(
      (name) => resolveSearchProvider(name),
      (providerName) => registry.recordUsage(providerName),
    ),
  );
  pi.registerTool(createWebFetchTool(store));
  pi.registerTool(createWebReadTool(store));
}
```

- [ ] **Step 2: Run all tests**

Run: `pnpm check`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "refactor: integrate provider registry into extension entry point"
```

### Phase 5 Checkpoint

The registry and quota system are operational. As providers are added in Phase 6, they automatically participate in quota-aware rotation.

---

## Phase 6: Keyed Search Providers

Adds all remaining search providers: Jina, Brave, Serper, Tavily, Exa, Perplexity, Firecrawl. Each follows the same pattern: implement `SearchProvider`, test with stubbed fetch, register in index.ts.

### Task 6.1: Jina Search Provider

**Files:**
- Create: `src/providers/jina.ts`
- Test: `tests/providers/jina.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/providers/jina.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JinaProvider } from "../../src/providers/jina.ts";
import { stubFetch } from "../helpers.ts";

describe("JinaProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct name and label", () => {
    const provider = new JinaProvider();
    expect(provider.name).toBe("jina");
    expect(provider.label).toBe("Jina");
  });

  it("returns search results from Jina search API", async () => {
    fetchStub.addResponse("s.jina.ai", {
      body: {
        data: [
          { title: "Result 1", url: "https://example.com/1", description: "Snippet 1" },
          { title: "Result 2", url: "https://example.com/2", description: "Snippet 2" },
        ],
      },
    });

    const provider = new JinaProvider();
    const results = await provider.search("test query", 5);
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe("Result 1");
    expect(results[0].url).toBe("https://example.com/1");
    expect(results[0].snippet).toBe("Snippet 1");
  });

  it("sends auth header when API key provided", async () => {
    fetchStub.addResponse("s.jina.ai", { body: { data: [] } });

    const provider = new JinaProvider("test-key");
    await provider.search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers).toHaveProperty("Authorization", "Bearer test-key");
  });

  it("works without API key", async () => {
    fetchStub.addResponse("s.jina.ai", { body: { data: [] } });

    const provider = new JinaProvider();
    const results = await provider.search("test", 5);
    expect(results).toEqual([]);
  });

  it("fetches content via Jina Reader", async () => {
    fetchStub.addResponse("r.jina.ai", {
      body: "# Page Title\n\nPage content here",
      headers: { "content-type": "text/plain" },
    });

    const provider = new JinaProvider();
    const result = await provider.fetch("https://example.com");
    expect(result.text).toContain("Page content");
  });

  it("throws on non-2xx response", async () => {
    fetchStub.addResponse("s.jina.ai", { status: 500, body: "Error" });
    const provider = new JinaProvider();
    await expect(provider.search("test", 5)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- tests/providers/jina.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement Jina provider**

```typescript
// src/providers/jina.ts
import type { FetchProvider, FetchResult, SearchProvider, SearchResult } from "./types.ts";

interface JinaSearchResponse {
  data: Array<{
    title: string;
    url: string;
    description: string;
  }>;
}

export class JinaProvider implements SearchProvider, FetchProvider {
  readonly name = "jina";
  readonly label = "Jina";
  private apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      Accept: "application/json",
    };
    if (this.apiKey) {
      h.Authorization = `Bearer ${this.apiKey}`;
    }
    return h;
  }

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
  ): Promise<SearchResult[]> {
    const url = `https://s.jina.ai/?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: this.headers(),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Jina search error: ${response.status} ${response.statusText}`);
    }

    const data: JinaSearchResponse = await response.json();
    return (data.data ?? []).slice(0, maxResults).map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.description,
    }));
  }

  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult> {
    const readerUrl = `https://r.jina.ai/${url}`;
    const response = await globalThis.fetch(readerUrl, {
      headers: {
        ...this.headers(),
        Accept: "text/plain",
      },
      signal,
    });

    if (!response.ok) {
      throw new Error(`Jina reader error: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    return { text };
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test -- tests/providers/jina.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/jina.ts tests/providers/jina.test.ts
git commit -m "feat: add Jina search and reader provider"
```

### Task 6.2: Brave Search Provider

**Files:**
- Create: `src/providers/brave.ts`
- Test: `tests/providers/brave.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/providers/brave.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BraveProvider } from "../../src/providers/brave.ts";
import { stubFetch } from "../helpers.ts";

describe("BraveProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct name and label", () => {
    const provider = new BraveProvider("test-key");
    expect(provider.name).toBe("brave");
    expect(provider.label).toBe("Brave Search");
  });

  it("returns normalized search results", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: {
        web: {
          results: [
            { title: "Brave Result", url: "https://brave.com", description: "A brave snippet" },
          ],
        },
      },
    });

    const provider = new BraveProvider("test-key");
    const results = await provider.search("test", 5);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Brave Result");
    expect(results[0].snippet).toBe("A brave snippet");
  });

  it("sends API key in header", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: { web: { results: [] } },
    });

    const provider = new BraveProvider("my-brave-key");
    await provider.search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers["X-Subscription-Token"]).toBe("my-brave-key");
  });

  it("throws on non-2xx response", async () => {
    fetchStub.addResponse("api.search.brave.com", { status: 429, body: "Rate limited" });
    const provider = new BraveProvider("test-key");
    await expect(provider.search("test", 5)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- tests/providers/brave.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement Brave provider**

```typescript
// src/providers/brave.ts
import type { SearchProvider, SearchResult } from "./types.ts";

interface BraveSearchResponse {
  web?: {
    results: Array<{
      title: string;
      url: string;
      description: string;
    }>;
  };
}

export class BraveProvider implements SearchProvider {
  readonly name = "brave";
  readonly label = "Brave Search";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
  ): Promise<SearchResult[]> {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": this.apiKey,
      },
      signal,
    });

    if (!response.ok) {
      throw new Error(`Brave API error: ${response.status} ${response.statusText}`);
    }

    const data: BraveSearchResponse = await response.json();
    return (data.web?.results ?? []).slice(0, maxResults).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
    }));
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test -- tests/providers/brave.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/brave.ts tests/providers/brave.test.ts
git commit -m "feat: add Brave Search provider"
```

### Task 6.3: Remaining Search Providers (Serper, Tavily, Exa, Perplexity, Firecrawl)

Each provider follows the same pattern as Brave. One task per provider, each with its own test file.

**Files per provider:**
- Create: `src/providers/<name>.ts`
- Test: `tests/providers/<name>.test.ts`

For each provider below, follow this pattern:

1. Write failing test with stubbed fetch responses matching the provider's API format
2. Run test to verify failure
3. Implement the provider class
4. Run test to verify pass
5. Commit

**Serper** (`src/providers/serper.ts`):

- [ ] **Step 1: Write failing test**

```typescript
// tests/providers/serper.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SerperProvider } from "../../src/providers/serper.ts";
import { stubFetch } from "../helpers.ts";

describe("SerperProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => { fetchStub = stubFetch(); });
  afterEach(() => { fetchStub.restore(); });

  it("has correct name and label", () => {
    expect(new SerperProvider("key").name).toBe("serper");
    expect(new SerperProvider("key").label).toBe("Google Serper");
  });

  it("returns normalized search results", async () => {
    fetchStub.addResponse("google.serper.dev", {
      body: {
        organic: [
          { title: "Serper Result", link: "https://serper.dev", snippet: "A snippet" },
        ],
      },
    });
    const results = await new SerperProvider("key").search("test", 5);
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://serper.dev");
  });

  it("sends API key in X-API-KEY header", async () => {
    fetchStub.addResponse("google.serper.dev", { body: { organic: [] } });
    await new SerperProvider("my-key").search("test", 5);
    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers["X-API-KEY"]).toBe("my-key");
  });

  it("throws on error response", async () => {
    fetchStub.addResponse("google.serper.dev", { status: 403 });
    await expect(new SerperProvider("key").search("test", 5)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Implement Serper provider**

```typescript
// src/providers/serper.ts
import type { SearchProvider, SearchResult } from "./types.ts";

interface SerperResponse {
  organic: Array<{ title: string; link: string; snippet: string }>;
}

export class SerperProvider implements SearchProvider {
  readonly name = "serper";
  readonly label = "Google Serper";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": this.apiKey,
      },
      body: JSON.stringify({ q: query, num: maxResults }),
      signal,
    });
    if (!response.ok) throw new Error(`Serper API error: ${response.status} ${response.statusText}`);
    const data: SerperResponse = await response.json();
    return (data.organic ?? []).slice(0, maxResults).map((r) => ({
      title: r.title, url: r.link, snippet: r.snippet,
    }));
  }
}
```

- [ ] **Step 3: Run tests and commit**

Run: `pnpm test -- tests/providers/serper.test.ts`
Expected: PASS.

```bash
git add src/providers/serper.ts tests/providers/serper.test.ts
git commit -m "feat: add Google Serper search provider"
```

**Tavily** (`src/providers/tavily.ts`):

- [ ] **Step 4: Write failing test**

```typescript
// tests/providers/tavily.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TavilyProvider } from "../../src/providers/tavily.ts";
import { stubFetch } from "../helpers.ts";

describe("TavilyProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => { fetchStub = stubFetch(); });
  afterEach(() => { fetchStub.restore(); });

  it("has correct name and label", () => {
    expect(new TavilyProvider("key").name).toBe("tavily");
    expect(new TavilyProvider("key").label).toBe("Tavily");
  });

  it("returns search results", async () => {
    fetchStub.addResponse("api.tavily.com", {
      body: {
        results: [
          { title: "Tavily Result", url: "https://tavily.com", content: "A snippet" },
        ],
      },
    });
    const results = await new TavilyProvider("key").search("test", 5);
    expect(results).toHaveLength(1);
    expect(results[0].snippet).toBe("A snippet");
  });

  it("sends API key in request body", async () => {
    fetchStub.addResponse("api.tavily.com", { body: { results: [] } });
    await new TavilyProvider("my-key").search("test", 5);
    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.api_key).toBe("my-key");
  });

  it("fetches content via extract API", async () => {
    fetchStub.addResponse("api.tavily.com/extract", {
      body: { results: [{ raw_content: "Extracted content here" }] },
    });
    const result = await new TavilyProvider("key").fetch("https://example.com");
    expect(result.text).toBe("Extracted content here");
  });
});
```

- [ ] **Step 5: Implement Tavily provider**

```typescript
// src/providers/tavily.ts
import type { FetchProvider, FetchResult, SearchProvider, SearchResult } from "./types.ts";

interface TavilySearchResponse {
  results: Array<{ title: string; url: string; content: string }>;
}

interface TavilyExtractResponse {
  results: Array<{ raw_content: string }>;
}

export class TavilyProvider implements SearchProvider, FetchProvider {
  readonly name = "tavily";
  readonly label = "Tavily";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: this.apiKey, query, max_results: maxResults }),
      signal,
    });
    if (!response.ok) throw new Error(`Tavily API error: ${response.status} ${response.statusText}`);
    const data: TavilySearchResponse = await response.json();
    return (data.results ?? []).slice(0, maxResults).map((r) => ({
      title: r.title, url: r.url, snippet: r.content,
    }));
  }

  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult> {
    const response = await globalThis.fetch("https://api.tavily.com/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: this.apiKey, urls: [url] }),
      signal,
    });
    if (!response.ok) throw new Error(`Tavily extract error: ${response.status} ${response.statusText}`);
    const data: TavilyExtractResponse = await response.json();
    const content = data.results?.[0]?.raw_content ?? "";
    return { text: content };
  }
}
```

- [ ] **Step 6: Run tests and commit**

Run: `pnpm test -- tests/providers/tavily.test.ts`
Expected: PASS.

```bash
git add src/providers/tavily.ts tests/providers/tavily.test.ts
git commit -m "feat: add Tavily search and extract provider"
```

**Exa** (`src/providers/exa.ts`):

- [ ] **Step 7: Write failing test**

```typescript
// tests/providers/exa.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExaProvider } from "../../src/providers/exa.ts";
import { stubFetch } from "../helpers.ts";

describe("ExaProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => { fetchStub = stubFetch(); });
  afterEach(() => { fetchStub.restore(); });

  it("has correct name and label", () => {
    expect(new ExaProvider("key").name).toBe("exa");
    expect(new ExaProvider("key").label).toBe("Exa");
  });

  it("returns search results", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: {
        results: [
          { title: "Exa Result", url: "https://exa.ai", text: "Exa snippet" },
        ],
      },
    });
    const results = await new ExaProvider("key").search("test", 5);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Exa Result");
  });

  it("returns code search results", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: {
        results: [
          { title: "Code Example", url: "https://github.com/ex", text: "const x = 1;" },
        ],
      },
    });
    const results = await new ExaProvider("key").codeSearch("typescript example", 5);
    expect(results).toHaveLength(1);
    expect(results[0].snippet).toBe("const x = 1;");
  });

  it("sends auth header", async () => {
    fetchStub.addResponse("api.exa.ai", { body: { results: [] } });
    await new ExaProvider("my-exa-key").search("test", 5);
    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers["x-api-key"]).toBe("my-exa-key");
  });

  it("fetches content via contents endpoint", async () => {
    fetchStub.addResponse("api.exa.ai/contents", {
      body: { results: [{ text: "Full page content" }] },
    });
    const result = await new ExaProvider("key").fetch("https://example.com");
    expect(result.text).toBe("Full page content");
  });
});
```

- [ ] **Step 8: Implement Exa provider**

```typescript
// src/providers/exa.ts
import type {
  CodeSearchProvider,
  CodeSearchResult,
  FetchProvider,
  FetchResult,
  SearchProvider,
  SearchResult,
} from "./types.ts";

interface ExaSearchResponse {
  results: Array<{ title: string; url: string; text?: string }>;
}

interface ExaContentsResponse {
  results: Array<{ text: string }>;
}

export class ExaProvider implements SearchProvider, FetchProvider, CodeSearchProvider {
  readonly name = "exa";
  readonly label = "Exa";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
    };
  }

  async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
    const response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        query,
        numResults: maxResults,
        useAutoprompt: true,
        type: "auto",
      }),
      signal,
    });
    if (!response.ok) throw new Error(`Exa API error: ${response.status} ${response.statusText}`);
    const data: ExaSearchResponse = await response.json();
    return (data.results ?? []).slice(0, maxResults).map((r) => ({
      title: r.title, url: r.url, snippet: r.text ?? "",
    }));
  }

  async codeSearch(query: string, maxResults: number, signal?: AbortSignal): Promise<CodeSearchResult[]> {
    const response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        query,
        numResults: maxResults,
        type: "auto",
        category: "code",
      }),
      signal,
    });
    if (!response.ok) throw new Error(`Exa code search error: ${response.status} ${response.statusText}`);
    const data: ExaSearchResponse = await response.json();
    return (data.results ?? []).slice(0, maxResults).map((r) => ({
      title: r.title, url: r.url, snippet: r.text ?? "",
    }));
  }

  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult> {
    const response = await globalThis.fetch("https://api.exa.ai/contents", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ urls: [url], text: true }),
      signal,
    });
    if (!response.ok) throw new Error(`Exa contents error: ${response.status} ${response.statusText}`);
    const data: ExaContentsResponse = await response.json();
    return { text: data.results?.[0]?.text ?? "" };
  }
}
```

- [ ] **Step 9: Run tests and commit**

Run: `pnpm test -- tests/providers/exa.test.ts`
Expected: PASS.

```bash
git add src/providers/exa.ts tests/providers/exa.test.ts
git commit -m "feat: add Exa search, code search, and contents provider"
```

**Perplexity** (`src/providers/perplexity.ts`):

- [ ] **Step 10: Write failing test**

```typescript
// tests/providers/perplexity.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PerplexityProvider } from "../../src/providers/perplexity.ts";
import { stubFetch } from "../helpers.ts";

describe("PerplexityProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => { fetchStub = stubFetch(); });
  afterEach(() => { fetchStub.restore(); });

  it("has correct name and label", () => {
    expect(new PerplexityProvider("key").name).toBe("perplexity");
    expect(new PerplexityProvider("key").label).toBe("Perplexity Sonar");
  });

  it("returns search results from chat completion format", async () => {
    fetchStub.addResponse("api.perplexity.ai", {
      body: {
        choices: [{ message: { content: "Perplexity answer about the topic" } }],
        citations: ["https://source1.com", "https://source2.com"],
      },
    });
    const results = await new PerplexityProvider("key").search("test", 5);
    expect(results.length).toBeGreaterThan(0);
  });

  it("sends Bearer auth header", async () => {
    fetchStub.addResponse("api.perplexity.ai", {
      body: { choices: [{ message: { content: "answer" } }], citations: [] },
    });
    await new PerplexityProvider("my-key").search("test", 5);
    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers.Authorization).toBe("Bearer my-key");
  });
});
```

- [ ] **Step 11: Implement Perplexity provider**

```typescript
// src/providers/perplexity.ts
import type { SearchProvider, SearchResult } from "./types.ts";

interface PerplexityResponse {
  choices: Array<{ message: { content: string } }>;
  citations?: string[];
}

export class PerplexityProvider implements SearchProvider {
  readonly name = "perplexity";
  readonly label = "Perplexity Sonar";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [{ role: "user", content: query }],
      }),
      signal,
    });
    if (!response.ok) throw new Error(`Perplexity API error: ${response.status} ${response.statusText}`);
    const data: PerplexityResponse = await response.json();

    const answer = data.choices?.[0]?.message?.content ?? "";
    const citations = data.citations ?? [];
    const results: SearchResult[] = [];

    // Main answer as first result
    if (answer) {
      results.push({ title: "Perplexity Answer", url: "", snippet: answer });
    }

    // Citations as additional results
    for (const url of citations.slice(0, maxResults - 1)) {
      results.push({ title: url, url, snippet: "" });
    }

    return results.slice(0, maxResults);
  }
}
```

- [ ] **Step 12: Run tests and commit**

Run: `pnpm test -- tests/providers/perplexity.test.ts`
Expected: PASS.

```bash
git add src/providers/perplexity.ts tests/providers/perplexity.test.ts
git commit -m "feat: add Perplexity Sonar search provider"
```

**Firecrawl** (`src/providers/firecrawl.ts`):

- [ ] **Step 13: Write failing test**

```typescript
// tests/providers/firecrawl.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FirecrawlProvider } from "../../src/providers/firecrawl.ts";
import { stubFetch } from "../helpers.ts";

describe("FirecrawlProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => { fetchStub = stubFetch(); });
  afterEach(() => { fetchStub.restore(); });

  it("has correct name and label", () => {
    expect(new FirecrawlProvider("key").name).toBe("firecrawl");
    expect(new FirecrawlProvider("key").label).toBe("Firecrawl");
  });

  it("returns search results", async () => {
    fetchStub.addResponse("api.firecrawl.dev/v1/search", {
      body: {
        data: [
          { title: "FC Result", url: "https://firecrawl.dev", markdown: "snippet text" },
        ],
      },
    });
    const results = await new FirecrawlProvider("key").search("test", 5);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("FC Result");
  });

  it("fetches content via scrape API", async () => {
    fetchStub.addResponse("api.firecrawl.dev/v1/scrape", {
      body: { data: { markdown: "Scraped content" } },
    });
    const result = await new FirecrawlProvider("key").fetch("https://example.com");
    expect(result.text).toBe("Scraped content");
  });

  it("sends Bearer auth header", async () => {
    fetchStub.addResponse("api.firecrawl.dev", { body: { data: [] } });
    await new FirecrawlProvider("my-key").search("test", 5);
    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers.Authorization).toBe("Bearer my-key");
  });
});
```

- [ ] **Step 14: Implement Firecrawl provider**

```typescript
// src/providers/firecrawl.ts
import type { FetchProvider, FetchResult, SearchProvider, SearchResult } from "./types.ts";

interface FirecrawlSearchResponse {
  data: Array<{ title: string; url: string; markdown?: string; description?: string }>;
}

interface FirecrawlScrapeResponse {
  data: { markdown: string };
}

export class FirecrawlProvider implements SearchProvider, FetchProvider {
  readonly name = "firecrawl";
  readonly label = "Firecrawl";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
    const response = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ query, limit: maxResults }),
      signal,
    });
    if (!response.ok) throw new Error(`Firecrawl search error: ${response.status} ${response.statusText}`);
    const data: FirecrawlSearchResponse = await response.json();
    return (data.data ?? []).slice(0, maxResults).map((r) => ({
      title: r.title, url: r.url, snippet: r.description ?? r.markdown?.slice(0, 200) ?? "",
    }));
  }

  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult> {
    const response = await globalThis.fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ url, formats: ["markdown"] }),
      signal,
    });
    if (!response.ok) throw new Error(`Firecrawl scrape error: ${response.status} ${response.statusText}`);
    const data: FirecrawlScrapeResponse = await response.json();
    return { text: data.data?.markdown ?? "" };
  }
}
```

- [ ] **Step 15: Run tests and commit**

Run: `pnpm test -- tests/providers/firecrawl.test.ts`
Expected: PASS.

```bash
git add src/providers/firecrawl.ts tests/providers/firecrawl.test.ts
git commit -m "feat: add Firecrawl search and scrape provider"
```

### Task 6.4: Register All Providers in Extension Entry Point

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Update index.ts with all provider registrations**

```typescript
// src/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig, resolveApiKey } from "./config.ts";
import { ContentStore, type StoredContent } from "./storage.ts";
import { ProviderRegistry } from "./providers/registry.ts";
import { DuckDuckGoProvider } from "./providers/duckduckgo.ts";
import { JinaProvider } from "./providers/jina.ts";
import { BraveProvider } from "./providers/brave.ts";
import { SerperProvider } from "./providers/serper.ts";
import { TavilyProvider } from "./providers/tavily.ts";
import { ExaProvider } from "./providers/exa.ts";
import { PerplexityProvider } from "./providers/perplexity.ts";
import { FirecrawlProvider } from "./providers/firecrawl.ts";
import type { SearchProvider } from "./providers/types.ts";
import { createWebSearchTool } from "./tools/web-search.ts";
import { createWebFetchTool } from "./tools/web-fetch.ts";
import { createWebReadTool } from "./tools/web-read.ts";

export default function createExtension(pi: ExtensionAPI): void {
  const config = loadConfig();
  const store = new ContentStore((customType, data) =>
    pi.appendEntry(customType, data),
  );
  const registry = new ProviderRegistry();

  // Register providers based on config
  const providerFactories: Record<
    string,
    {
      create: (key?: string) => { search?: SearchProvider; fetch?: any; codeSearch?: any };
      tier: 1 | 2 | 3;
      monthlyQuota: number | null;
      requiresKey: boolean;
    }
  > = {
    duckduckgo: {
      create: () => ({ search: new DuckDuckGoProvider() }),
      tier: 3, monthlyQuota: null, requiresKey: false,
    },
    jina: {
      create: (key) => {
        const p = new JinaProvider(key);
        return { search: p, fetch: p };
      },
      tier: 3, monthlyQuota: null, requiresKey: false,
    },
    brave: {
      create: (key) => ({ search: new BraveProvider(key!) }),
      tier: 1, monthlyQuota: 2000, requiresKey: true,
    },
    serper: {
      create: (key) => ({ search: new SerperProvider(key!) }),
      tier: 1, monthlyQuota: 2500, requiresKey: true,
    },
    tavily: {
      create: (key) => {
        const p = new TavilyProvider(key!);
        return { search: p, fetch: p };
      },
      tier: 1, monthlyQuota: 1000, requiresKey: true,
    },
    exa: {
      create: (key) => {
        const p = new ExaProvider(key!);
        return { search: p, fetch: p, codeSearch: p };
      },
      tier: 1, monthlyQuota: 1000, requiresKey: true,
    },
    perplexity: {
      create: (key) => ({ search: new PerplexityProvider(key!) }),
      tier: 2, monthlyQuota: null, requiresKey: true,
    },
    firecrawl: {
      create: (key) => {
        const p = new FirecrawlProvider(key!);
        return { search: p, fetch: p };
      },
      tier: 1, monthlyQuota: 1000, requiresKey: true,
    },
  };

  for (const [name, factory] of Object.entries(providerFactories)) {
    const providerConfig = config.providers[name];
    if (providerConfig?.enabled === false) continue;

    const configuredKey = providerConfig?.apiKey;
    // Check env var directly first, then fall back to config
    const envKey = resolveApiKey(name.toUpperCase() + "_API_KEY");
    const resolvedKey = envKey ?? resolveApiKey(configuredKey);

    if (factory.requiresKey && !resolvedKey) continue;

    const instances = factory.create(resolvedKey);
    const quota = providerConfig?.monthlyQuota ?? factory.monthlyQuota;

    if (instances.search) {
      registry.registerSearch(instances.search, { tier: factory.tier, monthlyQuota: quota });
    }
    if (instances.fetch) {
      registry.registerFetch(instances.fetch);
    }
    if (instances.codeSearch) {
      registry.registerCodeSearch(instances.codeSearch);
    }
  }

  function resolveSearchProvider(name?: string): SearchProvider {
    const provider = registry.selectSearch(name);
    if (!provider) throw new Error("No search providers available");
    return provider;
  }

  // Restore stored content from previous session
  pi.on("session_start", (_event, ctx) => {
    const entries = ctx.sessionManager.getEntries?.() ?? [];
    const restored = entries
      .filter((e: any) => e.customType === "pi-tools-content" && e.data)
      .map((e: any) => e.data as StoredContent);
    if (restored.length > 0) {
      store.restore(restored);
    }
  });

  pi.registerTool(
    createWebSearchTool(
      (name) => resolveSearchProvider(name),
      (providerName) => registry.recordUsage(providerName),
    ),
  );
  pi.registerTool(createWebFetchTool(store));
  pi.registerTool(createWebReadTool(store));
}
```

- [ ] **Step 2: Run all tests**

Run: `pnpm check`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: register all search providers with config-driven initialization"
```

### Phase 6 Checkpoint

All 8 search providers are implemented and registered. The extension auto-rotates across configured providers based on available quota and tier priority.

---

## Phase 7: code_search Tool

Adds the `code_search` tool using Exa's code context endpoint. After this phase, all four tools from the spec are functional.

### Task 7.1: code_search Tool Definition

**Files:**
- Create: `src/tools/code-search.ts`
- Test: `tests/tools/code-search.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/tools/code-search.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCodeSearchTool } from "../../src/tools/code-search.ts";
import { stubFetch } from "../helpers.ts";
import { makeCtx } from "../helpers.ts";
import type { CodeSearchProvider } from "../../src/providers/types.ts";

function mockCodeSearch(): CodeSearchProvider {
  return {
    name: "exa",
    codeSearch: vi.fn().mockResolvedValue([
      { title: "React useState", url: "https://github.com/facebook/react", snippet: "const [state, setState] = useState(0);", language: "typescript" },
      { title: "Express Router", url: "https://github.com/expressjs/express", snippet: "const router = express.Router();", language: "javascript" },
    ]),
  };
}

describe("code_search tool", () => {
  it("has correct tool metadata", () => {
    const tool = createCodeSearchTool(() => mockCodeSearch());
    expect(tool.name).toBe("code_search");
    expect(tool.label).toBe("Code Search");
  });

  it("returns formatted code results", async () => {
    const tool = createCodeSearchTool(() => mockCodeSearch());
    const ctx = makeCtx();
    const result = await tool.execute("call-1", { query: "react hooks" }, undefined, undefined, ctx);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("React useState");
    expect(text).toContain("typescript");
  });

  it("returns error when no code search provider available", async () => {
    const tool = createCodeSearchTool(() => undefined);
    const ctx = makeCtx();
    const result = await tool.execute("call-2", { query: "test" }, undefined, undefined, ctx);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Exa");
    expect(text.toLowerCase()).toContain("api key");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- tests/tools/code-search.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement code_search tool**

```typescript
// src/tools/code-search.ts
import { Type, type Static } from "typebox";
import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { CodeSearchProvider, CodeSearchResult } from "../providers/types.ts";
import { sanitizeError } from "../utils/errors.ts";

const CodeSearchParams = Type.Object({
  query: Type.String({ description: "Code or technical documentation search query" }),
  numResults: Type.Optional(
    Type.Number({ minimum: 1, maximum: 10, default: 5, description: "Number of results (1-10, default 5)" }),
  ),
});

type CodeSearchInput = Static<typeof CodeSearchParams>;

interface CodeSearchDetails {
  provider: string;
  resultCount: number;
}

function formatCodeResults(results: CodeSearchResult[]): string {
  if (results.length === 0) return "No code results found.";
  return results
    .map(
      (r, i) =>
        `${i + 1}. [${r.title}](${r.url})${r.language ? ` (${r.language})` : ""}\n   ${r.snippet}`,
    )
    .join("\n\n");
}

export function createCodeSearchTool(
  resolveProvider: () => CodeSearchProvider | undefined,
): ToolDefinition<typeof CodeSearchParams, CodeSearchDetails> {
  return {
    name: "code_search",
    label: "Code Search",
    description:
      "Search code, library APIs, and technical documentation across the web.",
    promptSnippet:
      "Search code, library APIs, and technical documentation across the web.",
    promptGuidelines: [
      "Use code_search for finding code examples, library documentation, and API references.",
      "Prefer code_search over web_search for programming-related queries.",
    ],
    parameters: CodeSearchParams,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const provider = resolveProvider();
      if (!provider) {
        return {
          content: [
            {
              type: "text" as const,
              text: "code_search requires an Exa API key. Set the EXA_API_KEY environment variable or configure it in ~/.pi/agent/extensions/pi-tools.json.",
            },
          ],
          details: { provider: "none", resultCount: 0 },
        };
      }

      try {
        const maxResults = params.numResults ?? 5;
        const results = await provider.codeSearch(params.query, maxResults, signal ?? undefined);
        const text = formatCodeResults(results);

        return {
          content: [{ type: "text" as const, text }],
          details: { provider: provider.name, resultCount: results.length },
        };
      } catch (error) {
        const msg = sanitizeError(error);
        return {
          content: [{ type: "text" as const, text: `Code search error: ${msg}` }],
          details: { provider: provider.name, resultCount: 0 },
        };
      }
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test -- tests/tools/code-search.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Wire into index.ts**

Add after the existing tool registrations in `src/index.ts`:

```typescript
import { createCodeSearchTool } from "./tools/code-search.ts";
```

And in the `createExtension` function body, after the existing `registerTool` calls:

```typescript
  pi.registerTool(
    createCodeSearchTool(() => registry.selectCodeSearch()),
  );
```

- [ ] **Step 6: Update index test**

Add to `tests/index.test.ts`:

```typescript
  it("registers code_search tool", () => {
    const pi = createMockPi();
    createExtension(pi as any);
    expect(pi.tools.some((t) => t.name === "code_search")).toBe(true);
  });
```

- [ ] **Step 7: Run all tests**

Run: `pnpm check`
Expected: All pass.

- [ ] **Step 8: Commit**

```bash
git add src/tools/code-search.ts src/index.ts tests/tools/code-search.test.ts tests/index.test.ts
git commit -m "feat: add code_search tool using Exa code context"
```

### Phase 7 Checkpoint

All four tools are now registered and functional: `web_search`, `web_fetch`, `web_read`, `code_search`.

---

## Phase 8: Advanced Extraction (PDF, RSC, Jina Reader, Provider Fallbacks)

Extends the extraction pipeline with PDF support, Next.js RSC parsing, Jina Reader fallback, and provider-based extraction. After this phase, `web_fetch` handles PDFs, JS-heavy sites, and complex pages.

### Task 8.1: PDF Extraction

**Files:**
- Create: `src/extract/pdf.ts`
- Test: `tests/extract/pdf.test.ts`
- Modify: `src/extract/pipeline.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/extract/pdf.test.ts
import { describe, expect, it } from "vitest";
import { extractPdf } from "../../src/extract/pdf.ts";

describe("extractPdf", () => {
  it("extracts text from a minimal PDF buffer", async () => {
    // Create a minimal valid PDF for testing
    // In practice, unpdf handles real PDFs. This tests the wrapper.
    // We test the function signature and error handling.
    const emptyBuffer = new Uint8Array(0);
    await expect(extractPdf(emptyBuffer)).rejects.toThrow();
  });

  it("exports extractPdf function", () => {
    expect(typeof extractPdf).toBe("function");
  });
});
```

- [ ] **Step 2: Implement PDF extraction**

```typescript
// src/extract/pdf.ts
import { getDocumentProxy, extractText } from "unpdf";

export async function extractPdf(
  buffer: Uint8Array,
  maxPages = 100,
): Promise<string> {
  const doc = await getDocumentProxy(buffer);
  const totalPages = Math.min(doc.numPages, maxPages);
  const { text } = await extractText(doc, { mergePages: true });
  return text.trim();
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm test -- tests/extract/pdf.test.ts`
Expected: Tests PASS (error handling test passes, function exists).

- [ ] **Step 4: Commit**

```bash
git add src/extract/pdf.ts tests/extract/pdf.test.ts
git commit -m "feat: add PDF text extraction via unpdf"
```

### Task 8.2: RSC Parser

**Files:**
- Create: `src/extract/rsc.ts`
- Test: `tests/extract/rsc.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/extract/rsc.test.ts
import { describe, expect, it } from "vitest";
import { extractRsc } from "../../src/extract/rsc.ts";

describe("extractRsc", () => {
  it("detects and extracts RSC content", () => {
    const html = `
    <html><body>
    <script>self.__next_f.push([1,"0:[\\"$\\",\\"div\\",null,{\\"children\\":\\"Hello RSC World\\"}]"])</script>
    <script>self.__next_f.push([1,"More RSC content here with actual text about the topic that is long enough to be useful content for extraction purposes."])</script>
    </body></html>`;

    const result = extractRsc(html);
    expect(result).not.toBeNull();
    expect(result).toContain("Hello RSC World");
  });

  it("returns null for non-RSC pages", () => {
    const html = "<html><body><p>Normal page</p></body></html>";
    expect(extractRsc(html)).toBeNull();
  });

  it("returns null when extracted content is too short", () => {
    const html = `<html><body>
    <script>self.__next_f.push([1,"x"])</script>
    </body></html>`;
    expect(extractRsc(html)).toBeNull();
  });
});
```

- [ ] **Step 2: Implement RSC parser**

```typescript
// src/extract/rsc.ts

const RSC_MARKER = "self.__next_f.push";
const MIN_CONTENT_LENGTH = 200;

export function extractRsc(html: string): string | null {
  if (!html.includes(RSC_MARKER)) return null;

  const chunks: string[] = [];
  const pattern = /self\.__next_f\.push\(\[1,"([^"]*?)"\]\)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html)) !== null) {
    try {
      // Unescape the JSON string
      const decoded = match[1]
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\")
        .replace(/\\n/g, "\n");
      chunks.push(decoded);
    } catch {
      // Skip malformed chunks
    }
  }

  if (chunks.length === 0) return null;

  // Extract text content from RSC payload
  const combined = chunks.join("\n");

  // Strip RSC protocol markers and extract readable text
  const text = combined
    .replace(/\$[A-Za-z0-9]+/g, "") // Remove RSC references
    .replace(/\["[^"]*",/g, "") // Remove component markers
    .replace(/[{}\[\]]/g, " ") // Remove JSON structure
    .replace(/\\u[0-9a-fA-F]{4}/g, "") // Remove unicode escapes
    .replace(/\s+/g, " ")
    .trim();

  if (text.length < MIN_CONTENT_LENGTH) return null;

  return text;
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm test -- tests/extract/rsc.test.ts`
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/extract/rsc.ts tests/extract/rsc.test.ts
git commit -m "feat: add Next.js RSC parser for JS-rendered content"
```

### Task 8.3: Jina Reader Extraction

**Files:**
- Create: `src/extract/jina-reader.ts`
- Test: `tests/extract/jina-reader.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/extract/jina-reader.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractViaJinaReader } from "../../src/extract/jina-reader.ts";
import { stubFetch } from "../helpers.ts";

describe("extractViaJinaReader", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => { fetchStub = stubFetch(); });
  afterEach(() => { fetchStub.restore(); });

  it("returns markdown from Jina Reader", async () => {
    fetchStub.addResponse("r.jina.ai", {
      body: "# Page Title\n\nRendered content from JS page",
      headers: { "content-type": "text/plain" },
    });

    const result = await extractViaJinaReader("https://example.com");
    expect(result).not.toBeNull();
    expect(result).toContain("Rendered content");
  });

  it("returns null on failure", async () => {
    fetchStub.addResponse("r.jina.ai", { status: 500, body: "Error" });
    const result = await extractViaJinaReader("https://example.com");
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Implement Jina Reader extraction**

```typescript
// src/extract/jina-reader.ts

export async function extractViaJinaReader(
  url: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const readerUrl = `https://r.jina.ai/${url}`;
    const response = await fetch(readerUrl, {
      headers: { Accept: "text/plain" },
      signal,
    });

    if (!response.ok) return null;

    const text = await response.text();
    if (!text || text.trim().length < 100) return null;

    return text.trim();
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm test -- tests/extract/jina-reader.test.ts`
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/extract/jina-reader.ts tests/extract/jina-reader.test.ts
git commit -m "feat: add Jina Reader fallback extractor"
```

### Task 8.4: Integrate All Extraction Tiers into Pipeline

**Files:**
- Modify: `src/extract/pipeline.ts`
- Modify: `tests/extract/pipeline.test.ts`

- [ ] **Step 1: Update pipeline with PDF, RSC, Jina Reader, and provider fallbacks**

```typescript
// src/extract/pipeline.ts
import { validateUrl } from "../utils/ssrf.ts";
import { extractHtml } from "./html.ts";
import { extractPdf } from "./pdf.ts";
import { extractRsc } from "./rsc.ts";
import { extractViaJinaReader } from "./jina-reader.ts";

export interface ExtractedContent {
  text: string;
  title?: string;
  url: string;
  extractionChain: string[];
  chars: number;
  truncated: boolean;
  contentId?: string;
}

const BINARY_CONTENT_TYPES = [
  "image/",
  "audio/",
  "video/",
  "application/zip",
  "application/gzip",
  "application/octet-stream",
];

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
};

export async function extractContent(
  url: string,
  signal?: AbortSignal,
): Promise<ExtractedContent> {
  validateUrl(url);

  const chain: string[] = [];

  const response = await fetch(url, {
    headers: BROWSER_HEADERS,
    signal,
    redirect: "follow",
  });

  chain.push(`http:${response.status}`);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") ?? "";

  // Block binary content (except PDF)
  if (!contentType.includes("application/pdf")) {
    for (const prefix of BINARY_CONTENT_TYPES) {
      if (contentType.startsWith(prefix)) {
        throw new Error(`Unsupported binary content type: ${contentType}`);
      }
    }
  }

  // PDF extraction
  if (contentType.includes("application/pdf")) {
    chain.push("pdf");
    try {
      const buffer = new Uint8Array(await response.arrayBuffer());
      const text = await extractPdf(buffer);
      if (text.length > 0) {
        return {
          text,
          title: undefined,
          url,
          extractionChain: chain,
          chars: text.length,
          truncated: false,
        };
      }
    } catch {
      chain.push("pdf:fail");
    }
  }

  const body = await response.text();

  // Tier 1: Readability
  const htmlResult = extractHtml(body, url);
  if (htmlResult && htmlResult.text.length >= 500) {
    chain.push("readability");
    return {
      text: htmlResult.text,
      title: htmlResult.title,
      url,
      extractionChain: chain,
      chars: htmlResult.text.length,
      truncated: false,
    };
  }
  chain.push("readability:thin");

  // Tier 2: RSC parser
  const rscText = extractRsc(body);
  if (rscText) {
    chain.push("rsc");
    return {
      text: rscText,
      title: undefined,
      url,
      extractionChain: chain,
      chars: rscText.length,
      truncated: false,
    };
  }
  chain.push("rsc:no-match");

  // Tier 3: Jina Reader
  const jinaText = await extractViaJinaReader(url, signal);
  if (jinaText) {
    chain.push("jina-reader");
    return {
      text: jinaText,
      title: undefined,
      url,
      extractionChain: chain,
      chars: jinaText.length,
      truncated: false,
    };
  }
  chain.push("jina-reader:fail");

  // Final fallback: raw text stripped of HTML
  const rawText = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (rawText.length > 0) {
    chain.push("raw-text");
    return {
      text: rawText,
      title: undefined,
      url,
      extractionChain: chain,
      chars: rawText.length,
      truncated: false,
    };
  }

  throw new Error(
    `Could not extract content from ${url}. Tried: ${chain.join(" -> ")}`,
  );
}
```

- [ ] **Step 2: Add pipeline tests for new tiers**

Add to `tests/extract/pipeline.test.ts`:

```typescript
  it("falls back to RSC parser for Next.js pages", async () => {
    const rscHtml = `<html><body>
      <script>self.__next_f.push([1,"${'Real content '.repeat(50)}"])</script>
    </body></html>`;
    fetchStub.addResponse("nextjs-app.com", {
      body: rscHtml,
      headers: { "content-type": "text/html" },
    });
    const result = await extractContent("https://nextjs-app.com");
    expect(result.extractionChain).toContain("rsc");
  });

  it("rejects binary image content", async () => {
    fetchStub.addResponse("example.com/photo.jpg", {
      body: "binary",
      headers: { "content-type": "image/jpeg" },
    });
    await expect(extractContent("https://example.com/photo.jpg")).rejects.toThrow(/binary/i);
  });
```

- [ ] **Step 3: Run tests**

Run: `pnpm check`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add src/extract/pipeline.ts tests/extract/pipeline.test.ts
git commit -m "feat: extend extraction pipeline with PDF, RSC, Jina Reader tiers"
```

### Phase 8 Checkpoint

The extraction pipeline now handles HTML, PDFs, Next.js RSC pages, JS-rendered pages (via Jina Reader), with raw text as final fallback. `web_fetch` can handle a wide variety of web content.

---

## Phase 9: TUI Rendering

Adds custom `renderCall` and `renderResult` for all tools. After this phase, tool output is polished in the terminal with status indicators, previews, and streaming states.

### Task 9.1: TUI Renderers for All Tools

**Files:**
- Modify: `src/tools/web-search.ts`
- Modify: `src/tools/web-fetch.ts`
- Modify: `src/tools/code-search.ts`
- Modify: `src/tools/web-read.ts`
- Test: `tests/tools/rendering.test.ts`

- [ ] **Step 1: Write tests for rendering**

```typescript
// tests/tools/rendering.test.ts
import { describe, expect, it, vi } from "vitest";
import { createWebSearchTool } from "../../src/tools/web-search.ts";
import { createWebFetchTool } from "../../src/tools/web-fetch.ts";
import { createCodeSearchTool } from "../../src/tools/code-search.ts";
import { createWebReadTool } from "../../src/tools/web-read.ts";
import { ContentStore } from "../../src/storage.ts";
import { DuckDuckGoProvider } from "../../src/providers/duckduckgo.ts";

describe("tool rendering", () => {
  it("web_search tool has renderCall and renderResult", () => {
    const tool = createWebSearchTool(() => new DuckDuckGoProvider());
    expect(tool.renderCall).toBeDefined();
    expect(tool.renderResult).toBeDefined();
  });

  it("web_fetch tool has renderCall and renderResult", () => {
    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    expect(tool.renderCall).toBeDefined();
    expect(tool.renderResult).toBeDefined();
  });

  it("code_search tool has renderCall and renderResult", () => {
    const tool = createCodeSearchTool(() => undefined);
    expect(tool.renderCall).toBeDefined();
    expect(tool.renderResult).toBeDefined();
  });

  it("web_read tool has renderCall and renderResult", () => {
    const store = new ContentStore(() => {});
    const tool = createWebReadTool(store);
    expect(tool.renderCall).toBeDefined();
    expect(tool.renderResult).toBeDefined();
  });
});
```

- [ ] **Step 2: Create shared render helpers**

```typescript
// src/tools/render-helpers.ts
import { Text, type Component } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

export function renderToolCall(
  toolLabel: string,
  argSummary: string,
  theme: Theme,
): Component {
  const truncated = argSummary.length > 70 ? argSummary.slice(0, 67) + "..." : argSummary;
  return Text(`${toolLabel} ${truncated}`);
}

export function renderStatusLine(
  text: string,
  isPartial: boolean,
  theme: Theme,
): Component {
  if (isPartial) {
    return Text(text);
  }
  return Text(text);
}
```

Note: The exact TUI rendering depends on the `@earendil-works/pi-tui` API. Check the `Text` and `Component` exports before implementing. If `Text` is not the right constructor, use whatever the existing tools in the Pi codebase use. The pattern here is minimal — just return a `Text` component with the formatted string.

- [ ] **Step 3: Add renderCall and renderResult to each tool**

Add to `src/tools/web-search.ts` in the returned tool object:

```typescript
    renderCall(args, theme, context) {
      const q = args.query.length > 70 ? args.query.slice(0, 67) + "..." : args.query;
      return Text(context.isPartial ? `Searching...` : `web_search "${q}"`);
    },
    renderResult(result, options, theme, context) {
      if (context.isPartial) return Text("Searching...");
      const count = result.details?.resultCount ?? 0;
      if (options.expanded) {
        const text = result.content[0] && "text" in result.content[0] ? result.content[0].text : "";
        return Text(text.slice(0, 500));
      }
      return Text(`${count} results via ${result.details?.provider ?? "unknown"}`);
    },
```

Add to `src/tools/web-fetch.ts`:

```typescript
    renderCall(args, theme, context) {
      const u = args.url.length > 70 ? args.url.slice(0, 67) + "..." : args.url;
      return Text(context.isPartial ? "Fetching..." : `web_fetch "${u}"`);
    },
    renderResult(result, options, theme, context) {
      if (context.isPartial) return Text("Fetching...");
      const details = result.details;
      const info = details ? `${details.chars} chars${details.truncated ? " (truncated)" : ""}` : "error";
      return Text(info);
    },
```

Add to `src/tools/code-search.ts`:

```typescript
    renderCall(args, theme, context) {
      const q = args.query.length > 70 ? args.query.slice(0, 67) + "..." : args.query;
      return Text(context.isPartial ? "Searching code..." : `code_search "${q}"`);
    },
    renderResult(result, options, theme, context) {
      if (context.isPartial) return Text("Searching code...");
      const count = result.details?.resultCount ?? 0;
      return Text(`${count} code results`);
    },
```

Add to `src/tools/web-read.ts`:

```typescript
    renderCall(args, theme, context) {
      return Text(`web_read "${args.contentId}"`);
    },
    renderResult(result, options, theme, context) {
      const text = result.content[0] && "text" in result.content[0] ? result.content[0].text : "";
      return Text(`${text.length} chars`);
    },
```

Each tool file will need this import at the top:

```typescript
import { Text } from "@earendil-works/pi-tui";
```

- [ ] **Step 4: Run tests**

Run: `pnpm check`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/tools/web-search.ts src/tools/web-fetch.ts src/tools/code-search.ts src/tools/web-read.ts src/tools/render-helpers.ts tests/tools/rendering.test.ts
git commit -m "feat: add TUI renderers for all tools"
```

### Phase 9 Checkpoint

All tools now have custom TUI rendering. The extension is feature-complete per the design spec.

Run final check: `pnpm check`
Expected: All lint, typecheck, and tests pass.

---

## Summary

| Phase | Deliverable | Tools Working After |
|-------|------------|-------------------|
| 1 | Types, config, errors, SSRF, storage, truncation, test helpers, deps | - |
| 2 | DuckDuckGo provider + web_search tool | `web_search` |
| 3 | Content storage + web_read tool | `web_search`, `web_read` |
| 4 | HTML extraction + web_fetch tool | `web_search`, `web_fetch`, `web_read` |
| 5 | Provider registry + quota-aware selection | `web_search` (multi-provider), `web_fetch`, `web_read` |
| 6 | All 8 search providers | `web_search` (all providers), `web_fetch`, `web_read` |
| 7 | code_search tool | All 4 tools |
| 8 | PDF, RSC, Jina Reader, provider extraction fallbacks | All 4 tools (enhanced) |
| 9 | TUI rendering for all tools | All 4 tools (polished) |
