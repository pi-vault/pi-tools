# Search Providers Phase 7: Dual-Mode OpenAI Codex

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `openai-native` with a dual-mode `openai-codex` provider supporting both Pi AuthStorage (Mode A: streaming Codex with rich snippets) and user OPENAI_API_KEY (Mode B: Responses API with url_citation parsing).

**Architecture:**

- Mode A: Pi packages available + AuthStorage has key -> `streamOpenAICodexResponses(model, context, options)` with `submit_search_results` tool
- Mode B: User OPENAI_API_KEY -> POST to OpenAI Responses API (same as current openai-native behavior)
- Lazy init pattern: mode resolved on first `search()` call since `AuthStorage.getApiKey()` is async
- Config alias: `openai-native` in config maps to `openai-codex` with deprecation warning

**Reference implementation:** `ronnieops-pi-search-hub/extensions/backends/openai-codex.ts`

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

## Task 1: Create `openai-codex.ts` with Dual-Mode Provider

**Files:** `src/providers/openai-codex.ts`

This task creates the new provider with both Mode A (Codex streaming) and Mode B (Responses API).

- [ ] **Step 1:** Create `src/providers/openai-codex.ts`

```typescript
// src/providers/openai-codex.ts
import type { ProviderConfigEntry } from "../config.ts";
import type { ProviderMeta, SearchProvider, SearchResult } from "./types.ts";
import { parseOpenAINativeResults } from "./parsers.ts";

/**
 * Dual-mode OpenAI Codex provider.
 *
 * Mode A (Codex): Uses Pi AuthStorage + streamOpenAICodexResponses via @earendil-works/pi-ai.
 *   Activated when Pi packages are available and AuthStorage has an openai-codex key.
 *   Returns rich snippets via submit_search_results tool call.
 *
 * Mode B (Responses API): Uses user-provided OPENAI_API_KEY with the Responses API.
 *   Activated as fallback when Mode A is unavailable.
 *   Returns url_citation annotations (title + url, no snippets).
 *
 * Mode resolution is deferred to first search() call (lazy init) because
 * AuthStorage.getApiKey() is async but ProviderMeta.create() is sync.
 */

const DEFAULT_MODEL_A = "gpt-5.4-mini";
const DEFAULT_MODEL_B = "gpt-4.1-nano";
const RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const DEFAULT_SEARCH_CONTEXT_SIZE = "low";
const MAX_TOOL_RESULTS = 20;
const MAX_TITLE_LENGTH = 200;
const MAX_SNIPPET_LENGTH = 1000;

type ResolvedMode = "codex" | "responses-api" | "unavailable";

// Minimal type shapes for dynamically imported Pi packages.
// These avoid compile-time dependency on @earendil-works/pi-ai and pi-coding-agent.
interface PiStreamFn {
  (model: unknown, context: unknown, options: unknown): { result(): Promise<PiStreamMessage> };
}
interface PiGetModelFn {
  (provider: string, modelId: string): unknown | undefined;
}
interface PiAuthStorage {
  getApiKey(provider: string, opts?: { includeFallback?: boolean }): Promise<string | undefined>;
}
interface PiStreamMessage {
  stopReason: string;
  errorMessage?: string;
  content: Array<{ type: string; name?: string; arguments?: unknown }>;
}

class OpenAICodexProvider implements SearchProvider {
  readonly name = "openai-codex";
  readonly label = "OpenAI Codex";

  private readonly userApiKey?: string;
  private readonly model?: string;
  private resolvedMode: ResolvedMode | null = null;

  // Mode A dependencies (resolved lazily via dynamic import)
  private streamFn: PiStreamFn | null = null;
  private getModelFn: PiGetModelFn | null = null;
  private authStorage: PiAuthStorage | null = null;

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
          streamOpenAICodexResponses: PiStreamFn;
          getModel: PiGetModelFn;
        }>,
        import("@earendil-works/pi-coding-agent") as Promise<{
          AuthStorage: { create(): PiAuthStorage };
        }>,
      ]);

      const authStorage = piAgent.AuthStorage.create();
      const key = await authStorage.getApiKey("openai-codex", {
        includeFallback: false,
      });
      if (key) {
        this.streamFn = piAi.streamOpenAICodexResponses;
        this.getModelFn = piAi.getModel;
        this.authStorage = authStorage;
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
   * Uses streamOpenAICodexResponses with web_search tool injection via onPayload,
   * and a submit_search_results tool for structured result extraction.
   */
  private async searchModeA(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
  ): Promise<SearchResult[]> {
    if (!this.streamFn || !this.getModelFn || !this.authStorage) return [];

    // Re-fetch key each call (tokens can expire)
    const apiKey = await this.authStorage.getApiKey("openai-codex", {
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

    const modelId = this.model ?? DEFAULT_MODEL_A;
    const model = this.getModelFn("openai-codex", modelId);
    if (!model) return [];

    const context = {
      systemPrompt: buildSystemPrompt(maxResults),
      messages: [{ role: "user", content: query, timestamp: Date.now() }],
      tools: [SUBMIT_SEARCH_RESULTS_TOOL],
    };

    const message = await this.streamFn(model, context, {
      apiKey,
      signal,
      transport: "sse",
      reasoningEffort: "minimal",
      textVerbosity: "low",
      onPayload: injectCodexSearchPayload,
    }).result();

    if (message.stopReason === "error" || message.stopReason === "aborted") {
      return [];
    }

    const submitCall = message.content.find(
      (block) => block.type === "toolCall" && block.name === "submit_search_results",
    );
    if (!submitCall || submitCall.type !== "toolCall") return [];

    return normalizeCodexToolCallResults(submitCall.arguments, maxResults);
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

// --- Mode A helpers ---

const SUBMIT_SEARCH_RESULTS_TOOL = {
  name: "submit_search_results",
  description: "Submit structured search results based on the available source evidence.",
  parameters: {
    type: "object",
    properties: {
      results: {
        type: "array",
        maxItems: MAX_TOOL_RESULTS,
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Page title or clearest source title for the URL." },
            url: { type: "string", description: "Canonical http/https URL for the result." },
            snippet: {
              type: "string",
              description:
                "A dense 450-500 character, multi-sentence paragraph with the most query-relevant facts, claims, numbers, dates, and source-specific details. Prefer completeness and concrete details over brevity.",
            },
          },
          required: ["title", "url", "snippet"],
        },
      },
    },
    required: ["results"],
  },
} as const;

function buildSystemPrompt(numResults: number): string {
  return [
    `Research the user's query with hosted web_search and call submit_search_results exactly once with at most ${numResults} results.`,
    "Return only real http/https URLs.",
    "Prefer primary sources.",
    "For snippet, write a dense 450-500 character, multi-sentence paragraph with the most query-relevant facts.",
    "Do not invent details or present unsupported text as source content.",
    "No prose. No internal references.",
  ].join(" ");
}

