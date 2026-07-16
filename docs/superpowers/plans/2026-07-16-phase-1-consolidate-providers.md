# Phase 1: Consolidate Shallow HTTP Search Providers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 9 shallow HTTP search provider files with a single data-driven `src/providers/http-providers.ts` that exports an array of `ProviderMeta` definitions, deleting 9 files and consolidating 9 test files.

**Architecture:** All 9 providers already delegate to `createHttpSearchProvider` from `http-adapter.ts`. Each file is pure configuration — no unique logic beyond brave's `buildFreshness` helper. The consolidation moves all 9 definitions into one array, updates `all.ts` to spread that array, and merges tests into one file.

**Tech Stack:** TypeScript (ES2022, Node16 modules), Vitest, native `fetch`

**Spec:** `docs/superpowers/specs/2026-07-16-architecture-deepening-design.md` (Phase 1)

---

### Task 1: Create http-providers.ts with all 9 provider definitions

**Files:**
- Create: `src/providers/http-providers.ts`

- [ ] **Step 1: Create the consolidated provider definitions file**

```typescript
// src/providers/http-providers.ts
import { createHttpSearchProvider } from "./http-adapter.ts";
import { applyDomainFilters } from "../utils/filters.ts";
import {
  parseBraveLlmResults,
  parseBraveResults,
  parseFastcrwResults,
  parseLangSearchResults,
  parseLinkupResults,
  parseMarginaliaResults,
  parsePerplexityResults,
  parseWebSearchApiResults,
  parseYouComResults,
} from "./parsers.ts";
import type { ProviderMeta, SearchFilters } from "./types.ts";

function buildFreshness(filters?: SearchFilters): string | null {
  if (!filters) return null;
  if (!filters.startDate && !filters.endDate) return null;
  return `${filters.startDate ?? ""}to${filters.endDate ?? ""}`;
}

export const httpProviders: ProviderMeta[] = [
  // ── Brave Search ──────────────────────────────────────────────────────
  {
    name: "brave",
    tier: 1,
    monthlyQuota: 2000,
    requiresKey: true,
    create: (key) => ({
      search: createHttpSearchProvider(key!, {
        name: "brave",
        label: "Brave Search",
        endpoint: (query, maxResults, filters) => {
          const params = new URLSearchParams({
            q: applyDomainFilters(query, filters),
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
        extractResults: parseBraveResults,
      }),
    }),
  },

  // ── Brave LLM Context ────────────────────────────────────────────────
  {
    name: "brave-llm",
    tier: 1,
    monthlyQuota: 2000,
    requiresKey: true,
    create: (key, providerConfig) => ({
      search: createHttpSearchProvider(key!, {
        name: "brave-llm",
        label: "Brave LLM Context",
        endpoint: "https://api.search.brave.com/res/v1/llm/context",
        method: "POST",
        buildHeaders: (apiKey) => ({
          Accept: "application/json",
          "X-Subscription-Token": apiKey,
        }),
        buildBody: (query) => {
          const body: Record<string, unknown> = { q: query };
          if (providerConfig?.tokenBudget !== undefined)
            body.maximum_number_of_tokens = providerConfig.tokenBudget;
          return body;
        },
        extractResults: parseBraveLlmResults,
      }),
    }),
  },

  // ── fastCRW ───────────────────────────────────────────────────────────
  {
    name: "fastcrw",
    tier: 2,
    monthlyQuota: 500,
    requiresKey: true,
    create: (key, providerConfig) => ({
      search: createHttpSearchProvider(key!, {
        name: "fastcrw",
        label: "fastCRW",
        endpoint: `${providerConfig?.baseUrl ?? "https://api.fastcrw.com"}/v1/search`,
        method: "POST",
        authPrefix: "Bearer ",
        buildBody: (query, maxResults) => ({
          query,
          limit: Math.min(maxResults, 20),
        }),
        extractResults: parseFastcrwResults,
      }),
    }),
  },

  // ── LangSearch ────────────────────────────────────────────────────────
  {
    name: "langsearch",
    tier: 2,
    monthlyQuota: null,
    requiresKey: true,
    create: (key) => ({
      search: createHttpSearchProvider(key!, {
        name: "langsearch",
        label: "LangSearch",
        endpoint: "https://api.langsearch.com/v1/web-search",
        method: "POST",
        authPrefix: "Bearer ",
        buildBody: (query, maxResults) => ({
          query,
          max_results: Math.min(maxResults, 20),
        }),
        extractResults: parseLangSearchResults,
      }),
    }),
  },

  // ── Linkup ────────────────────────────────────────────────────────────
  {
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
          depth: providerConfig?.depth ?? "standard",
        }),
        extractResults: parseLinkupResults,
      }),
    }),
  },

  // ── Marginalia ────────────────────────────────────────────────────────
  {
    name: "marginalia",
    tier: 3,
    monthlyQuota: null,
    requiresKey: false,
    create: (key) => ({
      search: createHttpSearchProvider(key ?? "public", {
        name: "marginalia",
        label: "Marginalia Search",
        endpoint: (query, maxResults) => {
          const params = new URLSearchParams({
            query,
            count: String(Math.min(maxResults, 100)),
          });
          return `https://api2.marginalia-search.com/search?${params}`;
        },
        method: "GET",
        buildHeaders: (apiKey) => ({
          Accept: "application/json",
          "API-Key": apiKey,
        }),
        extractResults: parseMarginaliaResults,
      }),
    }),
  },

  // ── Perplexity Sonar ──────────────────────────────────────────────────
  {
    name: "perplexity",
    tier: 2,
    monthlyQuota: null,
    requiresKey: true,
    create: (key, providerConfig) => ({
      search: createHttpSearchProvider(key!, {
        name: "perplexity",
        label: "Perplexity Sonar",
        endpoint: "https://api.perplexity.ai/chat/completions",
        method: "POST",
        authPrefix: "Bearer ",
        buildBody: (query) => ({
          model: providerConfig?.model ?? "sonar",
          messages: [{ role: "user", content: query }],
        }),
        extractResults: parsePerplexityResults,
      }),
    }),
  },

  // ── WebSearchAPI ──────────────────────────────────────────────────────
  {
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
        authPrefix: "Bearer ",
        buildBody: (query, maxResults) => ({ query, maxResults }),
        extractResults: parseWebSearchApiResults,
      }),
    }),
  },

  // ── You.com ───────────────────────────────────────────────────────────
  {
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
  },
];
```

---

### Task 2: Update all.ts to use http-providers.ts

**Files:**
- Modify: `src/providers/all.ts`

- [ ] **Step 2: Replace 9 individual imports with httpProviders spread**

Replace the full contents of `src/providers/all.ts` with:

```typescript
import type { ProviderMeta } from "./types.ts";
import { providerMeta as context7 } from "./context7.ts";
import { providerMeta as duckduckgo } from "./duckduckgo.ts";
import { providerMeta as exa } from "./exa.ts";
import { providerMeta as exaMcp } from "./exa-mcp.ts";
import { providerMeta as firecrawl } from "./firecrawl.ts";
import { httpProviders } from "./http-providers.ts";
import { providerMeta as jina } from "./jina.ts";
import { providerMeta as ollama } from "./ollama.ts";
import { providerMeta as openaiCodex } from "./openai-codex.ts";
import { providerMeta as openaiWebSearch } from "./openai-web-search.ts";
import { providerMeta as parallel } from "./parallel.ts";
import { providerMeta as searxng } from "./searxng.ts";
import { providerMeta as serper } from "./serper.ts";
import { providerMeta as sofya } from "./sofya.ts";
import { providerMeta as tavily } from "./tavily.ts";

