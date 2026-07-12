# Search Providers Expansion — Phase 4: Brave LLM Context Provider

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Brave LLM Context as a tier 1 search provider with configurable `tokenBudget`, sharing the same API key as the existing `brave` provider.

**Architecture:** Single provider file + parser addition + registration + config type extension. Uses `createHttpSearchProvider` with custom `buildHeaders` (X-Subscription-Token auth) and `buildBody` (optional token_budget). Parser extracts search results from Brave's `chunks` response format.

**Tech Stack:** TypeScript, Vitest, native `fetch`, `createHttpSearchProvider` factory

**Parent Plan:** `2026-07-12-search-providers.md`
**Prerequisite:** Phase 3 complete (langsearch registered, parsers.ts has langsearch parser)

---

## Key Reference Files

| File                            | Purpose                                         |
| ------------------------------- | ----------------------------------------------- |
| `src/providers/http-adapter.ts` | `createHttpSearchProvider()` factory            |
| `src/providers/parsers.ts`      | Pure parser functions                           |
| `src/providers/all.ts`          | Provider registration array                     |
| `src/providers/types.ts`        | `ProviderMeta`, `SearchResult` types            |
| `src/config.ts`                 | `ProviderConfigEntry` interface                 |
| `src/providers/brave.ts`        | Reference for X-Subscription-Token auth pattern |
| `tests/helpers.ts`              | `stubFetch()` test helper                       |

---

## Steps

### Step 1: Extend ProviderConfigEntry with tokenBudget

- [ ] Add `tokenBudget?: number` to `ProviderConfigEntry` in `src/config.ts`

In `src/config.ts`, add `tokenBudget` to the interface:

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
  it("parses chunks with source metadata", () => {
    const data = {
      chunks: [
        {
          content: "Brave Search is a privacy-focused search engine.",
          relevance_score: 0.95,
          source: { url: "https://brave.com/about", title: "About Brave" },
          type: "web",
        },
        {
          content: "Brave offers AI-powered search summaries.",
          relevance_score: 0.88,
          source: { url: "https://brave.com/ai", title: "Brave AI" },
          type: "web",
        },
      ],
    };
    const results = parseBraveLlmResults(data);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "About Brave",
      url: "https://brave.com/about",
      snippet: "Brave Search is a privacy-focused search engine.",
    });
    expect(results[1]).toEqual({
      title: "Brave AI",
      url: "https://brave.com/ai",
      snippet: "Brave offers AI-powered search summaries.",
    });
  });

  it("returns empty array when chunks is missing", () => {
    expect(parseBraveLlmResults({})).toEqual([]);
    expect(parseBraveLlmResults({ chunks: null })).toEqual([]);
  });

  it("returns empty array for null/undefined input", () => {
    expect(parseBraveLlmResults(null)).toEqual([]);
    expect(parseBraveLlmResults(undefined)).toEqual([]);
  });

  it("handles chunks with missing source gracefully", () => {
    const data = {
      chunks: [
        { content: "Some content without source metadata" },
        { content: "Another chunk", source: { url: "https://example.com" } },
      ],
    };
    const results = parseBraveLlmResults(data);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "",
      url: "",
      snippet: "Some content without source metadata",
    });
    expect(results[1]).toEqual({
      title: "",
      url: "https://example.com",
      snippet: "Another chunk",
    });
  });

  it("truncates content snippets to 500 characters", () => {
    const longContent = "y".repeat(600);
    const data = {
      chunks: [
        {
          content: longContent,
          source: { url: "https://example.com", title: "Long" },
        },
      ],
    };
    const results = parseBraveLlmResults(data);
    expect(results[0].snippet).toHaveLength(500);
  });
});
```

**Verify (expect failure — parser not yet implemented):**

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
    const provider = providerMeta.create("test-key").search!;
    expect(provider.name).toBe("brave-llm");
    expect(provider.label).toBe("Brave LLM Context");
  });

  it("returns normalized search results from chunks", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: {
        chunks: [
          {
            content: "Privacy-first search engine",
            source: { url: "https://brave.com", title: "Brave Search" },
            type: "web",
          },
        ],
      },
    });

    const provider = providerMeta.create("test-key").search!;
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
      body: { chunks: [] },
    });

    const provider = providerMeta.create("my-brave-token").search!;
    await provider.search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers["X-Subscription-Token"]).toBe("my-brave-token");
    expect(fetchCall[1].headers["Content-Type"]).toBe("application/json");
    expect(fetchCall[1].headers["Accept"]).toBe("application/json");
  });

  it("sends POST to correct endpoint with query in body", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: { chunks: [] },
    });

    const provider = providerMeta.create("key").search!;
    await provider.search("my query", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[0]).toBe(
      "https://api.search.brave.com/app/v1/llm/context",
    );
    expect(fetchCall[1].method).toBe("POST");
    const body = JSON.parse(fetchCall[1].body);
    expect(body.query).toBe("my query");
  });

  it("includes token_budget when providerConfig.tokenBudget is set", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: { chunks: [] },
    });

    const provider = providerMeta.create("key", {
      enabled: true,
      tokenBudget: 4096,
    }).search!;
    await provider.search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.token_budget).toBe(4096);
  });

  it("omits token_budget when providerConfig.tokenBudget is not set", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: { chunks: [] },
    });

    const provider = providerMeta.create("key", { enabled: true }).search!;
    await provider.search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.token_budget).toBeUndefined();
  });

  it("omits token_budget when no providerConfig is passed", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      body: { chunks: [] },
    });

    const provider = providerMeta.create("key").search!;
    await provider.search("test", 5);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.token_budget).toBeUndefined();
  });

  it("throws on non-2xx response", async () => {
    fetchStub.addResponse("api.search.brave.com", {
      status: 403,
      body: "Forbidden",
    });

    const provider = providerMeta.create("bad-key").search!;
    await expect(provider.search("test", 5)).rejects.toThrow(
      "Brave LLM Context API error",
    );
  });
});
```

**Verify (expect failure — provider file doesn't exist):**

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
  const d = data as { chunks?: unknown[] };
  const chunks = Array.isArray(d.chunks) ? d.chunks : [];
  return chunks.map((c: unknown) => {
    const chunk = c as Record<string, unknown>;
    const source = (chunk.source as Record<string, unknown>) || {};
    return {
      title: (source.title as string) || "",
      url: (source.url as string) || "",
      snippet: ((chunk.content as string) || "").slice(0, 500),
    };
  });
}
```

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
      endpoint: "https://api.search.brave.com/app/v1/llm/context",
      method: "POST",
      buildHeaders: (apiKey) => ({
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      }),
      buildBody: (query) => {
        const body: Record<string, unknown> = { query };
        if (providerConfig?.tokenBudget)
          body.token_budget = providerConfig.tokenBudget;
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
git add src/config.ts src/providers/brave-llm.ts src/providers/parsers.ts src/providers/all.ts tests/providers/brave-llm.test.ts tests/providers/parsers.test.ts
git commit -m "feat(providers): add Brave LLM Context provider (Phase 4)

- Add brave-llm.ts using createHttpSearchProvider with X-Subscription-Token auth
- Add parseBraveLlmResults parser to parsers.ts (chunks -> SearchResult[])
- Add tokenBudget to ProviderConfigEntry for optional token budget control
- Register in all.ts
- Tests for parser (chunks, empty, malformed source) and provider (with/without tokenBudget, error handling)"
```