/**
 * Payload injection callback for streamOpenAICodexResponses.
 * Adds web_search tool with external_web_access and search_context_size.
 */
export function injectCodexSearchPayload(payload: unknown): unknown {
  const body = isRecord(payload) ? payload : {};
  const existingTools = Array.isArray(body.tools) ? body.tools.filter(Boolean) : [];
  const filteredTools = existingTools.filter((tool) => {
    if (!isRecord(tool)) return true;
    return tool.type !== "web_search";
  });

  body.tools = [
    { type: "web_search", external_web_access: true, search_context_size: DEFAULT_SEARCH_CONTEXT_SIZE },
    ...filteredTools,
  ];
  body.tool_choice = "auto";
  body.parallel_tool_calls = false;

  const include = Array.isArray(body.include)
    ? body.include.filter((value): value is string => typeof value === "string")
    : [];
  body.include = Array.from(new Set([...include, "web_search_call.action.sources"]));

  return body;
}

/**
 * Parse the submit_search_results tool call arguments into SearchResult[].
 */
export function normalizeCodexToolCallResults(args: unknown, maxResults: number): SearchResult[] {
  if (!isRecord(args) || !Array.isArray(args.results)) return [];

  const limit = Math.max(1, Math.min(maxResults, MAX_TOOL_RESULTS));
  const seen = new Set<string>();
  const results: SearchResult[] = [];

  for (const raw of args.results) {
    if (!isRecord(raw)) continue;

    const url = normalizeHttpUrl(raw.url);
    if (!url) continue;

    // Deduplicate by normalized URL
    const dedupeKey = url.toLowerCase().replace(/\/+$/, "");
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const title = truncateText(cleanString(raw.title) || safeHostname(url), MAX_TITLE_LENGTH);
    const snippet = truncateText(cleanString(raw.snippet), MAX_SNIPPET_LENGTH);

    results.push({ title, url, snippet });
    if (results.length >= limit) break;
  }

  return results;
}

