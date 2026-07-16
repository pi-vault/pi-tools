# Phase 4: Ollama & OpenAI Native — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Ollama as a tier-3 search/fetch provider using native web endpoints, and add layered OpenAI native web search (payload rewrite + separate provider fallback).

**Architecture:** Two independent providers. Ollama uses Ollama's native `/api/web_search` and `/api/web_fetch` endpoints. OpenAI native has two layers: (1) payload rewrite via `before_provider_request` for OpenAI models, (2) separate Responses API provider for non-OpenAI models.

**Tech Stack:** TypeScript, Vitest, native `fetch`, Pi ExtensionAPI events

**Spec:** `docs/superpowers/specs/2026-07-15-feature-adoption-design.md` (Phase 4)

---

### Task 1: Write failing tests for Ollama provider

**Files:**
- Create: `tests/providers/ollama.test.ts`

- [ ] **Step 1: Create test file with all Ollama test cases**

```typescript
// tests/providers/ollama.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  OllamaProvider,
  isLocalHost,
  isConnectionRefused,
  providerMeta,
} from "../../src/providers/ollama.ts";
import { stubFetch } from "../helpers.ts";

describe("isLocalHost", () => {
  it("returns true for localhost", () => {
    expect(isLocalHost("http://localhost:11434")).toBe(true);
  });

  it("returns true for 127.0.0.1", () => {
    expect(isLocalHost("http://127.0.0.1:11434")).toBe(true);
  });

  it("returns true for 0.0.0.0", () => {
    expect(isLocalHost("http://0.0.0.0:11434")).toBe(true);
  });

  it("returns true for [::1]", () => {
    expect(isLocalHost("http://[::1]:11434")).toBe(true);
  });

  it("returns false for ollama.com", () => {
    expect(isLocalHost("https://ollama.com")).toBe(false);
  });

  it("returns false for custom hostname", () => {
    expect(isLocalHost("http://my-ollama.internal:11434")).toBe(false);
  });
});

describe("isConnectionRefused", () => {
  it("returns true for TypeError with ECONNREFUSED cause", () => {
    const err = new TypeError("fetch failed");
    (err as any).cause = { code: "ECONNREFUSED" };
    expect(isConnectionRefused(err)).toBe(true);
  });

  it("returns false for TypeError without cause", () => {
    expect(isConnectionRefused(new TypeError("fetch failed"))).toBe(false);
  });

  it("returns false for non-TypeError", () => {
    const err = new Error("fetch failed");
    (err as any).cause = { code: "ECONNREFUSED" };
    expect(isConnectionRefused(err)).toBe(false);
  });

  it("returns false for TypeError with different cause code", () => {
    const err = new TypeError("fetch failed");
    (err as any).cause = { code: "ETIMEDOUT" };
    expect(isConnectionRefused(err)).toBe(false);
  });
});

describe("OllamaProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct name and label", () => {
    const provider = new OllamaProvider();
    expect(provider.name).toBe("ollama");
    expect(provider.label).toBe("Ollama");
  });

  describe("search", () => {
    it("uses experimental paths for localhost", async () => {
      fetchStub.addResponse("localhost:11434/api/experimental/web_search", {
        body: {
          results: [
            { title: "Result 1", url: "https://example.com", content: "A snippet" },
          ],
        },
      });

      const provider = new OllamaProvider({ baseUrl: "http://localhost:11434" });
      const results = await provider.search("test query", 5);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        title: "Result 1",
        url: "https://example.com",
        snippet: "A snippet",
      });

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const url = fetchCall[0] as string;
      expect(url).toBe("http://localhost:11434/api/experimental/web_search");
    });

    it("uses stable paths for cloud host", async () => {
      fetchStub.addResponse("ollama.com/api/web_search", {
        body: {
          results: [
            { title: "Cloud Result", url: "https://example.com", content: "Cloud snippet" },
          ],
        },
      });

      const provider = new OllamaProvider({ baseUrl: "https://ollama.com" });
      const results = await provider.search("test", 5);

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Cloud Result");

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const url = fetchCall[0] as string;
      expect(url).toBe("https://ollama.com/api/web_search");
    });

    it("sends POST with query and max_results in body", async () => {
      fetchStub.addResponse("localhost:11434", {
        body: { results: [] },
      });

      const provider = new OllamaProvider();
      await provider.search("my query", 10);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      expect(fetchCall[1].method).toBe("POST");
      const body = JSON.parse(fetchCall[1].body);
      expect(body.query).toBe("my query");
      expect(body.max_results).toBe(10);
    });

    it("includes Authorization header when apiKey is set", async () => {
      fetchStub.addResponse("ollama.com", {
        body: { results: [] },
      });

      const provider = new OllamaProvider({
        baseUrl: "https://ollama.com",
        apiKey: "ollama-secret-key",
      });
      await provider.search("test", 5);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      expect(fetchCall[1].headers["Authorization"]).toBe("Bearer ollama-secret-key");
    });

    it("does not include Authorization header without apiKey", async () => {
      fetchStub.addResponse("localhost:11434", {
        body: { results: [] },
      });

      const provider = new OllamaProvider();
      await provider.search("test", 5);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      expect(fetchCall[1].headers["Authorization"]).toBeUndefined();
    });

    it("limits results to maxResults", async () => {
      const manyResults = Array.from({ length: 10 }, (_, i) => ({
        title: `Result ${i}`,
        url: `https://example.com/${i}`,
        content: `Snippet ${i}`,
      }));
      fetchStub.addResponse("localhost:11434", {
        body: { results: manyResults },
      });

      const provider = new OllamaProvider();
      const results = await provider.search("test", 3);
      expect(results).toHaveLength(3);
    });

    it("throws on HTTP error response", async () => {
      fetchStub.addResponse("localhost:11434", {
        status: 500,
        body: "Internal Server Error",
      });

      const provider = new OllamaProvider();
      await expect(provider.search("test", 5)).rejects.toThrow("Ollama API error");
    });

    it("throws actionable message on ECONNREFUSED", async () => {
      const originalFetch = globalThis.fetch;
      const err = new TypeError("fetch failed");
      (err as any).cause = { code: "ECONNREFUSED" };
      globalThis.fetch = (async () => { throw err; }) as any;

      try {
        const provider = new OllamaProvider();
        await expect(provider.search("test", 5)).rejects.toThrow(
          "Could not connect to Ollama at localhost:11434. Make sure Ollama is running (ollama serve).",
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("handles empty results array", async () => {
      fetchStub.addResponse("localhost:11434", {
        body: { results: [] },
      });

      const provider = new OllamaProvider();
      const results = await provider.search("nothing", 5);
      expect(results).toEqual([]);
    });
  });

  describe("fetch", () => {
    it("uses experimental paths for localhost", async () => {
      fetchStub.addResponse("localhost:11434/api/experimental/web_fetch", {
        body: {
          title: "Example Page",
          content: "Page content here",
          links: ["https://link1.com"],
        },
      });

      const provider = new OllamaProvider({ baseUrl: "http://localhost:11434" });
      const result = await provider.fetch("https://example.com");

      expect(result.title).toBe("Example Page");
      expect(result.text).toBe("Page content here");
      expect(result.contentType).toBe("text/html");

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const url = fetchCall[0] as string;
      expect(url).toBe("http://localhost:11434/api/experimental/web_fetch");
    });

    it("uses stable paths for cloud host", async () => {
      fetchStub.addResponse("ollama.com/api/web_fetch", {
        body: {
          title: "Cloud Page",
          content: "Cloud content",
          links: [],
        },
      });

      const provider = new OllamaProvider({ baseUrl: "https://ollama.com" });
      const result = await provider.fetch("https://example.com");

      expect(result.title).toBe("Cloud Page");
      expect(result.text).toBe("Cloud content");

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const url = fetchCall[0] as string;
      expect(url).toBe("https://ollama.com/api/web_fetch");
    });

    it("sends POST with url in body", async () => {
      fetchStub.addResponse("localhost:11434", {
        body: { title: "T", content: "C", links: [] },
      });

      const provider = new OllamaProvider();
      await provider.fetch("https://example.com/page");

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      expect(fetchCall[1].method).toBe("POST");
      const body = JSON.parse(fetchCall[1].body);
      expect(body.url).toBe("https://example.com/page");
    });

    it("throws actionable message on ECONNREFUSED", async () => {
      const originalFetch = globalThis.fetch;
      const err = new TypeError("fetch failed");
      (err as any).cause = { code: "ECONNREFUSED" };
      globalThis.fetch = (async () => { throw err; }) as any;

      try {
        const provider = new OllamaProvider();
        await expect(provider.fetch("https://example.com")).rejects.toThrow(
          "Could not connect to Ollama at localhost:11434. Make sure Ollama is running (ollama serve).",
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("throws on HTTP error response", async () => {
      fetchStub.addResponse("localhost:11434", {
        status: 404,
        body: "Not Found",
      });

      const provider = new OllamaProvider();
      await expect(provider.fetch("https://example.com")).rejects.toThrow("Ollama API error");
    });
  });
});

describe("providerMeta", () => {
  it("has correct metadata", () => {
    expect(providerMeta.name).toBe("ollama");
    expect(providerMeta.tier).toBe(3);
    expect(providerMeta.monthlyQuota).toBeNull();
    expect(providerMeta.requiresKey).toBe(false);
  });

  it("returns empty object when not enabled and no env var", () => {
    const instance = providerMeta.create();
    expect(instance.search).toBeUndefined();
    expect(instance.fetch).toBeUndefined();
  });

  it("creates search and fetch providers when enabled", () => {
    const instance = providerMeta.create(undefined, {
      enabled: true,
      baseUrl: "http://localhost:11434",
    });
    expect(instance.search).toBeDefined();
    expect(instance.fetch).toBeDefined();
  });

  it("creates provider with custom baseUrl from config", () => {
    const instance = providerMeta.create(undefined, {
      enabled: true,
      baseUrl: "http://my-ollama:11434",
    });
    expect(instance.search).toBeDefined();
    expect(instance.fetch).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails (module not found)**

```bash
pnpm vitest run tests/providers/ollama.test.ts
```

Expected: FAIL — `Cannot find module '../../src/providers/ollama.ts'`.

---

### Task 2: Implement Ollama provider

**Files:**
- Create: `src/providers/ollama.ts`

- [ ] **Step 3: Create the Ollama provider implementation**

```typescript
// src/providers/ollama.ts
import type { ProviderConfigEntry } from "../config.ts";
import type {
  FetchProvider,
  FetchResult,
  ProviderMeta,
  SearchFilters,
  SearchProvider,
  SearchResult,
} from "./types.ts";

const DEFAULT_BASE_URL = "http://localhost:11434";

interface OllamaProviderOptions {
  baseUrl?: string;
  apiKey?: string;
}

export function isLocalHost(baseUrl: string): boolean {
  const hostname = new URL(baseUrl).hostname;
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "[::1]"
  );
}

export function isConnectionRefused(error: unknown): boolean {
  if (error instanceof TypeError) {
    const cause = (error as { cause?: { code?: string } }).cause;
    return cause?.code === "ECONNREFUSED";
  }
  return false;
}

export class OllamaProvider implements SearchProvider, FetchProvider {
  readonly name = "ollama";
  readonly label = "Ollama";

  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly isLocal: boolean;

  constructor(options?: OllamaProviderOptions) {
    this.baseUrl = (
      options?.baseUrl ?? process.env.OLLAMA_HOST ?? DEFAULT_BASE_URL
    ).replace(/\/+$/, "");
    this.apiKey = options?.apiKey ?? process.env.OLLAMA_API_KEY ?? undefined;
    this.isLocal = isLocalHost(this.baseUrl);
  }

  private get searchPath(): string {
    return this.isLocal ? "/api/experimental/web_search" : "/api/web_search";
  }

  private get fetchPath(): string {
    return this.isLocal ? "/api/experimental/web_fetch" : "/api/web_fetch";
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  private hostLabel(): string {
    try {
      const u = new URL(this.baseUrl);
      return `${u.hostname}:${u.port || (u.protocol === "https:" ? "443" : "80")}`;
    } catch {
      return this.baseUrl;
    }
  }

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
    _filters?: SearchFilters,
  ): Promise<SearchResult[]> {
    const url = `${this.baseUrl}${this.searchPath}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify({ query, max_results: maxResults }),
        signal,
      });
    } catch (err) {
      if (isConnectionRefused(err)) {
        throw new Error(
          `Could not connect to Ollama at ${this.hostLabel()}. Make sure Ollama is running (ollama serve).`,
        );
      }
      throw err;
    }

    if (!response.ok) {
      throw new Error(
        `Ollama API error: ${response.status} ${response.statusText}`,
      );
    }

    const data: unknown = await response.json();
    return parseOllamaSearchResults(data).slice(0, maxResults);
  }

  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult> {
    const endpoint = `${this.baseUrl}${this.fetchPath}`;

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify({ url }),
        signal,
      });
    } catch (err) {
      if (isConnectionRefused(err)) {
        throw new Error(
          `Could not connect to Ollama at ${this.hostLabel()}. Make sure Ollama is running (ollama serve).`,
        );
      }
      throw err;
    }

    if (!response.ok) {
      throw new Error(
        `Ollama API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    return {
      text: (data.content as string) || "",
      title: (data.title as string) || undefined,
      contentType: "text/html",
    };
  }
}

function parseOllamaSearchResults(data: unknown): SearchResult[] {
  if (!data || typeof data !== "object") return [];
  const d = data as { results?: unknown[] };
  const results = Array.isArray(d.results) ? d.results : [];
  return results.map((r: unknown) => {
    const item = r as Record<string, unknown>;
    return {
      title: (item.title as string) || "",
      url: (item.url as string) || "",
      snippet: ((item.content as string) || (item.snippet as string) || "").slice(0, 500),
    };
  });
}

export const providerMeta: ProviderMeta = {
  name: "ollama",
  tier: 3,
  monthlyQuota: null,
  requiresKey: false,
  create: (_key?: string, providerConfig?: ProviderConfigEntry) => {
    const baseUrl =
      (providerConfig as any)?.baseUrl ??
      process.env.OLLAMA_HOST ??
      DEFAULT_BASE_URL;
    // Only register when explicitly enabled or OLLAMA_HOST env var is set
    if (providerConfig?.enabled !== true && !process.env.OLLAMA_HOST) return {};
    const provider = new OllamaProvider({ baseUrl, apiKey: providerConfig?.apiKey });
    return { search: provider, fetch: provider };
  },
};
```

- [ ] **Step 4: Run Ollama tests to verify they pass**

```bash
pnpm vitest run tests/providers/ollama.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Run full test suite to verify no regressions**

```bash
pnpm test
```

Expected: all existing tests PASS.

---

### Task 3: Write failing tests for OpenAI native rewrite (Layer 1)

**Files:**
- Create: `tests/providers/openai-native-rewrite.test.ts`

- [ ] **Step 6: Create test file for payload rewrite and model detection**

```typescript
// tests/providers/openai-native-rewrite.test.ts
import { describe, expect, it } from "vitest";
import {
  isOpenAiNativeModel,
  rewriteNativeWebSearch,
} from "../../src/providers/openai-native-rewrite.ts";

describe("isOpenAiNativeModel", () => {
  it("returns true for 'openai' provider", () => {
    expect(isOpenAiNativeModel({ provider: "openai" })).toBe(true);
  });

  it("returns true for 'openai-codex' provider", () => {
    expect(isOpenAiNativeModel({ provider: "openai-codex" })).toBe(true);
  });

  it("returns true for providers starting with 'openai-'", () => {
    expect(isOpenAiNativeModel({ provider: "openai-gpt4" })).toBe(true);
  });

  it("returns false for 'anthropic' provider", () => {
    expect(isOpenAiNativeModel({ provider: "anthropic" })).toBe(false);
  });

  it("returns false for undefined model", () => {
    expect(isOpenAiNativeModel(undefined)).toBe(false);
  });

  it("returns false for model without provider", () => {
    expect(isOpenAiNativeModel({})).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isOpenAiNativeModel({ provider: "OpenAI" })).toBe(true);
    expect(isOpenAiNativeModel({ provider: "OPENAI-CODEX" })).toBe(true);
  });
});

describe("rewriteNativeWebSearch", () => {
  it("rewrites web_search function tool to native format", () => {
    const payload = {
      model: "gpt-4.1",
      tools: [
        {
          type: "function",
          function: { name: "web_search", description: "Search the web", parameters: {} },
        },
      ],
      messages: [{ role: "user", content: "hello" }],
    };

    const result = rewriteNativeWebSearch(payload);

    expect(result.rewritten).toEqual(["web_search"]);
    expect(result.payload.tools).toEqual([
      { type: "web_search", external_web_access: true },
    ]);
    // Messages are preserved
    expect(result.payload.messages).toEqual(payload.messages);
  });

  it("preserves non-web_search tools", () => {
    const payload = {
      tools: [
        {
          type: "function",
          function: { name: "web_search", description: "Search", parameters: {} },
        },
        {
          type: "function",
          function: { name: "web_fetch", description: "Fetch", parameters: {} },
        },
        {
          type: "function",
          function: { name: "code_search", description: "Code", parameters: {} },
        },
      ],
    };

    const result = rewriteNativeWebSearch(payload);

    expect(result.rewritten).toEqual(["web_search"]);
    expect(result.payload.tools).toHaveLength(3);
    expect(result.payload.tools[0]).toEqual({
      type: "web_search",
      external_web_access: true,
    });
    // Other tools preserved as-is
    expect(result.payload.tools[1]).toEqual(payload.tools[1]);
    expect(result.payload.tools[2]).toEqual(payload.tools[2]);
  });

  it("returns empty rewritten array when no web_search tools found", () => {
    const payload = {
      tools: [
        {
          type: "function",
          function: { name: "web_fetch", description: "Fetch", parameters: {} },
        },
      ],
    };

    const result = rewriteNativeWebSearch(payload);

    expect(result.rewritten).toEqual([]);
    expect(result.payload.tools).toEqual(payload.tools);
  });

  it("handles payload without tools array", () => {
    const payload = { model: "gpt-4.1", messages: [] };

    const result = rewriteNativeWebSearch(payload as any);

    expect(result.rewritten).toEqual([]);
    expect(result.payload).toEqual(payload);
  });

  it("respects externalWebAccess option", () => {
    const payload = {
      tools: [
        {
          type: "function",
          function: { name: "web_search", description: "Search", parameters: {} },
        },
      ],
    };

    const result = rewriteNativeWebSearch(payload, {
      externalWebAccess: false,
    });

    expect(result.payload.tools[0]).toEqual({
      type: "web_search",
      external_web_access: false,
    });
  });

  it("defaults externalWebAccess to true", () => {
    const payload = {
      tools: [
        {
          type: "function",
          function: { name: "web_search", description: "Search", parameters: {} },
        },
      ],
    };

    const result = rewriteNativeWebSearch(payload);

    expect(result.payload.tools[0]).toEqual({
      type: "web_search",
      external_web_access: true,
    });
  });

  it("handles non-function tools gracefully", () => {
    const payload = {
      tools: [
        { type: "code_interpreter" },
        {
          type: "function",
          function: { name: "web_search", description: "Search", parameters: {} },
        },
      ],
    };

    const result = rewriteNativeWebSearch(payload);

    expect(result.rewritten).toEqual(["web_search"]);
    expect(result.payload.tools).toHaveLength(2);
    expect(result.payload.tools[0]).toEqual({ type: "code_interpreter" });
    expect(result.payload.tools[1]).toEqual({
      type: "web_search",
      external_web_access: true,
    });
  });
});
```

- [ ] **Step 7: Run test to verify it fails (module not found)**

```bash
pnpm vitest run tests/providers/openai-native-rewrite.test.ts
```

Expected: FAIL — `Cannot find module '../../src/providers/openai-native-rewrite.ts'`.

---

### Task 4: Implement OpenAI native rewrite (Layer 1)

**Files:**
- Create: `src/providers/openai-native-rewrite.ts`

- [ ] **Step 8: Create the payload rewrite implementation**

```typescript
// src/providers/openai-native-rewrite.ts

/**
 * Layer 1: Transparent payload rewrite for OpenAI native web search.
 *
 * When running on OpenAI/Codex models, rewrites the `web_search` function tool
 * definition to OpenAI's native `{ type: "web_search" }` format. The model then
 * uses its built-in web search — no API call from us, no quota cost.
 */

export function isOpenAiNativeModel(
  model: { provider?: string } | undefined,
): boolean {
  if (!model) return false;
  const provider = (model.provider ?? "").toLowerCase();
  return (
    provider === "openai-codex" ||
    provider === "openai" ||
    provider.startsWith("openai-")
  );
}

interface ToolEntry {
  type: string;
  function?: { name?: string; [key: string]: unknown };
  [key: string]: unknown;
}

export function rewriteNativeWebSearch<T extends { tools?: unknown[] }>(
  payload: T,
  options?: { externalWebAccess?: boolean },
): { payload: T; rewritten: string[] } {
  if (!Array.isArray(payload.tools) || payload.tools.length === 0) {
    return { payload, rewritten: [] };
  }

  const externalWebAccess = options?.externalWebAccess ?? true;
  const rewritten: string[] = [];

  const newTools = payload.tools.map((tool: unknown) => {
    const t = tool as ToolEntry;
    if (
      t.type === "function" &&
      t.function?.name === "web_search"
    ) {
      rewritten.push("web_search");
      return { type: "web_search", external_web_access: externalWebAccess };
    }
    return tool;
  });

  return {
    payload: { ...payload, tools: newTools },
    rewritten,
  };
}
```

- [ ] **Step 9: Run rewrite tests to verify they pass**

```bash
pnpm vitest run tests/providers/openai-native-rewrite.test.ts
```

Expected: all tests PASS.

- [ ] **Step 10: Run full test suite to verify no regressions**

```bash
pnpm test
```

Expected: all existing tests PASS.

---

### Task 5: Write failing tests for OpenAI web search provider (Layer 2)

**Files:**
- Create: `tests/providers/openai-web-search.test.ts`

- [ ] **Step 11: Create test file for OpenAI web search provider**

```typescript
// tests/providers/openai-web-search.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createOpenAiWebSearchProvider,
  providerMeta,
} from "../../src/providers/openai-web-search.ts";
import { stubFetch } from "../helpers.ts";

describe("OpenAI Web Search Provider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct name and label", () => {
    const { search } = createOpenAiWebSearchProvider("test-key");
    expect(search.name).toBe("openai-web-search");
    expect(search.label).toBe("OpenAI Web Search");
  });

  it("sends correct Authorization header and request body", async () => {
    fetchStub.addResponse("api.openai.com/v1/responses", {
      body: { output: [] },
    });

    const { search } = createOpenAiWebSearchProvider("sk-my-key");
    await search.search("typescript patterns", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[0]).toBe("https://api.openai.com/v1/responses");
    expect(fetchCall[1].method).toBe("POST");
    expect(fetchCall[1].headers["Authorization"]).toBe("Bearer sk-my-key");

    const body = JSON.parse(fetchCall[1].body);
    expect(body.model).toBe("gpt-4.1-mini");
    expect(body.tools).toEqual([{ type: "web_search" }]);
    expect(body.input).toContain("typescript patterns");
  });

  it("uses custom model from config", async () => {
    fetchStub.addResponse("api.openai.com", {
      body: { output: [] },
    });

    const { search } = createOpenAiWebSearchProvider("sk-key", {
      model: "gpt-4.1",
    });
    await search.search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.model).toBe("gpt-4.1");
  });

  it("extracts results from url_citation annotations", async () => {
    fetchStub.addResponse("api.openai.com", {
      body: {
        output: [
          {
            type: "message",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: "Here are results",
                annotations: [
                  {
                    type: "url_citation",
                    url: "https://example.com",
                    title: "Example Page",
                  },
                  {
                    type: "url_citation",
                    url: "https://docs.example.com",
                    title: "Docs Page",
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const { search } = createOpenAiWebSearchProvider("sk-key");
    const results = await search.search("test", 5);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "Example Page",
      url: "https://example.com",
      snippet: "",
    });
    expect(results[1]).toEqual({
      title: "Docs Page",
      url: "https://docs.example.com",
      snippet: "",
    });
  });

  it("deduplicates results by URL", async () => {
    fetchStub.addResponse("api.openai.com", {
      body: {
        output: [
          {
            type: "message",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: "results",
                annotations: [
                  {
                    type: "url_citation",
                    url: "https://example.com",
                    title: "First",
                  },
                  {
                    type: "url_citation",
                    url: "https://example.com",
                    title: "Duplicate",
                  },
                  {
                    type: "url_citation",
                    url: "https://other.com",
                    title: "Other",
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const { search } = createOpenAiWebSearchProvider("sk-key");
    const results = await search.search("test", 10);

    expect(results).toHaveLength(2);
    expect(results[0].title).toBe("First");
    expect(results[1].title).toBe("Other");
  });

  it("respects maxResults limit", async () => {
    const annotations = Array.from({ length: 20 }, (_, i) => ({
      type: "url_citation",
      url: `https://site${i}.com`,
      title: `Site ${i}`,
    }));
    fetchStub.addResponse("api.openai.com", {
      body: {
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "text", annotations }],
          },
        ],
      },
    });

    const { search } = createOpenAiWebSearchProvider("sk-key");
    const results = await search.search("test", 5);
    expect(results).toHaveLength(5);
  });

  it("throws on non-2xx response", async () => {
    fetchStub.addResponse("api.openai.com", {
      status: 429,
      body: "Rate limited",
    });

    const { search } = createOpenAiWebSearchProvider("sk-key");
    await expect(search.search("test", 5)).rejects.toThrow("429");
  });

  it("returns empty results for empty output", async () => {
    fetchStub.addResponse("api.openai.com", {
      body: { output: [] },
    });

    const { search } = createOpenAiWebSearchProvider("sk-key");
    const results = await search.search("test", 5);
    expect(results).toEqual([]);
  });

  it("returns empty results for output without message type", async () => {
    fetchStub.addResponse("api.openai.com", {
      body: {
        output: [
          { type: "web_search_call", id: "ws_123", status: "completed" },
        ],
      },
    });

    const { search } = createOpenAiWebSearchProvider("sk-key");
    const results = await search.search("test", 5);
    expect(results).toEqual([]);
  });
});

describe("providerMeta", () => {
  it("has correct metadata", () => {
    expect(providerMeta.name).toBe("openai-web-search");
    expect(providerMeta.tier).toBe(1);
    expect(providerMeta.monthlyQuota).toBeNull();
    expect(providerMeta.requiresKey).toBe(true);
  });

  it("creates search provider when key is provided", () => {
    const instance = providerMeta.create("sk-key");
    expect(instance.search).toBeDefined();
  });

  it("does not create search provider without key", () => {
    const instance = providerMeta.create();
    expect(instance.search).toBeUndefined();
  });
});
```

- [ ] **Step 12: Run test to verify it fails (module not found)**

```bash
pnpm vitest run tests/providers/openai-web-search.test.ts
```

Expected: FAIL — `Cannot find module '../../src/providers/openai-web-search.ts'`.

---

### Task 6: Implement OpenAI web search provider (Layer 2)

**Files:**
- Create: `src/providers/openai-web-search.ts`

- [ ] **Step 13: Create the OpenAI web search provider implementation**

```typescript
// src/providers/openai-web-search.ts
import { parseOpenAINativeResults } from "./parsers.ts";
import type {
  ProviderMeta,
  SearchFilters,
  SearchProvider,
  SearchResult,
} from "./types.ts";
import type { ProviderConfigEntry } from "../config.ts";

const RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-4.1-mini";

export interface OpenAiNativeConfig {
  model?: string;
}

class OpenAiWebSearchProvider implements SearchProvider {
  readonly name = "openai-web-search";
  readonly label = "OpenAI Web Search";

  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, config?: OpenAiNativeConfig) {
    this.apiKey = apiKey;
    this.model = config?.model ?? DEFAULT_MODEL;
  }

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
    _filters?: SearchFilters,
  ): Promise<SearchResult[]> {
    const response = await fetch(RESPONSES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        tools: [{ type: "web_search" }],
        input: `Search the web for: ${query}`,
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(
        `OpenAI Native API error: ${response.status} ${response.statusText}`,
      );
    }

    const data: unknown = await response.json();
    return parseOpenAINativeResults(data).slice(0, maxResults);
  }
}

export function createOpenAiWebSearchProvider(
  apiKey: string,
  config?: OpenAiNativeConfig,
): { search: SearchProvider } {
  return {
    search: new OpenAiWebSearchProvider(apiKey, config),
  };
}

export const providerMeta: ProviderMeta = {
  name: "openai-web-search",
  tier: 1,
  monthlyQuota: null,
  requiresKey: true,
  create: (key?: string, providerConfig?: ProviderConfigEntry) => {
    if (!key) return {};
    // Only register when providerEnabled is not explicitly false
    if (providerConfig?.enabled === false) return {};
    return createOpenAiWebSearchProvider(key, {
      model: (providerConfig as any)?.model,
    });
  },
};
```

- [ ] **Step 14: Run OpenAI web search tests to verify they pass**

```bash
pnpm vitest run tests/providers/openai-web-search.test.ts
```

Expected: all tests PASS.

- [ ] **Step 15: Run full test suite to verify no regressions**

```bash
pnpm test
```

Expected: all existing tests PASS.

---

### Task 7: Register providers, add config fields, wire up event handler

**Files:**
- Modify: `src/providers/all.ts`
- Modify: `src/config.ts`
- Modify: `src/index.ts`
- Modify: `tests/providers/all.test.ts`

- [ ] **Step 16: Register Ollama and OpenAI web search in `src/providers/all.ts`**

Add the imports and entries to the `allProviders` array:

```typescript
// At the top, after existing imports, add:
import { providerMeta as ollama } from "./ollama.ts";
import { providerMeta as openaiWebSearch } from "./openai-web-search.ts";
```

```typescript
// In the allProviders array, add entries in alphabetical position:
// After `marginalia,` add:
  ollama,
// After `openaiCodex,` add (before `parallel,`):
  openaiWebSearch,
```

- [ ] **Step 17: Add config fields to `src/config.ts`**

Add `ollama` to `FALLBACK_ENV_MAP` (after the `marginalia` entry):

```typescript
  ollama: "OLLAMA_API_KEY",
  "openai-web-search": "OPENAI_API_KEY",
```

Add `ollama` entry to `DEFAULT_CONFIG.providers` (after `"openai-codex"`):

```typescript
    ollama: { enabled: false },
    "openai-web-search": { enabled: true, apiKey: "OPENAI_API_KEY" },
```

**Note:** `OLLAMA_HOST` is handled directly in the `create()` factory via `process.env.OLLAMA_HOST` (it sets `baseUrl`, not `apiKey`, so it doesn't fit the `FALLBACK_ENV_MAP` pattern which maps provider names to API key env vars).

**Important:** The provider is named `"openai-web-search"` (not `"openai-native"`) because `config-manager.ts` has an alias `"openai-native" → "openai-codex"` for backward compatibility. Using `"openai-native"` would silently redirect to the code search provider. The config namespace uses provider-name-as-key in the providers map, matching the pattern of all other providers.

Ensure `parseConfigFile` passes through no new top-level fields — both `ollama` and `openai-web-search` live in the `providers` record and are covered by the existing `...parsed.providers` spread.

- [ ] **Step 18: Wire up `before_provider_request` handler in `src/index.ts`**

Add the import at the top of `src/index.ts`:

```typescript
import {
  isOpenAiNativeModel,
  rewriteNativeWebSearch,
} from "./providers/openai-native-rewrite.ts";
```

After the existing `pi.on("before_provider_request", ...)` trust handler (line 61-63), add:

```typescript
  // Layer 1: Rewrite web_search tool to native OpenAI format for OpenAI models
  pi.on("before_provider_request", (event, ctx) => {
    const openaiNativeConfig = configManager.current.providers["openai-web-search"];
    if (openaiNativeConfig?.enabled === false) return undefined;
    if (!isOpenAiNativeModel(ctx?.model as { provider?: string } | undefined)) return undefined;
    const result = rewriteNativeWebSearch(event.payload as { tools?: unknown[] });
    return result.rewritten.length > 0 ? result.payload : undefined;
  });
```

**Note:** The `before_provider_request` event is already typed in the ExtensionAPI. The handler type is `ExtensionHandler<BeforeProviderRequestEvent, BeforeProviderRequestEventResult>` where `BeforeProviderRequestEventResult = unknown`. No `as any` cast is needed on the event name. The `ctx.model` needs a type assertion since `ExtensionContext.model` is typed broadly.

- [ ] **Step 19: Update `tests/providers/all.test.ts` for new providers**

Update the test to expect 23 providers (was 21) and add the new names:

```typescript
  it("exports exactly 23 providers", () => {
    expect(allProviders).toHaveLength(23);
  });
```

Add to the sorted names array:
```typescript
    expect(names).toEqual([
      "brave",
      "brave-llm",
      "context7",
      "duckduckgo",
      "exa",
      "exa-mcp",
      "fastcrw",
      "firecrawl",
      "jina",
      "langsearch",
      "linkup",
      "marginalia",
      "ollama",           // NEW
      "openai-codex",
      "openai-web-search", // NEW
      "parallel",
      "perplexity",
      "searxng",
      "serper",
      "sofya",
      "tavily",
      "websearchapi",
      "youcom",
    ]);
```

- [ ] **Step 20: Run `all.test.ts` and full test suite**

```bash
pnpm vitest run tests/providers/all.test.ts && pnpm test
```

Expected: all tests PASS.

---

### Task 8: Commit all Phase 4 changes

- [ ] **Step 21: Stage and commit all new and modified files**

```bash
git add \
  src/providers/ollama.ts \
  src/providers/openai-web-search.ts \
  src/providers/openai-native-rewrite.ts \
  src/providers/all.ts \
  src/config.ts \
  src/index.ts \
  tests/providers/ollama.test.ts \
  tests/providers/openai-web-search.test.ts \
  tests/providers/openai-native-rewrite.test.ts \
  tests/providers/all.test.ts

git commit -m "feat: add Ollama provider and OpenAI web search (Phase 4)

Phase 4a — Ollama provider:
- Tier-3 search+fetch provider using native web endpoints
- Auto-detects local vs cloud: /api/experimental/* for localhost,
  /api/* for remote hosts
- Opt-in: only registers when enabled in config or OLLAMA_HOST set
- Actionable ECONNREFUSED error message
- Env vars: OLLAMA_HOST (base URL), OLLAMA_API_KEY (optional)

Phase 4b — OpenAI web search (two layers):
- Layer 1: before_provider_request rewrite converts web_search
  function tool to native { type: 'web_search' } for OpenAI models.
  Zero quota cost — model uses built-in search.
- Layer 2: openai-web-search provider calls Responses API
  directly with { type: 'web_search' } for non-OpenAI models.
  Named 'openai-web-search' to avoid config-manager alias conflict
  with deprecated 'openai-native' -> 'openai-codex' mapping.

Config: ollama, openai-web-search added to providers map.
FALLBACK_ENV_MAP updated for both.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

**Phase 4 complete.** Three new files (`ollama.ts`, `openai-web-search.ts`, `openai-native-rewrite.ts`) with corresponding tests, plus integration wiring in `all.ts`, `config.ts`, `index.ts`, and updated `all.test.ts`.

---

## Changes from Previous Plan (v1 → v2)

| # | Issue | Fix |
|---|-------|-----|
| 1 | Test file named `openai-native.test.ts` but imports from `openai-web-search.ts` | Consistently named `openai-web-search.test.ts` |
| 2 | `providerMeta.create()` test expected `search`/`fetch` when impl returns `{}` | Test now expects `undefined` when no config; separate test with `enabled: true` |
| 3 | Used deprecated `web_search_preview` tool type | Changed to `web_search` (matches existing `openai-codex.ts` and reference packages) |
| 4 | `all.test.ts` not updated (expects 21 providers) | Added Step 19 to update to 23 providers with both new names |
| 5 | Unnecessary `as any` casts on event handler | Removed; uses proper typed event with minimal type assertions |
| 6 | Ollama parser reads `item.snippet` but API returns `content` | Parser reads `item.content \|\| item.snippet` for safety |
| 7 | Missing `FALLBACK_ENV_MAP` entry for `openai-web-search` | Added `"openai-web-search": "OPENAI_API_KEY"` |
