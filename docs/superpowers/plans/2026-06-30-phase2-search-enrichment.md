# Phase 2: Search Enrichment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add domain/date filtering and compact output to web_search, with provider-specific filter mapping.

**Architecture:** Add `SearchFilters` to types, extend `SearchProvider.search()` with optional filters parameter, map filters to provider-native APIs where supported, add compact formatter to web_search tool.

**Tech Stack:** TypeScript, Vitest, existing pi-tools provider interfaces.

---

### Task 1: Add `SearchFilters` type and extend `SearchProvider` interface

**Files:**
- Modify: `src/providers/types.ts`
- Modify: `tests/providers/types.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/providers/types.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { SearchFilters, SearchProvider, SearchResult } from "../../src/providers/types.ts";

describe("SearchFilters type", () => {
  it("allows a provider to accept filters as an optional parameter", () => {
    const provider: SearchProvider = {
      name: "test",
      label: "Test",
      async search(
        query: string,
        maxResults: number,
        signal?: AbortSignal,
        filters?: SearchFilters,
      ): Promise<SearchResult[]> {
        return [];
      },
    };

    expect(provider.name).toBe("test");
  });

  it("allows a provider to omit the filters parameter (backward compat)", () => {
    const provider: SearchProvider = {
      name: "legacy",
      label: "Legacy",
      async search(
        query: string,
        maxResults: number,
        signal?: AbortSignal,
      ): Promise<SearchResult[]> {
        return [];
      },
    };

    expect(provider.name).toBe("legacy");
  });

  it("SearchFilters accepts all optional fields", () => {
    const filters: SearchFilters = {
      includeDomains: ["example.com", "docs.rs"],
      excludeDomains: ["spam.com"],
      startDate: "2025-01-01",
      endDate: "2025-12-31",
    };

    expect(filters.includeDomains).toHaveLength(2);
    expect(filters.excludeDomains).toHaveLength(1);
    expect(filters.startDate).toBe("2025-01-01");
    expect(filters.endDate).toBe("2025-12-31");
  });

  it("SearchFilters accepts empty object", () => {
    const filters: SearchFilters = {};
    expect(filters.includeDomains).toBeUndefined();
    expect(filters.excludeDomains).toBeUndefined();
    expect(filters.startDate).toBeUndefined();
    expect(filters.endDate).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/providers/types.test.ts`
Expected: FAIL — `SearchFilters` is not exported from `src/providers/types.ts`

- [ ] **Step 3: Add `SearchFilters` and extend `SearchProvider.search()` signature**

In `src/providers/types.ts`, add the `SearchFilters` interface before `SearchProvider`, and extend the `search()` method signature:

Add after the `FetchResult` interface:

```ts
export interface SearchFilters {
  includeDomains?: string[];
  excludeDomains?: string[];
  startDate?: string; // ISO 8601 date
  endDate?: string; // ISO 8601 date
}
```

Replace the `SearchProvider` interface:

```ts
export interface SearchProvider {
  readonly name: string;
  readonly label: string;
  search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
    filters?: SearchFilters,
  ): Promise<SearchResult[]>;
}
```

The full `src/providers/types.ts` should now be:

```ts
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

export interface SearchFilters {
  includeDomains?: string[];
  excludeDomains?: string[];
  startDate?: string; // ISO 8601 date
  endDate?: string; // ISO 8601 date
}

export interface SearchProvider {
  readonly name: string;
  readonly label: string;
  search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
    filters?: SearchFilters,
  ): Promise<SearchResult[]>;
}

export interface FetchProvider {
  readonly name: string;
  fetch(url: string, signal?: AbortSignal): Promise<FetchResult>;
}

export interface CodeSearchProvider {
  readonly name: string;
  codeSearch(query: string, maxResults: number, signal?: AbortSignal): Promise<CodeSearchResult[]>;
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
  defaultMonthlyQuota: number | null;
  capabilities: ProviderCapabilities;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/providers/types.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full test suite to verify backward compatibility**

Run: `npx vitest run`
Expected: All tests PASS — the added optional parameter does not break any existing provider implementations or tests.

- [ ] **Step 6: Commit**

```bash
git add src/providers/types.ts tests/providers/types.test.ts
git commit -m "feat: add SearchFilters type and extend SearchProvider.search() signature"
```

---

### Task 2: Update Brave provider to map filters

**Files:**
- Modify: `src/providers/brave.ts`
- Modify: `tests/providers/brave.test.ts`

- [ ] **Step 1: Write the failing tests**

Add the following tests to the existing `describe("BraveProvider", ...)` block in `tests/providers/brave.test.ts`:

```ts
import type { SearchFilters } from "../../src/providers/types.ts";

describe("search filters", () => {
  it("prepends site: operators for includeDomains", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: { web: { results: [] } },
    });

    const provider = new BraveProvider("test-key");
    const filters: SearchFilters = { includeDomains: ["example.com", "docs.rs"] };
    await provider.search("rust tutorial", 5, undefined, filters);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const url = fetchCall[0] as string;
    expect(url).toContain("site%3Aexample.com+OR+site%3Adocs.rs");
    expect(url).toContain("rust+tutorial");
  });

  it("prepends -site: operators for excludeDomains", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: { web: { results: [] } },
    });

    const provider = new BraveProvider("test-key");
    const filters: SearchFilters = { excludeDomains: ["spam.com"] };
    await provider.search("test query", 5, undefined, filters);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const url = fetchCall[0] as string;
    expect(url).toContain("-site%3Aspam.com");
    expect(url).toContain("test+query");
  });

  it("adds freshness parameter for date filters", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: { web: { results: [] } },
    });

    const provider = new BraveProvider("test-key");
    const filters: SearchFilters = {
      startDate: "2025-06-01",
      endDate: "2025-06-30",
    };
    await provider.search("test", 5, undefined, filters);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const url = fetchCall[0] as string;
    expect(url).toContain("freshness=2025-06-01to2025-06-30");
  });

  it("uses open-ended freshness when only startDate is set", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: { web: { results: [] } },
    });

    const provider = new BraveProvider("test-key");
    const filters: SearchFilters = { startDate: "2025-01-01" };
    await provider.search("test", 5, undefined, filters);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const url = fetchCall[0] as string;
    expect(url).toContain("freshness=2025-01-01to");
  });

  it("uses open-ended freshness when only endDate is set", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: { web: { results: [] } },
    });

    const provider = new BraveProvider("test-key");
    const filters: SearchFilters = { endDate: "2025-12-31" };
    await provider.search("test", 5, undefined, filters);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const url = fetchCall[0] as string;
    expect(url).toContain("freshness=to2025-12-31");
  });

  it("combines domain and date filters", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: { web: { results: [] } },
    });

    const provider = new BraveProvider("test-key");
    const filters: SearchFilters = {
      includeDomains: ["example.com"],
      startDate: "2025-01-01",
      endDate: "2025-06-30",
    };
    await provider.search("query", 5, undefined, filters);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const url = fetchCall[0] as string;
    expect(url).toContain("site%3Aexample.com");
    expect(url).toContain("freshness=2025-01-01to2025-06-30");
  });

  it("works normally without filters", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: {
        web: {
          results: [{ title: "Result", url: "https://example.com", description: "snippet" }],
        },
      },
    });

    const provider = new BraveProvider("test-key");
    const results = await provider.search("test", 5);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Result");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/providers/brave.test.ts`
