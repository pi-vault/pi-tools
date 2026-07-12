# Search Providers Phase 6: Parser Extraction

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract inline response parsing from 10 existing providers into pure functions in `src/providers/parsers.ts`, with full test coverage.

**Architecture:** Each provider's inline `extractResults` lambda or class-embedded parsing logic moves to a named export in `parsers.ts`. The provider file then imports and references the parser. This produces zero behavior change while enabling isolated unit testing of parsers.

**Tech Stack:** TypeScript, Vitest, pnpm

**Spec:** `docs/superpowers/specs/2026-07-12-search-providers-design.md` (Phase 6 section)

---

## Prerequisites

- Phases 1-5 complete (parsers.ts exists with: `parseMarginaliaResults`, `parseLangSearchResults`, `parseBraveLlmResults`, `parseLinkupResults`, `parseYouComResults`, `parseFastcrwResults`, `parseSofyaResults`)
- All tests passing: `pnpm test`

## Parser Contract

Every parser function follows this contract:

```typescript
export function parseXxxResults(data: unknown): SearchResult[] {
  // 1. Cast data to expected shape with safe access
  // 2. Extract results array (return [] if missing/malformed)
  // 3. Map to SearchResult[] with snippet truncation
  // 4. Pure: no HTTP, no side effects, no imports beyond types
}
```

- Input: `(data: unknown): SearchResult[]`
- Returns `[]` on malformed/missing input
- Truncates snippets to 500 chars via: `snippet.slice(0, 500)`
- No thrown exceptions on bad input

## Verification Commands

```bash
pnpm vitest run tests/providers/parsers.test.ts   # parser unit tests
pnpm vitest run tests/providers/brave.test.ts     # provider integration (per-provider)
pnpm test                                          # full suite
pnpm run lint
pnpm run typecheck
```

---

## Task 1: Extract `parseBraveResults`

**Files:** `src/providers/parsers.ts`, `src/providers/brave.ts`, `tests/providers/parsers.test.ts`

- [ ] **Step 1:** Add parser function to `src/providers/parsers.ts`

```typescript
// Add to src/providers/parsers.ts

export function parseBraveResults(data: unknown): SearchResult[] {
  const d = data as {
    web?: {
      results: Array<{ title: string; url: string; description: string }>;
    };
  };
  return (d.web?.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: (r.description ?? "").slice(0, 500),
  }));
}
```

- [ ] **Step 2:** Add test to `tests/providers/parsers.test.ts`

```typescript
// Add to tests/providers/parsers.test.ts

import { describe, it, expect } from "vitest";
import { parseBraveResults } from "../../src/providers/parsers.ts";

describe("parseBraveResults", () => {
  it("extracts results from valid response", () => {
    const data = {
      web: {
        results: [
          {
            title: "Brave Result",
            url: "https://brave.com",
            description: "A snippet",
          },
          {
            title: "Second",
            url: "https://example.com",
            description: "Another",
          },
        ],
      },
    };
    const results = parseBraveResults(data);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "Brave Result",
      url: "https://brave.com",
      snippet: "A snippet",
    });
  });

  it("returns [] for malformed input", () => {
    expect(parseBraveResults(null)).toEqual([]);
    expect(parseBraveResults(undefined)).toEqual([]);
    expect(parseBraveResults({})).toEqual([]);
    expect(parseBraveResults({ web: {} })).toEqual([]);
  });

  it("truncates snippets to 500 chars", () => {
    const long = "x".repeat(600);
    const data = {
      web: { results: [{ title: "T", url: "http://u", description: long }] },
    };
    const results = parseBraveResults(data);
    expect(results[0].snippet).toHaveLength(500);
  });
});
```

- [ ] **Step 3:** Update `src/providers/brave.ts` to import and use the parser

```typescript
// src/providers/brave.ts — replace inline extractResults
import { createHttpSearchProvider } from "./http-adapter.ts";
import { applyDomainFilters } from "../utils/filters.ts";
import { parseBraveResults } from "./parsers.ts";
import type { ProviderMeta, SearchFilters } from "./types.ts";

// ... buildFreshness unchanged ...

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
};
```

