# Phase 5: Batch Providers (Linkup, You.com, fastCRW, Sofya)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 4 tier 2 paid search providers: Linkup, You.com, fastCRW, and Sofya.

**Prerequisites:**

- Phases 1-4 complete (credential caching, marginalia, langsearch, brave-llm all merged)
- `src/providers/parsers.ts` exists with parsers from Phases 2-4
- `src/providers/all.ts` already includes marginalia, langsearch, brave-llm
- All tests pass: `pnpm vitest run`, `pnpm run lint`, `pnpm run typecheck`

**Verification after each task:**

```bash
pnpm vitest run tests/providers/linkup.test.ts    # (or respective test)
pnpm vitest run                                    # full suite
pnpm run lint
pnpm run typecheck
```

---

## Task 1: Linkup Provider

### Steps

- [ ] **1.1 Add parser to `src/providers/parsers.ts`**

Append the `parseLinkupResults` function:

```typescript
export function parseLinkupResults(data: unknown): SearchResult[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const rawResults = (d.searchResults ?? d.results ?? d.data) as unknown[];
  if (!Array.isArray(rawResults)) return [];
  return rawResults.map((r: unknown) => {
    const item = r as Record<string, unknown>;
    return {
      title: (item.title as string) || "",
      url: (item.url as string) || "",
      snippet: (
        (item.content as string) ||
        (item.snippet as string) ||
        ""
      ).slice(0, 500),
    };
  });
}
```

- [ ] **1.2 Write test file `tests/providers/linkup.test.ts`** (TDD: write tests first)

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { providerMeta } from "../../src/providers/linkup.ts";
import { parseLinkupResults } from "../../src/providers/parsers.ts";
import { stubFetch } from "../helpers.ts";

const makeProvider = (
  key = "test-key",
  providerConfig?: Record<string, unknown>,
) => providerMeta.create(key, providerConfig as any).search!;

describe("LinkupProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct metadata", () => {
    expect(providerMeta.name).toBe("linkup");
    expect(providerMeta.tier).toBe(2);
    expect(providerMeta.monthlyQuota).toBeNull();
    expect(providerMeta.requiresKey).toBe(true);
  });

  it("has correct name and label", () => {
    const provider = makeProvider();
    expect(provider.name).toBe("linkup");
    expect(provider.label).toBe("Linkup");
  });

  it("returns normalized search results", async () => {
    fetchStub.addResponse("api.linkup.so", {
      body: {
        searchResults: [
          {
            title: "Linkup Result",
            url: "https://example.com",
            content: "A linkup snippet",
          },
          {
            title: "Second",
            url: "https://second.com",
            content: "Another result",
          },
        ],
      },
    });

    const results = await makeProvider().search("test query", 10);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "Linkup Result",
      url: "https://example.com",
      snippet: "A linkup snippet",
    });
  });

  it("sends Bearer token and POST body", async () => {
    fetchStub.addResponse("api.linkup.so", { body: { searchResults: [] } });

    await makeProvider("my-linkup-key").search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers.Authorization).toBe("Bearer my-linkup-key");
    expect(fetchCall[1].method).toBe("POST");
    const body = JSON.parse(fetchCall[1].body);
    expect(body.query).toBe("test");
    expect(body.outputType).toBe("searchResults");
    expect(body.depth).toBe("standard");
  });

  it("respects depth config option", async () => {
    fetchStub.addResponse("api.linkup.so", { body: { searchResults: [] } });

    await makeProvider("key", { enabled: true, depth: "deep" }).search(
      "test",
      5,
    );

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.depth).toBe("deep");
  });

  it("throws on non-2xx response", async () => {
    fetchStub.addResponse("api.linkup.so", {
      status: 401,
      body: "Unauthorized",
    });
    await expect(makeProvider().search("test", 5)).rejects.toThrow("Linkup");
  });

  it("handles fallback response shapes (results array)", async () => {
    fetchStub.addResponse("api.linkup.so", {
      body: {
        results: [
          { title: "Fallback", url: "https://fb.com", content: "fb snippet" },
        ],
      },
    });

    const results = await makeProvider().search("test", 5);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Fallback");
  });
});