function normalizeHttpUrl(value: unknown): string | undefined {
  const input = cleanString(value);
  if (!input) return undefined;
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function safeHostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// --- Factory + Meta ---

export function createOpenAICodexProvider(
  key?: string,
  providerConfig?: ProviderConfigEntry,
): SearchProvider {
  return new OpenAICodexProvider(key, providerConfig);
}

export const providerMeta: ProviderMeta = {
  name: "openai-codex",
  tier: 1,
  monthlyQuota: null,
  requiresKey: false, // either Pi auth or user key — resolved lazily
  create: (key, providerConfig) => ({
    search: createOpenAICodexProvider(key, providerConfig),
  }),
};
```

- [ ] **Step 2:** Verify file compiles

```bash
pnpm run typecheck
```

- [ ] **Step 3:** Commit

```bash
git add src/providers/openai-codex.ts
git commit -m "feat(openai-codex): create dual-mode provider with Mode A (Codex) and Mode B (Responses API)"
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

The rest of the file remains unchanged (brave, braveLlm, context7, duckduckgo, exa, exaMcp, fastcrw, firecrawl, jina, langsearch, linkup, marginalia, parallel, perplexity, searxng, serper, sofya, tavily, websearchapi, youcom).

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

**Files:** `src/config-manager.ts`, `tests/config-manager.test.ts`

When a user has `openai-native` in their config, it should map to the `openai-codex` provider with a deprecation warning.

- [ ] **Step 1:** Add alias resolution in `src/config-manager.ts`

Add after imports, before the `ConfigChangeSet` interface:

```typescript
/** Provider name aliases for backward compatibility. */
const PROVIDER_ALIASES: Record<string, string> = {
  "openai-native": "openai-codex",
};

function resolveProviderAlias(name: string): { resolved: string; aliased: boolean } {
  const resolved = PROVIDER_ALIASES[name];
  if (resolved) {
    console.warn(
      `[pi-tools] Provider "${name}" is deprecated. Use "${resolved}" instead.`,
    );
    return { resolved, aliased: true };
  }
  return { resolved: name, aliased: false };
}
```

Then update the `registerProvider` method to resolve aliases:

```typescript
private registerProvider(name: string, config: PiToolsConfig): void {
  const { resolved } = resolveProviderAlias(name);
  const meta = this.metaByName.get(resolved);
  if (!meta) return;

  const providerConfig = config.providers[name]; // use original name for config lookup
  const resolvedKey = resolveApiKey(providerConfig?.apiKey);
  if (meta.requiresKey && !resolvedKey) return;

  const configWithSsrf = { ...providerConfig, ssrfAllowRanges: config.ssrf.allowRanges };

  let instances: ReturnType<typeof meta.create>;
  try {
    instances = meta.create(resolvedKey, configWithSsrf);
  } catch {
    return;
  }
  const quota = providerConfig?.monthlyQuota ?? meta.monthlyQuota;

  if (instances.search) {
    this.registry.registerSearch(instances.search, { tier: meta.tier, monthlyQuota: quota });
  }
  if (instances.fetch) {
    this.registry.registerFetch(instances.fetch);
  }
  if (instances.codeSearch) {
    this.registry.registerCodeSearch(instances.codeSearch);
  }
  if (instances.docs) {
    this.registry.registerDocs(instances.docs);
  }
}
```

- [ ] **Step 2:** Add test for alias resolution in `tests/config-manager.test.ts`

```typescript
describe("provider aliases", () => {
  it("resolves openai-native config to openai-codex provider", () => {
    // Create ConfigManager with a config containing openai-native
    // Verify that the openai-codex provider gets registered
    // Verify deprecation warning is logged via console.warn
  });

  it("does not warn for non-aliased provider names", () => {
    // Create ConfigManager with a config containing openai-codex directly
    // Verify no deprecation warning
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

## Task 4: Add Mode B Tests

**Files:** `tests/providers/openai-codex.test.ts`

- [ ] **Step 1:** Create `tests/providers/openai-codex.test.ts`

```typescript
// tests/providers/openai-codex.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubFetch } from "../helpers.ts";

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
    // Pi packages will fail to dynamically import in test env,
    // so provider falls back to Mode B when a user key is provided.

    it("has correct name and label", async () => {
      const { providerMeta } = await import("../../src/providers/openai-codex.ts");
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
                    { type: "url_citation", url: "https://example.com", title: "Example" },
                    { type: "url_citation", url: "https://other.com", title: "Other" },
                  ],
                },
              ],
            },
          ],
        },
      });

      const { providerMeta } = await import("../../src/providers/openai-codex.ts");
      const provider = providerMeta.create("test-key").search!;
      const results = await provider.search("test query", 5);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ title: "Example", url: "https://example.com", snippet: "" });
      expect(results[1]).toEqual({ title: "Other", url: "https://other.com", snippet: "" });
    });

    it("sends correct Authorization header and body", async () => {
      fetchStub.addResponse("api.openai.com", { body: { output: [] } });

      const { providerMeta } = await import("../../src/providers/openai-codex.ts");
      const provider = providerMeta.create("sk-my-key").search!;
      await provider.search("test", 5);

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(fetchCall[1].headers["Authorization"]).toBe("Bearer sk-my-key");
      const body = JSON.parse(fetchCall[1].body);
      expect(body.model).toBe("gpt-4.1-nano");
      expect(body.tools).toEqual([{ type: "web_search" }]);
      expect(body.tool_choice).toBe("required");
    });

    it("uses custom model from config", async () => {
      fetchStub.addResponse("api.openai.com", { body: { output: [] } });

      const { providerMeta } = await import("../../src/providers/openai-codex.ts");
      const provider = providerMeta.create("sk-key", { enabled: true, model: "gpt-4.1" } as any).search!;
      await provider.search("test", 5);

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.model).toBe("gpt-4.1");
    });

    it("throws on non-2xx response", async () => {
      fetchStub.addResponse("api.openai.com", { status: 429, body: "Rate limited" });

      const { providerMeta } = await import("../../src/providers/openai-codex.ts");
      const provider = providerMeta.create("sk-key").search!;
      await expect(provider.search("test", 5)).rejects.toThrow("429");
    });

    it("deduplicates URL citations", async () => {
      fetchStub.addResponse("api.openai.com", {
        body: {
          output: [{
            type: "message", role: "assistant",
            content: [{
              type: "output_text", text: "text",
              annotations: [
                { type: "url_citation", url: "https://a.com", title: "A" },
                { type: "url_citation", url: "https://a.com", title: "A again" },
                { type: "url_citation", url: "https://b.com", title: "B" },
              ],
            }],
          }],
        },
      });

      const { providerMeta } = await import("../../src/providers/openai-codex.ts");
      const provider = providerMeta.create("sk-key").search!;
      const results = await provider.search("test", 10);

      expect(results).toHaveLength(2);
      expect(results[0].url).toBe("https://a.com");
      expect(results[1].url).toBe("https://b.com");
    });

    it("respects maxResults limit", async () => {
      const annotations = Array.from({ length: 20 }, (_, i) => ({
        type: "url_citation", url: `https://site${i}.com`, title: `Site ${i}`,
      }));

      fetchStub.addResponse("api.openai.com", {
        body: {
          output: [{
            type: "message", role: "assistant",
            content: [{ type: "output_text", text: "text", annotations }],
          }],
        },
      });

      const { providerMeta } = await import("../../src/providers/openai-codex.ts");
      const provider = providerMeta.create("sk-key").search!;
      const results = await provider.search("test", 5);
      expect(results).toHaveLength(5);
    });
  });

  describe("Mode resolution", () => {
    it("returns empty results when no key and no Pi packages", async () => {
      const { providerMeta } = await import("../../src/providers/openai-codex.ts");
      const provider = providerMeta.create(undefined).search!;
      const results = await provider.search("test", 5);
      expect(results).toEqual([]);
    });

    it("provider meta has requiresKey: false", async () => {
      const { providerMeta } = await import("../../src/providers/openai-codex.ts");
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
 * Uses vi.doMock to control the dynamic import() behavior inside openai-codex.ts.
 */
describe("OpenAICodexProvider - Mode A (Codex)", () => {
  const mockStream = vi.fn();
  const mockGetModel = vi.fn();
  const mockGetApiKey = vi.fn();

  beforeEach(() => {
    vi.resetModules();

    // Mock the Pi packages that get dynamically imported
    vi.doMock("@earendil-works/pi-ai", () => ({
      streamOpenAICodexResponses: mockStream,
      getModel: mockGetModel,
    }));
    vi.doMock("@earendil-works/pi-coding-agent", () => ({
      AuthStorage: {
        create: () => ({ getApiKey: mockGetApiKey }),
      },
    }));

    // Default: getModel returns a truthy model object
    mockGetModel.mockReturnValue({ id: "gpt-5.4-mini", provider: "openai-codex" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses Mode A when Pi packages available and key resolves", async () => {
    mockGetApiKey.mockResolvedValue("pi-auth-key-123");
    mockStream.mockReturnValue({
      result: () => Promise.resolve({
        stopReason: "end_turn",
        content: [
          {
            type: "toolCall",
            name: "submit_search_results",
            arguments: {
              results: [
                { title: "Codex Result", url: "https://codex-result.com", snippet: "Rich snippet about the topic." },
              ],
            },
          },
        ],
      }),
    });

    const { providerMeta } = await import("../../src/providers/openai-codex.ts");
    const provider = providerMeta.create(undefined).search!;
    const results = await provider.search("codex query", 5);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      title: "Codex Result",
      url: "https://codex-result.com/",
      snippet: "Rich snippet about the topic.",
    });

    // Verify streamOpenAICodexResponses was called with correct structure
    expect(mockStream).toHaveBeenCalledWith(
      { id: "gpt-5.4-mini", provider: "openai-codex" }, // model object
      expect.objectContaining({
        systemPrompt: expect.stringContaining("submit_search_results"),
        messages: [expect.objectContaining({ role: "user", content: "codex query" })],
        tools: [expect.objectContaining({ name: "submit_search_results" })],
      }),
      expect.objectContaining({
        apiKey: "pi-auth-key-123",
        transport: "sse",
        reasoningEffort: "minimal",
        textVerbosity: "low",
        onPayload: expect.any(Function),
      }),
    );
  });

  it("uses configured model for Mode A", async () => {
    mockGetApiKey.mockResolvedValue("pi-key");
    mockStream.mockReturnValue({
      result: () => Promise.resolve({ stopReason: "end_turn", content: [] }),
    });

    const { providerMeta } = await import("../../src/providers/openai-codex.ts");
    const provider = providerMeta.create(undefined, { enabled: true, model: "gpt-5.4" } as any).search!;
    await provider.search("test", 5);

    expect(mockGetModel).toHaveBeenCalledWith("openai-codex", "gpt-5.4");
  });

  it("falls back to Mode B when AuthStorage returns no key", async () => {
    mockGetApiKey.mockResolvedValue(undefined);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ output: [] }), { status: 200 }),
    ) as unknown as typeof fetch;

    try {
      const { providerMeta } = await import("../../src/providers/openai-codex.ts");
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
    vi.doMock("@earendil-works/pi-ai", () => { throw new Error("Module not found"); });
    vi.doMock("@earendil-works/pi-coding-agent", () => { throw new Error("Module not found"); });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        output: [{
          type: "message", role: "assistant",
          content: [{
            type: "output_text", text: "fallback",
            annotations: [{ type: "url_citation", url: "https://fallback.com", title: "Fallback" }],
          }],
        }],
      }), { status: 200 }),
    ) as unknown as typeof fetch;

    try {
      const { providerMeta } = await import("../../src/providers/openai-codex.ts");
      const provider = providerMeta.create("user-key").search!;
      const results = await provider.search("test", 5);

      expect(results).toHaveLength(1);
      expect(results[0].url).toBe("https://fallback.com");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles Mode A key expiry by falling back to Mode B mid-session", async () => {
    // First call: Mode A resolves successfully
    mockGetApiKey.mockResolvedValueOnce("pi-key");
    mockStream.mockReturnValueOnce({
      result: () => Promise.resolve({
        stopReason: "end_turn",
        content: [{
          type: "toolCall", name: "submit_search_results",
          arguments: { results: [{ title: "First", url: "https://first.com", snippet: "First result." }] },
        }],
      }),
    });

    const { providerMeta } = await import("../../src/providers/openai-codex.ts");
    const provider = providerMeta.create("backup-key").search!;

    // First search uses Mode A
    const first = await provider.search("first", 5);
    expect(first).toHaveLength(1);
    expect(mockStream).toHaveBeenCalledTimes(1);

    // Second call: key expired
    mockGetApiKey.mockResolvedValueOnce(undefined);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        output: [{
          type: "message", role: "assistant",
          content: [{
            type: "output_text", text: "fallback",
            annotations: [{ type: "url_citation", url: "https://fallback.com", title: "Fallback" }],
          }],
        }],
      }), { status: 200 }),
    ) as unknown as typeof fetch;

    try {
      const second = await provider.search("second", 5);
      expect(second).toHaveLength(1);
      expect(second[0].url).toBe("https://fallback.com");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns empty when stream returns error stopReason", async () => {
    mockGetApiKey.mockResolvedValue("pi-key");
    mockStream.mockReturnValue({
      result: () => Promise.resolve({
        stopReason: "error",
        errorMessage: "Rate limit exceeded",
        content: [],
      }),
    });

    const { providerMeta } = await import("../../src/providers/openai-codex.ts");
    const provider = providerMeta.create(undefined).search!;
    const results = await provider.search("test", 5);
    expect(results).toEqual([]);
  });

  it("returns empty when model is not found", async () => {
    mockGetApiKey.mockResolvedValue("pi-key");
    mockGetModel.mockReturnValue(undefined); // model not found

    const { providerMeta } = await import("../../src/providers/openai-codex.ts");
    const provider = providerMeta.create(undefined).search!;
    const results = await provider.search("test", 5);
    expect(results).toEqual([]);
    expect(mockStream).not.toHaveBeenCalled();
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

## Task 6: Unit Tests for Exported Helpers

**Files:** `tests/providers/openai-codex-helpers.test.ts`

Test the exported helper functions (`injectCodexSearchPayload`, `normalizeCodexToolCallResults`) in isolation.

- [ ] **Step 1:** Create `tests/providers/openai-codex-helpers.test.ts`

```typescript
// tests/providers/openai-codex-helpers.test.ts
import { describe, expect, it } from "vitest";
import { injectCodexSearchPayload, normalizeCodexToolCallResults } from "../../src/providers/openai-codex.ts";

describe("injectCodexSearchPayload", () => {
  it("adds web_search tool with external_web_access", () => {
    const result = injectCodexSearchPayload({}) as Record<string, unknown>;
    const tools = result.tools as Array<Record<string, unknown>>;
    expect(tools[0]).toEqual({
      type: "web_search",
      external_web_access: true,
      search_context_size: "low",
    });
  });

  it("removes existing web_search tools", () => {
    const input = { tools: [{ type: "web_search" }, { type: "function", name: "foo" }] };
    const result = injectCodexSearchPayload(input) as Record<string, unknown>;
    const tools = result.tools as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(2); // new web_search + foo
    expect(tools[1]).toEqual({ type: "function", name: "foo" });
  });

  it("sets tool_choice to auto and disables parallel_tool_calls", () => {
    const result = injectCodexSearchPayload({}) as Record<string, unknown>;
    expect(result.tool_choice).toBe("auto");
    expect(result.parallel_tool_calls).toBe(false);
  });

  it("adds web_search_call.action.sources to include", () => {
    const result = injectCodexSearchPayload({}) as Record<string, unknown>;
    expect(result.include).toContain("web_search_call.action.sources");
  });

  it("preserves existing include entries", () => {
    const input = { include: ["existing_value"] };
    const result = injectCodexSearchPayload(input) as Record<string, unknown>;
    expect(result.include).toContain("existing_value");
    expect(result.include).toContain("web_search_call.action.sources");
  });
});

describe("normalizeCodexToolCallResults", () => {
  it("extracts valid results from tool call arguments", () => {
    const args = {
      results: [
        { title: "Test", url: "https://example.com/page", snippet: "Description" },
      ],
    };
    const results = normalizeCodexToolCallResults(args, 10);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      title: "Test",
      url: "https://example.com/page",
      snippet: "Description",
    });
  });

  it("deduplicates by normalized URL", () => {
    const args = {
      results: [
        { title: "A", url: "https://example.com/page#section1", snippet: "First" },
        { title: "B", url: "https://example.com/page#section2", snippet: "Second" },
      ],
    };
    const results = normalizeCodexToolCallResults(args, 10);
    expect(results).toHaveLength(1); // hash stripped, same URL
  });

  it("rejects non-http URLs", () => {
    const args = {
      results: [
        { title: "FTP", url: "ftp://example.com", snippet: "Bad protocol" },
        { title: "Good", url: "https://example.com", snippet: "OK" },
      ],
    };
    const results = normalizeCodexToolCallResults(args, 10);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Good");
  });

  it("respects maxResults limit", () => {
    const args = {
      results: Array.from({ length: 20 }, (_, i) => ({
        title: `Site ${i}`, url: `https://site${i}.com`, snippet: `Snippet ${i}`,
      })),
    };
    const results = normalizeCodexToolCallResults(args, 5);
    expect(results).toHaveLength(5);
  });

  it("truncates long titles and snippets", () => {
    const args = {
      results: [{
        title: "X".repeat(300),
        url: "https://example.com",
        snippet: "Y".repeat(1500),
      }],
    };
    const results = normalizeCodexToolCallResults(args, 10);
    expect(results[0].title.length).toBe(200);
    expect(results[0].snippet.length).toBe(1000);
  });

  it("returns empty array for invalid arguments", () => {
    expect(normalizeCodexToolCallResults(null, 10)).toEqual([]);
    expect(normalizeCodexToolCallResults({}, 10)).toEqual([]);
    expect(normalizeCodexToolCallResults({ results: "not array" }, 10)).toEqual([]);
  });

  it("uses hostname as fallback title", () => {
    const args = {
      results: [{ title: "", url: "https://example.com/path", snippet: "Content" }],
    };
    const results = normalizeCodexToolCallResults(args, 10);
    expect(results[0].title).toBe("example.com");
  });
});
```

- [ ] **Step 2:** Verify

```bash
pnpm vitest run tests/providers/openai-codex-helpers.test.ts
pnpm run typecheck
```

- [ ] **Step 3:** Commit

```bash
git add tests/providers/openai-codex-helpers.test.ts
git commit -m "test(openai-codex): add unit tests for injectCodexSearchPayload and normalizeCodexToolCallResults"
```

---

## Task 7: Update `package.json` and Remove `openai-native`

**Files:** `package.json`, `src/providers/openai-native.ts`, `tests/providers/openai-native.test.ts`

- [ ] **Step 1:** Add `@earendil-works/pi-ai` to optional peer dependencies in `package.json`

The existing `peerDependencies` already includes `@earendil-works/pi-coding-agent`. Add `@earendil-works/pi-ai`:

```json
{
  "peerDependencies": {
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*"
  },
  "peerDependenciesMeta": {
    "@earendil-works/pi-ai": { "optional": true },
    "@earendil-works/pi-coding-agent": { "optional": true },
    "@earendil-works/pi-tui": { "optional": true }
  }
}
```

Also add `@earendil-works/pi-ai` to devDependencies (same version range as pi-coding-agent: `"^0.80.6"`).

- [ ] **Step 2:** Remove old provider and test files

```bash
rm src/providers/openai-native.ts
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
git add package.json pnpm-lock.yaml src/providers/openai-native.ts tests/providers/openai-native.test.ts
git commit -m "feat(openai-codex): add pi-ai optional peer dep, remove openai-native"
```

---

## Final Verification

```bash
pnpm test
pnpm run lint
pnpm run typecheck
```

The `openai-native` provider is fully replaced by `openai-codex`:

- Mode A activates automatically when Pi AuthStorage is available (rich snippets via submit_search_results tool)
- Mode B is backward-compatible with existing OPENAI_API_KEY users (url_citation annotation parsing)
- Config alias ensures existing `openai-native` config entries still work with deprecation warning
- Key expiry in Mode A gracefully falls back to Mode B
- All helpers exported for testability: `injectCodexSearchPayload`, `normalizeCodexToolCallResults`
