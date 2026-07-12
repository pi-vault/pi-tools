# Search Providers Expansion — Phase 3: LangSearch Provider

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add LangSearch as a tier 2 search provider using `createHttpSearchProvider` and a pure parser function.

**Architecture:** Single provider file + parser addition + registration. Uses the established http-adapter pattern. Parser handles LangSearch's nested `data.webPages.value` response shape with fallback to a flat `results` array.

**Tech Stack:** TypeScript, Vitest, native `fetch`, `createHttpSearchProvider` factory

**Parent Plan:** `2026-07-12-search-providers.md`
**Prerequisite:** Phase 2 complete (parsers.ts exists, marginalia registered)

---

## Key Reference Files

| File                            | Purpose                                    |
| ------------------------------- | ------------------------------------------ |
| `src/providers/http-adapter.ts` | `createHttpSearchProvider()` factory       |
| `src/providers/parsers.ts`      | Pure parser functions (created in Phase 2) |
| `src/providers/all.ts`          | Provider registration array                |
| `src/providers/types.ts`        | `ProviderMeta`, `SearchResult` types       |
| `tests/helpers.ts`              | `stubFetch()` test helper                  |
| `src/providers/brave.ts`        | Reference provider implementation          |

---

## Steps

### Step 1: Write failing parser tests

- [ ] Add `parseLangSearchResults` tests to `tests/providers/parsers.test.ts`

```typescript
// Add to tests/providers/parsers.test.ts

import { parseLangSearchResults } from "../../src/providers/parsers.ts";

describe("parseLangSearchResults", () => {
  it("parses nested webPages.value response", () => {
    const data = {
      data: {
        webPages: {
          value: [
            {
              name: "LangSearch Docs",
              url: "https://langsearch.com/docs",
              snippet: "Documentation for LangSearch API",
            },
            {
              name: "Getting Started",
              url: "https://langsearch.com/start",
              snippet: "Quick start guide",
            },
          ],
        },
      },
    };
    const results = parseLangSearchResults(data);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "LangSearch Docs",
      url: "https://langsearch.com/docs",
      snippet: "Documentation for LangSearch API",
    });
    expect(results[1].title).toBe("Getting Started");
  });

  it("falls back to results array when webPages is absent", () => {
    const data = {
      results: [
        {
          title: "Fallback Result",
          link: "https://example.com",
          description: "A fallback",
        },
      ],
    };
    const results = parseLangSearchResults(data);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      title: "Fallback Result",
      url: "https://example.com",
      snippet: "A fallback",
    });
  });

  it("returns empty array for null/undefined input", () => {
    expect(parseLangSearchResults(null)).toEqual([]);
    expect(parseLangSearchResults(undefined)).toEqual([]);
  });

  it("returns empty array for malformed input", () => {
    expect(parseLangSearchResults("string")).toEqual([]);
    expect(
      parseLangSearchResults({ data: { webPages: { value: "not-array" } } }),
    ).toEqual([]);
  });

  it("truncates snippets to 500 characters", () => {
    const longSnippet = "x".repeat(600);
    const data = {
      data: {
        webPages: {
          value: [
            { name: "Long", url: "https://example.com", snippet: longSnippet },
          ],
        },
      },
    };
    const results = parseLangSearchResults(data);
    expect(results[0].snippet).toHaveLength(500);
  });
});
```

**Verify (expect failure — parser not yet implemented):**

```bash
pnpm vitest run tests/providers/parsers.test.ts
```

---

### Step 2: Write failing provider tests

- [ ] Create `tests/providers/langsearch.test.ts`