describe("parseLinkupResults", () => {
  it("returns empty array for null/undefined input", () => {
    expect(parseLinkupResults(null)).toEqual([]);
    expect(parseLinkupResults(undefined)).toEqual([]);
  });

  it("returns empty array when no results array found", () => {
    expect(parseLinkupResults({ foo: "bar" })).toEqual([]);
  });

  it("truncates snippets to 500 characters", () => {
    const longContent = "x".repeat(600);
    const results = parseLinkupResults({
      searchResults: [
        { title: "T", url: "https://u.com", content: longContent },
      ],
    });
    expect(results[0].snippet).toHaveLength(500);
  });

  it("prefers content over snippet field", () => {
    const results = parseLinkupResults({
      searchResults: [
        {
          title: "T",
          url: "https://u.com",
          content: "from content",
          snippet: "from snippet",
        },
      ],
    });
    expect(results[0].snippet).toBe("from content");
  });
});
```

- [ ] **1.3 Create provider file `src/providers/linkup.ts`**

```typescript
import { createHttpSearchProvider } from "./http-adapter.ts";
import { parseLinkupResults } from "./parsers.ts";
import type { ProviderMeta } from "./types.ts";

export const providerMeta: ProviderMeta = {
  name: "linkup",
  tier: 2,
  monthlyQuota: null,
  requiresKey: true,
  create: (key, providerConfig) => ({
    search: createHttpSearchProvider(key!, {
      name: "linkup",
      label: "Linkup",
      endpoint: "https://api.linkup.so/v1/search",
      method: "POST",
      authPrefix: "Bearer ",
      buildBody: (query) => ({
        query,
        outputType: "searchResults",
        depth: (providerConfig as any)?.depth ?? "standard",
      }),
      extractResults: parseLinkupResults,
    }),
  }),
};
```

- [ ] **1.4 Add `depth` config option to `src/config.ts`**

Add to `ProviderConfigEntry`:

```typescript
depth?: "standard" | "deep";
```

- [ ] **1.5 Register in `src/providers/all.ts`**

Add import and array entry:

```typescript
import { providerMeta as linkup } from "./linkup.ts";
```

Add `linkup` to the `allProviders` array in alphabetical position.

- [ ] **1.6 Verify and commit**

```bash
pnpm vitest run tests/providers/linkup.test.ts
pnpm vitest run
pnpm run lint
pnpm run typecheck
git add -A && git commit -m "feat(providers): add Linkup search provider"
```

---

## Task 2: You.com Provider

### Steps

- [ ] **2.1 Add parser to `src/providers/parsers.ts`**

Append the `parseYouComResults` function:

```typescript
export function parseYouComResults(data: unknown): SearchResult[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const rawHits = (d.hits ?? d.results) as unknown[];
  if (!Array.isArray(rawHits)) return [];
  return rawHits.map((r: unknown) => {
    const item = r as Record<string, unknown>;
    const snippets = Array.isArray(item.snippets)
      ? (item.snippets as string[]).join(" ")
      : "";
    return {
      title: (item.title as string) || "",
      url: (item.url as string) || "",
      snippet: ((item.description as string) || snippets || "").slice(0, 500),
    };
  });
}
```

- [ ] **2.2 Write test file `tests/providers/youcom.test.ts`** (TDD: write tests first)

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { providerMeta } from "../../src/providers/youcom.ts";
import { parseYouComResults } from "../../src/providers/parsers.ts";
import { stubFetch } from "../helpers.ts";

const makeProvider = (key = "test-key") => providerMeta.create(key).search!;

describe("YouComProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct metadata", () => {
    expect(providerMeta.name).toBe("youcom");
    expect(providerMeta.tier).toBe(2);
    expect(providerMeta.monthlyQuota).toBeNull();
    expect(providerMeta.requiresKey).toBe(true);
  });

  it("has correct name and label", () => {
    const provider = makeProvider();
    expect(provider.name).toBe("youcom");
    expect(provider.label).toBe("You.com");
  });

  it("returns normalized search results", async () => {
    fetchStub.addResponse("api.you.com", {
      body: {
        hits: [
          {
            title: "You Result",
            url: "https://example.com",
            description: "A you.com snippet",
            snippets: [],
          },
          {
            title: "Second",
            url: "https://second.com",
            description: "",
            snippets: ["snip1", "snip2"],
          },
        ],
      },
    });

    const results = await makeProvider().search("test query", 10);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "You Result",
      url: "https://example.com",
      snippet: "A you.com snippet",
    });
    expect(results[1].snippet).toBe("snip1 snip2");
  });

  it("sends X-API-Key header via GET with query params", async () => {
    fetchStub.addResponse("api.you.com", { body: { hits: [] } });

    await makeProvider("my-you-key").search("hello world", 8);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const url = fetchCall[0] as string;
    expect(url).toContain("api.you.com/v1/search");
    expect(url).toContain("query=hello+world");
    expect(url).toContain("num_web_results=8");
    expect(fetchCall[1].headers["X-API-Key"]).toBe("my-you-key");
  });

  it("caps num_web_results at 100", async () => {
    fetchStub.addResponse("api.you.com", { body: { hits: [] } });

    await makeProvider().search("test", 200);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const url = fetchCall[0] as string;
    expect(url).toContain("num_web_results=100");
  });

  it("throws on non-2xx response", async () => {
    fetchStub.addResponse("api.you.com", { status: 403, body: "Forbidden" });
    await expect(makeProvider().search("test", 5)).rejects.toThrow("You.com");
  });
});

describe("parseYouComResults", () => {
  it("returns empty array for null/undefined input", () => {
    expect(parseYouComResults(null)).toEqual([]);
    expect(parseYouComResults(undefined)).toEqual([]);
  });

  it("returns empty array when no hits array found", () => {
    expect(parseYouComResults({ foo: "bar" })).toEqual([]);
  });

  it("joins snippets array when description is empty", () => {
    const results = parseYouComResults({
      hits: [
        {
          title: "T",
          url: "https://u.com",
          description: "",
          snippets: ["a", "b", "c"],
        },
      ],
    });
    expect(results[0].snippet).toBe("a b c");
  });

  it("prefers description over snippets", () => {
    const results = parseYouComResults({
      hits: [
        {
          title: "T",
          url: "https://u.com",
          description: "desc",
          snippets: ["snip"],
        },
      ],
    });
    expect(results[0].snippet).toBe("desc");
  });

  it("truncates snippets to 500 characters", () => {
    const longDesc = "y".repeat(600);
    const results = parseYouComResults({
      hits: [{ title: "T", url: "https://u.com", description: longDesc }],
    });
    expect(results[0].snippet).toHaveLength(500);
  });
});
```

