# Phase 1: Provider Resilience — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a search or fetch provider fails, automatically try the next available provider instead of returning an error. Collect all failures into a single actionable error message when every provider fails.

**Architecture:** Three changes — (1) `ProviderRegistry` gains a `selectSearchCandidates()` method that returns an ordered list instead of a single pick, (2) `web_search` loops through candidates with try/catch, (3) `web_fetch` falls back to registered `FetchProvider`s when the direct HTTP pipeline fails. A new `AggregateProviderError` collects per-provider errors for the "all failed" case.

**Tech Stack:** TypeScript, Vitest, existing pi-tools provider interfaces.

---

### Task 1: Add `AggregateProviderError`

**Files:**
- Modify: `src/utils/errors.ts`
- Modify: `tests/utils/errors.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/utils/errors.test.ts`:

```ts
import { AggregateProviderError } from "../../src/utils/errors.ts";

describe("AggregateProviderError", () => {
  it("formats multiple provider errors into a readable message", () => {
    const err = new AggregateProviderError("search", [
      { provider: "brave", error: "429 Too Many Requests" },
      { provider: "exa", error: "Request timeout" },
    ]);
    expect(err.message).toContain("All search providers failed");
    expect(err.message).toContain("brave: 429 Too Many Requests");
    expect(err.message).toContain("exa: Request timeout");
    expect(err).toBeInstanceOf(Error);
  });

  it("sanitizes secrets in individual error messages", () => {
    const err = new AggregateProviderError("search", [
      { provider: "brave", error: "token=sk-abc123456789xyz failed" },
    ]);
    expect(err.message).toContain("[redacted]");
    expect(err.message).not.toContain("sk-abc123456789xyz");
  });

  it("exposes the errors array for programmatic access", () => {
    const errors = [
      { provider: "brave", error: "429" },
      { provider: "exa", error: "timeout" },
    ];
    const err = new AggregateProviderError("fetch", errors);
    expect(err.errors).toEqual(errors);
    expect(err.message).toContain("All fetch providers failed");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/utils/errors.test.ts`
Expected: FAIL — `AggregateProviderError` is not exported from `src/utils/errors.ts`

- [ ] **Step 3: Implement `AggregateProviderError`**

Add to the bottom of `src/utils/errors.ts` (after the existing `sanitizeError` function):

```ts
export interface ProviderError {
  provider: string;
  error: string;
}

export class AggregateProviderError extends Error {
  readonly errors: ProviderError[];

  constructor(context: string, errors: ProviderError[]) {
    const lines = errors.map(
      (e) => `- ${e.provider}: ${sanitizeError(e.error)}`,
    );
    super(`All ${context} providers failed:\n${lines.join("\n")}`);
    this.name = "AggregateProviderError";
    this.errors = errors;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/utils/errors.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/errors.ts tests/utils/errors.test.ts
git commit -m "feat: add AggregateProviderError for multi-provider failure reporting"
```

---

### Task 2: Add `selectSearchCandidates()` to `ProviderRegistry`

**Files:**
- Modify: `src/providers/registry.ts`
- Modify: `tests/providers/registry.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/providers/registry.test.ts` inside the existing `describe("ProviderRegistry", ...)` block:

```ts
describe("selectSearchCandidates", () => {
  it("returns all providers ordered by tier then remaining quota", () => {
    const tracker = new UsageTracker();
    const registry = new ProviderRegistry(tracker);
    const brave = mockProvider("brave", "Brave");
    const serper = mockProvider("serper", "Serper");
    const perplexity = mockProvider("perplexity", "Perplexity");
    const ddg = mockProvider("duckduckgo", "DuckDuckGo");

    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
    registry.registerSearch(serper, { tier: 1, monthlyQuota: 2500 });
    registry.registerSearch(perplexity, { tier: 2, monthlyQuota: null });
    registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

    const candidates = registry.selectSearchCandidates();
    expect(candidates.map((c) => c.name)).toEqual([
      "serper",     // tier 1, highest remaining (2500)
      "brave",      // tier 1, lower remaining (2000)
      "perplexity", // tier 2
      "duckduckgo", // tier 3
    ]);
  });

  it("excludes exhausted providers", () => {
    const tracker = new UsageTracker();
    const registry = new ProviderRegistry(tracker);
    const brave = mockProvider("brave", "Brave");
    const ddg = mockProvider("duckduckgo", "DuckDuckGo");

    registry.registerSearch(brave, { tier: 1, monthlyQuota: 1 });
    registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

    registry.recordUsage("brave"); // exhausted
    const candidates = registry.selectSearchCandidates();
    expect(candidates.map((c) => c.name)).toEqual(["duckduckgo"]);
  });

  it("returns single-element array for explicit provider name", () => {
    const tracker = new UsageTracker();
    const registry = new ProviderRegistry(tracker);
    const brave = mockProvider("brave", "Brave");
    const ddg = mockProvider("duckduckgo", "DuckDuckGo");

    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
    registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

    const candidates = registry.selectSearchCandidates("duckduckgo");
    expect(candidates.map((c) => c.name)).toEqual(["duckduckgo"]);
  });

  it("returns empty array for unknown explicit provider", () => {
    const tracker = new UsageTracker();
    const registry = new ProviderRegistry(tracker);
    expect(registry.selectSearchCandidates("nonexistent")).toEqual([]);
  });

  it("returns empty array when no providers registered", () => {
    const tracker = new UsageTracker();
    const registry = new ProviderRegistry(tracker);
    expect(registry.selectSearchCandidates()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/providers/registry.test.ts`
Expected: FAIL — `selectSearchCandidates` is not a function

- [ ] **Step 3: Implement `selectSearchCandidates()`**

Add the following method to the `ProviderRegistry` class in `src/providers/registry.ts`, after the existing `selectSearch()` method:

```ts
selectSearchCandidates(name?: string): SearchProvider[] {
  if (name && name !== "auto") {
    const provider = this.searchProviders.get(name)?.provider;
    return provider ? [provider] : [];
  }

  const candidates: SearchProvider[] = [];
  for (const tier of [1, 2, 3] as ProviderTier[]) {
    const tierCandidates = [...this.searchProviders.values()]
      .filter((r) => r.tier === tier)
      .filter((r) => {
        if (r.monthlyQuota === null) return true;
        return this.tracker.getCount(r.provider.name) < r.monthlyQuota;
      })
      .sort((a, b) => {
        const remA = this.tracker.getRemaining(a.provider.name, a.monthlyQuota);
        const remB = this.tracker.getRemaining(b.provider.name, b.monthlyQuota);
        return remB - remA;
      });
    for (const c of tierCandidates) {
      candidates.push(c.provider);
    }
  }
  return candidates;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/providers/registry.test.ts`
Expected: All tests PASS (both existing and new)

- [ ] **Step 5: Commit**

```bash
git add src/providers/registry.ts tests/providers/registry.test.ts
git commit -m "feat: add selectSearchCandidates() for fallback chain support"
```

---

### Task 3: Add `selectFetchCandidates()` to `ProviderRegistry`

**Files:**
- Modify: `src/providers/registry.ts`
- Modify: `tests/providers/registry.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/providers/registry.test.ts` inside the existing `describe("ProviderRegistry", ...)` block:

```ts
import type { FetchProvider, FetchResult } from "../../src/providers/types.ts";

function mockFetchProvider(name: string): FetchProvider {
  return {
    name,
    fetch: vi.fn().mockResolvedValue({ text: "content", title: "Title" }),
  };
}

describe("selectFetchCandidates", () => {
  it("returns all registered fetch providers", () => {
    const tracker = new UsageTracker();
    const registry = new ProviderRegistry(tracker);
    const jina = mockFetchProvider("jina");
    const exa = mockFetchProvider("exa");

    registry.registerFetch(jina);
    registry.registerFetch(exa);

    const candidates = registry.selectFetchCandidates();
    expect(candidates.map((c) => c.name)).toEqual(["jina", "exa"]);
  });

  it("returns empty array when no fetch providers registered", () => {
    const tracker = new UsageTracker();
    const registry = new ProviderRegistry(tracker);
    expect(registry.selectFetchCandidates()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/providers/registry.test.ts`
Expected: FAIL — `selectFetchCandidates` is not a function

- [ ] **Step 3: Implement `selectFetchCandidates()`**

Add the following method to the `ProviderRegistry` class in `src/providers/registry.ts`, after the existing `selectFetch()` method:

```ts
selectFetchCandidates(): FetchProvider[] {
  return [...this.fetchProviders.values()].map((r) => r.provider);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/providers/registry.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/providers/registry.ts tests/providers/registry.test.ts
git commit -m "feat: add selectFetchCandidates() for fetch fallback support"
```

---

### Task 4: Wire fallback chain into `web_search`

**Files:**
- Modify: `src/tools/web-search.ts`
- Modify: `src/index.ts`
- Modify: `tests/tools/web-search.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/tools/web-search.test.ts`:

```ts
import { AggregateProviderError } from "../../src/utils/errors.ts";

function makeNamedProvider(name: string, results: SearchResult[]): SearchProvider {
  return {
    name,
    label: name,
    async search(_query: string, maxResults: number, _signal?: AbortSignal) {
      return results.slice(0, maxResults);
    },
  };
}

function makeNamedFailingProvider(name: string, message: string): SearchProvider {
  return {
    name,
    label: name,
    async search() {
      throw new Error(message);
    },
  };
}

describe("web_search fallback chain", () => {
  const sampleResults: SearchResult[] = [
    { title: "Result", url: "https://example.com", snippet: "test" },
  ];

  it("falls back to second provider when first fails", async () => {
    const failing = makeNamedFailingProvider("brave", "429 Too Many Requests");
    const working = makeNamedProvider("exa", sampleResults);

    const tool = createWebSearchTool(
      () => [failing, working],
      vi.fn(),
    );
    const ctx = makeCtx();
    const result = await tool.execute("call-1", { query: "test" }, undefined, undefined, ctx);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Result");
    expect(result.details.provider).toBe("exa");
  });

  it("returns aggregate error when all providers fail", async () => {
    const fail1 = makeNamedFailingProvider("brave", "429 Too Many Requests");
    const fail2 = makeNamedFailingProvider("exa", "Request timeout");

    const tool = createWebSearchTool(
      () => [fail1, fail2],
      vi.fn(),
    );
    const ctx = makeCtx();
    const result = await tool.execute("call-2", { query: "test" }, undefined, undefined, ctx);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("brave: 429 Too Many Requests");
    expect(text).toContain("exa: Request timeout");
  });

  it("records usage only for the successful provider", async () => {
    const failing = makeNamedFailingProvider("brave", "429");
    const working = makeNamedProvider("exa", sampleResults);
    const onSuccess = vi.fn();

    const tool = createWebSearchTool(
      () => [failing, working],
      onSuccess,
    );
    const ctx = makeCtx();
    await tool.execute("call-3", { query: "test" }, undefined, undefined, ctx);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith("exa");
  });

  it("returns error when candidates list is empty", async () => {
    const tool = createWebSearchTool(
      () => [],
      vi.fn(),
    );
    const ctx = makeCtx();
    const result = await tool.execute("call-4", { query: "test" }, undefined, undefined, ctx);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text.toLowerCase()).toContain("no search providers available");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tools/web-search.test.ts`
Expected: FAIL — `createWebSearchTool` still expects `(name?: string) => SearchProvider`, not `() => SearchProvider[]`

- [ ] **Step 3: Update `createWebSearchTool` signature and implement fallback loop**

Replace the contents of `src/tools/web-search.ts`:

```ts
import { Type } from "typebox";
import type { Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { SearchProvider, SearchResult } from "../providers/types.ts";
import { sanitizeError, AggregateProviderError } from "../utils/errors.ts";

const WebSearchParams = Type.Object({
  query: Type.String({ description: "Search query" }),
  numResults: Type.Optional(
    Type.Number({
      minimum: 1,
      maximum: 20,
      default: 5,
      description: "Number of results (1-20, default 5)",
    }),
  ),
  provider: Type.Optional(
    Type.String({ description: "Provider name or 'auto' (default)" }),
  ),
});

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
  resolveCandidates: (name?: string) => SearchProvider[],
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
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const candidates = resolveCandidates(params.provider);

      if (candidates.length === 0) {
        return {
          content: [{ type: "text" as const, text: "Search error: No search providers available" }],
          details: { provider: "none", resultCount: 0 },
        };
      }

      const maxResults = params.numResults ?? 5;
      const errors: Array<{ provider: string; error: string }> = [];

      for (const provider of candidates) {
        try {
          const results = await provider.search(
            params.query,
            maxResults,
            signal ?? undefined,
          );
          const text = formatResults(results);
          onSuccess?.(provider.name);

          return {
            content: [{ type: "text" as const, text }],
            details: { provider: provider.name, resultCount: results.length },
          };
        } catch (error) {
          errors.push({
            provider: provider.name,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const aggregate = new AggregateProviderError("search", errors);
      return {
        content: [{ type: "text" as const, text: `Search error: ${aggregate.message}` }],
        details: { provider: "none", resultCount: 0 },
      };
    },
    renderCall(args, theme: Theme, context) {
      const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
      if (!context.argsComplete) {
        text.setText(theme.fg("warning", "Searching..."));
        return text;
      }
      const q = args.query.length > 70 ? `${args.query.slice(0, 67)}...` : args.query;
      text.setText(
        `${theme.fg("toolTitle", theme.bold("web_search"))} ${theme.fg("accent", `"${q}"`)}`,
      );
      return text;
    },
    renderResult(result, options, theme: Theme, context) {
      const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
      if (context.isPartial) {
        text.setText(theme.fg("warning", "Searching..."));
        return text;
      }
      const count = result.details?.resultCount ?? 0;
      const provider = result.details?.provider ?? "unknown";
      if (options.expanded) {
        const raw =
          result.content[0] && "text" in result.content[0] ? result.content[0].text : "";
        const lines = raw.split("\n").slice(0, 15);
        text.setText(lines.map((l) => theme.fg("toolOutput", l)).join("\n"));
      } else {
        text.setText(theme.fg("toolOutput", `${count} results via ${provider}`));
      }
      return text;
    },
  };
}
```

- [ ] **Step 4: Update `src/index.ts` to pass candidates resolver instead of single-provider resolver**

In `src/index.ts`, replace the `resolveSearchProvider` function and the `createWebSearchTool` call.

Replace:

```ts
function resolveSearchProvider(name?: string): SearchProvider {
  const provider = registry.selectSearch(name);
  if (!provider) {
    throw new Error("No search providers available");
  }
  return provider;
}
```

With:

```ts
function resolveSearchCandidates(name?: string): SearchProvider[] {
  return registry.selectSearchCandidates(name);
}
```

Replace:

```ts
pi.registerTool(
  createWebSearchTool(
    (name) => resolveSearchProvider(name),
    (providerName) => registry.recordUsage(providerName),
  ),
);
```

With:

```ts
pi.registerTool(
  createWebSearchTool(
    (name) => resolveSearchCandidates(name),
    (providerName) => registry.recordUsage(providerName),
  ),
);
```

- [ ] **Step 5: Update existing tests in `tests/tools/web-search.test.ts` to match new signature**

The existing tests pass a `(name?: string) => SearchProvider` resolver. Update them to pass `() => SearchProvider[]` instead.

Replace the existing `makeStubProvider` and `makeFailingProvider` usage in the old tests:

```ts
// Old:
const tool = createWebSearchTool(() => makeStubProvider(sampleResults));
// New:
const tool = createWebSearchTool(() => [makeStubProvider(sampleResults)]);

// Old:
const tool = createWebSearchTool(() => makeFailingProvider("Provider exploded"));
// New:
const tool = createWebSearchTool(() => [makeFailingProvider("Provider exploded")]);
```

- [ ] **Step 6: Run all tests to verify they pass**

Run: `npx vitest run tests/tools/web-search.test.ts`
Expected: All tests PASS (both old and new)

- [ ] **Step 7: Commit**

```bash
git add src/tools/web-search.ts src/index.ts tests/tools/web-search.test.ts
git commit -m "feat: wire search fallback chain into web_search tool"
```

---

### Task 5: Wire fetch provider fallback into `web_fetch`

**Files:**
- Modify: `src/tools/web-fetch.ts`
- Modify: `src/index.ts`
- Modify: `tests/tools/web-fetch.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/tools/web-fetch.test.ts`:

```ts
import type { FetchProvider, FetchResult } from "../../src/providers/types.ts";

function mockFetchProvider(
  name: string,
  result: FetchResult,
): FetchProvider {
  return {
    name,
    fetch: vi.fn().mockResolvedValue(result),
  };
}

function mockFailingFetchProvider(name: string, message: string): FetchProvider {
  return {
    name,
    fetch: vi.fn().mockRejectedValue(new Error(message)),
  };
}

describe("web_fetch fallback to FetchProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("falls back to FetchProvider when HTTP fetch returns 5xx", async () => {
    fetchStub.addResponse("example.com/broken", {
      status: 500,
      body: "Internal Server Error",
      headers: { "content-type": "text/html" },
    });

    const provider = mockFetchProvider("exa", {
      text: "Content from Exa provider",
      title: "Exa Title",
    });

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store, () => [provider]);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-fb-1",
      { url: "https://example.com/broken" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Content from Exa provider");
    expect(result.details.extractionChain).toContain("fetch-provider:exa");
  });

  it("falls back to second FetchProvider when first also fails", async () => {
    fetchStub.addResponse("example.com/broken", {
      status: 503,
      body: "Service Unavailable",
      headers: { "content-type": "text/html" },
    });

    const failProvider = mockFailingFetchProvider("jina", "Jina timeout");
    const workProvider = mockFetchProvider("exa", {
      text: "Content from Exa",
      title: "Exa Title",
    });

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store, () => [failProvider, workProvider]);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-fb-2",
      { url: "https://example.com/broken" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Content from Exa");
  });

  it("does NOT fall back on 4xx client errors (except 429)", async () => {
    fetchStub.addResponse("example.com/notfound", {
      status: 404,
      body: "Not Found",
      headers: { "content-type": "text/html" },
    });

    const provider = mockFetchProvider("exa", {
      text: "Should not reach this",
      title: "Exa",
    });

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store, () => [provider]);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-fb-3",
      { url: "https://example.com/notfound" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text.toLowerCase()).toContain("error");
    expect(provider.fetch).not.toHaveBeenCalled();
  });

  it("falls back on 429 rate limit errors", async () => {
    fetchStub.addResponse("example.com/limited", {
      status: 429,
      body: "Rate Limited",
      headers: { "content-type": "text/html" },
    });

    const provider = mockFetchProvider("exa", {
      text: "Content via fallback",
      title: "Fallback Title",
    });

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store, () => [provider]);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-fb-4",
      { url: "https://example.com/limited" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Content via fallback");
  });

  it("returns aggregate error when pipeline and all providers fail", async () => {
    fetchStub.addResponse("example.com/broken", {
      status: 500,
      body: "Server Error",
      headers: { "content-type": "text/html" },
    });

    const failProvider = mockFailingFetchProvider("exa", "Exa unavailable");

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store, () => [failProvider]);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-fb-5",
      { url: "https://example.com/broken" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text.toLowerCase()).toContain("error");
  });

  it("works without any fetch providers (existing behavior preserved)", async () => {
    fetchStub.addResponse("example.com/page", {
      body: GOOD_HTML,
      headers: { "content-type": "text/html" },
    });

    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store, () => []);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-fb-6",
      { url: "https://example.com/page" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Article Title");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tools/web-fetch.test.ts`
Expected: FAIL — `createWebFetchTool` does not accept a second argument

- [ ] **Step 3: Create a retryable error type in the extraction pipeline**

Add to `src/extract/pipeline.ts`, before the `extractContent` function:

```ts
/**
 * Error thrown when the HTTP fetch itself fails in a way that
 * a different fetch provider might succeed (network errors, 5xx, 429).
 */
export class RetryableExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableExtractionError";
  }
}
```

Then update the `!response.ok` check inside `extractContent` to distinguish retryable from non-retryable:

Replace:

```ts
if (!response.ok) {
  throw new Error(`HTTP ${response.status}: ${response.statusText}`);
}
```

With:

```ts
if (!response.ok) {
  const status = response.status;
  // 429 and 5xx are retryable — a different provider might succeed
  if (status === 429 || status >= 500) {
    throw new RetryableExtractionError(`HTTP ${status}: ${response.statusText}`);
  }
  throw new Error(`HTTP ${status}: ${response.statusText}`);
}
```

- [ ] **Step 4: Update `createWebFetchTool` to accept fetch provider candidates and implement fallback**

Replace the contents of `src/tools/web-fetch.ts`:

```ts
import { Type } from "typebox";
import type { Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { ContentStore } from "../storage.ts";
import type { FetchProvider } from "../providers/types.ts";
import { extractContent, RetryableExtractionError } from "../extract/pipeline.ts";
import { truncateContent } from "../utils/truncate.ts";
import { sanitizeError, AggregateProviderError } from "../utils/errors.ts";

const INLINE_LIMIT = 15_000;

const WebFetchParams = Type.Object({
  url: Type.String({ description: "HTTP(S) URL to fetch" }),
});

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
  resolveFetchCandidates?: () => FetchProvider[],
): ToolDefinition<typeof WebFetchParams, WebFetchDetails> {
  return {
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch a URL and extract readable content as markdown. Supports HTML pages.",
    promptSnippet:
      "Fetch a URL and extract readable content as markdown. Supports HTML pages.",
    promptGuidelines: [
      "Use web_fetch when you have a specific URL to read.",
      "For large pages, use web_read with the returned contentId to retrieve the full text.",
    ],
    parameters: WebFetchParams,
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      // Try the direct extraction pipeline first
      try {
        const extracted = await extractContent(params.url, signal ?? undefined);
        return buildResult(extracted, params.url, store);
      } catch (pipelineError) {
        // Only fall back to providers for retryable errors
        if (!(pipelineError instanceof RetryableExtractionError)) {
          const msg = sanitizeError(pipelineError);
          return errorResult(params.url, `Fetch error: ${msg}`);
        }

        // Try each registered FetchProvider as fallback
        const candidates = resolveFetchCandidates?.() ?? [];
        if (candidates.length === 0) {
          const msg = sanitizeError(pipelineError);
          return errorResult(params.url, `Fetch error: ${msg}`);
        }

        const errors: Array<{ provider: string; error: string }> = [
          { provider: "http", error: pipelineError.message },
        ];

        for (const provider of candidates) {
          try {
            const fetchResult = await provider.fetch(params.url, signal ?? undefined);
            return buildResult(
              {
                text: fetchResult.text,
                title: fetchResult.title,
                url: params.url,
                extractionChain: [`fetch-provider:${provider.name}`],
                chars: fetchResult.text.length,
                truncated: false,
              },
              params.url,
              store,
            );
          } catch (providerError) {
            errors.push({
              provider: provider.name,
              error: providerError instanceof Error ? providerError.message : String(providerError),
            });
          }
        }

        const aggregate = new AggregateProviderError("fetch", errors);
        return errorResult(params.url, `Fetch error: ${aggregate.message}`);
      }
    },
    renderCall(args, theme: Theme, context) {
      const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
      if (!context.argsComplete) {
        text.setText(theme.fg("warning", "Fetching..."));
        return text;
      }
      const u = args.url.length > 70 ? `${args.url.slice(0, 67)}...` : args.url;
      text.setText(
        `${theme.fg("toolTitle", theme.bold("web_fetch"))} ${theme.fg("accent", `"${u}"`)}`,
      );
      return text;
    },
    renderResult(result, options, theme: Theme, context) {
      const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
      if (context.isPartial) {
        text.setText(theme.fg("warning", "Fetching..."));
        return text;
      }
      const details = result.details;
      if (!details || details.chars === 0) {
        text.setText(theme.fg("error", "fetch error"));
        return text;
      }
      if (options.expanded) {
        const raw =
          result.content[0] && "text" in result.content[0] ? result.content[0].text : "";
        const lines = raw.split("\n").slice(0, 20);
        text.setText(lines.map((l) => theme.fg("toolOutput", l)).join("\n"));
      } else {
        const truncNote = details.truncated ? theme.fg("warning", " (truncated)") : "";
        text.setText(theme.fg("toolOutput", `${details.chars} chars`) + truncNote);
      }
      return text;
    },
  };
}

function buildResult(
  extracted: {
    text: string;
    title?: string;
    url: string;
    extractionChain: string[];
    chars: number;
    truncated: boolean;
  },
  originalUrl: string,
  store: ContentStore,
) {
  let contentId: string | undefined;
  let outputText: string;
  let truncated = extracted.truncated;

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
}

function errorResult(url: string, message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    details: {
      url,
      chars: 0,
      truncated: false,
      extractionChain: [] as string[],
    },
  };
}
```