Expected: FAIL — Brave provider does not accept a `filters` parameter yet, and the domain/date assertions fail

- [ ] **Step 3: Implement filter mapping in `BraveProvider`**

Replace the contents of `src/providers/brave.ts`:

```ts
// src/providers/brave.ts
import type { SearchFilters, SearchProvider, SearchResult } from "./types.ts";

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
    filters?: SearchFilters,
  ): Promise<SearchResult[]> {
    const effectiveQuery = applyDomainFilters(query, filters);

    const params = new URLSearchParams({
      q: effectiveQuery,
      count: String(maxResults),
    });

    const freshness = buildFreshness(filters);
    if (freshness) {
      params.set("freshness", freshness);
    }

    const url = `https://api.search.brave.com/res/v1/web/search?${params.toString()}`;
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

    const data = (await response.json()) as BraveSearchResponse;
    return (data.web?.results ?? []).slice(0, maxResults).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
    }));
  }
}

function applyDomainFilters(query: string, filters?: SearchFilters): string {
  if (!filters) return query;

  const parts: string[] = [];

  if (filters.includeDomains?.length) {
    parts.push(filters.includeDomains.map((d) => `site:${d}`).join(" OR "));
  }

  if (filters.excludeDomains?.length) {
    parts.push(filters.excludeDomains.map((d) => `-site:${d}`).join(" "));
  }

  if (parts.length === 0) return query;
  return `${parts.join(" ")} ${query}`;
}