- [ ] **2.3 Create provider file `src/providers/youcom.ts`**

```typescript
import { createHttpSearchProvider } from "./http-adapter.ts";
import { parseYouComResults } from "./parsers.ts";
import type { ProviderMeta } from "./types.ts";

export const providerMeta: ProviderMeta = {
  name: "youcom",
  tier: 2,
  monthlyQuota: null,
  requiresKey: true,
  create: (key) => ({
    search: createHttpSearchProvider(key!, {
      name: "youcom",
      label: "You.com",
      endpoint: (query, maxResults) => {
        const params = new URLSearchParams({
          query,
          num_web_results: String(Math.min(maxResults, 100)),
        });
        return `https://api.you.com/v1/search?${params}`;
      },
      method: "GET",
      buildHeaders: (apiKey) => ({ "X-API-Key": apiKey }),
      extractResults: parseYouComResults,
    }),
  }),
};
```

- [ ] **2.4 Register in `src/providers/all.ts`**

Add import and array entry:

```typescript
import { providerMeta as youcom } from "./youcom.ts";
```

Add `youcom` to the `allProviders` array in alphabetical position.

- [ ] **2.5 Verify and commit**

```bash
pnpm vitest run tests/providers/youcom.test.ts
pnpm vitest run
pnpm run lint
pnpm run typecheck
git add -A && git commit -m "feat(providers): add You.com search provider"
```

---

## Task 3: fastCRW Provider

### Steps

- [ ] **3.1 Add parser to `src/providers/parsers.ts`**

Append the `parseFastcrwResults` function:

```typescript
export function parseFastcrwResults(data: unknown): SearchResult[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const rawData = d.data as unknown[];
  if (!Array.isArray(rawData)) return [];
  return rawData.map((r: unknown) => {
    const item = r as Record<string, unknown>;
    return {
      title: (item.title as string) || "",
      url: (item.url as string) || "",
      snippet: (
        (item.description as string) ||
        (item.snippet as string) ||
        ""
      ).slice(0, 500),
    };
  });
}
```

- [ ] **3.2 Write test file `tests/providers/fastcrw.test.ts`** (TDD: write tests first)

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { providerMeta } from "../../src/providers/fastcrw.ts";
import { parseFastcrwResults } from "../../src/providers/parsers.ts";
import { stubFetch } from "../helpers.ts";

const makeProvider = (
  key = "test-key",
  providerConfig?: Record<string, unknown>,
) => providerMeta.create(key, providerConfig as any).search!;

describe("FastcrwProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct metadata", () => {
    expect(providerMeta.name).toBe("fastcrw");
    expect(providerMeta.tier).toBe(2);
    expect(providerMeta.monthlyQuota).toBe(500);
    expect(providerMeta.requiresKey).toBe(true);
  });

  it("has correct name and label", () => {
    const provider = makeProvider();
    expect(provider.name).toBe("fastcrw");
    expect(provider.label).toBe("fastCRW");
  });

  it("returns normalized search results", async () => {
    fetchStub.addResponse("api.fastcrw.com", {
      body: {
        success: true,
        data: [
          {
            title: "Fast Result",
            url: "https://example.com",
            description: "A fast snippet",
          },
          {
            title: "Second",
            url: "https://second.com",
            description: "Another",
          },
        ],
      },
    });

    const results = await makeProvider().search("test query", 10);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "Fast Result",
      url: "https://example.com",
      snippet: "A fast snippet",
    });
  });

  it("sends Bearer token and POST body with limit", async () => {
    fetchStub.addResponse("api.fastcrw.com", {
      body: { success: true, data: [] },
    });

    await makeProvider("my-fastcrw-key").search("test", 15);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[0]).toContain("api.fastcrw.com/v1/search");
    expect(fetchCall[1].headers.Authorization).toBe("Bearer my-fastcrw-key");
    expect(fetchCall[1].method).toBe("POST");
    const body = JSON.parse(fetchCall[1].body);
    expect(body.query).toBe("test");
    expect(body.limit).toBe(15);
  });

  it("caps limit at 20", async () => {
    fetchStub.addResponse("api.fastcrw.com", {
      body: { success: true, data: [] },
    });

    await makeProvider().search("test", 50);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.limit).toBe(20);
  });

  it("respects baseUrl config option", async () => {
    fetchStub.addResponse("custom.host.com", {
      body: { success: true, data: [] },
    });

    await makeProvider("key", {
      enabled: true,
      baseUrl: "https://custom.host.com",
    }).search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[0]).toContain("custom.host.com/v1/search");
  });

  it("throws on non-2xx response", async () => {
    fetchStub.addResponse("api.fastcrw.com", {
      status: 500,
      body: "Server Error",
    });
    await expect(makeProvider().search("test", 5)).rejects.toThrow("fastCRW");
  });
});

describe("parseFastcrwResults", () => {
  it("returns empty array for null/undefined input", () => {
    expect(parseFastcrwResults(null)).toEqual([]);
    expect(parseFastcrwResults(undefined)).toEqual([]);
  });

  it("returns empty array when data is not an array", () => {
    expect(parseFastcrwResults({ data: "not-array" })).toEqual([]);
    expect(parseFastcrwResults({ success: true })).toEqual([]);
  });

  it("truncates snippets to 500 characters", () => {
    const longDesc = "z".repeat(600);
    const results = parseFastcrwResults({
      data: [{ title: "T", url: "https://u.com", description: longDesc }],
    });
    expect(results[0].snippet).toHaveLength(500);
  });

  it("falls back to snippet field when description is missing", () => {
    const results = parseFastcrwResults({
      data: [{ title: "T", url: "https://u.com", snippet: "from snippet" }],
    });
    expect(results[0].snippet).toBe("from snippet");
  });
});
```