```typescript
// tests/providers/langsearch.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { providerMeta } from "../../src/providers/langsearch.ts";
import { stubFetch } from "../helpers.ts";

const makeProvider = (key = "test-langsearch-key") =>
  providerMeta.create(key).search!;

describe("LangSearchProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct metadata", () => {
    expect(providerMeta.name).toBe("langsearch");
    expect(providerMeta.tier).toBe(2);
    expect(providerMeta.monthlyQuota).toBeNull();
    expect(providerMeta.requiresKey).toBe(true);
  });

  it("has correct name and label", () => {
    const provider = makeProvider();
    expect(provider.name).toBe("langsearch");
    expect(provider.label).toBe("LangSearch");
  });

  it("returns normalized search results", async () => {
    fetchStub.addResponse("api.langsearch.com", {
      body: {
        data: {
          webPages: {
            value: [
              {
                name: "Result 1",
                url: "https://example.com/1",
                snippet: "First result",
              },
              {
                name: "Result 2",
                url: "https://example.com/2",
                snippet: "Second result",
              },
            ],
          },
        },
      },
    });

    const results = await makeProvider().search("test query", 5);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "Result 1",
      url: "https://example.com/1",
      snippet: "First result",
    });
  });

  it("sends Bearer token in Authorization header", async () => {
    fetchStub.addResponse("api.langsearch.com", {
      body: { data: { webPages: { value: [] } } },
    });

    await makeProvider("my-lang-key").search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers["Authorization"]).toBe("Bearer my-lang-key");
  });

  it("sends POST with query and max_results in body", async () => {
    fetchStub.addResponse("api.langsearch.com", {
      body: { data: { webPages: { value: [] } } },
    });

    await makeProvider().search("my query", 10);

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

    await makeProvider().search("test", 50);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.max_results).toBe(20);
  });

  it("throws on non-2xx response", async () => {
    fetchStub.addResponse("api.langsearch.com", {
      status: 429,
      body: "Rate limited",
    });
    await expect(makeProvider().search("test", 5)).rejects.toThrow(
      "LangSearch API error",
    );
  });
});
```

**Verify (expect failure — provider file doesn't exist):**

```bash
pnpm vitest run tests/providers/langsearch.test.ts
```

---

### Step 3: Implement the parser

- [ ] Add `parseLangSearchResults` to `src/providers/parsers.ts`

Add the following export to the existing `src/providers/parsers.ts` file:

```typescript
export function parseLangSearchResults(data: unknown): SearchResult[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  // Response: { data: { webPages: { value: [...] } } } with fallbacks
  const pages = (d.data as Record<string, unknown>)?.webPages as
    | Record<string, unknown>
    | undefined;
  const results = (pages?.value ?? d.results ?? []) as unknown[];
  if (!Array.isArray(results)) return [];
  return results.map((r: unknown) => {
    const item = r as Record<string, unknown>;
    return {
      title: (item.name as string) || (item.title as string) || "",
      url: (item.url as string) || (item.link as string) || "",
      snippet: (
        (item.snippet as string) ||
        (item.description as string) ||
        ""
      ).slice(0, 500),
    };
  });
}
```

**Verify parser tests pass:**

```bash
pnpm vitest run tests/providers/parsers.test.ts
```

---

### Step 4: Implement the provider

- [ ] Create `src/providers/langsearch.ts`

```typescript
import { createHttpSearchProvider } from "./http-adapter.ts";
import { parseLangSearchResults } from "./parsers.ts";
import type { ProviderMeta } from "./types.ts";

export const providerMeta: ProviderMeta = {
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
};
```

**Verify provider tests pass:**

```bash
pnpm vitest run tests/providers/langsearch.test.ts
```

---

### Step 5: Register the provider

- [ ] Add import and array entry to `src/providers/all.ts`

Add after the existing imports:

```typescript
import { providerMeta as langsearch } from "./langsearch.ts";
```

Add `langsearch` to the `allProviders` array (alphabetical position, after `jina`).

**Verify all tests pass:**

```bash
pnpm vitest run tests/providers/all.test.ts
```

---

### Step 6: Full verification

- [ ] Run full test suite, lint, and typecheck

```bash
pnpm vitest run
pnpm run lint
pnpm run typecheck
```

All must pass with zero errors.

---

### Step 7: Commit

- [ ] Create atomic commit

```bash
git add src/providers/langsearch.ts src/providers/parsers.ts src/providers/all.ts tests/providers/langsearch.test.ts tests/providers/parsers.test.ts
git commit -m "feat(providers): add LangSearch search provider (Phase 3)

- Add langsearch.ts using createHttpSearchProvider with POST method
- Add parseLangSearchResults parser to parsers.ts
- Register in all.ts
- Tests for parser (nested response, fallback, malformed) and provider"
```