- [ ] **Step 5: Update `src/index.ts` to pass fetch candidates to `createWebFetchTool`**

Replace:

```ts
pi.registerTool(createWebFetchTool(store));
```

With:

```ts
pi.registerTool(
  createWebFetchTool(store, () => registry.selectFetchCandidates()),
);
```

- [ ] **Step 6: Update existing tests in `tests/tools/web-fetch.test.ts` to match new signature**

The existing tests create `createWebFetchTool(store)` with no second argument. Since the second param is optional with a default of `undefined`, the existing tests should still work. Verify by running them.

- [ ] **Step 7: Run all tests**

Run: `npx vitest run tests/tools/web-fetch.test.ts`
Expected: All tests PASS (both old and new)

- [ ] **Step 8: Commit**

```bash
git add src/tools/web-fetch.ts src/extract/pipeline.ts src/index.ts tests/tools/web-fetch.test.ts
git commit -m "feat: wire fetch provider fallback into web_fetch tool"
```

---

### Task 6: Add extraction pipeline tests for `RetryableExtractionError`

**Files:**
- Modify: `tests/extract/pipeline.test.ts`

- [ ] **Step 1: Write the tests**

Add to `tests/extract/pipeline.test.ts` (find the appropriate location alongside existing pipeline tests):

```ts
import { RetryableExtractionError } from "../../src/extract/pipeline.ts";

describe("RetryableExtractionError", () => {
  it("is thrown for HTTP 500", async () => {
    fetchStub.addResponse("example.com/server-error", {
      status: 500,
      body: "Internal Server Error",
      headers: { "content-type": "text/html" },
    });

    await expect(extractContent("https://example.com/server-error"))
      .rejects.toThrow(RetryableExtractionError);
  });

  it("is thrown for HTTP 503", async () => {
    fetchStub.addResponse("example.com/unavailable", {
      status: 503,
      body: "Service Unavailable",
      headers: { "content-type": "text/html" },
    });

    await expect(extractContent("https://example.com/unavailable"))
      .rejects.toThrow(RetryableExtractionError);
  });

  it("is thrown for HTTP 429", async () => {
    fetchStub.addResponse("example.com/rate-limited", {
      status: 429,
      body: "Too Many Requests",
      headers: { "content-type": "text/html" },
    });

    await expect(extractContent("https://example.com/rate-limited"))
      .rejects.toThrow(RetryableExtractionError);
  });

  it("is NOT thrown for HTTP 404", async () => {
    fetchStub.addResponse("example.com/missing", {
      status: 404,
      body: "Not Found",
      headers: { "content-type": "text/html" },
    });

    await expect(extractContent("https://example.com/missing"))
      .rejects.toThrow(Error);
    await expect(extractContent("https://example.com/missing"))
      .rejects.not.toThrow(RetryableExtractionError);
  });

  it("is NOT thrown for HTTP 403", async () => {
    fetchStub.addResponse("example.com/forbidden", {
      status: 403,
      body: "Forbidden",
      headers: { "content-type": "text/html" },
    });

    await expect(extractContent("https://example.com/forbidden"))
      .rejects.toThrow(Error);
    await expect(extractContent("https://example.com/forbidden"))
      .rejects.not.toThrow(RetryableExtractionError);
  });
});
```

- [ ] **Step 2: Check imports**

Ensure the test file imports `extractContent` from the pipeline and `stubFetch` from helpers. If the test file already has these imports and a `fetchStub` setup, add the new `describe` block alongside the existing ones. If not, add the necessary imports and `beforeEach`/`afterEach` for `stubFetch`.

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/extract/pipeline.test.ts`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add tests/extract/pipeline.test.ts
git commit -m "test: add RetryableExtractionError status code tests"
```

---

### Task 7: Full regression test

**Files:** None (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: All tests PASS across all test files

- [ ] **Step 2: Run type checking**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Verify no unused imports**

Scan `src/index.ts` for the old `resolveSearchProvider` function and the old `SearchProvider` import (if it's no longer needed directly). The old `selectSearch` method in `ProviderRegistry` is still valid for potential direct use, so leave it.

- [ ] **Step 4: Final commit if any cleanup was needed**

```bash
git add -A
git commit -m "chore: phase 1 cleanup and regression verification"
```