- [ ] **3.3 Create provider file `src/providers/fastcrw.ts`**

```typescript
import { createHttpSearchProvider } from "./http-adapter.ts";
import { parseFastcrwResults } from "./parsers.ts";
import type { ProviderMeta } from "./types.ts";

export const providerMeta: ProviderMeta = {
  name: "fastcrw",
  tier: 2,
  monthlyQuota: 500,
  requiresKey: true,
  create: (key, providerConfig) => ({
    search: createHttpSearchProvider(key!, {
      name: "fastcrw",
      label: "fastCRW",
      endpoint: `${(providerConfig as any)?.baseUrl ?? "https://api.fastcrw.com"}/v1/search`,
      method: "POST",
      authPrefix: "Bearer ",
      buildBody: (query, maxResults) => ({
        query,
        limit: Math.min(maxResults, 20),
      }),
      extractResults: parseFastcrwResults,
    }),
  }),
};
```

- [ ] **3.4 Add `baseUrl` config option to `src/config.ts`**

Add to `ProviderConfigEntry` (if not already present from earlier phases):

```typescript
baseUrl?: string;
```

- [ ] **3.5 Register in `src/providers/all.ts`**

Add import and array entry:

```typescript
import { providerMeta as fastcrw } from "./fastcrw.ts";
```

