# Phase 12: HTTP Adapter Scaffolding Implementation Plan (Conditional)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract repeated HTTP scaffolding (class boilerplate, headers, fetch, error handling, response mapping) from search-only providers into a shared `createHttpSearchProvider` helper. Each converted provider becomes a config object + `providerMeta` export — no class needed.

**Scope:** 5 search-only providers: perplexity, websearchapi, serper, brave, openai-native.

**Out of scope:**
- Dual-interface providers (tavily, firecrawl, parallel, jina, exa) — they need classes for `fetch()`/`codeSearch()` methods, so the adapter only saves ~7 lines each. Not worth the indirection.
- SearXNG — config-based constructor, env var resolution, SSRF validation. Doesn't fit the adapter pattern.
- DuckDuckGo (CLI-based), ExaMCP (JSON-RPC) — not HTTP search providers.

**Tech Stack:** TypeScript 6, Vitest 4, Node 24+

---

## Condition

**This phase is speculative. Only proceed if:**
1. The per-provider savings exceed 15 lines each
2. The adapter interface doesn't grow wider than a single provider implementation
3. Phase 9 (provider meta exports) is complete [DONE]

**Measure before committing:** After converting the first 3 providers, count lines saved. If net savings < 45 lines (15 per provider), STOP and skip this phase.

---

## Context

Common scaffolding across search-only providers:
1. **Class boilerplate**: `class X implements SearchProvider { readonly name; readonly label; private apiKey; constructor(apiKey) { ... } }`
2. **Headers**: `{ "Content-Type": "application/json", [authHeaderName]: prefix + apiKey }`
3. **Fetch + error handling**: `const response = await fetch(url, init); if (!response.ok) throw new Error(...)`
4. **Response mapping**: `(await response.json()) as T` then `.slice(0, maxResults).map(r => (...))`

Each provider differs in:
- Endpoint URL (some GET with params, some POST with body)
- Auth header name and prefix (`X-Subscription-Token`, `Authorization: Bearer`, `X-API-KEY`)
- Additional headers (Brave needs `Accept: application/json`)
- Request body shape
- Response shape and field names
- Filter handling (some use `applyDomainFilters`, some have native APIs)

---

### Task 1: Create the HTTP adapter with tests