export const allProviders: ProviderMeta[] = [
  ...httpProviders,
  context7,
  duckduckgo,
  exa,
  exaMcp,
  firecrawl,
  jina,
  ollama,
  openaiCodex,
  openaiWebSearch,
  parallel,
  searxng,
  serper,
  sofya,
  tavily,
];
```

- [ ] **Step 3: Run typecheck to verify compilation**

```bash
pnpm run typecheck
```

Expected: no type errors.

---

### Task 3: Write consolidated tests

**Files:**
- Create: `tests/providers/http-providers.test.ts`

- [ ] **Step 4: Create the consolidated test file**

```typescript
// tests/providers/http-providers.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { httpProviders } from "../../src/providers/http-providers.ts";
import { stubFetch } from "../helpers.ts";

// ── Metadata tests ──────────────────────────────────────────────────────

describe("httpProviders metadata", () => {
  const expectedMeta = [
    { name: "brave", tier: 1, monthlyQuota: 2000, requiresKey: true },
    { name: "brave-llm", tier: 1, monthlyQuota: 2000, requiresKey: true },
    { name: "fastcrw", tier: 2, monthlyQuota: 500, requiresKey: true },
    { name: "langsearch", tier: 2, monthlyQuota: null, requiresKey: true },
    { name: "linkup", tier: 2, monthlyQuota: null, requiresKey: true },
    { name: "marginalia", tier: 3, monthlyQuota: null, requiresKey: false },
    { name: "perplexity", tier: 2, monthlyQuota: null, requiresKey: true },
    { name: "websearchapi", tier: 1, monthlyQuota: null, requiresKey: true },
    { name: "youcom", tier: 2, monthlyQuota: null, requiresKey: true },
  ];

  it("exports exactly 9 providers", () => {
    expect(httpProviders).toHaveLength(9);
  });

  for (const meta of expectedMeta) {
    it(`${meta.name} has correct metadata`, () => {
      const provider = httpProviders.find((p) => p.name === meta.name);
      expect(provider).toBeDefined();
      expect(provider!.tier).toBe(meta.tier);
      expect(provider!.monthlyQuota).toBe(meta.monthlyQuota);
      expect(provider!.requiresKey).toBe(meta.requiresKey);
    });
  }

  it("every provider create() returns an object with a search property", () => {
    for (const meta of httpProviders) {
      const key = meta.requiresKey ? "test-key" : undefined;
      const result = meta.create(key);
      expect(result.search).toBeDefined();
      expect(result.search!.name).toBe(meta.name);
    }
  });
});