- [ ] **Step 4:** Verify

```bash
pnpm vitest run tests/providers/parsers.test.ts
pnpm vitest run tests/providers/brave.test.ts
pnpm run typecheck
```

- [ ] **Step 5:** Commit

```bash
git add src/providers/parsers.ts src/providers/brave.ts tests/providers/parsers.test.ts
git commit -m "refactor(parsers): extract parseBraveResults to parsers.ts"
```

---

## Task 2: Extract `parseSerperResults`

**Files:** `src/providers/parsers.ts`, `src/providers/serper.ts`, `tests/providers/parsers.test.ts`

- [ ] **Step 1:** Add parser function to `src/providers/parsers.ts`

```typescript
export function parseSerperResults(data: unknown): SearchResult[] {
  const d = data as {
    organic?: Array<{ title: string; link: string; snippet: string }>;
  };
  return (d.organic ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.link ?? "",
    snippet: (r.snippet ?? "").slice(0, 500),
  }));
}
```

- [ ] **Step 2:** Add test to `tests/providers/parsers.test.ts`

```typescript
describe("parseSerperResults", () => {
  it("extracts results from valid response", () => {
    const data = {
      organic: [
        {
          title: "Google Result",
          link: "https://google.com/1",
          snippet: "A snippet",
        },
      ],
    };
    const results = parseSerperResults(data);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      title: "Google Result",
      url: "https://google.com/1",
      snippet: "A snippet",
    });
  });

  it("returns [] for malformed input", () => {
    expect(parseSerperResults(null)).toEqual([]);
    expect(parseSerperResults(undefined)).toEqual([]);
    expect(parseSerperResults({})).toEqual([]);
  });

  it("truncates snippets to 500 chars", () => {
    const long = "y".repeat(600);
    const data = { organic: [{ title: "T", link: "http://u", snippet: long }] };
    const results = parseSerperResults(data);
    expect(results[0].snippet).toHaveLength(500);
  });
});
```

- [ ] **Step 3:** Update `src/providers/serper.ts`

```typescript
// src/providers/serper.ts — add import, replace inline extractResults
import { createHttpSearchProvider } from "./http-adapter.ts";
import { applyDomainFilters } from "../utils/filters.ts";
import { parseSerperResults } from "./parsers.ts";
import type { ProviderMeta, SearchFilters } from "./types.ts";

// ... isoToMDY and buildTbs unchanged ...

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
      extractResults: parseSerperResults,
    }),
  }),
};
```

- [ ] **Step 4:** Verify

```bash
pnpm vitest run tests/providers/parsers.test.ts
pnpm vitest run tests/providers/serper.test.ts
pnpm run typecheck
```

- [ ] **Step 5:** Commit

```bash
git add src/providers/parsers.ts src/providers/serper.ts tests/providers/parsers.test.ts
git commit -m "refactor(parsers): extract parseSerperResults to parsers.ts"
```

---

## Task 3: Extract `parseWebSearchApiResults`

**Files:** `src/providers/parsers.ts`, `src/providers/websearchapi.ts`, `tests/providers/parsers.test.ts`

- [ ] **Step 1:** Add parser function to `src/providers/parsers.ts`

```typescript
export function parseWebSearchApiResults(data: unknown): SearchResult[] {
  const d = data as {
    organic?: Array<{ title: string; url: string; description: string }>;
  };
  return (d.organic ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: (r.description ?? "").slice(0, 500),
  }));
}
```

- [ ] **Step 2:** Add test to `tests/providers/parsers.test.ts`