Add `fastcrw` to the `allProviders` array in alphabetical position.

- [ ] **3.6 Verify and commit**

```bash
pnpm vitest run tests/providers/fastcrw.test.ts
pnpm vitest run
pnpm run lint
pnpm run typecheck
git add -A && git commit -m "feat(providers): add fastCRW search provider"
```

---

## Task 4: Sofya Provider (Search + Fetch)

### Steps

- [ ] **4.1 Add parser to `src/providers/parsers.ts`**

Append the `parseSofyaResults` function:

```typescript
export function parseSofyaResults(data: unknown): SearchResult[] {
  if (!data || typeof data !== "object") return [];
  const d = data as { results?: unknown[] };
  const results = Array.isArray(d.results) ? d.results : [];
  return results.map((r: unknown) => {
    const item = r as Record<string, unknown>;
    const content =
      (item.content as string) || (item.description as string) || "";
    return {
      title: (item.title as string) || "",
      url: (item.url as string) || "",
      snippet: ((item.description as string) || content).slice(0, 500),
    };
  });
}
```

- [ ] **4.2 Add config options to `src/config.ts`**

Add to `ProviderConfigEntry`:

```typescript
searchDepth?: "snippets" | "basic";
topic?: "general" | "news";
```

- [ ] **4.3 Write test file `tests/providers/sofya.test.ts`** (TDD: write tests first)

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { providerMeta } from "../../src/providers/sofya.ts";
import { parseSofyaResults } from "../../src/providers/parsers.ts";
import { stubFetch } from "../helpers.ts";

const makeProvider = (
  key = "test-key",
  providerConfig?: Record<string, unknown>,
) => {
  const created = providerMeta.create(key, providerConfig as any);
  return { search: created.search!, fetch: created.fetch! };
};