// ── Brave Search ────────────────────────────────────────────────────────

describe("brave provider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;
  const brave = httpProviders.find((p) => p.name === "brave")!;

  beforeEach(() => {
    fetchStub = stubFetch();
  });
  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct name and label", () => {
    const provider = brave.create("key").search!;
    expect(provider.name).toBe("brave");
    expect(provider.label).toBe("Brave Search");
  });

  it("sends X-Subscription-Token header", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: { web: { results: [] } },
    });
    await brave.create("my-brave-key").search!.search("test", 5);
    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers["X-Subscription-Token"]).toBe("my-brave-key");
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
    const results = await brave.create("key").search!.search("test", 5);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Brave Result");
    expect(results[0].snippet).toBe("A brave snippet");
  });

  it("prepends site: operators for includeDomains", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: { web: { results: [] } },
    });
    await brave.create("key").search!.search("rust tutorial", 5, undefined, {
      includeDomains: ["example.com", "docs.rs"],
    });
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain("site%3Aexample.com+OR+site%3Adocs.rs");
    expect(url).toContain("rust+tutorial");
  });

  it("prepends -site: operators for excludeDomains", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: { web: { results: [] } },
    });
    await brave.create("key").search!.search("test query", 5, undefined, {
      excludeDomains: ["spam.com"],
    });
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain("-site%3Aspam.com");
  });

  it("adds freshness parameter for date filters", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: { web: { results: [] } },
    });
    await brave.create("key").search!.search("test", 5, undefined, {
      startDate: "2025-06-01",
      endDate: "2025-06-30",
    });
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain("freshness=2025-06-01to2025-06-30");
  });

  it("uses open-ended freshness when only startDate is set", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: { web: { results: [] } },
    });
    await brave.create("key").search!.search("test", 5, undefined, {
      startDate: "2025-01-01",
    });
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain("freshness=2025-01-01to");
  });

  it("uses open-ended freshness when only endDate is set", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: { web: { results: [] } },
    });
    await brave.create("key").search!.search("test", 5, undefined, {
      endDate: "2025-12-31",
    });
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain("freshness=to2025-12-31");
  });

  it("throws on non-2xx response", async () => {
    fetchStub.addResponse("api.search.brave.com", { status: 429, body: "Rate limited" });
    await expect(brave.create("key").search!.search("test", 5)).rejects.toThrow();
  });
});

