# Phase 6: Keyed Search Providers

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add all remaining search providers: Jina, Brave, Serper, Tavily, Exa, Perplexity, Firecrawl. Each follows the same pattern: implement `SearchProvider`, test with stubbed fetch, register in index.ts.

**Spec:** `docs/superpowers/specs/2026-06-27-pi-tools-design.md`

**Depends on:** Phase 1 (types), Phase 5 (registry)

**Produces:** `src/providers/{jina,brave,serper,tavily,exa,perplexity,firecrawl}.ts`, updated `src/index.ts`

---

## Task 6.1: Jina Search Provider

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

## Task 6.2: Brave Search Provider

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

## Task 6.3: Serper Provider

**Files:**
- Create: `src/providers/serper.ts`
- Test: `tests/providers/serper.test.ts`

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

## Task 6.4: Tavily Provider

**Files:**
- Create: `src/providers/tavily.ts`
- Test: `tests/providers/tavily.test.ts`

- [ ] **Step 1: Write failing test**

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

- [ ] **Step 2: Implement Tavily provider**

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

- [ ] **Step 3: Run tests and commit**

Run: `pnpm test -- tests/providers/tavily.test.ts`
Expected: PASS.

```bash
git add src/providers/tavily.ts tests/providers/tavily.test.ts
git commit -m "feat: add Tavily search and extract provider"
```

## Task 6.5: Exa Provider

**Files:**
- Create: `src/providers/exa.ts`
- Test: `tests/providers/exa.test.ts`

- [ ] **Step 1: Write failing test**

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

- [ ] **Step 2: Implement Exa provider**

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

- [ ] **Step 3: Run tests and commit**

Run: `pnpm test -- tests/providers/exa.test.ts`
Expected: PASS.

```bash
git add src/providers/exa.ts tests/providers/exa.test.ts
git commit -m "feat: add Exa search, code search, and contents provider"
```

## Task 6.6: Perplexity Provider

**Files:**
- Create: `src/providers/perplexity.ts`
- Test: `tests/providers/perplexity.test.ts`

- [ ] **Step 1: Write failing test**

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

- [ ] **Step 2: Implement Perplexity provider**

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

- [ ] **Step 3: Run tests and commit**

Run: `pnpm test -- tests/providers/perplexity.test.ts`
Expected: PASS.

```bash
git add src/providers/perplexity.ts tests/providers/perplexity.test.ts
git commit -m "feat: add Perplexity Sonar search provider"
```

## Task 6.7: Firecrawl Provider

**Files:**
- Create: `src/providers/firecrawl.ts`
- Test: `tests/providers/firecrawl.test.ts`

- [ ] **Step 1: Write failing test**

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

- [ ] **Step 2: Implement Firecrawl provider**

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

- [ ] **Step 3: Run tests and commit**

Run: `pnpm test -- tests/providers/firecrawl.test.ts`
Expected: PASS.

```bash
git add src/providers/firecrawl.ts tests/providers/firecrawl.test.ts
git commit -m "feat: add Firecrawl search and scrape provider"
```

## Task 6.8: Register All Providers in Extension Entry Point

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

## Phase 6 Checkpoint

All 8 search providers are implemented and registered. The extension auto-rotates across configured providers based on available quota and tier priority.
