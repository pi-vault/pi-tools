# Search Providers Expansion — Phase 4: Brave LLM Context Provider

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Brave LLM Context as a tier 1 search provider, sharing the same API key as the existing `brave` provider. Supports configurable `maximum_number_of_tokens` via `tokenBudget` config field.

**Architecture:** Single provider file + parser addition + registration + config type extension + fallback env map entry. Uses `createHttpSearchProvider` with custom `buildHeaders` (X-Subscription-Token auth) and `buildBody` (POST with `q` + optional `maximum_number_of_tokens`). Parser extracts search results from Brave's `grounding.generic[]` response format, joining multiple snippets per URL.

**Tech Stack:** TypeScript, Vitest, native `fetch`, `createHttpSearchProvider` factory

**Parent Plan:** `2026-07-12-search-providers.md`
**Prerequisite:** Phase 3 complete (langsearch registered, parsers.ts has langsearch parser)

---

## Brave LLM Context API Reference

**Endpoint:** `POST https://api.search.brave.com/res/v1/llm/context`
**Auth:** `X-Subscription-Token: <API_KEY>` header (same key as Brave Web Search)
**Docs:** https://api-dashboard.search.brave.com/documentation/services/llm-context

### Request Body (POST, Content-Type: application/json)

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `q` | string | Yes | - | Search query (1-400 chars, max 50 words) |
| `count` | int | No | 20 | Max search results to consider (1-50) |
| `maximum_number_of_tokens` | int | No | 8192 | Approximate max tokens in context (1024-32768) |
| `maximum_number_of_urls` | int | No | 20 | Max URLs in response (1-50) |
| `maximum_number_of_snippets` | int | No | 50 | Max snippets across all URLs (1-256) |
| `country` | string | No | `US` | 2-letter country code |
| `search_lang` | string | No | `en` | Language preference |
| `freshness` | string | No | - | Filter by page age (pd/pw/pm/py or date range) |

### Response Format

```json
{
  "grounding": {
    "generic": [
      {
        "url": "https://example.com/page",
        "title": "Page Title",
        "snippets": [
          "Relevant text chunk extracted from the page...",
          "Another relevant passage from the same page..."
        ]
      }
    ],
    "map": []
  },
  "sources": {
    "https://example.com/page": {
      "title": "Page Title",
      "hostname": "example.com",
      "age": ["Wednesday, January 15, 2025", "2025-01-15", "392 days ago"]
    }
  }
}
```

**Key structure:** Each `grounding.generic[]` entry groups multiple `snippets` (strings) under one URL. Snippets may contain plain text or JSON-serialized structured data (tables, code blocks).

---

## Key Reference Files

| File | Purpose |
|------|---------|
| `src/providers/http-adapter.ts` | `createHttpSearchProvider()` factory |
| `src/providers/parsers.ts` | Pure parser functions |
| `src/providers/all.ts` | Provider registration array |
| `src/providers/types.ts` | `ProviderMeta`, `SearchResult` types |
| `src/config.ts` | `ProviderConfigEntry` interface, `FALLBACK_ENV_MAP`, `DEFAULT_CONFIG` |
| `src/providers/brave.ts` | Reference for X-Subscription-Token auth pattern |
| `tests/helpers.ts` | `stubFetch()` test helper |

---

## Steps

### Step 1: Extend config with tokenBudget and brave-llm entries

- [ ] Add `tokenBudget?: number` to `ProviderConfigEntry` in `src/config.ts`
- [ ] Add `"brave-llm": "BRAVE_API_KEY"` to `FALLBACK_ENV_MAP` (shares key with brave)
- [ ] Add `"brave-llm"` entry to `DEFAULT_CONFIG.providers`

In `src/config.ts`, update the interface:

```typescript
export interface ProviderConfigEntry {
  enabled: boolean;
  monthlyQuota?: number;
  apiKey?: string;
  instanceUrl?: string;
  ssrfAllowRanges?: string[];
  tokenBudget?: number;
}
```