function buildFreshness(filters?: SearchFilters): string | null {
  if (!filters) return null;
  if (!filters.startDate && !filters.endDate) return null;
  return `${filters.startDate ?? ""}to${filters.endDate ?? ""}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/providers/brave.test.ts`
Expected: All tests PASS (both existing and new)

- [ ] **Step 5: Commit**

```bash
git add src/providers/brave.ts tests/providers/brave.test.ts
git commit -m "feat: map SearchFilters to Brave API (site: operators + freshness)"
```

---

### Task 3: Update Exa provider to map filters

**Files:**
- Modify: `src/providers/exa.ts`
- Modify: `tests/providers/exa.test.ts`

- [ ] **Step 1: Write the failing tests**

Add the following tests to the existing `describe("ExaProvider", ...)` block in `tests/providers/exa.test.ts`:

```ts
import type { SearchFilters } from "../../src/providers/types.ts";

describe("search filters", () => {
  it("passes includeDomains to the API", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: { results: [] },
    });

    const provider = new ExaProvider("key");
    const filters: SearchFilters = { includeDomains: ["example.com", "docs.rs"] };
    await provider.search("test", 5, undefined, filters);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.includeDomains).toEqual(["example.com", "docs.rs"]);
  });

  it("passes excludeDomains to the API", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: { results: [] },
    });

    const provider = new ExaProvider("key");
    const filters: SearchFilters = { excludeDomains: ["spam.com"] };
    await provider.search("test", 5, undefined, filters);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.excludeDomains).toEqual(["spam.com"]);
  });

  it("passes startPublishedDate and endPublishedDate to the API", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: { results: [] },
    });

    const provider = new ExaProvider("key");
    const filters: SearchFilters = {
      startDate: "2025-01-01",
      endDate: "2025-12-31",
    };
    await provider.search("test", 5, undefined, filters);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.startPublishedDate).toBe("2025-01-01");
    expect(body.endPublishedDate).toBe("2025-12-31");
  });

  it("combines all filter fields", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: { results: [] },
    });

    const provider = new ExaProvider("key");
    const filters: SearchFilters = {
      includeDomains: ["example.com"],
      excludeDomains: ["spam.com"],
      startDate: "2025-01-01",
      endDate: "2025-06-30",
    };
    await provider.search("test", 5, undefined, filters);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.includeDomains).toEqual(["example.com"]);
    expect(body.excludeDomains).toEqual(["spam.com"]);
    expect(body.startPublishedDate).toBe("2025-01-01");
    expect(body.endPublishedDate).toBe("2025-06-30");
  });

  it("omits filter fields from body when not provided", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: { results: [] },
    });

    const provider = new ExaProvider("key");
    await provider.search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.includeDomains).toBeUndefined();
    expect(body.excludeDomains).toBeUndefined();
    expect(body.startPublishedDate).toBeUndefined();
    expect(body.endPublishedDate).toBeUndefined();
  });

  it("does not affect codeSearch method", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: {
        results: [
          { title: "Code", url: "https://github.com/ex", text: "const x = 1;" },
        ],
      },
    });

    const provider = new ExaProvider("key");
    const results = await provider.codeSearch("typescript", 5);
    expect(results).toHaveLength(1);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.includeDomains).toBeUndefined();
    expect(body.excludeDomains).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/providers/exa.test.ts`
Expected: FAIL — Exa provider does not pass filter fields to the API body

- [ ] **Step 3: Implement filter mapping in `ExaProvider`**

Replace the contents of `src/providers/exa.ts`:

```ts
// src/providers/exa.ts
import type {
  CodeSearchProvider,
  CodeSearchResult,
  FetchProvider,
  FetchResult,
  SearchFilters,
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

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
    filters?: SearchFilters,
  ): Promise<SearchResult[]> {
    const body: Record<string, unknown> = {
      query,
      numResults: maxResults,
      useAutoprompt: true,
      type: "auto",
    };

    if (filters?.includeDomains?.length) {
      body.includeDomains = filters.includeDomains;
    }
    if (filters?.excludeDomains?.length) {
      body.excludeDomains = filters.excludeDomains;
    }
    if (filters?.startDate) {
      body.startPublishedDate = filters.startDate;
    }
    if (filters?.endDate) {
      body.endPublishedDate = filters.endDate;
    }

    const response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) throw new Error(`Exa API error: ${response.status} ${response.statusText}`);
    const data = (await response.json()) as ExaSearchResponse;
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
    const data = (await response.json()) as ExaSearchResponse;
    return (data.results ?? []).slice(0, maxResults).map((r) => ({
      title: r.title, url: r.url, snippet: r.text ?? "",
    }));
  }

  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult> {
    const response = await fetch("https://api.exa.ai/contents", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ urls: [url], text: true }),
      signal,
    });
    if (!response.ok) throw new Error(`Exa contents error: ${response.status} ${response.statusText}`);
    const data = (await response.json()) as ExaContentsResponse;
    return { text: data.results?.[0]?.text ?? "" };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/providers/exa.test.ts`
Expected: All tests PASS (both existing and new)

- [ ] **Step 5: Commit**

```bash
git add src/providers/exa.ts tests/providers/exa.test.ts
git commit -m "feat: map SearchFilters to Exa API (native domain + date params)"
```

---

### Task 4: Update Tavily provider to map filters

**Files:**
- Modify: `src/providers/tavily.ts`
- Modify: `tests/providers/tavily.test.ts`

- [ ] **Step 1: Write the failing tests**

Add the following tests to the existing `describe("TavilyProvider", ...)` block in `tests/providers/tavily.test.ts`:

```ts
import type { SearchFilters } from "../../src/providers/types.ts";

describe("search filters", () => {
  it("passes include_domains to the API", async () => {
    fetchStub.addResponse("api.tavily.com", {
      body: { results: [] },
    });

    const provider = new TavilyProvider("key");
    const filters: SearchFilters = { includeDomains: ["example.com", "docs.rs"] };
    await provider.search("test", 5, undefined, filters);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.include_domains).toEqual(["example.com", "docs.rs"]);
  });

  it("passes exclude_domains to the API", async () => {
    fetchStub.addResponse("api.tavily.com", {
      body: { results: [] },
    });

    const provider = new TavilyProvider("key");
    const filters: SearchFilters = { excludeDomains: ["spam.com"] };
    await provider.search("test", 5, undefined, filters);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.exclude_domains).toEqual(["spam.com"]);
  });

  it("silently ignores date filters (not supported by Tavily)", async () => {
    fetchStub.addResponse("api.tavily.com", {
      body: { results: [] },
    });

    const provider = new TavilyProvider("key");
    const filters: SearchFilters = {
      startDate: "2025-01-01",
      endDate: "2025-12-31",
    };
    await provider.search("test", 5, undefined, filters);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.startDate).toBeUndefined();
    expect(body.endDate).toBeUndefined();
    expect(body.start_date).toBeUndefined();
    expect(body.end_date).toBeUndefined();
  });

  it("omits domain fields from body when not provided", async () => {
    fetchStub.addResponse("api.tavily.com", {
      body: { results: [] },
    });

    const provider = new TavilyProvider("key");
    await provider.search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.include_domains).toBeUndefined();
    expect(body.exclude_domains).toBeUndefined();
  });

  it("combines domain filters with existing search params", async () => {
    fetchStub.addResponse("api.tavily.com", {
      body: { results: [] },
    });

    const provider = new TavilyProvider("key");
    const filters: SearchFilters = {
      includeDomains: ["example.com"],
      excludeDomains: ["spam.com"],
    };
    await provider.search("test query", 10, undefined, filters);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.query).toBe("test query");
    expect(body.max_results).toBe(10);
    expect(body.include_domains).toEqual(["example.com"]);
    expect(body.exclude_domains).toEqual(["spam.com"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/providers/tavily.test.ts`
Expected: FAIL — Tavily provider does not pass domain filter fields to the API body

- [ ] **Step 3: Implement filter mapping in `TavilyProvider`**

Replace the contents of `src/providers/tavily.ts`:

```ts
// src/providers/tavily.ts
import type { FetchProvider, FetchResult, SearchFilters, SearchProvider, SearchResult } from "./types.ts";

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

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
    filters?: SearchFilters,
  ): Promise<SearchResult[]> {
    const body: Record<string, unknown> = {
      api_key: this.apiKey,
      query,
      max_results: maxResults,
    };

    if (filters?.includeDomains?.length) {
      body.include_domains = filters.includeDomains;
    }
    if (filters?.excludeDomains?.length) {
      body.exclude_domains = filters.excludeDomains;
    }
    // Note: Tavily does not support date filtering — startDate/endDate are silently ignored.

    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) throw new Error(`Tavily API error: ${response.status} ${response.statusText}`);
    const data = (await response.json()) as TavilySearchResponse;
    return (data.results ?? []).slice(0, maxResults).map((r) => ({
      title: r.title, url: r.url, snippet: r.content,
    }));
  }

  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult> {
    const response = await fetch("https://api.tavily.com/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: this.apiKey, urls: [url] }),
      signal,
    });
    if (!response.ok) throw new Error(`Tavily extract error: ${response.status} ${response.statusText}`);
    const data = (await response.json()) as TavilyExtractResponse;
    const content = data.results?.[0]?.raw_content ?? "";
    return { text: content };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/providers/tavily.test.ts`
Expected: All tests PASS (both existing and new)

- [ ] **Step 5: Commit**

```bash
git add src/providers/tavily.ts tests/providers/tavily.test.ts
git commit -m "feat: map SearchFilters to Tavily API (domain filters, dates ignored)"
```

---

### Task 5: Update Serper provider to map filters

**Files:**
- Modify: `src/providers/serper.ts`
- Modify: `tests/providers/serper.test.ts`

- [ ] **Step 1: Write the failing tests**

Add the following tests to the existing `describe("SerperProvider", ...)` block in `tests/providers/serper.test.ts`:

```ts
import type { SearchFilters } from "../../src/providers/types.ts";

describe("search filters", () => {
  it("prepends site: operators for includeDomains", async () => {
    fetchStub.addResponse("google.serper.dev", {
      body: { organic: [] },
    });

    const provider = new SerperProvider("key");
    const filters: SearchFilters = { includeDomains: ["example.com", "docs.rs"] };
    await provider.search("rust tutorial", 5, undefined, filters);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.q).toContain("site:example.com OR site:docs.rs");
    expect(body.q).toContain("rust tutorial");
  });

  it("prepends -site: operators for excludeDomains", async () => {
    fetchStub.addResponse("google.serper.dev", {
      body: { organic: [] },
    });

    const provider = new SerperProvider("key");
    const filters: SearchFilters = { excludeDomains: ["spam.com"] };
    await provider.search("test query", 5, undefined, filters);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.q).toContain("-site:spam.com");
    expect(body.q).toContain("test query");
  });

  it("adds tbs parameter for date range filters", async () => {
    fetchStub.addResponse("google.serper.dev", {
      body: { organic: [] },
    });

    const provider = new SerperProvider("key");
    const filters: SearchFilters = {
      startDate: "2025-06-01",
      endDate: "2025-06-30",
    };
    await provider.search("test", 5, undefined, filters);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.tbs).toBe("cdr:1,cd_min:06/01/2025,cd_max:06/30/2025");
  });

  it("uses open-ended tbs when only startDate is set", async () => {
    fetchStub.addResponse("google.serper.dev", {
      body: { organic: [] },
    });

    const provider = new SerperProvider("key");
    const filters: SearchFilters = { startDate: "2025-01-15" };
    await provider.search("test", 5, undefined, filters);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.tbs).toBe("cdr:1,cd_min:01/15/2025,cd_max:");
  });

  it("uses open-ended tbs when only endDate is set", async () => {
    fetchStub.addResponse("google.serper.dev", {
      body: { organic: [] },
    });

    const provider = new SerperProvider("key");
    const filters: SearchFilters = { endDate: "2025-12-31" };
    await provider.search("test", 5, undefined, filters);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.tbs).toBe("cdr:1,cd_min:,cd_max:12/31/2025");
  });

  it("combines domain and date filters", async () => {
    fetchStub.addResponse("google.serper.dev", {
      body: { organic: [] },
    });

    const provider = new SerperProvider("key");
    const filters: SearchFilters = {
      includeDomains: ["example.com"],
      excludeDomains: ["spam.com"],
      startDate: "2025-01-01",
      endDate: "2025-06-30",
    };
    await provider.search("query", 5, undefined, filters);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.q).toContain("site:example.com");
    expect(body.q).toContain("-site:spam.com");
    expect(body.tbs).toContain("cd_min:01/01/2025");
  });

  it("does not add tbs when no date filters are set", async () => {
    fetchStub.addResponse("google.serper.dev", {
      body: { organic: [] },
    });

    const provider = new SerperProvider("key");
    const filters: SearchFilters = { includeDomains: ["example.com"] };
    await provider.search("test", 5, undefined, filters);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.tbs).toBeUndefined();
  });

  it("works normally without filters", async () => {
    fetchStub.addResponse("google.serper.dev", {
      body: {
        organic: [
          { title: "Result", link: "https://example.com", snippet: "A snippet" },
        ],
      },
    });

    const provider = new SerperProvider("key");
    const results = await provider.search("test", 5);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Result");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/providers/serper.test.ts`
Expected: FAIL — Serper provider does not accept a `filters` parameter yet

- [ ] **Step 3: Implement filter mapping in `SerperProvider`**

Replace the contents of `src/providers/serper.ts`:

```ts
// src/providers/serper.ts
import type { SearchFilters, SearchProvider, SearchResult } from "./types.ts";

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

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
    filters?: SearchFilters,
  ): Promise<SearchResult[]> {
    const effectiveQuery = applyDomainFilters(query, filters);

    const body: Record<string, unknown> = {
      q: effectiveQuery,
      num: maxResults,
    };

    const tbs = buildTbs(filters);
    if (tbs) {
      body.tbs = tbs;
    }

    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": this.apiKey,
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) throw new Error(`Serper API error: ${response.status} ${response.statusText}`);
    const data = (await response.json()) as SerperResponse;
    return (data.organic ?? []).slice(0, maxResults).map((r) => ({
      title: r.title, url: r.link, snippet: r.snippet,
    }));
  }
}

function applyDomainFilters(query: string, filters?: SearchFilters): string {
  if (!filters) return query;

  const parts: string[] = [];

  if (filters.includeDomains?.length) {
    parts.push(filters.includeDomains.map((d) => `site:${d}`).join(" OR "));
  }

  if (filters.excludeDomains?.length) {
    parts.push(filters.excludeDomains.map((d) => `-site:${d}`).join(" "));
  }

  if (parts.length === 0) return query;
  return `${parts.join(" ")} ${query}`;
}

/**
 * Builds a Google `tbs` (time-based search) parameter string.
 * Format: cdr:1,cd_min:MM/DD/YYYY,cd_max:MM/DD/YYYY
 */
function buildTbs(filters?: SearchFilters): string | null {
  if (!filters) return null;
  if (!filters.startDate && !filters.endDate) return null;

  const min = filters.startDate ? isoToMDY(filters.startDate) : "";
  const max = filters.endDate ? isoToMDY(filters.endDate) : "";
  return `cdr:1,cd_min:${min},cd_max:${max}`;
}

/** Converts "YYYY-MM-DD" to "MM/DD/YYYY" for Google's tbs format. */
function isoToMDY(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${month}/${day}/${year}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/providers/serper.test.ts`
Expected: All tests PASS (both existing and new)

- [ ] **Step 5: Commit**

```bash
git add src/providers/serper.ts tests/providers/serper.test.ts
git commit -m "feat: map SearchFilters to Serper API (site: operators + tbs date range)"
```

---

### Task 6: Update DuckDuckGo provider to map filters

**Files:**
- Modify: `src/providers/duckduckgo.ts`
- Modify: `tests/providers/duckduckgo.test.ts`

- [ ] **Step 1: Write the failing tests**

Add the following tests to the existing `describe("DuckDuckGoProvider", ...)` block in `tests/providers/duckduckgo.test.ts`:

```ts
import type { SearchFilters } from "../../src/providers/types.ts";

describe("search filters", () => {
  it("prepends site: operators for includeDomains in the -q argument", async () => {
    const provider = new DuckDuckGoProvider(execStub.fn);
    const filters: SearchFilters = { includeDomains: ["example.com", "docs.rs"] };
    await provider.search("rust tutorial", 5, undefined, filters);

    const args = execStub.lastArgs();
    const qIdx = args?.indexOf("-q") ?? -1;
    const query = args?.[qIdx + 1] ?? "";
    expect(query).toContain("site:example.com OR site:docs.rs");
    expect(query).toContain("rust tutorial");
  });

  it("prepends -site: operators for excludeDomains in the -q argument", async () => {
    const provider = new DuckDuckGoProvider(execStub.fn);
    const filters: SearchFilters = { excludeDomains: ["spam.com"] };
    await provider.search("test query", 5, undefined, filters);

    const args = execStub.lastArgs();
    const qIdx = args?.indexOf("-q") ?? -1;
    const query = args?.[qIdx + 1] ?? "";
    expect(query).toContain("-site:spam.com");
    expect(query).toContain("test query");
  });

  it("passes timelimit flag for startDate (approximate mapping)", async () => {
    const provider = new DuckDuckGoProvider(execStub.fn);
    // 7 days ago
    const recent = new Date();
    recent.setDate(recent.getDate() - 5);
    const filters: SearchFilters = { startDate: recent.toISOString().slice(0, 10) };
    await provider.search("test", 5, undefined, filters);

    const args = execStub.lastArgs();
    expect(args).toContain("-t");
    // Should pick "w" (week) since the date is within the last 7 days
    const tIdx = args?.indexOf("-t") ?? -1;
    expect(args?.[tIdx + 1]).toBe("w");
  });

  it("maps startDate older than 30 days to year timelimit", async () => {
    const provider = new DuckDuckGoProvider(execStub.fn);
    const old = new Date();
    old.setDate(old.getDate() - 200);
    const filters: SearchFilters = { startDate: old.toISOString().slice(0, 10) };
    await provider.search("test", 5, undefined, filters);

    const args = execStub.lastArgs();
    expect(args).toContain("-t");
    const tIdx = args?.indexOf("-t") ?? -1;
    expect(args?.[tIdx + 1]).toBe("y");
  });

  it("does not pass timelimit when no startDate is set", async () => {
    const provider = new DuckDuckGoProvider(execStub.fn);
    const filters: SearchFilters = { includeDomains: ["example.com"] };
    await provider.search("test", 5, undefined, filters);

    const args = execStub.lastArgs();
    expect(args).not.toContain("-t");
  });

  it("silently ignores endDate (not supported by ddgs)", async () => {
    const provider = new DuckDuckGoProvider(execStub.fn);
    const filters: SearchFilters = { endDate: "2025-12-31" };
    await provider.search("test", 5, undefined, filters);

    const args = execStub.lastArgs();
    expect(args).not.toContain("-t");
  });

  it("combines domain and date filters", async () => {
    const provider = new DuckDuckGoProvider(execStub.fn);
    const recent = new Date();
    recent.setDate(recent.getDate() - 20);
    const filters: SearchFilters = {
      includeDomains: ["example.com"],
      excludeDomains: ["spam.com"],
      startDate: recent.toISOString().slice(0, 10),
    };
    await provider.search("query", 5, undefined, filters);

    const args = execStub.lastArgs();
    const qIdx = args?.indexOf("-q") ?? -1;
    const query = args?.[qIdx + 1] ?? "";
    expect(query).toContain("site:example.com");
    expect(query).toContain("-site:spam.com");
    expect(args).toContain("-t");
    const tIdx = args?.indexOf("-t") ?? -1;
    expect(args?.[tIdx + 1]).toBe("m");
  });

  it("works normally without filters", async () => {
    const provider = new DuckDuckGoProvider(execStub.fn);
    const results = await provider.search("test query", 5);
    expect(results.length).toBe(3);
    expect(results[0].title).toBe("Example Result");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/providers/duckduckgo.test.ts`
Expected: FAIL — DuckDuckGo provider does not handle filters

- [ ] **Step 3: Implement filter mapping in `DuckDuckGoProvider`**

Replace the contents of `src/providers/duckduckgo.ts`:

```ts
import { execFile as defaultExecFile } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { SearchFilters, SearchProvider, SearchResult } from "./types.ts";

interface DDGSResult {
  title: string;
  href: string;
  body: string;
}

// Narrow type covering only the execFile overload we actually call.
// Using typeof defaultExecFile would require __promisify__, making mocks complex.
export type ExecFileFn = (
  command: string,
  args: string[],
  options: { timeout?: number },
  callback: (error: Error | null, stdout: string, stderr: string) => void,
) => { kill(): boolean | undefined };

const EXEC_TIMEOUT_MS = 15_000;

export class DuckDuckGoProvider implements SearchProvider {
  readonly name = "duckduckgo";
  readonly label = "DuckDuckGo";

  private readonly execFile: ExecFileFn;

  constructor(execFileFn: ExecFileFn = defaultExecFile as unknown as ExecFileFn) {
    this.execFile = execFileFn;
  }

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
    filters?: SearchFilters,
  ): Promise<SearchResult[]> {
    if (signal?.aborted) {
      throw new Error("Search aborted");
    }

    const effectiveQuery = applyDomainFilters(query, filters);
    const timelimit = computeTimelimit(filters);

    const tmpFile = path.join(
      os.tmpdir(),
      `ddgs-${crypto.randomUUID()}.json`,
    );

    try {
      // runDdgs handles ENOENT (binary missing) and rethrows with install hint
      await this.runDdgs(effectiveQuery, maxResults, tmpFile, signal, timelimit);

      let raw: string;
      try {
        raw = await fs.readFile(tmpFile, "utf-8");
      } catch {
        throw new Error("Failed to parse ddgs output: output file not created");
      }

      let data: DDGSResult[];
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error("not an array");
        data = parsed as DDGSResult[];
      } catch {
        throw new Error("Failed to parse ddgs output: malformed JSON");
      }

      return data.slice(0, maxResults).map((r) => ({
        title: r.title,
        url: r.href,
        snippet: r.body,
      }));
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
    }
  }

  private runDdgs(
    query: string,
    maxResults: number,
    outPath: string,
    signal?: AbortSignal,
    timelimit?: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        child.kill();
        reject(new Error("Search aborted"));
      };

      const args = ["text", "-q", query, "-m", String(maxResults), "-o", outPath];
      if (timelimit) {
        args.push("-t", timelimit);
      }

      const child = this.execFile(
        "ddgs",
        args,
        { timeout: EXEC_TIMEOUT_MS },
        (error, _stdout, stderr) => {
          if (signal) signal.removeEventListener("abort", onAbort);
          if (error) {
            // ENOENT from execFile means the ddgs binary is missing
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
              reject(
                new Error(
                  "ddgs CLI not found. Install with: pip install ddgs (or: uv tool install ddgs)",
                ),
              );
              return;
            }
            // Include stderr in the error message when available
            const detail = stderr?.trim();
            reject(detail ? new Error(`ddgs failed: ${detail}`) : error);
          } else {
            resolve();
          }
        },
      );

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }
}

function applyDomainFilters(query: string, filters?: SearchFilters): string {
  if (!filters) return query;

  const parts: string[] = [];

  if (filters.includeDomains?.length) {
    parts.push(filters.includeDomains.map((d) => `site:${d}`).join(" OR "));
  }

  if (filters.excludeDomains?.length) {
    parts.push(filters.excludeDomains.map((d) => `-site:${d}`).join(" "));
  }

  if (parts.length === 0) return query;
  return `${parts.join(" ")} ${query}`;
}

/**
 * Maps a startDate to the closest ddgs timelimit flag.
 * ddgs supports: d (day), w (week), m (month), y (year).
 * endDate is not supported — silently ignored.
 */
function computeTimelimit(filters?: SearchFilters): string | undefined {
  if (!filters?.startDate) return undefined;

  const start = new Date(filters.startDate);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays <= 1) return "d";
  if (diffDays <= 7) return "w";
  if (diffDays <= 30) return "m";
  return "y";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/providers/duckduckgo.test.ts`
Expected: All tests PASS (both existing and new)

- [ ] **Step 5: Commit**

```bash
git add src/providers/duckduckgo.ts tests/providers/duckduckgo.test.ts
git commit -m "feat: map SearchFilters to DuckDuckGo (site: operators + timelimit)"
```

---

### Task 7: Update Jina, Perplexity, Firecrawl providers (accept and ignore filters)

**Files:**
- Modify: `src/providers/jina.ts`
- Modify: `src/providers/perplexity.ts`
- Modify: `src/providers/firecrawl.ts`
- Modify: `tests/providers/jina.test.ts`
- Modify: `tests/providers/perplexity.test.ts`
- Modify: `tests/providers/firecrawl.test.ts`

- [ ] **Step 1: Write the failing tests for all three providers**

Add to `tests/providers/jina.test.ts` inside the existing `describe("JinaProvider", ...)` block:

```ts
import type { SearchFilters } from "../../src/providers/types.ts";

describe("search filters", () => {
  it("accepts filters parameter without error", async () => {
    fetchStub.addResponse("s.jina.ai", {
      body: {
        data: [{ title: "Result", url: "https://example.com", description: "snippet" }],
      },
    });

    const provider = new JinaProvider("key");
    const filters: SearchFilters = {
      includeDomains: ["example.com"],
      excludeDomains: ["spam.com"],
      startDate: "2025-01-01",
      endDate: "2025-12-31",
    };
    const results = await provider.search("test", 5, undefined, filters);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Result");
  });

  it("does not modify the query or request when filters are provided", async () => {
    fetchStub.addResponse("s.jina.ai", {
      body: { data: [] },
    });

    const provider = new JinaProvider("key");
    const filters: SearchFilters = { includeDomains: ["example.com"] };
    await provider.search("test query", 5, undefined, filters);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const url = fetchCall[0] as string;
    expect(url).toContain("q=test%20query");
    expect(url).not.toContain("site:");
  });
});
```

Add to `tests/providers/perplexity.test.ts` inside the existing `describe("PerplexityProvider", ...)` block:

```ts
import type { SearchFilters } from "../../src/providers/types.ts";

describe("search filters", () => {
  it("accepts filters parameter without error", async () => {
    fetchStub.addResponse("api.perplexity.ai", {
      body: {
        choices: [{ message: { content: "Answer text" } }],
        citations: ["https://example.com"],
      },
    });

    const provider = new PerplexityProvider("key");
    const filters: SearchFilters = {
      includeDomains: ["example.com"],
      excludeDomains: ["spam.com"],
      startDate: "2025-01-01",
      endDate: "2025-12-31",
    };
    const results = await provider.search("test", 5, undefined, filters);
    expect(results.length).toBeGreaterThan(0);
  });

  it("does not modify the request body when filters are provided", async () => {
    fetchStub.addResponse("api.perplexity.ai", {
      body: {
        choices: [{ message: { content: "Answer" } }],
        citations: [],
      },
    });

    const provider = new PerplexityProvider("key");
    const filters: SearchFilters = { includeDomains: ["example.com"] };
    await provider.search("test query", 5, undefined, filters);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.messages[0].content).toBe("test query");
    expect(body.includeDomains).toBeUndefined();
  });
});
```

Add to `tests/providers/firecrawl.test.ts` inside the existing `describe("FirecrawlProvider", ...)` block:

```ts
import type { SearchFilters } from "../../src/providers/types.ts";

describe("search filters", () => {
  it("accepts filters parameter without error", async () => {
    fetchStub.addResponse("api.firecrawl.dev/v1/search", {
      body: {
        data: [{ title: "Result", url: "https://example.com", description: "snippet" }],
      },
    });

    const provider = new FirecrawlProvider("key");
    const filters: SearchFilters = {
      includeDomains: ["example.com"],
      excludeDomains: ["spam.com"],
      startDate: "2025-01-01",
      endDate: "2025-12-31",
    };
    const results = await provider.search("test", 5, undefined, filters);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Result");
  });

  it("does not modify the request body when filters are provided", async () => {
    fetchStub.addResponse("api.firecrawl.dev/v1/search", {
      body: { data: [] },
    });

    const provider = new FirecrawlProvider("key");
    const filters: SearchFilters = { includeDomains: ["example.com"] };
    await provider.search("test query", 5, undefined, filters);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.query).toBe("test query");
    expect(body.includeDomains).toBeUndefined();
    expect(body.include_domains).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/providers/jina.test.ts tests/providers/perplexity.test.ts tests/providers/firecrawl.test.ts`
Expected: FAIL — the providers' `search()` signatures don't accept a fourth `filters` parameter (TypeScript type mismatch in tests)

- [ ] **Step 3: Add `filters` parameter to `JinaProvider.search()`**

In `src/providers/jina.ts`, update the import and the `search()` method signature:

Replace:
```ts
import type { FetchProvider, FetchResult, SearchProvider, SearchResult } from "./types.ts";
```
With:
```ts
import type { FetchProvider, FetchResult, SearchFilters, SearchProvider, SearchResult } from "./types.ts";
```

Replace:
```ts
  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
  ): Promise<SearchResult[]> {
```
With:
```ts
  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
    _filters?: SearchFilters,
  ): Promise<SearchResult[]> {
```

The method body is unchanged — filters are accepted and silently ignored.

- [ ] **Step 4: Add `filters` parameter to `PerplexityProvider.search()`**

In `src/providers/perplexity.ts`, update the import and the `search()` method signature:

Replace:
```ts
import type { SearchProvider, SearchResult } from "./types.ts";
```
With:
```ts
import type { SearchFilters, SearchProvider, SearchResult } from "./types.ts";
```

Replace:
```ts
  async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
```
With:
```ts
  async search(query: string, maxResults: number, signal?: AbortSignal, _filters?: SearchFilters): Promise<SearchResult[]> {
```

The method body is unchanged — filters are accepted and silently ignored.

- [ ] **Step 5: Add `filters` parameter to `FirecrawlProvider.search()`**

In `src/providers/firecrawl.ts`, update the import and the `search()` method signature:

Replace:
```ts
import type { FetchProvider, FetchResult, SearchProvider, SearchResult } from "./types.ts";
```
With:
```ts
import type { FetchProvider, FetchResult, SearchFilters, SearchProvider, SearchResult } from "./types.ts";
```

Replace:
```ts
  async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
```
With:
```ts
  async search(query: string, maxResults: number, signal?: AbortSignal, _filters?: SearchFilters): Promise<SearchResult[]> {
```

The method body is unchanged — filters are accepted and silently ignored.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/providers/jina.test.ts tests/providers/perplexity.test.ts tests/providers/firecrawl.test.ts`
Expected: All tests PASS (both existing and new)

- [ ] **Step 7: Commit**

```bash
git add src/providers/jina.ts src/providers/perplexity.ts src/providers/firecrawl.ts tests/providers/jina.test.ts tests/providers/perplexity.test.ts tests/providers/firecrawl.test.ts
git commit -m "feat: accept SearchFilters in Jina, Perplexity, Firecrawl providers (silently ignored)"
```

---

### Task 8: Add compact output format and filter parameters to `web_search` tool

**Files:**
- Modify: `src/tools/web-search.ts`
- Modify: `tests/tools/web-search.test.ts`

- [ ] **Step 1: Write the failing tests**

Add the following tests to `tests/tools/web-search.test.ts`. These use the post-Phase-1 signature where `createWebSearchTool` takes `resolveCandidates: (name?) => SearchProvider[]`:

```ts
import type { SearchFilters } from "../../src/providers/types.ts";

function makeCapturingProvider(): {
  provider: SearchProvider;
  captured: { query: string; filters?: SearchFilters }[];
} {
  const captured: { query: string; filters?: SearchFilters }[] = [];
  const provider: SearchProvider = {
    name: "capturing",
    label: "Capturing",
    async search(
      query: string,
      maxResults: number,
      signal?: AbortSignal,
      filters?: SearchFilters,
    ): Promise<SearchResult[]> {
      captured.push({ query, filters });
      return [
        { title: "Captured Result", url: "https://example.com", snippet: "captured" },
      ];
    },
  };
  return { provider, captured };
}

describe("web_search filter parameters", () => {
  it("passes includeDomains to the provider as SearchFilters", async () => {
    const { provider, captured } = makeCapturingProvider();
    const tool = createWebSearchTool(() => [provider]);
    const ctx = makeCtx();
    await tool.execute(
      "call-f1",
      { query: "test", includeDomains: ["example.com", "docs.rs"] },
      undefined,
      undefined,
      ctx,
    );
    expect(captured).toHaveLength(1);
    expect(captured[0].filters?.includeDomains).toEqual(["example.com", "docs.rs"]);
  });

  it("passes excludeDomains to the provider as SearchFilters", async () => {
    const { provider, captured } = makeCapturingProvider();
    const tool = createWebSearchTool(() => [provider]);
    const ctx = makeCtx();
    await tool.execute(
      "call-f2",
      { query: "test", excludeDomains: ["spam.com"] },
      undefined,
      undefined,
      ctx,
    );
    expect(captured).toHaveLength(1);
    expect(captured[0].filters?.excludeDomains).toEqual(["spam.com"]);
  });

  it("passes startDate and endDate to the provider as SearchFilters", async () => {
    const { provider, captured } = makeCapturingProvider();
    const tool = createWebSearchTool(() => [provider]);
    const ctx = makeCtx();
    await tool.execute(
      "call-f3",
      { query: "test", startDate: "2025-01-01", endDate: "2025-12-31" },
      undefined,
      undefined,
      ctx,
    );
    expect(captured).toHaveLength(1);
    expect(captured[0].filters?.startDate).toBe("2025-01-01");
    expect(captured[0].filters?.endDate).toBe("2025-12-31");
  });

  it("passes all filter fields together", async () => {
    const { provider, captured } = makeCapturingProvider();
    const tool = createWebSearchTool(() => [provider]);
    const ctx = makeCtx();
    await tool.execute(
      "call-f4",
      {
        query: "test",
        includeDomains: ["example.com"],
        excludeDomains: ["spam.com"],
        startDate: "2025-01-01",
        endDate: "2025-06-30",
      },
      undefined,
      undefined,
      ctx,
    );
    expect(captured).toHaveLength(1);
    expect(captured[0].filters).toEqual({
      includeDomains: ["example.com"],
      excludeDomains: ["spam.com"],
      startDate: "2025-01-01",
      endDate: "2025-06-30",
    });
  });

  it("passes undefined filters when no filter params are provided", async () => {
    const { provider, captured } = makeCapturingProvider();
    const tool = createWebSearchTool(() => [provider]);
    const ctx = makeCtx();
    await tool.execute(
      "call-f5",
      { query: "test" },
      undefined,
      undefined,
      ctx,
    );
    expect(captured).toHaveLength(1);
    expect(captured[0].filters).toBeUndefined();
  });
});

describe("web_search compact output", () => {
  const sampleResults: SearchResult[] = [
    {
      title: "TypeScript",
      url: "https://typescriptlang.org",
      snippet: "A typed superset of JavaScript",
    },
    {
      title: "MDN Web Docs",
      url: "https://developer.mozilla.org",
      snippet: "Web technology reference",
    },
  ];

  it("returns compact single-line format when compact=true", async () => {
    const tool = createWebSearchTool(() => [makeProvider("stub", sampleResults)]);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-c1",
      { query: "test", compact: true },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toBe(
      "1. TypeScript -- https://typescriptlang.org\n2. MDN Web Docs -- https://developer.mozilla.org",
    );
  });

  it("returns full format when compact is not set", async () => {
    const tool = createWebSearchTool(() => [makeProvider("stub", sampleResults)]);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-c2",
      { query: "test" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("[TypeScript]");
    expect(text).toContain("A typed superset of JavaScript");
  });

  it("returns full format when compact=false", async () => {
    const tool = createWebSearchTool(() => [makeProvider("stub", sampleResults)]);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-c3",
      { query: "test", compact: false },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("[TypeScript]");
    expect(text).toContain("A typed superset of JavaScript");
  });

  it("returns 'No results found.' in compact mode with empty results", async () => {
    const tool = createWebSearchTool(() => [makeProvider("stub", [])]);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-c4",
      { query: "test", compact: true },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toBe("No results found.");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tools/web-search.test.ts`
Expected: FAIL — `WebSearchParams` does not include `includeDomains`, `excludeDomains`, `startDate`, `endDate`, or `compact`; the test params will be stripped or cause type errors

- [ ] **Step 3: Update `WebSearchParams`, add compact formatter, and wire filters through in `web_search`**

Replace the contents of `src/tools/web-search.ts`:

```ts
import { Type } from "typebox";
import type { Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { SearchFilters, SearchProvider, SearchResult } from "../providers/types.ts";
import { AggregateProviderError } from "../utils/errors.ts";

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
  includeDomains: Type.Optional(
    Type.Array(Type.String(), {
      description: "Only return results from these domains",
    }),
  ),
  excludeDomains: Type.Optional(
    Type.Array(Type.String(), {
      description: "Exclude results from these domains",
    }),
  ),
  startDate: Type.Optional(
    Type.String({
      description: "Only return results published after this date (ISO 8601, e.g. 2025-01-01)",
    }),
  ),
  endDate: Type.Optional(
    Type.String({
      description: "Only return results published before this date (ISO 8601, e.g. 2025-12-31)",
    }),
  ),
  compact: Type.Optional(
    Type.Boolean({
      description: "When true, return results in compact single-line format (title -- URL, no snippets)",
    }),
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

function formatResultsCompact(results: SearchResult[]): string {
  if (results.length === 0) return "No results found.";
  return results
    .map((r, i) => `${i + 1}. ${r.title} -- ${r.url}`)
    .join("\n");
}

function buildFilters(params: {
  includeDomains?: string[];
  excludeDomains?: string[];
  startDate?: string;
  endDate?: string;
}): SearchFilters | undefined {
  const hasAny =
    params.includeDomains?.length ||
    params.excludeDomains?.length ||
    params.startDate ||
    params.endDate;

  if (!hasAny) return undefined;

  return {
    includeDomains: params.includeDomains,
    excludeDomains: params.excludeDomains,
    startDate: params.startDate,
    endDate: params.endDate,
  };
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
      const filters = buildFilters(params);
      const errors: Array<{ provider: string; error: string }> = [];

      for (const provider of candidates) {
        try {
          const results = await provider.search(
            params.query,
            maxResults,
            signal ?? undefined,
            filters,
          );
          const text = params.compact
            ? formatResultsCompact(results)
            : formatResults(results);
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/tools/web-search.test.ts`
Expected: All tests PASS (existing tests, new filter tests, and new compact tests)

- [ ] **Step 5: Commit**

```bash
git add src/tools/web-search.ts tests/tools/web-search.test.ts
git commit -m "feat: add filter params and compact output format to web_search tool"
```

---

### Task 9: Full regression test

**Files:** None (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: All tests PASS across all test files

- [ ] **Step 2: Run type checking**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Verify all providers implement the updated interface**

Manually verify each provider file accepts the `filters?: SearchFilters` parameter:

| Provider   | File                          | Status                                        |
| ---------- | ----------------------------- | --------------------------------------------- |
| Brave      | `src/providers/brave.ts`      | Maps `site:` + `freshness`                    |
| Exa        | `src/providers/exa.ts`        | Maps native API fields                        |
| Tavily     | `src/providers/tavily.ts`     | Maps `include_domains` / `exclude_domains`    |
| Serper     | `src/providers/serper.ts`     | Maps `site:` + `tbs`                          |
| DuckDuckGo | `src/providers/duckduckgo.ts` | Maps `site:` + `-t` timelimit                 |
| Jina       | `src/providers/jina.ts`       | Accepts and ignores (`_filters`)              |
| Perplexity | `src/providers/perplexity.ts` | Accepts and ignores (`_filters`)              |
| Firecrawl  | `src/providers/firecrawl.ts`  | Accepts and ignores (`_filters`)              |

- [ ] **Step 4: Verify `codeSearch` on ExaProvider is unchanged**

Confirm `ExaProvider.codeSearch()` does NOT have a `filters` parameter — only `search()` was updated.

- [ ] **Step 5: Final commit if any cleanup was needed**

```bash
git add -A
git commit -m "chore: phase 2 cleanup and regression verification"
```