// ── Brave LLM Context ──────────────────────────────────────────────────

describe("brave-llm provider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;
  const braveLlm = httpProviders.find((p) => p.name === "brave-llm")!;

  beforeEach(() => {
    fetchStub = stubFetch();
  });
  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct name and label", () => {
    const provider = braveLlm.create("key").search!;
    expect(provider.name).toBe("brave-llm");
    expect(provider.label).toBe("Brave LLM Context");
  });

  it("sends X-Subscription-Token and Accept headers", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: { grounding: { generic: [] } },
    });
    await braveLlm.create("my-brave-token").search!.search("test", 5);
    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers["X-Subscription-Token"]).toBe("my-brave-token");
    expect(fetchCall[1].headers["Accept"]).toBe("application/json");
  });

  it("sends POST to correct endpoint with q in body", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: { grounding: { generic: [] } },
    });
    await braveLlm.create("key").search!.search("my query", 5);
    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[0]).toBe("https://api.search.brave.com/res/v1/llm/context");
    expect(fetchCall[1].method).toBe("POST");
    const body = JSON.parse(fetchCall[1].body);
    expect(body.q).toBe("my query");
  });

  it("includes maximum_number_of_tokens when providerConfig.tokenBudget is set", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: { grounding: { generic: [] } },
    });
    await braveLlm.create("key", { enabled: true, tokenBudget: 4096 }).search!.search("test", 5);
    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.maximum_number_of_tokens).toBe(4096);
  });

  it("includes maximum_number_of_tokens when providerConfig.tokenBudget is 0", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: { grounding: { generic: [] } },
    });
    await braveLlm.create("key", { enabled: true, tokenBudget: 0 }).search!.search("test", 5);
    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.maximum_number_of_tokens).toBe(0);
  });

  it("omits maximum_number_of_tokens when providerConfig.tokenBudget is not set", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: { grounding: { generic: [] } },
    });
    await braveLlm.create("key", { enabled: true }).search!.search("test", 5);
    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.maximum_number_of_tokens).toBeUndefined();
  });

  it("returns normalized search results from grounding.generic", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: {
        grounding: {
          generic: [
            { url: "https://brave.com", title: "Brave Search", snippets: ["Privacy-first search engine"] },
          ],
        },
      },
    });
    const results = await braveLlm.create("key").search!.search("brave search", 5);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      title: "Brave Search",
      url: "https://brave.com",
      snippet: "Privacy-first search engine",
    });
  });

  it("throws on non-2xx response", async () => {
    fetchStub.addResponse("api.search.brave.com", { status: 403, body: "Forbidden" });
    await expect(braveLlm.create("bad-key").search!.search("test", 5)).rejects.toThrow(
      "Brave LLM Context API error",
    );
  });
});

// ── fastCRW ─────────────────────────────────────────────────────────────

describe("fastcrw provider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;
  const fastcrw = httpProviders.find((p) => p.name === "fastcrw")!;

  beforeEach(() => {
    fetchStub = stubFetch();
  });
  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct name and label", () => {
    const provider = fastcrw.create("key").search!;
    expect(provider.name).toBe("fastcrw");
    expect(provider.label).toBe("fastCRW");
  });

  it("sends Bearer token and POST body with limit", async () => {
    fetchStub.addResponse("api.fastcrw.com", {
      body: { success: true, data: [] },
    });
    await fastcrw.create("my-fastcrw-key").search!.search("test", 15);
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
    await fastcrw.create("key").search!.search("test", 50);
    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.limit).toBe(20);
  });

  it("respects baseUrl config option", async () => {
    fetchStub.addResponse("custom.host.com", {
      body: { success: true, data: [] },
    });
    await fastcrw
      .create("key", { enabled: true, baseUrl: "https://custom.host.com" })
      .search!.search("test", 5);
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain("custom.host.com/v1/search");
  });

  it("returns normalized search results", async () => {
    fetchStub.addResponse("api.fastcrw.com", {
      body: {
        success: true,
        data: [
          { title: "Fast Result", url: "https://example.com", description: "A fast snippet" },
        ],
      },
    });
    const results = await fastcrw.create("key").search!.search("test query", 10);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      title: "Fast Result",
      url: "https://example.com",
      snippet: "A fast snippet",
    });
  });

  it("throws on non-2xx response", async () => {
    fetchStub.addResponse("api.fastcrw.com", { status: 500, body: "Server Error" });
    await expect(fastcrw.create("key").search!.search("test", 5)).rejects.toThrow("fastCRW");
  });
});