Add to `FALLBACK_ENV_MAP`:

```typescript
export const FALLBACK_ENV_MAP: Record<string, string> = {
  brave: "BRAVE_API_KEY",
  "brave-llm": "BRAVE_API_KEY",  // shares key with brave
  // ... rest unchanged
};
```

Add to `DEFAULT_CONFIG.providers`:

```typescript
"brave-llm": { enabled: true, monthlyQuota: 2000, apiKey: "BRAVE_API_KEY" },
```

**Verify typecheck still passes (additive change):**

```bash
pnpm run typecheck
```

---

### Step 2: Write failing parser tests

- [ ] Add `parseBraveLlmResults` tests to `tests/providers/parsers.test.ts`

```typescript
// Add to tests/providers/parsers.test.ts

import { parseBraveLlmResults } from "../../src/providers/parsers.ts";

describe("parseBraveLlmResults", () => {
  it("maps grounding.generic entries to SearchResult[]", () => {
    const data = {
      grounding: {
        generic: [
          {
            url: "https://brave.com/about",
            title: "About Brave",
            snippets: [
              "Brave Search is a privacy-focused search engine.",
              "It does not track users.",
            ],
          },
          {
            url: "https://brave.com/ai",
            title: "Brave AI",
            snippets: ["Brave offers AI-powered search summaries."],
          },
        ],
      },
    };
    const results = parseBraveLlmResults(data);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "About Brave",
      url: "https://brave.com/about",
      snippet:
        "Brave Search is a privacy-focused search engine.\n\nIt does not track users.",
    });
    expect(results[1]).toEqual({
      title: "Brave AI",
      url: "https://brave.com/ai",
      snippet: "Brave offers AI-powered search summaries.",
    });
  });

  it("returns empty array when grounding is missing", () => {
    expect(parseBraveLlmResults({})).toEqual([]);
    expect(parseBraveLlmResults({ grounding: null })).toEqual([]);
  });

  it("returns empty array for null/undefined input", () => {
    expect(parseBraveLlmResults(null)).toEqual([]);
    expect(parseBraveLlmResults(undefined)).toEqual([]);
  });

  it("returns empty array when generic is not an array", () => {
    expect(parseBraveLlmResults({ grounding: {} })).toEqual([]);
    expect(
      parseBraveLlmResults({ grounding: { generic: "not-array" } }),
    ).toEqual([]);
  });

  it("handles entries with missing fields gracefully", () => {
    const data = {
      grounding: {
        generic: [
          { snippets: ["Some content without url/title metadata"] },
          { url: "https://example.com", title: "Has URL" },
          {},
        ],
      },
    };
    const results = parseBraveLlmResults(data);
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({
      title: "",
      url: "",
      snippet: "Some content without url/title metadata",
    });
    expect(results[1]).toEqual({
      title: "Has URL",
      url: "https://example.com",
      snippet: "",
    });
    expect(results[2]).toEqual({
      title: "",
      url: "",
      snippet: "",
    });
  });

  it("joins multiple snippets with double newline", () => {
    const data = {
      grounding: {
        generic: [
          {
            url: "https://example.com",
            title: "Multi",
            snippets: ["First chunk.", "Second chunk.", "Third chunk."],
          },
        ],
      },
    };
    const results = parseBraveLlmResults(data);
    expect(results[0].snippet).toBe(
      "First chunk.\n\nSecond chunk.\n\nThird chunk.",
    );
  });

  it("handles empty snippets array", () => {
    const data = {
      grounding: {
        generic: [
          { url: "https://example.com", title: "Empty", snippets: [] },
        ],
      },
    };
    const results = parseBraveLlmResults(data);
    expect(results[0].snippet).toBe("");
  });

  it("handles non-array snippets gracefully", () => {
    const data = {
      grounding: {
        generic: [
          { url: "https://example.com", title: "Bad", snippets: "not-array" },
        ],
      },
    };
    const results = parseBraveLlmResults(data);
    expect(results[0].snippet).toBe("");
  });
});
```

