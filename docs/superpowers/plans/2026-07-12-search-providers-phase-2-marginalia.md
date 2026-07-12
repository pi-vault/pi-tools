# Phase 2: Marginalia Provider + Create parsers.ts

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Marginalia search provider and establish the shared `parsers.ts` module for pure result-extraction functions.

**Prerequisites:**

- Phase 1 (credentials) is complete and merged
- All tests pass: `pnpm test`
- Working branch checked out

---

## Task 1: Create `src/providers/parsers.ts`

- [ ] Create the parsers module with `parseMarginaliaResults`

**File:** `src/providers/parsers.ts`

```typescript
import type { SearchResult } from "./types.ts";

export function parseMarginaliaResults(data: unknown): SearchResult[] {
  if (!data || typeof data !== "object") return [];
  const d = data as { results?: unknown[] };
  const results = Array.isArray(d.results) ? d.results : [];
  return results.map((r: unknown) => {
    const item = r as Record<string, unknown>;
    return {
      title: (item.title as string) || "",
      url: (item.url as string) || "",
      snippet: ((item.description as string) || "").slice(0, 500),
    };
  });
}
```

**Verify:**

```bash
pnpm run typecheck
```

Expected: no type errors related to `parsers.ts`.

---

## Task 2: Write tests for `parseMarginaliaResults`

- [ ] Create test file with parser unit tests (TDD: write tests first, they should fail until Task 1 is complete)

**File:** `tests/providers/parsers.test.ts`

```typescript
import { describe, expect, it } from "vitest";
import { parseMarginaliaResults } from "../../src/providers/parsers.ts";

describe("parseMarginaliaResults", () => {
  it("maps valid response data to SearchResult[]", () => {
    const data = {
      results: [
        {
          title: "Indie Web",
          url: "https://indieweb.org",
          description: "A community of independent web creators",
        },
        {
          title: "Small Tech",
          url: "https://small-tech.org",
          description: "Technology for people",
        },
      ],
    };

    const results = parseMarginaliaResults(data);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "Indie Web",
      url: "https://indieweb.org",
      snippet: "A community of independent web creators",
    });
    expect(results[1]).toEqual({
      title: "Small Tech",
      url: "https://small-tech.org",
      snippet: "Technology for people",
    });
  });

  it("returns empty array for null input", () => {
    expect(parseMarginaliaResults(null)).toEqual([]);
  });

  it("returns empty array for non-object input", () => {
    expect(parseMarginaliaResults("string")).toEqual([]);
    expect(parseMarginaliaResults(42)).toEqual([]);
    expect(parseMarginaliaResults(undefined)).toEqual([]);
  });

  it("returns empty array when results field is missing", () => {
    expect(parseMarginaliaResults({})).toEqual([]);
    expect(parseMarginaliaResults({ other: "field" })).toEqual([]);
  });

  it("returns empty array when results is not an array", () => {
    expect(parseMarginaliaResults({ results: "not-array" })).toEqual([]);
    expect(parseMarginaliaResults({ results: 123 })).toEqual([]);
  });

  it("truncates snippets to 500 characters", () => {
    const longDescription = "x".repeat(600);
    const data = {
      results: [
        {
          title: "Long",
          url: "https://example.com",
          description: longDescription,
        },
      ],
    };

    const results = parseMarginaliaResults(data);

    expect(results[0].snippet).toHaveLength(500);
    expect(results[0].snippet).toBe("x".repeat(500));
  });

  it("handles items with missing fields gracefully", () => {
    const data = {
      results: [{ title: "Only Title" }, { url: "https://only-url.com" }, {}],
    };

    const results = parseMarginaliaResults(data);

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ title: "Only Title", url: "", snippet: "" });
    expect(results[1]).toEqual({
      title: "",
      url: "https://only-url.com",
      snippet: "",
    });
    expect(results[2]).toEqual({ title: "", url: "", snippet: "" });
  });
});
```

**Verify:**

```bash
pnpm vitest run tests/providers/parsers.test.ts
```

Expected: all 7 tests pass.

---

## Task 3: Create `src/providers/marginalia.ts`

- [ ] Create the Marginalia provider module using `createHttpSearchProvider`

**File:** `src/providers/marginalia.ts`

```typescript
import { createHttpSearchProvider } from "./http-adapter.ts";
import { parseMarginaliaResults } from "./parsers.ts";
import type { ProviderMeta } from "./types.ts";

export const providerMeta: ProviderMeta = {
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
};
```

**Verify:**

```bash
pnpm run typecheck
```

Expected: no type errors.

---

## Task 4: Write tests for Marginalia provider

- [ ] Create integration tests for the Marginalia provider

**File:** `tests/providers/marginalia.test.ts`

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { providerMeta } from "../../src/providers/marginalia.ts";
import { stubFetch } from "../helpers.ts";

const makeProvider = (key?: string) => providerMeta.create(key).search!;