// ── LangSearch ──────────────────────────────────────────────────────────

describe("langsearch provider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;
  const langsearch = httpProviders.find((p) => p.name === "langsearch")!;

  beforeEach(() => {
    fetchStub = stubFetch();
  });
  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct name and label", () => {
    const provider = langsearch.create("key").search!;
    expect(provider.name).toBe("langsearch");
    expect(provider.label).toBe("LangSearch");
  });

  it("sends Bearer token in Authorization header", async () => {
    fetchStub.addResponse("api.langsearch.com", {
      body: { data: { webPages: { value: [] } } },
    });
    await langsearch.create("my-lang-key").search!.search("test", 5);
    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers["Authorization"]).toBe("Bearer my-lang-key");
  });

  it("sends POST with query and max_results in body", async () => {
    fetchStub.addResponse("api.langsearch.com", {
      body: { data: { webPages: { value: [] } } },
    });
    await langsearch.create("key").search!.search("my query", 10);
    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[0]).toBe("https://api.langsearch.com/v1/web-search");
    expect(fetchCall[1].method).toBe("POST");
    const body = JSON.parse(fetchCall[1].body);
    expect(body.query).toBe("my query");
    expect(body.max_results).toBe(10);
  });

  it("caps max_results at 20", async () => {
    fetchStub.addResponse("api.langsearch.com", {
      body: { data: { webPages: { value: [] } } },
    });
    await langsearch.create("key").search!.search("test", 50);
    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.max_results).toBe(20);
  });

  it("returns normalized search results", async () => {
    fetchStub.addResponse("api.langsearch.com", {
      body: {
        data: {
          webPages: {
            value: [
              { name: "Result 1", url: "https://example.com/1", snippet: "First result" },
            ],
          },
        },
      },
    });
    const results = await langsearch.create("key").search!.search("test query", 5);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      title: "Result 1",
      url: "https://example.com/1",
      snippet: "First result",
    });
  });

  it("throws on non-2xx response", async () => {
    fetchStub.addResponse("api.langsearch.com", { status: 429, body: "Rate limited" });
    await expect(langsearch.create("key").search!.search("test", 5)).rejects.toThrow(
      "LangSearch API error",
    );
  });
});

// ── Linkup ──────────────────────────────────────────────────────────────

describe("linkup provider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;
  const linkup = httpProviders.find((p) => p.name === "linkup")!;

  beforeEach(() => {
    fetchStub = stubFetch();
  });
  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct name and label", () => {
    const provider = linkup.create("key").search!;
    expect(provider.name).toBe("linkup");
    expect(provider.label).toBe("Linkup");
  });

  it("sends Bearer token and POST body with default depth", async () => {
    fetchStub.addResponse("api.linkup.so", { body: { searchResults: [] } });
    await linkup.create("my-linkup-key").search!.search("test", 5);
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
    await linkup
      .create("key", { enabled: true, depth: "deep" })
      .search!.search("test", 5);
    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.depth).toBe("deep");
  });

  it("returns normalized search results", async () => {
    fetchStub.addResponse("api.linkup.so", {
      body: {
        searchResults: [
          { title: "Linkup Result", url: "https://example.com", content: "A linkup snippet" },
        ],
      },
    });
    const results = await linkup.create("key").search!.search("test query", 10);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      title: "Linkup Result",
      url: "https://example.com",
      snippet: "A linkup snippet",
    });
  });

  it("throws on non-2xx response", async () => {
    fetchStub.addResponse("api.linkup.so", { status: 401, body: "Unauthorized" });
    await expect(linkup.create("key").search!.search("test", 5)).rejects.toThrow("Linkup");
  });
});

// ── Marginalia ──────────────────────────────────────────────────────────