**Verify (expect failure -- parser not yet implemented):**

```bash
pnpm vitest run tests/providers/parsers.test.ts
```

---

### Step 3: Write failing provider tests

- [ ] Create `tests/providers/brave-llm.test.ts`

```typescript
// tests/providers/brave-llm.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { providerMeta } from "../../src/providers/brave-llm.ts";
import { stubFetch } from "../helpers.ts";

const makeProvider = (key = "test-key", providerConfig?: Parameters<typeof providerMeta.create>[1]) =>
  providerMeta.create(key, providerConfig).search!;

describe("BraveLlmProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct metadata", () => {
    expect(providerMeta.name).toBe("brave-llm");
    expect(providerMeta.tier).toBe(1);
    expect(providerMeta.monthlyQuota).toBe(2000);
    expect(providerMeta.requiresKey).toBe(true);
  });

  it("has correct name and label", () => {
    const provider = makeProvider();
    expect(provider.name).toBe("brave-llm");
    expect(provider.label).toBe("Brave LLM Context");
  });

  it("returns normalized search results from grounding.generic", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: {
        grounding: {
          generic: [
            {
              url: "https://brave.com",
              title: "Brave Search",
              snippets: ["Privacy-first search engine"],
            },
          ],
        },
      },
    });

    const provider = makeProvider();
    const results = await provider.search("brave search", 5);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      title: "Brave Search",
      url: "https://brave.com",
      snippet: "Privacy-first search engine",
    });
  });

  it("sends X-Subscription-Token header", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: { grounding: { generic: [] } },
    });

    const provider = makeProvider("my-brave-token");
    await provider.search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers["X-Subscription-Token"]).toBe("my-brave-token");
    expect(fetchCall[1].headers["Accept"]).toBe("application/json");
  });

  it("sends POST to correct endpoint with q in body", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: { grounding: { generic: [] } },
    });

    const provider = makeProvider();
    await provider.search("my query", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[0]).toBe(
      "https://api.search.brave.com/res/v1/llm/context",
    );
    expect(fetchCall[1].method).toBe("POST");
    const body = JSON.parse(fetchCall[1].body);
    expect(body.q).toBe("my query");
  });

  it("includes maximum_number_of_tokens when providerConfig.tokenBudget is set", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: { grounding: { generic: [] } },
    });

    const provider = makeProvider("key", {
      enabled: true,
      tokenBudget: 4096,
    });
    await provider.search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.maximum_number_of_tokens).toBe(4096);
  });

  it("omits maximum_number_of_tokens when providerConfig.tokenBudget is not set", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: { grounding: { generic: [] } },
    });

    const provider = makeProvider("key", { enabled: true });
    await provider.search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.maximum_number_of_tokens).toBeUndefined();
  });

  it("omits maximum_number_of_tokens when no providerConfig is passed", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: { grounding: { generic: [] } },
    });

    const provider = makeProvider();
    await provider.search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.maximum_number_of_tokens).toBeUndefined();
  });

  it("throws on non-2xx response", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      status: 403,
      body: "Forbidden",
    });

    const provider = makeProvider("bad-key");
    await expect(provider.search("test", 5)).rejects.toThrow(
      "Brave LLM Context API error",
    );
  });
});
```