describe("SofyaProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct metadata", () => {
    expect(providerMeta.name).toBe("sofya");
    expect(providerMeta.tier).toBe(2);
    expect(providerMeta.monthlyQuota).toBeNull();
    expect(providerMeta.requiresKey).toBe(true);
  });

  it("creates both search and fetch providers", () => {
    const created = providerMeta.create("key");
    expect(created.search).toBeDefined();
    expect(created.fetch).toBeDefined();
  });

  it("has correct name", () => {
    const { search, fetch } = makeProvider();
    expect(search.name).toBe("sofya");
    expect(fetch.name).toBe("sofya");
  });

  describe("search", () => {
    it("returns normalized search results", async () => {
      fetchStub.addResponse("sofya.co/v1/search", {
        body: {
          results: [
            {
              title: "Sofya Result",
              url: "https://example.com",
              content: "content text",
              description: "A sofya snippet",
            },
            {
              title: "Second",
              url: "https://second.com",
              content: "more content",
              description: "",
            },
          ],
        },
      });

      const { search } = makeProvider();
      const results = await search.search("test query", 10);
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        title: "Sofya Result",
        url: "https://example.com",
        snippet: "A sofya snippet",
      });
    });

    it("sends Bearer token and correct POST body", async () => {
      fetchStub.addResponse("sofya.co/v1/search", { body: { results: [] } });

      const { search } = makeProvider("my-sofya-key");
      await search.search("test", 10);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      expect(fetchCall[0]).toBe("https://sofya.co/v1/search");
      expect(fetchCall[1].headers.Authorization).toBe("Bearer my-sofya-key");
      expect(fetchCall[1].method).toBe("POST");
      const body = JSON.parse(fetchCall[1].body);
      expect(body.query).toBe("test");
      expect(body.search_depth).toBe("basic");
      expect(body.max_results).toBe(10);
      expect(body.include_answer).toBe(false);
      expect(body.topic).toBe("general");
    });

    it("caps max_results at 20", async () => {
      fetchStub.addResponse("sofya.co/v1/search", { body: { results: [] } });

      const { search } = makeProvider();
      await search.search("test", 50);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.max_results).toBe(20);
    });

    it("respects searchDepth and topic config options", async () => {
      fetchStub.addResponse("sofya.co/v1/search", { body: { results: [] } });

      const { search } = makeProvider("key", {
        enabled: true,
        searchDepth: "snippets",
        topic: "news",
      });
      await search.search("test", 5);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.search_depth).toBe("snippets");
      expect(body.topic).toBe("news");
    });

    it("throws on non-2xx response", async () => {
      fetchStub.addResponse("sofya.co/v1/search", {
        status: 401,
        body: "Unauthorized",
      });
      const { search } = makeProvider();
      await expect(search.search("test", 5)).rejects.toThrow("Sofya API error");
    });
  });

  describe("fetch", () => {
    it("returns extracted content", async () => {
      fetchStub.addResponse("sofya.co/v1/fetch", {
        body: {
          results: [{ content: "Extracted page content", title: "Page Title" }],
        },
      });

      const { fetch: fetchProvider } = makeProvider();
      const result = await fetchProvider.fetch("https://example.com/page");
      expect(result.text).toBe("Extracted page content");
      expect(result.title).toBe("Page Title");
    });

    it("sends correct POST body for fetch", async () => {
      fetchStub.addResponse("sofya.co/v1/fetch", { body: { results: [] } });

      const { fetch: fetchProvider } = makeProvider("my-key");
      await fetchProvider.fetch("https://example.com/page");

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      expect(fetchCall[0]).toBe("https://sofya.co/v1/fetch");
      expect(fetchCall[1].headers.Authorization).toBe("Bearer my-key");
      const body = JSON.parse(fetchCall[1].body);
      expect(body.urls).toEqual(["https://example.com/page"]);
      expect(body.include_raw_html).toBe(false);
    });

    it("returns empty text when no results", async () => {
      fetchStub.addResponse("sofya.co/v1/fetch", { body: { results: [] } });

      const { fetch: fetchProvider } = makeProvider();
      const result = await fetchProvider.fetch("https://example.com");
      expect(result.text).toBe("");
      expect(result.title).toBeUndefined();
    });

    it("throws on non-2xx response", async () => {
      fetchStub.addResponse("sofya.co/v1/fetch", {
        status: 500,
        body: "Error",
      });
      const { fetch: fetchProvider } = makeProvider();
      await expect(fetchProvider.fetch("https://example.com")).rejects.toThrow(
        "Sofya fetch error",
      );
    });
  });
});

describe("parseSofyaResults", () => {
  it("returns empty array for null/undefined input", () => {
    expect(parseSofyaResults(null)).toEqual([]);
    expect(parseSofyaResults(undefined)).toEqual([]);
  });

  it("returns empty array when results is not an array", () => {
    expect(parseSofyaResults({ results: "not-array" })).toEqual([]);
    expect(parseSofyaResults({})).toEqual([]);
  });

  it("prefers description over content for snippet", () => {
    const results = parseSofyaResults({
      results: [
        {
          title: "T",
          url: "https://u.com",
          description: "desc text",
          content: "content text",
        },
      ],
    });
    expect(results[0].snippet).toBe("desc text");
  });

  it("falls back to content when description is empty", () => {
    const results = parseSofyaResults({
      results: [
        {
          title: "T",
          url: "https://u.com",
          description: "",
          content: "content text",
        },
      ],
    });
    expect(results[0].snippet).toBe("content text");
  });

  it("truncates snippets to 500 characters", () => {
    const longContent = "s".repeat(600);
    const results = parseSofyaResults({
      results: [{ title: "T", url: "https://u.com", content: longContent }],
    });
    expect(results[0].snippet).toHaveLength(500);
  });
});
```

- [ ] **4.4 Create provider file `src/providers/sofya.ts`**

```typescript
import { parseSofyaResults } from "./parsers.ts";
import type {
  FetchProvider,
  FetchResult,
  ProviderMeta,
  SearchFilters,
  SearchProvider,
  SearchResult,
} from "./types.ts";