```typescript
describe("parseWebSearchApiResults", () => {
  it("extracts results from valid response", () => {
    const data = {
      organic: [
        {
          title: "WebSearch Result",
          url: "https://example.com",
          description: "Web snippet",
        },
      ],
    };
    const results = parseWebSearchApiResults(data);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      title: "WebSearch Result",
      url: "https://example.com",
      snippet: "Web snippet",
    });
  });

  it("returns [] for malformed input", () => {
    expect(parseWebSearchApiResults(null)).toEqual([]);
    expect(parseWebSearchApiResults(undefined)).toEqual([]);
    expect(parseWebSearchApiResults({})).toEqual([]);
  });

  it("truncates snippets to 500 chars", () => {
    const long = "z".repeat(600);
    const data = {
      organic: [{ title: "T", url: "http://u", description: long }],
    };
    const results = parseWebSearchApiResults(data);
    expect(results[0].snippet).toHaveLength(500);
  });
});
```

- [ ] **Step 3:** Update `src/providers/websearchapi.ts`

```typescript
import { createHttpSearchProvider } from "./http-adapter.ts";
import { parseWebSearchApiResults } from "./parsers.ts";
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
      authPrefix: "Bearer ",
      buildBody: (query, maxResults) => ({ query, maxResults }),
      extractResults: parseWebSearchApiResults,
    }),
  }),
};
```

- [ ] **Step 4:** Verify

```bash
pnpm vitest run tests/providers/parsers.test.ts
pnpm vitest run tests/providers/websearchapi.test.ts
pnpm run typecheck
```

- [ ] **Step 5:** Commit

```bash
git add src/providers/parsers.ts src/providers/websearchapi.ts tests/providers/parsers.test.ts
git commit -m "refactor(parsers): extract parseWebSearchApiResults to parsers.ts"
```

---

## Task 4: Extract `parsePerplexityResults`

**Files:** `src/providers/parsers.ts`, `src/providers/perplexity.ts`, `tests/providers/parsers.test.ts`

- [ ] **Step 1:** Add parser function to `src/providers/parsers.ts`

```typescript
export function parsePerplexityResults(data: unknown): SearchResult[] {
  const d = data as {
    choices?: Array<{ message?: { content?: string } }>;
    citations?: string[];
  };
  const answer = d.choices?.[0]?.message?.content ?? "";
  const citations = d.citations ?? [];
  if (!answer) return [];
  return [
    { title: "Perplexity Answer", url: "", snippet: answer.slice(0, 500) },
    ...citations.map((url) => ({
      title: url ?? "",
      url: url ?? "",
      snippet: "",
    })),
  ];
}
```

- [ ] **Step 2:** Add test to `tests/providers/parsers.test.ts`

```typescript
describe("parsePerplexityResults", () => {
  it("extracts answer and citations", () => {
    const data = {
      choices: [{ message: { content: "The answer is 42." } }],
      citations: ["https://source1.com", "https://source2.com"],
    };
    const results = parsePerplexityResults(data);
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({
      title: "Perplexity Answer",
      url: "",
      snippet: "The answer is 42.",
    });
    expect(results[1]).toEqual({
      title: "https://source1.com",
      url: "https://source1.com",
      snippet: "",
    });
  });

  it("returns [] when no answer content", () => {
    expect(
      parsePerplexityResults({ choices: [{ message: { content: "" } }] }),
    ).toEqual([]);
    expect(parsePerplexityResults({})).toEqual([]);
  });

  it("returns [] for malformed input", () => {
    expect(parsePerplexityResults(null)).toEqual([]);
    expect(parsePerplexityResults(undefined)).toEqual([]);
  });

  it("truncates answer snippet to 500 chars", () => {
    const long = "a".repeat(600);
    const data = { choices: [{ message: { content: long } }], citations: [] };
    const results = parsePerplexityResults(data);
    expect(results[0].snippet).toHaveLength(500);
  });
});
```

- [ ] **Step 3:** Update `src/providers/perplexity.ts`

```typescript
import { createHttpSearchProvider } from "./http-adapter.ts";
import { parsePerplexityResults } from "./parsers.ts";
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
      authPrefix: "Bearer ",
      buildBody: (query) => ({
        model: "sonar",
        messages: [{ role: "user", content: query }],
      }),
      extractResults: parsePerplexityResults,
    }),
  }),
};
```