describe("marginalia provider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;
  const marginalia = httpProviders.find((p) => p.name === "marginalia")!;

  beforeEach(() => {
    fetchStub = stubFetch();
  });
  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct name and label", () => {
    const provider = marginalia.create().search!;
    expect(provider.name).toBe("marginalia");
    expect(provider.label).toBe("Marginalia Search");
  });

  it("creates provider with 'public' key when no key provided", async () => {
    fetchStub.addResponse("api2.marginalia-search.com", {
      body: { results: [] },
    });
    await marginalia.create().search!.search("test", 5);
    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers["API-Key"]).toBe("public");
  });

  it("sends API-Key and Accept headers", async () => {
    fetchStub.addResponse("api2.marginalia-search.com", {
      body: { results: [] },
    });
    await marginalia.create("my-api-key").search!.search("test", 5);
    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers["API-Key"]).toBe("my-api-key");
    expect(fetchCall[1].headers["Accept"]).toBe("application/json");
  });

  it("sends correct query parameters", async () => {
    fetchStub.addResponse("api2.marginalia-search.com", {
      body: { results: [] },
    });
    await marginalia.create("key").search!.search("test query", 20);
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain("query=test+query");
    expect(url).toContain("count=20");
  });

  it("caps maxResults at 100", async () => {
    fetchStub.addResponse("api2.marginalia-search.com", {
      body: { results: [] },
    });
    await marginalia.create().search!.search("test", 200);
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain("count=100");
  });

  it("returns normalized search results", async () => {
    fetchStub.addResponse("api2.marginalia-search.com", {
      body: {
        results: [
          { title: "Indie Web", url: "https://indieweb.org", description: "Independent web" },
        ],
      },
    });
    const results = await marginalia.create().search!.search("indie web", 10);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      title: "Indie Web",
      url: "https://indieweb.org",
      snippet: "Independent web",
    });
  });

  it("throws on non-2xx response", async () => {
    fetchStub.addResponse("api2.marginalia-search.com", { status: 503, body: "Service Unavailable" });
    await expect(marginalia.create().search!.search("test", 5)).rejects.toThrow(
      /Marginalia Search API error: 503/,
    );
  });
});

// ── Perplexity Sonar ────────────────────────────────────────────────────

describe("perplexity provider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;
  const perplexity = httpProviders.find((p) => p.name === "perplexity")!;

  beforeEach(() => {
    fetchStub = stubFetch();
  });
  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct name and label", () => {
    const provider = perplexity.create("key").search!;
    expect(provider.name).toBe("perplexity");
    expect(provider.label).toBe("Perplexity Sonar");
  });

  it("sends Bearer auth header", async () => {
    fetchStub.addResponse("api.perplexity.ai", {
      body: { choices: [{ message: { content: "answer" } }], citations: [] },
    });
    await perplexity.create("my-key").search!.search("test", 5);
    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers.Authorization).toBe("Bearer my-key");
  });

  it("uses default model 'sonar' when not configured", async () => {
    fetchStub.addResponse("api.perplexity.ai", {
      body: { choices: [{ message: { content: "answer" } }], citations: [] },
    });
    await perplexity.create("key").search!.search("test", 5);
    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.model).toBe("sonar");
  });

  it("uses configured model from providerConfig", async () => {
    fetchStub.addResponse("api.perplexity.ai", {
      body: { choices: [{ message: { content: "answer" } }], citations: [] },
    });
    await perplexity
      .create("pplx-key", { enabled: true, model: "sonar-pro" })
      .search!.search("test", 5);
    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.model).toBe("sonar-pro");
  });

  it("sends messages array in body", async () => {
    fetchStub.addResponse("api.perplexity.ai", {
      body: { choices: [{ message: { content: "answer" } }], citations: [] },
    });
    await perplexity.create("key").search!.search("test query", 5);
    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.messages).toEqual([{ role: "user", content: "test query" }]);
  });

  it("returns search results from chat completion format", async () => {
    fetchStub.addResponse("api.perplexity.ai", {
      body: {
        choices: [{ message: { content: "Perplexity answer about the topic" } }],
        citations: ["https://source1.com", "https://source2.com"],
      },
    });
    const results = await perplexity.create("key").search!.search("test", 5);
    expect(results.length).toBeGreaterThan(0);
  });

  it("throws on non-2xx response", async () => {
    fetchStub.addResponse("api.perplexity.ai", { status: 403, body: "Forbidden" });
    await expect(perplexity.create("key").search!.search("test", 5)).rejects.toThrow();
  });
});