const SOFYA_BASE = "https://sofya.co";

class SofyaProvider implements SearchProvider, FetchProvider {
  readonly name = "sofya";
  readonly label = "Sofya";
  private readonly apiKey: string;
  private readonly searchDepth: string;
  private readonly topic: string;

  constructor(apiKey: string, searchDepth?: string, topic?: string) {
    this.apiKey = apiKey;
    this.searchDepth = searchDepth ?? "basic";
    this.topic = topic ?? "general";
  }

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
    _filters?: SearchFilters,
  ): Promise<SearchResult[]> {
    const response = await fetch(`${SOFYA_BASE}/v1/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        query,
        search_depth: this.searchDepth,
        max_results: Math.min(maxResults, 20),
        include_answer: false,
        topic: this.topic,
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(
        `Sofya API error: ${response.status} ${response.statusText}`,
      );
    }

    const data: unknown = await response.json();
    return parseSofyaResults(data).slice(0, maxResults);
  }

  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult> {
    const response = await fetch(`${SOFYA_BASE}/v1/fetch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ urls: [url], include_raw_html: false }),
      signal,
    });

    if (!response.ok) {
      throw new Error(
        `Sofya fetch error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      results?: Array<{ content?: string; title?: string }>;
    };
    const first = data.results?.[0];
    return { text: first?.content ?? "", title: first?.title };
  }
}

export const providerMeta: ProviderMeta = {
  name: "sofya",
  tier: 2,
  monthlyQuota: null,
  requiresKey: true,
  create: (key, providerConfig) => {
    const cfg = providerConfig as any;
    const p = new SofyaProvider(key!, cfg?.searchDepth, cfg?.topic);
    return { search: p, fetch: p };
  },
};
```

- [ ] **4.5 Register in `src/providers/all.ts`**

Add import and array entry:

```typescript
import { providerMeta as sofya } from "./sofya.ts";
```

Add `sofya` to the `allProviders` array in alphabetical position.

- [ ] **4.6 Verify and commit**

```bash
pnpm vitest run tests/providers/sofya.test.ts
pnpm vitest run
pnpm run lint
pnpm run typecheck
git add -A && git commit -m "feat(providers): add Sofya search+fetch provider"
```

---

## Final Verification

After all 4 tasks are complete:

```bash
pnpm vitest run
pnpm run lint
pnpm run typecheck
```

**Expected state of `src/providers/all.ts`** after this phase — 4 new entries added (21 total):

- brave, braveLlm, context7, duckduckgo, exa, exaMcp, **fastcrw**, firecrawl, jina, langsearch, **linkup**, marginalia, openaiNative, parallel, perplexity, searxng, serper, **sofya**, tavily, websearchapi, **youcom**

**Expected additions to `src/providers/parsers.ts`:**

- `parseLinkupResults`
- `parseYouComResults`
- `parseFastcrwResults`
- `parseSofyaResults`

**Expected additions to `src/config.ts` `ProviderConfigEntry`:**

- `depth?: "standard" | "deep"`
- `baseUrl?: string`
- `searchDepth?: "snippets" | "basic"`
- `topic?: "general" | "news"`

**New files created (8):**

- `src/providers/linkup.ts`
- `src/providers/youcom.ts`
- `src/providers/fastcrw.ts`
- `src/providers/sofya.ts`
- `tests/providers/linkup.test.ts`
- `tests/providers/youcom.test.ts`
- `tests/providers/fastcrw.test.ts`
- `tests/providers/sofya.test.ts`
