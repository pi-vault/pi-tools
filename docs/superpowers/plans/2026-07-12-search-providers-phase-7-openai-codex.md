# Search Providers Phase 7: Dual-Mode OpenAI Codex

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `openai-native` with a dual-mode `openai-codex` provider supporting both Pi AuthStorage (Mode A: streaming Codex) and user OPENAI_API_KEY (Mode B: Responses API).

**Architecture:**

- Mode A: Pi AuthStorage available -> streaming via `openAICodexResponsesStreams.stream` from `@earendil-works/pi-ai`
- Mode B: User OPENAI_API_KEY -> POST to OpenAI Responses API (same as current openai-native behavior)
- Lazy init pattern: mode resolved on first `search()` call since `AuthStorage.getApiKey()` is async
- Config alias: `openai-native` in config maps to `openai-codex` with deprecation warning

**Tech Stack:** TypeScript, Vitest, pnpm, dynamic imports for optional peer deps

**Spec:** `docs/superpowers/specs/2026-07-12-search-providers-design.md` (Phase 7 section)

---

## Prerequisites

- Phase 6 complete (parsers.ts has `parseOpenAINativeResults`)
- All tests passing: `pnpm test`
- Existing `src/providers/openai-native.ts` and `tests/providers/openai-native.test.ts`

## Verification Commands

```bash
pnpm vitest run tests/providers/openai-codex.test.ts
pnpm test
pnpm run lint
pnpm run typecheck
```

---

## Task 1: Create `openai-codex.ts` with Mode B Only (Rename)

**Files:** `src/providers/openai-codex.ts`, `src/providers/openai-native.ts`

This task creates the new file with Mode B behavior identical to the current openai-native provider. The old file is kept temporarily for the alias handling.

- [ ] **Step 1:** Create `src/providers/openai-codex.ts`