- [ ] **Step 4:** Verify

```bash
pnpm vitest run tests/providers/parsers.test.ts
pnpm vitest run tests/providers/perplexity.test.ts
pnpm run typecheck
```

- [ ] **Step 5:** Commit

```bash
git add src/providers/parsers.ts src/providers/perplexity.ts tests/providers/parsers.test.ts
git commit -m "refactor(parsers): extract parsePerplexityResults to parsers.ts"
```

---

## Task 5: Extract `parseOpenAINativeResults`

**Files:** `src/providers/parsers.ts`, `src/providers/openai-native.ts`, `tests/providers/parsers.test.ts`

- [ ] **Step 1:** Add parser function to `src/providers/parsers.ts`

```typescript
export function parseOpenAINativeResults(data: unknown): SearchResult[] {
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

  const d = data as { output?: OutputItem[] };
  if (!d?.output) return [];

  const messageOutput = d.output.find(
    (item): item is MessageOutput => item.type === "message",
  );
  if (!messageOutput) return [];

  const textContent = messageOutput.content?.find(
    (c): c is OutputText => c.type === "output_text",
  );
  if (!textContent?.annotations?.length) return [];

  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const ann of textContent.annotations) {
    if (ann.type !== "url_citation") continue;
    if (seen.has(ann.url)) continue;
    seen.add(ann.url);
    results.push({ title: ann.title ?? "", url: ann.url, snippet: "" });
  }
  return results;
}
```

- [ ] **Step 2:** Add test to `tests/providers/parsers.test.ts`

```typescript
describe("parseOpenAINativeResults", () => {
  it("extracts deduplicated URL citations", () => {
    const data = {
      output: [
        {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "Here are results",
              annotations: [
                { type: "url_citation", url: "https://a.com", title: "A" },
                { type: "url_citation", url: "https://b.com", title: "B" },
                {
                  type: "url_citation",
                  url: "https://a.com",
                  title: "A duplicate",
                },
              ],
            },
          ],
        },
      ],
    };
    const results = parseOpenAINativeResults(data);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "A",
      url: "https://a.com",
      snippet: "",
    });
    expect(results[1]).toEqual({
      title: "B",
      url: "https://b.com",
      snippet: "",
    });
  });

  it("returns [] when no message output", () => {
    expect(parseOpenAINativeResults({ output: [{ type: "other" }] })).toEqual(
      [],
    );
  });

  it("returns [] for malformed input", () => {
    expect(parseOpenAINativeResults(null)).toEqual([]);
    expect(parseOpenAINativeResults(undefined)).toEqual([]);
    expect(parseOpenAINativeResults({})).toEqual([]);
  });

  it("returns [] when no annotations", () => {
    const data = {
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "No citations" }],
        },
      ],
    };
    expect(parseOpenAINativeResults(data)).toEqual([]);
  });
});
```

- [ ] **Step 3:** Update `src/providers/openai-native.ts`

```typescript
import { createHttpSearchProvider } from "./http-adapter.ts";
import { parseOpenAINativeResults } from "./parsers.ts";
import type { ProviderMeta } from "./types.ts";

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
      authPrefix: "Bearer ",
      buildBody: (query) => ({
        model: "gpt-4.1-nano",
        tools: [{ type: "web_search" }],
        tool_choice: "required",
        input: `Search the web for: ${query}`,
      }),
      extractResults: parseOpenAINativeResults,
    }),
  }),
};
```

- [ ] **Step 4:** Verify

```bash
pnpm vitest run tests/providers/parsers.test.ts
pnpm vitest run tests/providers/openai-native.test.ts
pnpm run typecheck
```

- [ ] **Step 5:** Commit

```bash
git add src/providers/parsers.ts src/providers/openai-native.ts tests/providers/parsers.test.ts
git commit -m "refactor(parsers): extract parseOpenAINativeResults to parsers.ts"
```