**Files:**
- Create: `src/providers/http-adapter.ts`
- Create: `tests/providers/http-adapter.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/providers/http-adapter.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHttpSearchProvider } from "../../src/providers/http-adapter.ts";
import { stubFetch } from "../helpers.ts";

describe("createHttpSearchProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("performs a POST request with correct headers and body", async () => {
    fetchStub.addResponse("api.example.com/search", {
      body: { results: [{ title: "Test", url: "https://test.com", content: "snippet text" }] },
    });

    const provider = createHttpSearchProvider("test-key", {
      name: "example",
      label: "Example",
      endpoint: "https://api.example.com/search",
      method: "POST",
      authHeader: "X-API-Key",
      buildBody: (query, maxResults) => ({ query, max_results: maxResults }),
      extractResults: (data) => {
        const d = data as { results: Array<{ title: string; url: string; content: string }> };
        return d.results.map((r) => ({ title: r.title, url: r.url, snippet: r.content }));
      },
    });

    expect(provider.name).toBe("example");
    expect(provider.label).toBe("Example");
    const results = await provider.search("test query", 5);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Test");
    expect(results[0].snippet).toBe("snippet text");
  });

  it("performs a GET request with dynamic URL", async () => {
    fetchStub.addResponse("api.example.com/search", {
      body: { items: [{ name: "Result", link: "https://r.com", desc: "a result" }] },
    });

    const provider = createHttpSearchProvider("my-key", {
      name: "get-example",
      label: "GET Example",
      endpoint: (query, maxResults) =>
        `https://api.example.com/search?q=${encodeURIComponent(query)}&count=${maxResults}`,
      method: "GET",
      authHeader: "Authorization",
      authPrefix: "Bearer ",
      extractResults: (data) => {
        const d = data as { items: Array<{ name: string; link: string; desc: string }> };
        return d.items.map((r) => ({ title: r.name, url: r.link, snippet: r.desc }));
      },
    });

    const results = await provider.search("hello", 3);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Result");
  });

  it("supports custom headers via buildHeaders", async () => {
    fetchStub.addResponse("api.example.com", {
      body: { results: [] },
    });

    const provider = createHttpSearchProvider("key", {
      name: "custom-headers",
      label: "Custom",
      endpoint: "https://api.example.com/search",
      method: "GET",
      buildHeaders: (apiKey) => ({
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      }),
      extractResults: () => [],
    });

    await provider.search("q", 5);
    // Verifying no error thrown — header construction worked
  });

  it("throws on non-ok response", async () => {
    fetchStub.addResponse("api.example.com", {
      status: 429,
      body: "rate limited",
    });

    const provider = createHttpSearchProvider("key", {
      name: "failing",
      label: "Failing",
      endpoint: "https://api.example.com/search",
      method: "POST",
      authHeader: "X-Key",
      buildBody: (q) => ({ q }),
      extractResults: () => [],
    });

    await expect(provider.search("q", 5)).rejects.toThrow("failing API error: 429");
  });

  it("slices results to maxResults", async () => {
    const manyResults = Array.from({ length: 20 }, (_, i) => ({
      title: `R${i}`, url: `https://r${i}.com`, snippet: `s${i}`,
    }));
    fetchStub.addResponse("api.example.com", {
      body: { results: manyResults },
    });

    const provider = createHttpSearchProvider("key", {
      name: "many",
      label: "Many",
      endpoint: "https://api.example.com/search",
      method: "POST",
      authHeader: "X-Key",
      buildBody: (q) => ({ q }),
      extractResults: (data) => {
        const d = data as { results: Array<{ title: string; url: string; snippet: string }> };
        return d.results;
      },
    });

    const results = await provider.search("q", 5);
    expect(results).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/providers/http-adapter.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Implement createHttpSearchProvider**

Create `src/providers/http-adapter.ts`:

```ts
import type { SearchFilters, SearchProvider, SearchResult } from "./types.ts";

export interface HttpSearchConfig {
  name: string;
  label: string;
  endpoint: string | ((query: string, maxResults: number, filters?: SearchFilters) => string);
  method: "GET" | "POST";

  // Auth: use EITHER authHeader/authPrefix OR buildHeaders (not both)
  authHeader?: string;
  authPrefix?: string;
  buildHeaders?: (apiKey: string) => Record<string, string>;

  buildBody?: (query: string, maxResults: number, filters?: SearchFilters) => unknown;
  extractResults: (data: unknown) => Array<{ title: string; url: string; snippet: string }>;
}

export function createHttpSearchProvider(
  apiKey: string,
  config: HttpSearchConfig,
): SearchProvider {
  return {
    name: config.name,
    label: config.label,
    async search(
      query: string,
      maxResults: number,
      signal?: AbortSignal,
      filters?: SearchFilters,
    ): Promise<SearchResult[]> {
      const url = typeof config.endpoint === "function"
        ? config.endpoint(query, maxResults, filters)
        : config.endpoint;

      const headers: Record<string, string> = config.buildHeaders
        ? config.buildHeaders(apiKey)
        : { [config.authHeader!]: (config.authPrefix ?? "") + apiKey };

      const init: RequestInit = { signal, headers };

      if (config.method === "POST") {
        headers["Content-Type"] = "application/json";
        init.method = "POST";
        init.body = config.buildBody
          ? JSON.stringify(config.buildBody(query, maxResults, filters))
          : undefined;
      }

      const response = await fetch(url, init);

      if (!response.ok) {
        throw new Error(`${config.name} API error: ${response.status} ${response.statusText}`);
      }

      const data: unknown = await response.json();
      return config.extractResults(data).slice(0, maxResults);
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/providers/http-adapter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/providers/http-adapter.ts tests/providers/http-adapter.test.ts
git commit -m "feat: add createHttpSearchProvider adapter"
```

---

### Task 2: Convert first 3 providers (perplexity, websearchapi, serper) and measure

**Files:**
- Modify: `src/providers/perplexity.ts`
- Modify: `src/providers/websearchapi.ts`
- Modify: `src/providers/serper.ts`

- [ ] **Step 1: Count current line counts**

```bash
wc -l src/providers/perplexity.ts src/providers/websearchapi.ts src/providers/serper.ts
```

Expected: 58 + 60 + 78 = 196 total

- [ ] **Step 2: Convert perplexity.ts**

Replace `src/providers/perplexity.ts`:

```ts
import { createHttpSearchProvider } from "./http-adapter.ts";
import type { ProviderMeta } from "./types.ts";

export const providerMeta: ProviderMeta = {
  name: "perplexity",
  tier: 2,
  monthlyQuota: null,
  requiresKey: true,
  create: (key) => ({
    search: createHttpSearchProvider(key!, {
      name: "perplexity",
      label: "Perplexity Sonar",
      endpoint: "https://api.perplexity.ai/chat/completions",
      method: "POST",
      authHeader: "Authorization",
      authPrefix: "Bearer ",
      buildBody: (query) => ({
        model: "sonar",
        messages: [{ role: "user", content: query }],
      }),
      extractResults: (data) => {
        const d = data as { choices?: Array<{ message?: { content?: string } }>; citations?: string[] };
        const answer = d.choices?.[0]?.message?.content ?? "";
        const citations = d.citations ?? [];
        if (!answer) return [];
        return [
          { title: "Perplexity Answer", url: "", snippet: answer },
          ...citations.map((url) => ({ title: url, url, snippet: "" })),
        ];
      },
    }),
  }),
};
```

~30 lines. Savings vs current 58: **28 lines**.

- [ ] **Step 3: Convert websearchapi.ts**

Replace `src/providers/websearchapi.ts`:

```ts
import { createHttpSearchProvider } from "./http-adapter.ts";
import type { ProviderMeta } from "./types.ts";

export const providerMeta: ProviderMeta = {
  name: "websearchapi",
  tier: 1,
  monthlyQuota: null,
  requiresKey: true,
  create: (key) => ({
    search: createHttpSearchProvider(key!, {
      name: "websearchapi",
      label: "WebSearchAPI",
      endpoint: "https://api.websearchapi.ai/ai-search",
      method: "POST",
      authHeader: "Authorization",
      authPrefix: "Bearer ",
      buildBody: (query, maxResults) => ({ query, maxResults }),
      extractResults: (data) => {
        const d = data as { organic?: Array<{ title: string; url: string; description: string }> };
        return (d.organic ?? []).map((r) => ({
          title: r.title, url: r.url, snippet: r.description,
        }));
      },
    }),
  }),
};
```

~24 lines. Savings vs current 60: **36 lines**.

- [ ] **Step 4: Convert serper.ts**

Replace `src/providers/serper.ts`:

```ts
import { createHttpSearchProvider } from "./http-adapter.ts";
import { applyDomainFilters } from "../utils/filters.ts";
import type { ProviderMeta, SearchFilters } from "./types.ts";

/** Converts "YYYY-MM-DD" to "MM/DD/YYYY" for Google's tbs format. */
function isoToMDY(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${month}/${day}/${year}`;
}

function buildTbs(filters?: SearchFilters): string | null {
  if (!filters) return null;
  if (!filters.startDate && !filters.endDate) return null;
  const min = filters.startDate ? isoToMDY(filters.startDate) : "";
  const max = filters.endDate ? isoToMDY(filters.endDate) : "";
  return `cdr:1,cd_min:${min},cd_max:${max}`;
}

export const providerMeta: ProviderMeta = {
  name: "serper",
  tier: 1,
  monthlyQuota: 2500,
  requiresKey: true,
  create: (key) => ({
    search: createHttpSearchProvider(key!, {
      name: "serper",
      label: "Google Serper",
      endpoint: "https://google.serper.dev/search",
      method: "POST",
      authHeader: "X-API-KEY",
      buildBody: (query, maxResults, filters) => {
        const body: Record<string, unknown> = {
          q: applyDomainFilters(query, filters),
          num: maxResults,
        };
        const tbs = buildTbs(filters);
        if (tbs) body.tbs = tbs;
        return body;
      },
      extractResults: (data) => {
        const d = data as { organic?: Array<{ title: string; link: string; snippet: string }> };
        return (d.organic ?? []).map((r) => ({
          title: r.title, url: r.link, snippet: r.snippet,
        }));
      },
    }),
  }),
};
```

~44 lines. Savings vs current 78: **34 lines**.

- [ ] **Step 5: Run all provider tests**

Run: `pnpm vitest run tests/providers/`
Expected: PASS (existing provider tests still pass because the same search behavior is preserved)

- [ ] **Step 6: Measure line savings**

```bash
wc -l src/providers/perplexity.ts src/providers/websearchapi.ts src/providers/serper.ts
```

Expected: ~98 total (was 196). Net savings: **~98 lines** across 3 providers. Easily clears the 45-line threshold.

If net savings < 45, **STOP here** and skip remaining providers.

- [ ] **Step 7: Commit**

```bash
git add src/providers/perplexity.ts src/providers/websearchapi.ts src/providers/serper.ts
git commit -m "refactor: convert perplexity, websearchapi, serper to HTTP adapter"
```

---

### Task 3: Convert brave and openai-native

**Files:**
- Modify: `src/providers/brave.ts`
- Modify: `src/providers/openai-native.ts`

- [ ] **Step 1: Convert brave.ts**

Replace `src/providers/brave.ts`:

```ts
import { createHttpSearchProvider } from "./http-adapter.ts";
import { applyDomainFilters } from "../utils/filters.ts";
import type { ProviderMeta, SearchFilters } from "./types.ts";

function buildFreshness(filters?: SearchFilters): string | null {
  if (!filters) return null;
  if (!filters.startDate && !filters.endDate) return null;
  return `${filters.startDate ?? ""}to${filters.endDate ?? ""}`;
}

export const providerMeta: ProviderMeta = {
  name: "brave",
  tier: 1,
  monthlyQuota: 2000,
  requiresKey: true,
  create: (key) => ({
    search: createHttpSearchProvider(key!, {
      name: "brave",
      label: "Brave Search",
      endpoint: (query, maxResults, filters) => {
        const effectiveQuery = applyDomainFilters(query, filters);
        const params = new URLSearchParams({
          q: effectiveQuery,
          count: String(maxResults),
        });
        const freshness = buildFreshness(filters);
        if (freshness) params.set("freshness", freshness);
        return `https://api.search.brave.com/res/v1/web/search?${params.toString()}`;
      },
      method: "GET",
      buildHeaders: (apiKey) => ({
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      }),
      extractResults: (data) => {
        const d = data as { web?: { results: Array<{ title: string; url: string; description: string }> } };
        return (d.web?.results ?? []).map((r) => ({
          title: r.title, url: r.url, snippet: r.description,
        }));
      },
    }),
  }),
};
```

~40 lines. Savings vs current 76: **36 lines**.

- [ ] **Step 2: Convert openai-native.ts**

Replace `src/providers/openai-native.ts`:

```ts
import { createHttpSearchProvider } from "./http-adapter.ts";
import type { ProviderMeta } from "./types.ts";

interface UrlCitation {
  type: "url_citation";
  url: string;
  title: string;
}

interface OutputText {
  type: "output_text";
  text: string;
  annotations?: UrlCitation[];
}

interface MessageOutput {
  type: "message";
  role: string;
  content: OutputText[];
}

type OutputItem = MessageOutput | { type: string };

interface OpenAIResponsesResult {
  id: string;
  output: OutputItem[];
}

export const providerMeta: ProviderMeta = {
  name: "openai-native",
  tier: 1,
  monthlyQuota: null,
  requiresKey: true,
  create: (key) => ({
    search: createHttpSearchProvider(key!, {
      name: "openai-native",
      label: "OpenAI Web Search",
      endpoint: "https://api.openai.com/v1/responses",
      method: "POST",
      authHeader: "Authorization",
      authPrefix: "Bearer ",
      buildBody: (query) => ({
        model: "gpt-4.1-nano",
        tools: [{ type: "web_search" }],
        tool_choice: "required",
        input: `Search the web for: ${query}`,
      }),
      extractResults: (raw) => {
        const data = raw as OpenAIResponsesResult;
        const messageOutput = data.output.find(
          (item): item is MessageOutput => item.type === "message",
        );
        if (!messageOutput) return [];
        const textContent = messageOutput.content?.find(
          (c): c is OutputText => c.type === "output_text",
        );
        if (!textContent?.annotations?.length) return [];

        // Deduplicate by URL, preserving order
        const seen = new Set<string>();
        const results: Array<{ title: string; url: string; snippet: string }> = [];
        for (const ann of textContent.annotations) {
          if (ann.type !== "url_citation") continue;
          if (seen.has(ann.url)) continue;
          seen.add(ann.url);
          results.push({ title: ann.title, url: ann.url, snippet: "" });
        }
        return results;
      },
    }),
  }),
};
```

~65 lines. Savings vs current 106: **41 lines**. Note: openai-native keeps its type interfaces because the extractor is complex enough to need them for readability.

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run tests/providers/brave.test.ts tests/providers/openai-native.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/providers/brave.ts src/providers/openai-native.ts
git commit -m "refactor: convert brave and openai-native to HTTP adapter"
```

---

### Task 4: Final verification and cleanup

- [ ] **Step 1: Run full verification**

Run: `pnpm check`
Expected: lint + typecheck + tests all PASS

- [ ] **Step 2: Measure total impact**

```bash
wc -l src/providers/http-adapter.ts src/providers/perplexity.ts src/providers/websearchapi.ts src/providers/serper.ts src/providers/brave.ts src/providers/openai-native.ts
```

Expected totals:
- http-adapter.ts: ~55 lines (new file)
- 5 converted providers: ~203 lines (was 378 before)
- Net reduction: ~120 lines

- [ ] **Step 3: Final commit (if any adjustments needed)**

If lint/format adjusted files:
```bash
git add -u && git commit -m "style: format converted providers"
```

---

## Summary of changes

| File | Before | After | Saved |
|------|--------|-------|-------|
| `src/providers/http-adapter.ts` | 0 | ~55 | -55 (new) |
| `src/providers/perplexity.ts` | 58 | ~30 | 28 |
| `src/providers/websearchapi.ts` | 60 | ~24 | 36 |
| `src/providers/serper.ts` | 78 | ~44 | 34 |
| `src/providers/brave.ts` | 76 | ~40 | 36 |
| `src/providers/openai-native.ts` | 106 | ~65 | 41 |
| **Total** | **378** | **~258** | **~120 net** |

## Design decisions

1. **No wrapper classes.** `providerMeta.create()` calls `createHttpSearchProvider()` directly. This eliminates ~10 lines of class boilerplate per provider that a wrapper pattern would reintroduce.

2. **`buildHeaders` escape hatch.** For providers that need non-standard header patterns (Brave's `Accept` + `X-Subscription-Token`), config can supply `buildHeaders(apiKey)` instead of `authHeader`/`authPrefix`.

3. **Dual-interface providers stay as-is.** Tavily, firecrawl, parallel, jina, and exa all implement `FetchProvider` (and exa also `CodeSearchProvider`). Their class structure is needed for the non-search methods. Converting just `search()` to delegate to an inner adapter would save ~7 lines each but add indirection. Not worth it.

4. **SearXNG stays as-is.** Its constructor reads env vars, accepts a config-based `instanceUrl`, and performs SSRF validation. This doesn't fit the adapter's "fixed endpoint + API key" model.