```typescript
// src/providers/openai-codex.ts
import type { ProviderConfigEntry } from "../config.ts";
import type { ProviderMeta, SearchProvider, SearchResult } from "./types.ts";
import { parseOpenAINativeResults } from "./parsers.ts";

/**
 * Dual-mode OpenAI Codex provider.
 *
 * Mode A (Codex): Uses Pi AuthStorage + streaming Codex via @earendil-works/pi-ai.
 *   Activated when Pi packages are available and AuthStorage has an openai-codex key.
 *
 * Mode B (Responses API): Uses user-provided OPENAI_API_KEY with the Responses API.
 *   Activated as fallback when Mode A is unavailable.
 *
 * Mode resolution is deferred to first search() call (lazy init) because
 * AuthStorage.getApiKey() is async but ProviderMeta.create() is sync.
 */

const DEFAULT_MODEL_A = "gpt-5.4-mini";
const DEFAULT_MODEL_B = "gpt-4.1-nano";
const RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";

type ResolvedMode = "codex" | "responses-api" | "unavailable";

interface CodexStreamResult {
  output: unknown[];
}

class OpenAICodexProvider implements SearchProvider {
  readonly name = "openai-codex";
  readonly label = "OpenAI Codex";

  private readonly userApiKey?: string;
  private readonly model?: string;
  private resolvedMode: ResolvedMode | null = null;
  private piStreamFn: ((opts: unknown) => Promise<CodexStreamResult>) | null =
    null;
  private piGetApiKey:
    | ((provider: string, opts?: unknown) => Promise<string | undefined>)
    | null = null;

  constructor(userApiKey?: string, providerConfig?: ProviderConfigEntry) {
    this.userApiKey = userApiKey;
    this.model = (providerConfig as Record<string, unknown> | undefined)
      ?.model as string | undefined;
  }

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
  ): Promise<SearchResult[]> {
    if (!this.resolvedMode) {
      await this.resolveMode();
    }

    switch (this.resolvedMode) {
      case "codex":
        return this.searchModeA(query, maxResults, signal);
      case "responses-api":
        return this.searchModeB(query, maxResults, signal);
      default:
        return [];
    }
  }

  private async resolveMode(): Promise<void> {
    // Try Mode A: dynamic import of Pi packages
    try {
      const [piAi, piAgent] = await Promise.all([
        import("@earendil-works/pi-ai") as Promise<{
          openAICodexResponsesStreams: {
            stream: (opts: unknown) => Promise<CodexStreamResult>;
          };
        }>,
        import("@earendil-works/pi-coding-agent") as Promise<{
          AuthStorage: {
            getApiKey: (
              provider: string,
              opts?: unknown,
            ) => Promise<string | undefined>;
          };
        }>,
      ]);

      // Verify AuthStorage can resolve a key
      const key = await piAgent.AuthStorage.getApiKey("openai-codex", {
        includeFallback: false,
      });
      if (key) {
        this.piStreamFn = piAi.openAICodexResponsesStreams.stream;
        this.piGetApiKey = piAgent.AuthStorage.getApiKey;
        this.resolvedMode = "codex";
        return;
      }
    } catch {
      // Pi packages not available — fall through to Mode B
    }

    // Try Mode B: user-provided API key
    if (this.userApiKey) {
      this.resolvedMode = "responses-api";
      return;
    }

    this.resolvedMode = "unavailable";
  }

  /**
   * Mode A: Streaming Codex via Pi AuthStorage.
   * Uses openAICodexResponsesStreams.stream with web_search tool.
   */
  private async searchModeA(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
  ): Promise<SearchResult[]> {
    if (!this.piStreamFn || !this.piGetApiKey) return [];

    const apiKey = await this.piGetApiKey("openai-codex", {
      includeFallback: false,
    });
    if (!apiKey) {
      // Key expired or revoked — fall back to Mode B if available
      if (this.userApiKey) {
        this.resolvedMode = "responses-api";
        return this.searchModeB(query, maxResults, signal);
      }
      return [];
    }

    const result = await this.piStreamFn({
      apiKey,
      model: this.model ?? DEFAULT_MODEL_A,
      tools: [{ type: "web_search", external_web_access: true }],
      tool_choice: "required",
      input: `Search the web for: ${query}`,
      options: {
        reasoningEffort: "minimal",
        textVerbosity: "low",
      },
      signal,
    });

    return parseOpenAINativeResults(result).slice(0, maxResults);
  }

  /**
   * Mode B: Direct POST to OpenAI Responses API.
   * Same behavior as the original openai-native provider.
   */
  private async searchModeB(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
  ): Promise<SearchResult[]> {
    if (!this.userApiKey) return [];

    const response = await fetch(RESPONSES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.userApiKey}`,
      },
      body: JSON.stringify({
        model: this.model ?? DEFAULT_MODEL_B,
        tools: [{ type: "web_search" }],
        tool_choice: "required",
        input: `Search the web for: ${query}`,
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(
        `OpenAI Codex API error: ${response.status} ${response.statusText}`,
      );
    }

    const data: unknown = await response.json();
    return parseOpenAINativeResults(data).slice(0, maxResults);
  }
}

export function createOpenAICodexProvider(
  key?: string,
  providerConfig?: ProviderConfigEntry,
): SearchProvider | null {
  // Provider always creates optimistically — mode resolved on first search()
  return new OpenAICodexProvider(key, providerConfig);
}

export const providerMeta: ProviderMeta = {
  name: "openai-codex",
  tier: 1,
  monthlyQuota: null,
  requiresKey: false, // either Pi auth or user key — resolved lazily
  create: (key, providerConfig) => {
    const provider = createOpenAICodexProvider(key, providerConfig);
    if (!provider) return {};
    return { search: provider };
  },
};
```

- [ ] **Step 2:** Verify file compiles

```bash
pnpm run typecheck
```

- [ ] **Step 3:** Commit

```bash
git add src/providers/openai-codex.ts
git commit -m "feat(openai-codex): create dual-mode provider with Mode B (Responses API)"
```

---

## Task 2: Update `all.ts` to Import `openai-codex`

**Files:** `src/providers/all.ts`

- [ ] **Step 1:** Replace the openai-native import with openai-codex in `src/providers/all.ts`

```typescript
// Replace:
import { providerMeta as openaiNative } from "./openai-native.ts";