---

## Task 6: Extract `parseDuckDuckGoResults`

**Files:** `src/providers/parsers.ts`, `src/providers/duckduckgo.ts`, `tests/providers/parsers.test.ts`

Note: DuckDuckGo is a custom class provider, not an http-adapter user. The parser extracts the JSON-to-SearchResult mapping from the `search()` method.

- [ ] **Step 1:** Add parser function to `src/providers/parsers.ts`

```typescript
export function parseDuckDuckGoResults(data: unknown): SearchResult[] {
  if (!Array.isArray(data)) return [];
  return data.map((r: { title?: string; href?: string; body?: string }) => ({
    title: r.title ?? "",
    url: r.href ?? "",
    snippet: (r.body ?? "").slice(0, 500),
  }));
}
```

- [ ] **Step 2:** Add test to `tests/providers/parsers.test.ts`

```typescript
describe("parseDuckDuckGoResults", () => {
  it("extracts results from valid array", () => {
    const data = [
      { title: "DDG Result", href: "https://ddg.co/1", body: "A snippet" },
      { title: "Second", href: "https://ddg.co/2", body: "Another" },
    ];
    const results = parseDuckDuckGoResults(data);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "DDG Result",
      url: "https://ddg.co/1",
      snippet: "A snippet",
    });
  });

  it("returns [] for non-array input", () => {
    expect(parseDuckDuckGoResults(null)).toEqual([]);
    expect(parseDuckDuckGoResults(undefined)).toEqual([]);
    expect(parseDuckDuckGoResults({})).toEqual([]);
    expect(parseDuckDuckGoResults("string")).toEqual([]);
  });

  it("truncates snippets to 500 chars", () => {
    const long = "d".repeat(600);
    const data = [{ title: "T", href: "http://u", body: long }];
    const results = parseDuckDuckGoResults(data);
    expect(results[0].snippet).toHaveLength(500);
  });
});
```

- [ ] **Step 3:** Update `src/providers/duckduckgo.ts` — replace inline mapping with parser call

Replace in the `search()` method:

```typescript
// Before (lines 71-75):
return data.slice(0, maxResults).map((r) => ({
  title: r.title,
  url: r.href,
  snippet: r.body,
}));

// After:
return parseDuckDuckGoResults(data).slice(0, maxResults);
```

Add import at top:

```typescript
import { parseDuckDuckGoResults } from "./parsers.ts";
```

- [ ] **Step 4:** Verify

```bash
pnpm vitest run tests/providers/parsers.test.ts
pnpm vitest run tests/providers/duckduckgo.test.ts
pnpm run typecheck
```

- [ ] **Step 5:** Commit

```bash
git add src/providers/parsers.ts src/providers/duckduckgo.ts tests/providers/parsers.test.ts
git commit -m "refactor(parsers): extract parseDuckDuckGoResults to parsers.ts"
```

---

## Task 7: Extract `parseExaResults`

**Files:** `src/providers/parsers.ts`, `src/providers/exa.ts`, `tests/providers/parsers.test.ts`

Note: Exa is a custom class provider. The parser extracts the result mapping from `search()`.

- [ ] **Step 1:** Add parser function to `src/providers/parsers.ts`

```typescript
export function parseExaResults(data: unknown): SearchResult[] {
  const d = data as {
    results?: Array<{ title: string; url: string; text?: string }>;
  };
  return (d.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: (r.text ?? "").slice(0, 500),
  }));
}
```

- [ ] **Step 2:** Add test to `tests/providers/parsers.test.ts`