// ── WebSearchAPI ────────────────────────────────────────────────────────

describe("websearchapi provider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;
  const websearchapi = httpProviders.find((p) => p.name === "websearchapi")!;

  beforeEach(() => {
    fetchStub = stubFetch();
  });
  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct name and label", () => {
    const provider = websearchapi.create("key").search!;
    expect(provider.name).toBe("websearchapi");
    expect(provider.label).toBe("WebSearchAPI");
  });

  it("sends correct POST request with Bearer auth", async () => {
    fetchStub.addResponse("api.websearchapi.ai", {
      body: { organic: [], responseTime: 0.5 },
    });
    await websearchapi.create("my-ws-key").search!.search("my query", 7);
    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[0]).toBe("https://api.websearchapi.ai/ai-search");
    expect(fetchCall[1].method).toBe("POST");
    const body = JSON.parse(fetchCall[1].body);
    expect(body.query).toBe("my query");
    expect(body.maxResults).toBe(7);
    expect(fetchCall[1].headers["Authorization"]).toBe("Bearer my-ws-key");
    expect(fetchCall[1].headers["Content-Type"]).toBe("application/json");
  });

  it("returns normalized search results from organic array", async () => {
    fetchStub.addResponse("api.websearchapi.ai", {
      body: {
        organic: [
          { title: "WS Result", url: "https://example.com/page", description: "A WebSearchAPI snippet" },
        ],
        responseTime: 1.2,
      },
    });
    const results = await websearchapi.create("key").search!.search("test query", 5);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      title: "WS Result",
      url: "https://example.com/page",
      snippet: "A WebSearchAPI snippet",
    });
  });

  it("limits results to maxResults", async () => {
    const manyResults = Array.from({ length: 10 }, (_, i) => ({
      title: `Result ${i}`,
      url: `https://example.com/${i}`,
      description: `Snippet ${i}`,
    }));
    fetchStub.addResponse("api.websearchapi.ai", {
      body: { organic: manyResults, responseTime: 1.0 },
    });
    const results = await websearchapi.create("key").search!.search("test", 3);
    expect(results).toHaveLength(3);
  });

  it("throws on non-2xx response", async () => {
    fetchStub.addResponse("api.websearchapi.ai", { status: 401, body: "Unauthorized" });
    await expect(websearchapi.create("bad-key").search!.search("test", 5)).rejects.toThrow();
  });
});

// ── You.com ─────────────────────────────────────────────────────────────