**Verify (expect failure -- provider file doesn't exist):**

```bash
pnpm vitest run tests/providers/brave-llm.test.ts
```

---

### Step 4: Implement the parser

- [ ] Add `parseBraveLlmResults` to `src/providers/parsers.ts`

Add the following export to the existing `src/providers/parsers.ts` file:

```typescript
export function parseBraveLlmResults(data: unknown): SearchResult[] {
  if (!data || typeof data !== "object") return [];
  const d = data as { grounding?: { generic?: unknown } };
  const grounding = d.grounding;
  if (!grounding || typeof grounding !== "object") return [];
  const generic = (grounding as { generic?: unknown }).generic;
  if (!Array.isArray(generic)) return [];
  return generic.map((entry: unknown) => {
    const e = entry as Record<string, unknown>;
    const snippets = Array.isArray(e.snippets) ? (e.snippets as string[]) : [];
    return {
      title: (e.title as string) || "",
      url: (e.url as string) || "",
      snippet: snippets.join("\n\n"),
    };
  });
}
```

**Design note:** Each `grounding.generic[]` entry's snippets are joined with `\n\n` (no truncation). LLM context is designed to be large; downstream consumers can truncate as needed.

**Verify parser tests pass:**

```bash
pnpm vitest run tests/providers/parsers.test.ts
```

---

### Step 5: Implement the provider

- [ ] Create `src/providers/brave-llm.ts`

```typescript
import { createHttpSearchProvider } from "./http-adapter.ts";
import { parseBraveLlmResults } from "./parsers.ts";
import type { ProviderMeta } from "./types.ts";

export const providerMeta: ProviderMeta = {
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
        if (providerConfig?.tokenBudget)
          body.maximum_number_of_tokens = providerConfig.tokenBudget;
        return body;
      },
      extractResults: parseBraveLlmResults,
    }),
  }),
};
```

**Verify provider tests pass:**

```bash
pnpm vitest run tests/providers/brave-llm.test.ts
```

---

### Step 6: Register the provider

- [ ] Add import and array entry to `src/providers/all.ts`

Add after the `brave` import:

```typescript
import { providerMeta as braveLlm } from "./brave-llm.ts";
```

Add `braveLlm` to the `allProviders` array (alphabetical position, after `brave`).

- [ ] Update `tests/providers/all.test.ts` provider count and name list

The test expects exactly 16 providers and a sorted name list. Update:
- Count: `16` -> `17`
- Add `"brave-llm"` to the sorted expected name array (after `"brave"`)

**Verify registration tests pass:**

```bash
pnpm vitest run tests/providers/all.test.ts
```

---

### Step 7: Full verification

- [ ] Run full test suite, lint, and typecheck

```bash
pnpm vitest run
pnpm run lint
pnpm run typecheck
```

All must pass with zero errors.

---

### Step 8: Commit

- [ ] Create atomic commit

```bash
git add src/config.ts src/providers/brave-llm.ts src/providers/parsers.ts src/providers/all.ts tests/providers/brave-llm.test.ts tests/providers/parsers.test.ts tests/providers/all.test.ts
git commit -m "feat(providers): add Brave LLM Context provider (Phase 4)

- Add brave-llm.ts using createHttpSearchProvider with X-Subscription-Token auth
- Add parseBraveLlmResults parser to parsers.ts (grounding.generic -> SearchResult[])
- Add tokenBudget to ProviderConfigEntry, maps to maximum_number_of_tokens API param
- Add brave-llm to FALLBACK_ENV_MAP (shares BRAVE_API_KEY) and DEFAULT_CONFIG
- Register in all.ts, update all.test.ts count and name list
- Tests for parser (grounding.generic, empty, malformed, multi-snippet join) and provider"
```

---

## Changes from Previous Plan Version

This plan was rewritten to correct errors from the original version (which was based on an older API path used by pi-search-hub). Key corrections:

| Aspect | Previous (wrong) | Corrected |
|--------|------------------|-----------|
| **Endpoint** | `/app/v1/llm/context` | `/res/v1/llm/context` |
| **Query field** | `{ query: "..." }` | `{ q: "..." }` |
| **Response format** | `{ chunks: [{ content, source: { url, title } }] }` | `{ grounding: { generic: [{ url, title, snippets: [...] }] } }` |
| **Token budget param** | `token_budget` | `maximum_number_of_tokens` |
| **Snippet handling** | One SearchResult per chunk, truncate to 500 | One SearchResult per URL, join snippets with `\n\n`, no truncation |
| **Config entries** | Missing FALLBACK_ENV_MAP and DEFAULT_CONFIG | Added both |
| **all.test.ts** | Not mentioned | Updated count and name list |