```typescript
describe("parseExaResults", () => {
  it("extracts results from valid response", () => {
    const data = {
      results: [
        {
          title: "Exa Result",
          url: "https://exa.ai/1",
          text: "Content snippet",
        },
      ],
    };
    const results = parseExaResults(data);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      title: "Exa Result",
      url: "https://exa.ai/1",
      snippet: "Content snippet",
    });
  });

  it("handles missing text field", () => {
    const data = { results: [{ title: "T", url: "http://u" }] };
    const results = parseExaResults(data);
    expect(results[0].snippet).toBe("");
  });

  it("returns [] for malformed input", () => {
    expect(parseExaResults(null)).toEqual([]);
    expect(parseExaResults(undefined)).toEqual([]);
    expect(parseExaResults({})).toEqual([]);
  });

  it("truncates snippets to 500 chars", () => {
    const long = "e".repeat(600);
    const data = { results: [{ title: "T", url: "http://u", text: long }] };
    const results = parseExaResults(data);
    expect(results[0].snippet).toHaveLength(500);
  });
});
```

- [ ] **Step 3:** Update `src/providers/exa.ts` — replace inline mapping in `search()` method

```typescript
// Add import at top:
import { parseExaResults } from "./parsers.ts";

// In search() method, replace:
//   return (data.results ?? []).slice(0, maxResults).map((r) => ({
//     title: r.title, url: r.url, snippet: r.text ?? "",
//   }));
// With:
return parseExaResults(data).slice(0, maxResults);
```

Note: Leave the `codeSearch()` method unchanged (it has different semantics — `category: "code"`).

- [ ] **Step 4:** Verify

```bash
pnpm vitest run tests/providers/parsers.test.ts
pnpm vitest run tests/providers/exa.test.ts
pnpm run typecheck
```

- [ ] **Step 5:** Commit

```bash
git add src/providers/parsers.ts src/providers/exa.ts tests/providers/parsers.test.ts
git commit -m "refactor(parsers): extract parseExaResults to parsers.ts"
```

---

## Task 8: Extract `parseFirecrawlResults`

**Files:** `src/providers/parsers.ts`, `src/providers/firecrawl.ts`, `tests/providers/parsers.test.ts`

- [ ] **Step 1:** Add parser function to `src/providers/parsers.ts`

```typescript
export function parseFirecrawlResults(data: unknown): SearchResult[] {
  const d = data as {
    data?: Array<{
      title: string;
      url: string;
      markdown?: string;
      description?: string;
    }>;
  };
  return (d.data ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: (r.description ?? r.markdown?.slice(0, 200) ?? "").slice(0, 500),
  }));
}
```

- [ ] **Step 2:** Add test to `tests/providers/parsers.test.ts`

```typescript
describe("parseFirecrawlResults", () => {
  it("extracts results with description", () => {
    const data = {
      data: [
        {
          title: "Fire Result",
          url: "https://fire.dev/1",
          description: "A desc",
        },
      ],
    };
    const results = parseFirecrawlResults(data);
    expect(results).toHaveLength(1);
    expect(results[0].snippet).toBe("A desc");
  });

  it("falls back to markdown when no description", () => {
    const data = {
      data: [
        { title: "T", url: "http://u", markdown: "# Heading\nContent here" },
      ],
    };
    const results = parseFirecrawlResults(data);
    expect(results[0].snippet).toBe("# Heading\nContent here");
  });

  it("returns [] for malformed input", () => {
    expect(parseFirecrawlResults(null)).toEqual([]);
    expect(parseFirecrawlResults(undefined)).toEqual([]);
    expect(parseFirecrawlResults({})).toEqual([]);
  });

  it("truncates snippets to 500 chars", () => {
    const long = "f".repeat(600);
    const data = { data: [{ title: "T", url: "http://u", description: long }] };
    const results = parseFirecrawlResults(data);
    expect(results[0].snippet).toHaveLength(500);
  });
});
```

- [ ] **Step 3:** Update `src/providers/firecrawl.ts` — replace inline mapping in `search()`

```typescript
// Add import at top:
import { parseFirecrawlResults } from "./parsers.ts";

// In search() method, replace:
//   return (data.data ?? []).slice(0, maxResults).map((r) => ({
//     title: r.title, url: r.url,
//     snippet: r.description ?? r.markdown?.slice(0, 200) ?? "",
//   }));
// With:
return parseFirecrawlResults(data).slice(0, maxResults);
```