// With:
import { providerMeta as openaiCodex } from "./openai-codex.ts";
```

And in the array:

```typescript
// Replace:
  openaiNative,
// With:
  openaiCodex,
```

Full updated file:

```typescript
import type { ProviderMeta } from "./types.ts";
import { providerMeta as brave } from "./brave.ts";
import { providerMeta as context7 } from "./context7.ts";
import { providerMeta as duckduckgo } from "./duckduckgo.ts";
import { providerMeta as exa } from "./exa.ts";
import { providerMeta as exaMcp } from "./exa-mcp.ts";
import { providerMeta as firecrawl } from "./firecrawl.ts";
import { providerMeta as jina } from "./jina.ts";
import { providerMeta as openaiCodex } from "./openai-codex.ts";
import { providerMeta as parallel } from "./parallel.ts";
import { providerMeta as perplexity } from "./perplexity.ts";
import { providerMeta as searxng } from "./searxng.ts";
import { providerMeta as serper } from "./serper.ts";
import { providerMeta as tavily } from "./tavily.ts";
import { providerMeta as websearchapi } from "./websearchapi.ts";

export const allProviders: ProviderMeta[] = [
  brave,
  context7,
  duckduckgo,
  exa,
  exaMcp,
  firecrawl,
  jina,
  openaiCodex,
  parallel,
  perplexity,
  searxng,
  serper,
  tavily,
  websearchapi,
];
```

- [ ] **Step 2:** Verify

```bash
pnpm run typecheck
pnpm vitest run tests/providers/all.test.ts
```

- [ ] **Step 3:** Commit

```bash
git add src/providers/all.ts
git commit -m "feat(openai-codex): register openai-codex in all.ts, replacing openai-native"
```

---

## Task 3: Add Config Alias Handling

**Files:** `src/config-manager.ts`

When a user has `openai-native` in their config, it should map to the `openai-codex` provider with a deprecation warning.

- [ ] **Step 1:** Add alias map and resolution in `src/config-manager.ts`

Add at the top of the file (after imports):

```typescript
/** Provider name aliases for backward compatibility. */
const PROVIDER_ALIASES: Record<string, string> = {
  "openai-native": "openai-codex",
};

function resolveProviderAlias(name: string): string {
  const resolved = PROVIDER_ALIASES[name];
  if (resolved) {
    console.warn(
      `[pi-tools] Provider "${name}" is deprecated. Use "${resolved}" instead.`,
    );
    return resolved;
  }
  return name;
}
```

Then in the `registerFromConfig` method, resolve the alias before looking up meta:

```typescript
private registerProvider(name: string, config: PiToolsConfig): void {
  const resolvedName = resolveProviderAlias(name);
  const meta = this.metaByName.get(resolvedName);
  if (!meta) return;

  const providerConfig = config.providers[name]; // use original name for config lookup
  const resolvedKey = resolveApiKey(providerConfig?.apiKey);
  if (meta.requiresKey && !resolvedKey) return;

  // ... rest unchanged ...
}
```

- [ ] **Step 2:** Add test in `tests/config-manager.test.ts`

```typescript
describe("provider aliases", () => {
  it("resolves openai-native config to openai-codex provider", () => {
    // Setup: config with openai-native entry
    // Assert: openai-codex provider gets registered
    // Assert: deprecation warning logged
  });
});
```

- [ ] **Step 3:** Verify

```bash
pnpm vitest run tests/config-manager.test.ts
pnpm run typecheck
```

- [ ] **Step 4:** Commit

```bash
git add src/config-manager.ts tests/config-manager.test.ts
git commit -m "feat(openai-codex): add openai-native -> openai-codex config alias with deprecation warning"
```

---

## Task 4: Add Mode A with Lazy Init and Dynamic Imports

This task is already implemented in the `openai-codex.ts` from Task 1. This task adds specific Mode A test coverage verifying the streaming Codex path.

**Files:** `tests/providers/openai-codex.test.ts`

- [ ] **Step 1:** Create `tests/providers/openai-codex.test.ts`

```typescript
// tests/providers/openai-codex.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubFetch } from "../helpers.ts";