describe("youcom provider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;
  const youcom = httpProviders.find((p) => p.name === "youcom")!;

  beforeEach(() => {
    fetchStub = stubFetch();
  });
  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct name and label", () => {
    const provider = youcom.create("key").search!;
    expect(provider.name).toBe("youcom");
    expect(provider.label).toBe("You.com");
  });

  it("sends X-API-Key header via GET with query params", async () => {
    fetchStub.addResponse("api.you.com", { body: { hits: [] } });
    await youcom.create("my-you-key").search!.search("hello world", 8);
    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const url = fetchCall[0] as string;
    expect(url).toContain("api.you.com/v1/search");
    expect(url).toContain("query=hello+world");
    expect(url).toContain("num_web_results=8");
    expect(fetchCall[1].headers["X-API-Key"]).toBe("my-you-key");
  });

  it("caps num_web_results at 100", async () => {
    fetchStub.addResponse("api.you.com", { body: { hits: [] } });
    await youcom.create("key").search!.search("test", 200);
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain("num_web_results=100");
  });

  it("returns normalized search results", async () => {
    fetchStub.addResponse("api.you.com", {
      body: {
        hits: [
          { title: "You Result", url: "https://example.com", description: "A you.com snippet", snippets: [] },
        ],
      },
    });
    const results = await youcom.create("key").search!.search("test query", 10);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      title: "You Result",
      url: "https://example.com",
      snippet: "A you.com snippet",
    });
  });

  it("throws on non-2xx response", async () => {
    fetchStub.addResponse("api.you.com", { status: 403, body: "Forbidden" });
    await expect(youcom.create("key").search!.search("test", 5)).rejects.toThrow("You.com");
  });
});
```

- [ ] **Step 5: Run the consolidated tests**

```bash
pnpm vitest run tests/providers/http-providers.test.ts
```

Expected: all tests PASS.

---

### Task 4: Delete the 9 individual provider files and their test files

**Files:**
- Delete: `src/providers/marginalia.ts`
- Delete: `src/providers/langsearch.ts`
- Delete: `src/providers/linkup.ts`
- Delete: `src/providers/fastcrw.ts`
- Delete: `src/providers/youcom.ts`
- Delete: `src/providers/websearchapi.ts`
- Delete: `src/providers/perplexity.ts`
- Delete: `src/providers/brave.ts`
- Delete: `src/providers/brave-llm.ts`
- Delete: `tests/providers/marginalia.test.ts`
- Delete: `tests/providers/langsearch.test.ts`
- Delete: `tests/providers/linkup.test.ts`
- Delete: `tests/providers/fastcrw.test.ts`
- Delete: `tests/providers/youcom.test.ts`
- Delete: `tests/providers/websearchapi.test.ts`
- Delete: `tests/providers/perplexity.test.ts`
- Delete: `tests/providers/brave.test.ts`
- Delete: `tests/providers/brave-llm.test.ts`

- [ ] **Step 6: Delete the 9 source files**

```bash
rm src/providers/marginalia.ts src/providers/langsearch.ts src/providers/linkup.ts src/providers/fastcrw.ts src/providers/youcom.ts src/providers/websearchapi.ts src/providers/perplexity.ts src/providers/brave.ts src/providers/brave-llm.ts
```

- [ ] **Step 7: Delete the 9 individual test files**

```bash
rm tests/providers/marginalia.test.ts tests/providers/langsearch.test.ts tests/providers/linkup.test.ts tests/providers/fastcrw.test.ts tests/providers/youcom.test.ts tests/providers/websearchapi.test.ts tests/providers/perplexity.test.ts tests/providers/brave.test.ts tests/providers/brave-llm.test.ts
```

---

### Task 5: Run verification

- [ ] **Step 8: Run typecheck**

```bash
pnpm run typecheck
```

Expected: no type errors.

- [ ] **Step 9: Run all tests**

```bash
pnpm test
```

Expected: all tests PASS. The `tests/providers/all.test.ts` test that verifies all 23 provider names should pass unchanged since the same 9 providers are still exported via `httpProviders`.

- [ ] **Step 10: Run lint**

```bash
pnpm run lint
```

Expected: no lint errors.

---

### Task 6: Commit

- [ ] **Step 11: Stage and commit**

```bash
git add src/providers/http-providers.ts src/providers/all.ts tests/providers/http-providers.test.ts
git rm src/providers/marginalia.ts src/providers/langsearch.ts src/providers/linkup.ts src/providers/fastcrw.ts src/providers/youcom.ts src/providers/websearchapi.ts src/providers/perplexity.ts src/providers/brave.ts src/providers/brave-llm.ts
git rm tests/providers/marginalia.test.ts tests/providers/langsearch.test.ts tests/providers/linkup.test.ts tests/providers/fastcrw.test.ts tests/providers/youcom.test.ts tests/providers/websearchapi.test.ts tests/providers/perplexity.test.ts tests/providers/brave.test.ts tests/providers/brave-llm.test.ts
git commit -m "refactor: consolidate 9 shallow HTTP providers into data-driven definitions

Replace 9 individual provider files (brave, brave-llm, fastcrw,
langsearch, linkup, marginalia, perplexity, websearchapi, youcom)
with a single http-providers.ts that exports a ProviderMeta[] array.
Each entry uses createHttpSearchProvider with its parser from parsers.ts.

- Create src/providers/http-providers.ts (9 provider definitions)
- Update src/providers/all.ts to spread httpProviders
- Consolidate 9 test files into tests/providers/http-providers.test.ts
- Delete 9 source files and 9 test files (18 files removed)

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

**Phase 1 complete.** 9 shallow provider files and 9 test files replaced by 1 source file and 1 test file. Net deletion: 18 files removed, 2 files created, 1 file modified.