- [ ] **Step 4:** Verify

```bash
pnpm vitest run tests/providers/parsers.test.ts
pnpm vitest run tests/providers/firecrawl.test.ts
pnpm run typecheck
```

- [ ] **Step 5:** Commit

```bash
git add src/providers/parsers.ts src/providers/firecrawl.ts tests/providers/parsers.test.ts
git commit -m "refactor(parsers): extract parseFirecrawlResults to parsers.ts"
```

---

## Task 9: Extract `parseJinaResults`

**Files:** `src/providers/parsers.ts`, `src/providers/jina.ts`, `tests/providers/parsers.test.ts`

- [ ] **Step 1:** Add parser function to `src/providers/parsers.ts`

```typescript
export function parseJinaResults(data: unknown): SearchResult[] {
  const d = data as {
    data?: Array<{ title: string; url: string; description: string }>;
  };
  return (d.data ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: (r.description ?? "").slice(0, 500),
  }));
}
```

- [ ] **Step 2:** Add test to `tests/providers/parsers.test.ts`

```typescript
describe("parseJinaResults", () => {
  it("extracts results from valid response", () => {
    const data = {
      data: [
        {
          title: "Jina Result",
          url: "https://jina.ai/1",
          description: "Jina snippet",
        },
      ],
    };
    const results = parseJinaResults(data);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      title: "Jina Result",
      url: "https://jina.ai/1",
      snippet: "Jina snippet",
    });
  });

  it("returns [] for malformed input", () => {
    expect(parseJinaResults(null)).toEqual([]);
    expect(parseJinaResults(undefined)).toEqual([]);
    expect(parseJinaResults({})).toEqual([]);
  });

  it("truncates snippets to 500 chars", () => {
    const long = "j".repeat(600);
    const data = { data: [{ title: "T", url: "http://u", description: long }] };
    const results = parseJinaResults(data);
    expect(results[0].snippet).toHaveLength(500);
  });
});
```

- [ ] **Step 3:** Update `src/providers/jina.ts` — replace inline mapping in `search()`

```typescript
// Add import at top:
import { parseJinaResults } from "./parsers.ts";

// In search() method, replace:
//   return (data.data ?? []).slice(0, maxResults).map((item) => ({
//     title: item.title, url: item.url, snippet: item.description,
//   }));
// With:
return parseJinaResults(data).slice(0, maxResults);
```

- [ ] **Step 4:** Verify

```bash
pnpm vitest run tests/providers/parsers.test.ts
pnpm vitest run tests/providers/jina.test.ts
pnpm run typecheck
```

- [ ] **Step 5:** Commit

```bash
git add src/providers/parsers.ts src/providers/jina.ts tests/providers/parsers.test.ts
git commit -m "refactor(parsers): extract parseJinaResults to parsers.ts"
```

---

## Task 10: Extract `parseTavilyResults`

**Files:** `src/providers/parsers.ts`, `src/providers/tavily.ts`, `tests/providers/parsers.test.ts`

- [ ] **Step 1:** Add parser function to `src/providers/parsers.ts`

```typescript
export function parseTavilyResults(data: unknown): SearchResult[] {
  const d = data as {
    results?: Array<{ title: string; url: string; content: string }>;
  };
  return (d.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: (r.content ?? "").slice(0, 500),
  }));
}
```

- [ ] **Step 2:** Add test to `tests/providers/parsers.test.ts`

```typescript
describe("parseTavilyResults", () => {
  it("extracts results from valid response", () => {
    const data = {
      results: [
        {
          title: "Tavily Result",
          url: "https://tavily.com/1",
          content: "Tavily snippet",
        },
      ],
    };
    const results = parseTavilyResults(data);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      title: "Tavily Result",
      url: "https://tavily.com/1",
      snippet: "Tavily snippet",
    });
  });

  it("returns [] for malformed input", () => {
    expect(parseTavilyResults(null)).toEqual([]);
    expect(parseTavilyResults(undefined)).toEqual([]);
    expect(parseTavilyResults({})).toEqual([]);
  });

  it("truncates snippets to 500 chars", () => {
    const long = "t".repeat(600);
    const data = { results: [{ title: "T", url: "http://u", content: long }] };
    const results = parseTavilyResults(data);
    expect(results[0].snippet).toHaveLength(500);
  });
});
```

