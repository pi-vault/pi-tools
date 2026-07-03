# Phase 12: HTTP Adapter Scaffolding Implementation Plan (Conditional)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract repeated HTTP scaffolding (headers, error handling, response mapping) from 11 HTTP-based providers into a shared `createHttpSearchProvider` helper. Each provider becomes a config object.

**Architecture:** A new `src/providers/http-adapter.ts` exports `createHttpSearchProvider(apiKey, config)` which returns a `SearchProvider`. The config describes endpoint, method, auth header, body builder, and result extractor. Outliers (DuckDuckGo CLI, ExaMCP JSON-RPC) keep their custom implementations.

**Tech Stack:** TypeScript 6, Vitest 4, Node 24+

---

## Condition

**This phase is speculative. Only proceed if:**
1. The per-provider savings exceed 15 lines each
2. The adapter interface doesn't grow wider than a single provider implementation
3. Phase 9 (provider meta exports) is complete

**Measure before committing:** After converting the first 3 providers, count lines saved. If net savings < 45 lines (15 per provider), STOP and skip this phase.

---

## Context

Common scaffolding across 11 providers:
1. **Headers**: `{ "Content-Type": "application/json", [authHeaderName]: apiKey }`
2. **Error handling**: `if (!response.ok) throw new Error(\`${name} API error: ${response.status} ${response.statusText}\`)`
3. **Response mapping**: `.slice(0, maxResults).map(r => ({ title: r.title, url: r.url, snippet: r[snippetField] }))`

Each provider differs in:
- Endpoint URL (some are GET with params, some are POST with body)
- Auth header name (`X-Subscription-Token`, `Authorization: Bearer`, `X-API-Key`, etc.)
- Request body shape
- Response shape (different field names for snippet: `description`, `content`, `body`, `text`)
- Filter handling (some use `applyDomainFilters`, some have native filter APIs, most ignore filters)

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
      extractResults: (data: unknown) => {
        const d = data as { results: Array<{ title: string; url: string; content: string }> };
        return d.results.map((r) => ({ title: r.title, url: r.url, snippet: r.content }));
      },
    });

    const results = await provider.search("test query", 5);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Test");
    expect(results[0].snippet).toBe("snippet text");
  });

  it("performs a GET request with URL params", async () => {
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
      extractResults: (data: unknown) => {
        const d = data as { items: Array<{ name: string; link: string; desc: string }> };
        return d.items.map((r) => ({ title: r.name, url: r.link, snippet: r.desc }));
      },
    });

    const results = await provider.search("hello", 3);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Result");
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
      extractResults: (data: unknown) => {
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
  authHeader: string;
  authPrefix?: string;
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

      const headers: Record<string, string> = {
        [config.authHeader]: (config.authPrefix ?? "") + apiKey,
      };

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

Record the total.

- [ ] **Step 2: Convert perplexity.ts**

Replace `src/providers/perplexity.ts`:

```ts
import { createHttpSearchProvider, type HttpSearchConfig } from "./http-adapter.ts";
import type { ProviderMeta } from "./all.ts";
import type { SearchProvider } from "./types.ts";

const config: HttpSearchConfig = {
  name: "perplexity",
  label: "Perplexity",
  endpoint: "https://api.perplexity.ai/chat/completions",
  method: "POST",
  authHeader: "Authorization",
  authPrefix: "Bearer ",
  buildBody: (query) => ({
    model: "sonar",
    messages: [{ role: "user", content: query }],
    web_search: true,
  }),
  extractResults: (data: unknown) => {
    const d = data as { choices?: Array<{ message?: { content?: string } }>; citations?: string[] };
    const text = d.choices?.[0]?.message?.content ?? "";
    const citations = d.citations ?? [];
    // Perplexity returns an AI answer + citations. Package as one result.
    if (!text) return [];
    return [
      { title: "Perplexity Answer", url: citations[0] ?? "", snippet: text },
      ...citations.slice(1).map((url) => ({ title: url, url, snippet: "" })),
    ];
  },
};

export class PerplexityProvider {
  readonly name = "perplexity";
  readonly label = "Perplexity";
  private inner: SearchProvider;

  constructor(apiKey: string) {
    this.inner = createHttpSearchProvider(apiKey, config);
  }

  search(...args: Parameters<SearchProvider["search"]>) {
    return this.inner.search(...args);
  }
}

export const providerMeta: ProviderMeta = {
  name: "perplexity",
  tier: 2,
  monthlyQuota: null,
  requiresKey: true,
  create: (key) => ({ search: new PerplexityProvider(key!) }),
};
```

- [ ] **Step 3: Convert websearchapi.ts**

Replace `src/providers/websearchapi.ts`:

```ts
import { createHttpSearchProvider, type HttpSearchConfig } from "./http-adapter.ts";
import type { ProviderMeta } from "./all.ts";
import type { SearchProvider } from "./types.ts";

const config: HttpSearchConfig = {
  name: "websearchapi",
  label: "WebSearchAPI",
  endpoint: (query, maxResults) =>
    `https://api.websearchapi.com/v2/search?q=${encodeURIComponent(query)}&num=${maxResults}&engine=google`,
  method: "GET",
  authHeader: "Authorization",
  authPrefix: "Bearer ",
  extractResults: (data: unknown) => {
    const d = data as { results?: Array<{ title: string; url: string; description: string }> };
    return (d.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
    }));
  },
};