describe("MarginaliaProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct metadata", () => {
    expect(providerMeta.name).toBe("marginalia");
    expect(providerMeta.tier).toBe(3);
    expect(providerMeta.monthlyQuota).toBeNull();
    expect(providerMeta.requiresKey).toBe(false);
  });

  it("creates provider with 'public' key when no key provided", () => {
    fetchStub.addResponse("api2.marginalia-search.com", {
      body: { results: [] },
    });

    const provider = makeProvider();
    expect(provider.name).toBe("marginalia");
    expect(provider.label).toBe("Marginalia Search");
  });

  it("returns search results from API response", async () => {
    fetchStub.addResponse("api2.marginalia-search.com", {
      body: {
        results: [
          {
            title: "Indie Web",
            url: "https://indieweb.org",
            description: "Independent web",
          },
          {
            title: "Gemini Protocol",
            url: "gemini://gemini.circumlunar.space",
            description: "A new internet protocol",
          },
        ],
      },
    });

    const results = await makeProvider().search("indie web", 10);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "Indie Web",
      url: "https://indieweb.org",
      snippet: "Independent web",
    });
    expect(results[1]).toEqual({
      title: "Gemini Protocol",
      url: "gemini://gemini.circumlunar.space",
      snippet: "A new internet protocol",
    });
  });

  it("sends correct query parameters", async () => {
    fetchStub.addResponse("api2.marginalia-search.com", {
      body: { results: [] },
    });

    await makeProvider("my-key").search("test query", 20);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const url = fetchCall[0] as string;
    expect(url).toContain("query=test+query");
    expect(url).toContain("count=20");
  });

  it("caps maxResults at 100", async () => {
    fetchStub.addResponse("api2.marginalia-search.com", {
      body: { results: [] },
    });

    await makeProvider().search("test", 200);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const url = fetchCall[0] as string;
    expect(url).toContain("count=100");
  });

  it("sends API-Key header", async () => {
    fetchStub.addResponse("api2.marginalia-search.com", {
      body: { results: [] },
    });

    await makeProvider("my-api-key").search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers["API-Key"]).toBe("my-api-key");
    expect(fetchCall[1].headers["Accept"]).toBe("application/json");
  });

  it("uses 'public' as API-Key when no key provided", async () => {
    fetchStub.addResponse("api2.marginalia-search.com", {
      body: { results: [] },
    });

    await makeProvider().search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers["API-Key"]).toBe("public");
  });

  it("throws on non-200 response", async () => {
    fetchStub.addResponse("api2.marginalia-search.com", {
      status: 503,
      body: "Service Unavailable",
    });

    await expect(makeProvider().search("test", 5)).rejects.toThrow(
      /Marginalia Search API error: 503/,
    );
  });

  it("handles empty results gracefully", async () => {
    fetchStub.addResponse("api2.marginalia-search.com", {
      body: { results: [] },
    });

    const results = await makeProvider().search("obscure query", 10);
    expect(results).toEqual([]);
  });
});
```

**Verify:**

```bash
pnpm vitest run tests/providers/marginalia.test.ts
```

Expected: all 8 tests pass.

---

## Task 5: Register Marginalia in `src/providers/all.ts`

- [ ] Add import and array entry in alphabetical order (after `jina`, before `openaiNative`)

**Edit:** `src/providers/all.ts`

Add import after jina:

```typescript
import { providerMeta as marginalia } from "./marginalia.ts";
```

Add to array after `jina,`:

```typescript
  marginalia,
```

**Result (relevant lines):**

```typescript
import { providerMeta as jina } from "./jina.ts";
import { providerMeta as marginalia } from "./marginalia.ts";
import { providerMeta as openaiNative } from "./openai-native.ts";
```

```typescript
export const allProviders: ProviderMeta[] = [
  brave,
  context7,
  duckduckgo,
  exa,
  exaMcp,
  firecrawl,
  jina,
  marginalia,
  openaiNative,
  parallel,
  perplexity,
  searxng,
  serper,
  tavily,
  websearchapi,
];
```

**Verify:**

```bash
pnpm run typecheck
```

Expected: no type errors.

---

## Task 6: Run full verification

- [ ] Run all tests, lint, and typecheck

```bash
pnpm vitest run tests/providers/parsers.test.ts tests/providers/marginalia.test.ts
```

Expected: all tests pass (7 parser tests + 8 provider tests).

```bash
pnpm test
```

Expected: full test suite passes (no regressions).

```bash
pnpm run lint
```

Expected: no lint errors.

```bash
pnpm run typecheck
```

Expected: no type errors.

---

## Task 7: Commit

- [ ] Stage and commit all Phase 2 changes

```bash
git add src/providers/parsers.ts src/providers/marginalia.ts src/providers/all.ts tests/providers/parsers.test.ts tests/providers/marginalia.test.ts
git commit -m "feat(providers): add Marginalia search provider and parsers.ts module

- Create src/providers/parsers.ts with parseMarginaliaResults extractor
- Create src/providers/marginalia.ts using http-adapter pattern
- Register marginalia in all.ts (tier 3, no key required)
- Add comprehensive tests for parser and provider

Phase 2 of search providers expansion."
```

---

## Files Changed Summary

| Action | File                                 |
| ------ | ------------------------------------ |
| Create | `src/providers/parsers.ts`           |
| Create | `src/providers/marginalia.ts`        |
| Edit   | `src/providers/all.ts`               |
| Create | `tests/providers/parsers.test.ts`    |
| Create | `tests/providers/marginalia.test.ts` |

## Verification Checklist

- [ ] `parseMarginaliaResults` handles null, non-object, missing fields, and long snippets
- [ ] Marginalia provider uses `createHttpSearchProvider` with correct config
- [ ] Provider falls back to `"public"` key when none provided
- [ ] `all.ts` includes marginalia in alphabetical position
- [ ] All new tests pass
- [ ] Full test suite passes (no regressions)
- [ ] Lint passes
- [ ] Typecheck passes