- [ ] **Step 3:** Update `src/providers/tavily.ts` — replace inline mapping in `search()`

```typescript
// Add import at top:
import { parseTavilyResults } from "./parsers.ts";

// In search() method, replace:
//   return (data.results ?? []).slice(0, maxResults).map((r) => ({
//     title: r.title, url: r.url, snippet: r.content,
//   }));
// With:
return parseTavilyResults(data).slice(0, maxResults);
```

- [ ] **Step 4:** Verify

```bash
pnpm vitest run tests/providers/parsers.test.ts
pnpm vitest run tests/providers/tavily.test.ts
pnpm run typecheck
```

- [ ] **Step 5:** Commit

```bash
git add src/providers/parsers.ts src/providers/tavily.ts tests/providers/parsers.test.ts
git commit -m "refactor(parsers): extract parseTavilyResults to parsers.ts"
```

---

## Task 11: Extract `parseSearxngResults`

**Files:** `src/providers/parsers.ts`, `src/providers/searxng.ts`, `tests/providers/parsers.test.ts`

- [ ] **Step 1:** Add parser function to `src/providers/parsers.ts`

```typescript
export function parseSearxngResults(data: unknown): SearchResult[] {
  const d = data as {
    results?: Array<{ title: string; url: string; content: string }>;
  };
  return (d.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: (r.content ?? "").slice(0, 500),
  }));
}
```

- [ ] **Step 2:** Add test to `tests/providers/parsers.test.ts`

```typescript
describe("parseSearxngResults", () => {
  it("extracts results from valid response", () => {
    const data = {
      results: [
        {
          title: "SearXNG Result",
          url: "https://searx.info/1",
          content: "SearX snippet",
        },
      ],
    };
    const results = parseSearxngResults(data);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      title: "SearXNG Result",
      url: "https://searx.info/1",
      snippet: "SearX snippet",
    });
  });

  it("returns [] for malformed input", () => {
    expect(parseSearxngResults(null)).toEqual([]);
    expect(parseSearxngResults(undefined)).toEqual([]);
    expect(parseSearxngResults({})).toEqual([]);
  });

  it("truncates snippets to 500 chars", () => {
    const long = "s".repeat(600);
    const data = { results: [{ title: "T", url: "http://u", content: long }] };
    const results = parseSearxngResults(data);
    expect(results[0].snippet).toHaveLength(500);
  });
});
```

- [ ] **Step 3:** Update `src/providers/searxng.ts` — replace inline mapping in `search()`

```typescript
// Add import at top:
import { parseSearxngResults } from "./parsers.ts";

// In search() method, replace:
//   return (data.results ?? []).slice(0, maxResults).map((r) => ({
//     title: r.title, url: r.url, snippet: r.content,
//   }));
// With:
return parseSearxngResults(data).slice(0, maxResults);
```

- [ ] **Step 4:** Verify

```bash
pnpm vitest run tests/providers/parsers.test.ts
pnpm vitest run tests/providers/searxng.test.ts
pnpm run typecheck
```

- [ ] **Step 5:** Commit

```bash
git add src/providers/parsers.ts src/providers/searxng.ts tests/providers/parsers.test.ts
git commit -m "refactor(parsers): extract parseSearxngResults to parsers.ts"
```

---

## Final Verification

After all 11 tasks complete (Tasks 1-11 — Task 11 is SearXNG):

```bash
pnpm test
pnpm run lint
pnpm run typecheck
```

All 10 provider parsers now live in `src/providers/parsers.ts` alongside the 7 parsers from Phases 2-5, giving 17 total pure parser functions with full test coverage.