export class WebSearchApiProvider {
  readonly name = "websearchapi";
  readonly label = "WebSearchAPI";
  private inner: SearchProvider;

  constructor(apiKey: string) {
    this.inner = createHttpSearchProvider(apiKey, config);
  }

  search(...args: Parameters<SearchProvider["search"]>) {
    return this.inner.search(...args);
  }
}

export const providerMeta: ProviderMeta = {
  name: "websearchapi",
  tier: 1,
  monthlyQuota: null,
  requiresKey: true,
  create: (key) => ({ search: new WebSearchApiProvider(key!) }),
};
```

- [ ] **Step 4: Convert serper.ts**

Replace `src/providers/serper.ts`:

```ts
import { createHttpSearchProvider, type HttpSearchConfig } from "./http-adapter.ts";
import { applyDomainFilters } from "../utils/filters.ts";
import type { SearchFilters } from "./types.ts";
import type { ProviderMeta } from "./all.ts";
import type { SearchProvider } from "./types.ts";

function buildTbs(filters?: SearchFilters): string | undefined {
  if (!filters?.startDate && !filters?.endDate) return undefined;
  const start = filters.startDate ?? "";
  const end = filters.endDate ?? "";
  return `cdr:1,cd_min:${start},cd_max:${end}`;
}

const config: HttpSearchConfig = {
  name: "serper",
  label: "Serper",
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
  extractResults: (data: unknown) => {
    const d = data as { organic?: Array<{ title: string; link: string; snippet: string }> };
    return (d.organic ?? []).map((r) => ({
      title: r.title,
      url: r.link,
      snippet: r.snippet,
    }));
  },
};

export class SerperProvider {
  readonly name = "serper";
  readonly label = "Serper";
  private inner: SearchProvider;

  constructor(apiKey: string) {
    this.inner = createHttpSearchProvider(apiKey, config);
  }

  search(...args: Parameters<SearchProvider["search"]>) {
    return this.inner.search(...args);
  }
}

export const providerMeta: ProviderMeta = {
  name: "serper",
  tier: 1,
  monthlyQuota: 2500,
  requiresKey: true,
  create: (key) => ({ search: new SerperProvider(key!) }),
};
```

- [ ] **Step 5: Run provider tests**

Run: `pnpm vitest run tests/providers/perplexity.test.ts tests/providers/websearchapi.test.ts tests/providers/serper.test.ts`
Expected: PASS

- [ ] **Step 6: Measure line savings**

```bash
wc -l src/providers/perplexity.ts src/providers/websearchapi.ts src/providers/serper.ts
```

Compare with Step 1 totals. If net savings < 45 lines across these 3 providers, **STOP here**. The adapter interface is too wide for the savings. Skip remaining providers.

- [ ] **Step 7: Commit (if savings are sufficient)**

```bash
git add src/providers/perplexity.ts src/providers/websearchapi.ts src/providers/serper.ts
git commit -m "refactor: convert perplexity, websearchapi, serper to use HTTP adapter"
```

---

### Task 3: Convert remaining providers (if Task 2 showed sufficient savings)

**Files:**
- Modify: `src/providers/brave.ts`
- Modify: `src/providers/tavily.ts`
- Modify: `src/providers/exa.ts`
- Modify: `src/providers/firecrawl.ts`
- Modify: `src/providers/jina.ts`
- Modify: `src/providers/openai-native.ts`
- Modify: `src/providers/parallel.ts`
- Modify: `src/providers/searxng.ts`

- [ ] **Step 1: Convert each remaining HTTP-based provider**

For each provider, follow the same pattern as Task 2:
1. Define an `HttpSearchConfig` object capturing the provider's endpoint, auth, body, and result extraction
2. Create the class that delegates to `createHttpSearchProvider`
3. Keep the `providerMeta` export

Note: Providers implementing `FetchProvider` (tavily, exa, firecrawl, jina, parallel) keep their `fetch()` method as a custom implementation — only the `search()` method delegates to the adapter.

- [ ] **Step 2: Run full test suite**

Run: `pnpm vitest run`
Expected: All PASS

- [ ] **Step 3: Run full verification**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 4: Measure total line savings**

```bash
find src/providers -name "*.ts" | xargs wc -l
```

If net reduction ≥ 100 lines across all providers, the phase is justified.

- [ ] **Step 5: Commit**

```bash
git add src/providers/
git commit -m "refactor: convert all HTTP-based providers to use adapter scaffolding"
```