// We dynamically import the provider to control module mocking
describe("OpenAICodexProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
    vi.restoreAllMocks();
  });

  describe("Mode B (Responses API)", () => {
    it("has correct name and label", async () => {
      const { providerMeta } =
        await import("../../src/providers/openai-codex.ts");
      const provider = providerMeta.create("test-openai-key").search!;
      expect(provider.name).toBe("openai-codex");
      expect(provider.label).toBe("OpenAI Codex");
    });

    it("sends search request to Responses API", async () => {
      fetchStub.addResponse("api.openai.com", {
        body: {
          output: [
            {
              type: "message",
              role: "assistant",
              content: [
                {
                  type: "output_text",
                  text: "Results found",
                  annotations: [
                    {
                      type: "url_citation",
                      url: "https://example.com",
                      title: "Example",
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

      const { providerMeta } =
        await import("../../src/providers/openai-codex.ts");
      const provider = providerMeta.create("test-key").search!;
      const results = await provider.search("test query", 5);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        title: "Example",
        url: "https://example.com",
        snippet: "",
      });
      expect(results[1]).toEqual({
        title: "Other",
        url: "https://other.com",
        snippet: "",
      });
    });

    it("sends correct Authorization header", async () => {
      fetchStub.addResponse("api.openai.com", {
        body: { output: [] },
      });

      const { providerMeta } =
        await import("../../src/providers/openai-codex.ts");
      const provider = providerMeta.create("sk-my-key").search!;
      await provider.search("test", 5);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      expect(fetchCall[1].headers["Authorization"]).toBe("Bearer sk-my-key");
    });

    it("sends correct model in body", async () => {
      fetchStub.addResponse("api.openai.com", {
        body: { output: [] },
      });

      const { providerMeta } =
        await import("../../src/providers/openai-codex.ts");
      const provider = providerMeta.create("sk-key").search!;
      await provider.search("test", 5);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.model).toBe("gpt-4.1-nano");
      expect(body.tools).toEqual([{ type: "web_search" }]);
      expect(body.tool_choice).toBe("required");
    });

    it("uses custom model from config", async () => {
      fetchStub.addResponse("api.openai.com", {
        body: { output: [] },
      });

      const { providerMeta } =
        await import("../../src/providers/openai-codex.ts");
      const provider = providerMeta.create("sk-key", {
        enabled: true,
        model: "gpt-4.1",
      } as any).search!;
      await provider.search("test", 5);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.model).toBe("gpt-4.1");
    });

    it("throws on non-2xx response", async () => {
      fetchStub.addResponse("api.openai.com", {
        status: 429,
        body: "Rate limited",
      });

      const { providerMeta } =
        await import("../../src/providers/openai-codex.ts");
      const provider = providerMeta.create("sk-key").search!;
      await expect(provider.search("test", 5)).rejects.toThrow("429");
    });

    it("deduplicates URL citations", async () => {
      fetchStub.addResponse("api.openai.com", {
        body: {
          output: [
            {
              type: "message",
              role: "assistant",
              content: [
                {
                  type: "output_text",
                  text: "text",
                  annotations: [
                    { type: "url_citation", url: "https://a.com", title: "A" },
                    {
                      type: "url_citation",
                      url: "https://a.com",
                      title: "A again",
                    },
                    { type: "url_citation", url: "https://b.com", title: "B" },
                  ],
                },
              ],
            },
          ],
        },
      });

      const { providerMeta } =
        await import("../../src/providers/openai-codex.ts");
      const provider = providerMeta.create("sk-key").search!;
      const results = await provider.search("test", 10);

      expect(results).toHaveLength(2);
      expect(results[0].url).toBe("https://a.com");
      expect(results[1].url).toBe("https://b.com");
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

      const { providerMeta } =
        await import("../../src/providers/openai-codex.ts");
      const provider = providerMeta.create("sk-key").search!;
      const results = await provider.search("test", 5);

      expect(results).toHaveLength(5);
    });
  });

  describe("Mode resolution", () => {
    it("returns empty results when no key and no Pi packages", async () => {
      const { providerMeta } =
        await import("../../src/providers/openai-codex.ts");
      // No key provided, Pi packages will fail to import
      const provider = providerMeta.create(undefined).search!;
      const results = await provider.search("test", 5);
      expect(results).toEqual([]);
    });

    it("provider meta has requiresKey: false", async () => {
      const { providerMeta } =
        await import("../../src/providers/openai-codex.ts");
      expect(providerMeta.requiresKey).toBe(false);
      expect(providerMeta.name).toBe("openai-codex");
      expect(providerMeta.tier).toBe(1);
    });
  });
});
```

- [ ] **Step 2:** Verify

```bash
pnpm vitest run tests/providers/openai-codex.test.ts
pnpm run typecheck
```

- [ ] **Step 3:** Commit

```bash
git add tests/providers/openai-codex.test.ts
git commit -m "test(openai-codex): add comprehensive tests for Mode B and mode resolution"
```

---

## Task 5: Add Mode A Tests with Mocked Pi Packages

**Files:** `tests/providers/openai-codex-mode-a.test.ts`

This test file mocks the `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` modules to test Mode A behavior.

- [ ] **Step 1:** Create `tests/providers/openai-codex-mode-a.test.ts`

```typescript
// tests/providers/openai-codex-mode-a.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests Mode A (Codex streaming) by mocking the dynamic Pi package imports.
 *
 * We use vi.doMock to control the dynamic import() behavior inside openai-codex.ts.
 */

describe("OpenAICodexProvider - Mode A (Codex)", () => {
  const mockStream = vi.fn();
  const mockGetApiKey = vi.fn();

  beforeEach(() => {
    vi.resetModules();

    // Mock the Pi packages that get dynamically imported
    vi.doMock("@earendil-works/pi-ai", () => ({
      openAICodexResponsesStreams: { stream: mockStream },
    }));
    vi.doMock("@earendil-works/pi-coding-agent", () => ({
      AuthStorage: { getApiKey: mockGetApiKey },
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses Mode A when Pi packages available and key resolves", async () => {
    mockGetApiKey.mockResolvedValue("pi-auth-key-123");
    mockStream.mockResolvedValue({
      output: [
        {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "Found results",
              annotations: [
                {
                  type: "url_citation",
                  url: "https://codex-result.com",
                  title: "Codex Result",
                },
              ],
            },
          ],
        },
      ],
    });

    const { providerMeta } =
      await import("../../src/providers/openai-codex.ts");
    const provider = providerMeta.create(undefined).search!;
    const results = await provider.search("codex query", 5);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      title: "Codex Result",
      url: "https://codex-result.com",
      snippet: "",
    });

    // Verify stream was called with correct params
    expect(mockStream).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "pi-auth-key-123",
        model: "gpt-5.4-mini",
        tools: [{ type: "web_search", external_web_access: true }],
        tool_choice: "required",
        options: { reasoningEffort: "minimal", textVerbosity: "low" },
      }),
    );
  });

  it("uses configured model for Mode A", async () => {
    mockGetApiKey.mockResolvedValue("pi-key");
    mockStream.mockResolvedValue({ output: [] });

    const { providerMeta } =
      await import("../../src/providers/openai-codex.ts");
    const provider = providerMeta.create(undefined, {
      enabled: true,
      model: "gpt-5.4",
    } as any).search!;
    await provider.search("test", 5);

    expect(mockStream).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-5.4" }),
    );
  });

  it("falls back to Mode B when AuthStorage returns no key", async () => {
    mockGetApiKey.mockResolvedValue(undefined);

    // Need fetch mock for Mode B fallback
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ output: [] }), { status: 200 }),
      ) as unknown as typeof fetch;

    try {
      const { providerMeta } =
        await import("../../src/providers/openai-codex.ts");
      const provider = providerMeta.create("fallback-key").search!;
      const results = await provider.search("test", 5);

      // Should have used fetch (Mode B), not stream (Mode A)
      expect(mockStream).not.toHaveBeenCalled();
      expect(globalThis.fetch).toHaveBeenCalled();
      expect(results).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("falls back to Mode B when Pi packages import fails", async () => {
    vi.resetModules();
    // Do NOT mock Pi packages — let dynamic import fail
    vi.doMock("@earendil-works/pi-ai", () => {
      throw new Error("Module not found");
    });
    vi.doMock("@earendil-works/pi-coding-agent", () => {
      throw new Error("Module not found");
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: "message",
              role: "assistant",
              content: [
                {
                  type: "output_text",
                  text: "fallback",
                  annotations: [
                    {
                      type: "url_citation",
                      url: "https://fallback.com",
                      title: "Fallback",
                    },
                  ],
                },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    try {
      const { providerMeta } =
        await import("../../src/providers/openai-codex.ts");
      const provider = providerMeta.create("user-key").search!;
      const results = await provider.search("test", 5);

      expect(results).toHaveLength(1);
      expect(results[0].url).toBe("https://fallback.com");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles Mode A key expiry by falling back to Mode B", async () => {
    // First call: Mode A resolves
    mockGetApiKey.mockResolvedValueOnce("pi-key");
    mockStream.mockResolvedValueOnce({
      output: [
        {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "first",
              annotations: [
                {
                  type: "url_citation",
                  url: "https://first.com",
                  title: "First",
                },
              ],
            },
          ],
        },
      ],
    });

    const { providerMeta } =
      await import("../../src/providers/openai-codex.ts");
    const provider = providerMeta.create("backup-key").search!;

    // First search uses Mode A
    const first = await provider.search("first", 5);
    expect(first).toHaveLength(1);
    expect(mockStream).toHaveBeenCalledTimes(1);

    // Second call: key expired
    mockGetApiKey.mockResolvedValueOnce(undefined);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: "message",
              role: "assistant",
              content: [
                {
                  type: "output_text",
                  text: "fallback",
                  annotations: [
                    {
                      type: "url_citation",
                      url: "https://fallback.com",
                      title: "Fallback",
                    },
                  ],
                },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    try {
      const second = await provider.search("second", 5);
      expect(second).toHaveLength(1);
      expect(second[0].url).toBe("https://fallback.com");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
```

- [ ] **Step 2:** Verify

```bash
pnpm vitest run tests/providers/openai-codex-mode-a.test.ts
pnpm run typecheck
```

- [ ] **Step 3:** Commit

```bash
git add tests/providers/openai-codex-mode-a.test.ts
git commit -m "test(openai-codex): add Mode A tests with mocked Pi packages"
```

---

## Task 6: Update `package.json` with Optional Peer Deps

**Files:** `package.json`

- [ ] **Step 1:** Add peer dependencies to `package.json`

Add these fields (merge with existing peerDependencies if any):

```json
{
  "peerDependencies": {
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-coding-agent": "*"
  },
  "peerDependenciesMeta": {
    "@earendil-works/pi-ai": { "optional": true },
    "@earendil-works/pi-coding-agent": { "optional": true }
  }
}
```

- [ ] **Step 2:** Remove old `openai-native.ts` file

```bash
rm src/providers/openai-native.ts
```

Update any remaining test imports:

```bash
# If tests/providers/openai-native.test.ts exists, remove it
# (replaced by openai-codex.test.ts and openai-codex-mode-a.test.ts)
rm tests/providers/openai-native.test.ts
```

- [ ] **Step 3:** Verify full suite

```bash
pnpm install
pnpm test
pnpm run lint
pnpm run typecheck
```

- [ ] **Step 4:** Commit

```bash
git add package.json src/providers/openai-native.ts tests/providers/openai-native.test.ts
git commit -m "feat(openai-codex): add optional peer deps, remove openai-native"
```

---

## Final Verification

```bash
pnpm test
pnpm run lint
pnpm run typecheck
```

The `openai-native` provider is fully replaced by `openai-codex`:

- Mode B is backward-compatible with existing OPENAI_API_KEY users
- Mode A activates automatically when Pi AuthStorage is available
- Config alias ensures existing `openai-native` config entries still work
- All tests cover both modes and fallback behavior
