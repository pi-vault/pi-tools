# Search Providers Phase 6: Parser Extraction

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract inline response parsing from 11 existing providers into pure functions in `src/providers/parsers.ts`, with full test coverage.

**Architecture:** Each provider's inline `extractResults` lambda or class-embedded parsing logic moves to a named export in `parsers.ts`. The provider file then imports and references the parser. This standardizes snippet truncation to 500 chars while enabling isolated unit testing of parsers.

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
  // 1. Guard: if (!data || typeof data !== "object") return [];
  // 2. Cast data with Record<string, unknown> safe access
  // 3. Extract results array (return [] if missing/malformed)
  // 4. Map to SearchResult[] with snippet truncation to 500 chars
  // 5. Pure: no HTTP, no side effects, no imports beyond types
}
```

- Input: `(data: unknown): SearchResult[]`
- Returns `[]` on null, undefined, non-object, or malformed input
- Truncates snippets to 500 chars via: `snippet.slice(0, 500)`
- Uses `(field as string) || ""` pattern (matches existing parsers.ts style)
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
export function parseBraveResults(data: unknown): SearchResult[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const web = d.web;
  if (!web || typeof web !== "object") return [];
  const rawResults = (web as Record<string, unknown>).results;
  if (!Array.isArray(rawResults)) return [];
  return rawResults.map((r: unknown) => {
    const item = r as Record<string, unknown>;
    return {
      title: (item.title as string) || "",
      url: (item.url as string) || "",
      snippet: ((item.description as string) || "").slice(0, 500),
    };
  });
}
```

- [ ] **Step 2:** Add test to `tests/providers/parsers.test.ts`

```typescript
describe("parseBraveResults", () => {
  it("extracts results from valid response", () => {
    const data = {
      web: {
        results: [
          { title: "Brave Result", url: "https://brave.com", description: "A snippet" },
          { title: "Second", url: "https://example.com", description: "Another" },
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
    expect(parseBraveResults({ web: { results: "not-array" } })).toEqual([]);
  });

  it("truncates snippets to 500 chars", () => {
    const long = "x".repeat(600);
    const data = { web: { results: [{ title: "T", url: "http://u", description: long }] } };
    const results = parseBraveResults(data);
    expect(results[0].snippet).toHaveLength(500);
  });

  it("handles items with missing fields gracefully", () => {
    const data = { web: { results: [{ title: "Only Title" }, {}] } };
    const results = parseBraveResults(data);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ title: "Only Title", url: "", snippet: "" });
    expect(results[1]).toEqual({ title: "", url: "", snippet: "" });
  });
});
```

- [ ] **Step 3:** Update `src/providers/brave.ts` to import and use the parser

```typescript
// Replace the extractResults inline lambda with:
import { parseBraveResults } from "./parsers.ts";

// In the config object:
      extractResults: parseBraveResults,
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
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const rawResults = d.organic;
  if (!Array.isArray(rawResults)) return [];
  return rawResults.map((r: unknown) => {
    const item = r as Record<string, unknown>;
    return {
      title: (item.title as string) || "",
      url: (item.link as string) || "",
      snippet: ((item.snippet as string) || "").slice(0, 500),
    };
  });
}
```

- [ ] **Step 2:** Add test to `tests/providers/parsers.test.ts`

```typescript
describe("parseSerperResults", () => {
  it("extracts results from valid response", () => {
    const data = {
      organic: [
        { title: "Google Result", link: "https://google.com/1", snippet: "A snippet" },
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
    expect(parseSerperResults({ organic: "not-array" })).toEqual([]);
  });

  it("truncates snippets to 500 chars", () => {
    const long = "y".repeat(600);
    const data = { organic: [{ title: "T", link: "http://u", snippet: long }] };
    const results = parseSerperResults(data);
    expect(results[0].snippet).toHaveLength(500);
  });

  it("handles items with missing fields gracefully", () => {
    const data = { organic: [{ title: "Only Title" }, {}] };
    const results = parseSerperResults(data);
    expect(results[0]).toEqual({ title: "Only Title", url: "", snippet: "" });
    expect(results[1]).toEqual({ title: "", url: "", snippet: "" });
  });
});
```

- [ ] **Step 3:** Update `src/providers/serper.ts`

```typescript
// Add import:
import { parseSerperResults } from "./parsers.ts";

// Replace the extractResults inline lambda:
      extractResults: parseSerperResults,
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
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const rawResults = d.organic;
  if (!Array.isArray(rawResults)) return [];
  return rawResults.map((r: unknown) => {
    const item = r as Record<string, unknown>;
    return {
      title: (item.title as string) || "",
      url: (item.url as string) || "",
      snippet: ((item.description as string) || "").slice(0, 500),
    };
  });
}
```

- [ ] **Step 2:** Add test to `tests/providers/parsers.test.ts`

```typescript
describe("parseWebSearchApiResults", () => {
  it("extracts results from valid response", () => {
    const data = {
      organic: [
        { title: "WebSearch Result", url: "https://example.com", description: "Web snippet" },
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
    expect(parseWebSearchApiResults({ organic: "not-array" })).toEqual([]);
  });

  it("truncates snippets to 500 chars", () => {
    const long = "z".repeat(600);
    const data = { organic: [{ title: "T", url: "http://u", description: long }] };
    const results = parseWebSearchApiResults(data);
    expect(results[0].snippet).toHaveLength(500);
  });

  it("handles items with missing fields gracefully", () => {
    const data = { organic: [{ title: "Only Title" }, {}] };
    const results = parseWebSearchApiResults(data);
    expect(results[0]).toEqual({ title: "Only Title", url: "", snippet: "" });
    expect(results[1]).toEqual({ title: "", url: "", snippet: "" });
  });
});
```

- [ ] **Step 3:** Update `src/providers/websearchapi.ts`

```typescript
// Add import:
import { parseWebSearchApiResults } from "./parsers.ts";

// Replace the extractResults inline lambda:
      extractResults: parseWebSearchApiResults,
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
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const choices = d.choices as Array<Record<string, unknown>> | undefined;
  const message = choices?.[0]?.message as Record<string, unknown> | undefined;
  const answer = (message?.content as string) || "";
  const citations = Array.isArray(d.citations) ? (d.citations as string[]) : [];
  if (!answer) return [];
  return [
    { title: "Perplexity Answer", url: "", snippet: answer.slice(0, 500) },
    ...citations.map((url) => ({
      title: (url as string) || "",
      url: (url as string) || "",
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
    expect(parsePerplexityResults({ choices: [{ message: { content: "" } }] })).toEqual([]);
    expect(parsePerplexityResults({})).toEqual([]);
  });

  it("returns [] for malformed input", () => {
    expect(parsePerplexityResults(null)).toEqual([]);
    expect(parsePerplexityResults(undefined)).toEqual([]);
    expect(parsePerplexityResults("string")).toEqual([]);
  });

  it("truncates answer snippet to 500 chars", () => {
    const long = "a".repeat(600);
    const data = { choices: [{ message: { content: long } }], citations: [] };
    const results = parsePerplexityResults(data);
    expect(results[0].snippet).toHaveLength(500);
  });

  it("returns answer only when citations missing", () => {
    const data = { choices: [{ message: { content: "Answer" } }] };
    const results = parsePerplexityResults(data);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Perplexity Answer");
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

Note: The type definitions (UrlCitation, OutputText, MessageOutput, OutputItem) move into the parser function scope since they are only needed for parsing.

- [ ] **Step 1:** Add parser function to `src/providers/parsers.ts`

```typescript
export function parseOpenAINativeResults(data: unknown): SearchResult[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const output = d.output;
  if (!Array.isArray(output)) return [];

  // Find the message output item
  const messageOutput = output.find(
    (item: unknown) =>
      item && typeof item === "object" && (item as Record<string, unknown>).type === "message",
  ) as Record<string, unknown> | undefined;
  if (!messageOutput) return [];

  const content = messageOutput.content;
  if (!Array.isArray(content)) return [];

  // Find the output_text content block
  const textContent = content.find(
    (c: unknown) =>
      c && typeof c === "object" && (c as Record<string, unknown>).type === "output_text",
  ) as Record<string, unknown> | undefined;
  if (!textContent) return [];

  const annotations = textContent.annotations;
  if (!Array.isArray(annotations) || annotations.length === 0) return [];

  // Deduplicate by URL, preserving order
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const ann of annotations) {
    if (!ann || typeof ann !== "object") continue;
    const a = ann as Record<string, unknown>;
    if (a.type !== "url_citation") continue;
    const url = (a.url as string) || "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    results.push({ title: (a.title as string) || "", url, snippet: "" });
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
                { type: "url_citation", url: "https://a.com", title: "A duplicate" },
              ],
            },
          ],
        },
      ],
    };
    const results = parseOpenAINativeResults(data);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ title: "A", url: "https://a.com", snippet: "" });
    expect(results[1]).toEqual({ title: "B", url: "https://b.com", snippet: "" });
  });

  it("returns [] when no message output", () => {
    expect(parseOpenAINativeResults({ output: [{ type: "other" }] })).toEqual([]);
  });

  it("returns [] for malformed input", () => {
    expect(parseOpenAINativeResults(null)).toEqual([]);
    expect(parseOpenAINativeResults(undefined)).toEqual([]);
    expect(parseOpenAINativeResults({})).toEqual([]);
    expect(parseOpenAINativeResults("string")).toEqual([]);
  });

  it("returns [] when output is not an array", () => {
    expect(parseOpenAINativeResults({ output: "not-array" })).toEqual([]);
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

  it("skips annotations with empty url", () => {
    const data = {
      output: [
        {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "text",
              annotations: [
                { type: "url_citation", url: "", title: "Empty URL" },
                { type: "url_citation", url: "https://valid.com", title: "Valid" },
              ],
            },
          ],
        },
      ],
    };
    const results = parseOpenAINativeResults(data);
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://valid.com");
  });
});
```

- [ ] **Step 3:** Update `src/providers/openai-native.ts`

Remove the local type definitions (UrlCitation, OutputText, MessageOutput, OutputItem, OpenAIResponsesResult) and replace with parser import:

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

Note: DuckDuckGo is a custom class provider using subprocess. The parser extracts the JSON-to-SearchResult mapping from the `search()` method. The input is already validated as an array by the provider before calling the parser.

- [ ] **Step 1:** Add parser function to `src/providers/parsers.ts`

```typescript
export function parseDuckDuckGoResults(data: unknown): SearchResult[] {
  if (!Array.isArray(data)) return [];
  return data.map((r: unknown) => {
    const item = r as Record<string, unknown>;
    return {
      title: (item.title as string) || "",
      url: (item.href as string) || "",
      snippet: ((item.body as string) || "").slice(0, 500),
    };
  });
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

  it("handles items with missing fields gracefully", () => {
    const data = [{ title: "Only Title" }, {}];
    const results = parseDuckDuckGoResults(data);
    expect(results[0]).toEqual({ title: "Only Title", url: "", snippet: "" });
    expect(results[1]).toEqual({ title: "", url: "", snippet: "" });
  });
});
```

- [ ] **Step 3:** Update `src/providers/duckduckgo.ts` — replace inline mapping with parser call

Add import at top:

```typescript
import { parseDuckDuckGoResults } from "./parsers.ts";
```

Replace in the `search()` method (lines 71-75):

```typescript
// Before:
return data.slice(0, maxResults).map((r) => ({
  title: r.title,
  url: r.href,
  snippet: r.body,
}));

// After:
return parseDuckDuckGoResults(data).slice(0, maxResults);
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

Note: Exa is a custom class provider. The parser extracts the result mapping from `search()`. Leave `codeSearch()` unchanged (it has different semantics with `category: "code"` but identical mapping — it can use the same parser if desired, but the plan keeps it separate to minimize diff).

- [ ] **Step 1:** Add parser function to `src/providers/parsers.ts`

```typescript
export function parseExaResults(data: unknown): SearchResult[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const rawResults = d.results;
  if (!Array.isArray(rawResults)) return [];
  return rawResults.map((r: unknown) => {
    const item = r as Record<string, unknown>;
    return {
      title: (item.title as string) || "",
      url: (item.url as string) || "",
      snippet: ((item.text as string) || "").slice(0, 500),
    };
  });
}
```

- [ ] **Step 2:** Add test to `tests/providers/parsers.test.ts`

```typescript
describe("parseExaResults", () => {
  it("extracts results from valid response", () => {
    const data = {
      results: [
        { title: "Exa Result", url: "https://exa.ai/1", text: "Content snippet" },
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
    expect(parseExaResults({ results: "not-array" })).toEqual([]);
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

// In search() method, replace (lines 71-75):
//   return (data.results ?? []).slice(0, maxResults).map((r) => ({
//     title: r.title,
//     url: r.url,
//     snippet: r.text ?? "",
//   }));
// With:
return parseExaResults(data).slice(0, maxResults);
```

Note: Leave `codeSearch()` unchanged — it can optionally be refactored to use the same parser in a follow-up.

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
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const rawData = d.data;
  if (!Array.isArray(rawData)) return [];
  return rawData.map((r: unknown) => {
    const item = r as Record<string, unknown>;
    const description = (item.description as string) || "";
    const markdown = (item.markdown as string) || "";
    return {
      title: (item.title as string) || "",
      url: (item.url as string) || "",
      snippet: (description || markdown.slice(0, 200)).slice(0, 500),
    };
  });
}
```

- [ ] **Step 2:** Add test to `tests/providers/parsers.test.ts`

```typescript
describe("parseFirecrawlResults", () => {
  it("extracts results with description", () => {
    const data = {
      data: [
        { title: "Fire Result", url: "https://fire.dev/1", description: "A desc" },
      ],
    };
    const results = parseFirecrawlResults(data);
    expect(results).toHaveLength(1);
    expect(results[0].snippet).toBe("A desc");
  });

  it("falls back to markdown when no description", () => {
    const data = {
      data: [{ title: "T", url: "http://u", markdown: "# Heading\nContent here" }],
    };
    const results = parseFirecrawlResults(data);
    expect(results[0].snippet).toBe("# Heading\nContent here");
  });

  it("truncates markdown fallback to 200 chars before 500 limit", () => {
    const longMarkdown = "m".repeat(300);
    const data = { data: [{ title: "T", url: "http://u", markdown: longMarkdown }] };
    const results = parseFirecrawlResults(data);
    expect(results[0].snippet).toHaveLength(200);
  });

  it("returns [] for malformed input", () => {
    expect(parseFirecrawlResults(null)).toEqual([]);
    expect(parseFirecrawlResults(undefined)).toEqual([]);
    expect(parseFirecrawlResults({})).toEqual([]);
    expect(parseFirecrawlResults({ data: "not-array" })).toEqual([]);
  });

  it("truncates description snippets to 500 chars", () => {
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

// In search() method, replace (lines 50-54):
//   return (data.data ?? []).slice(0, maxResults).map((r) => ({
//     title: r.title,
//     url: r.url,
//     snippet: r.description ?? r.markdown?.slice(0, 200) ?? "",
//   }));
// With:
return parseFirecrawlResults(data).slice(0, maxResults);
```

Note: The `FirecrawlSearchResponse` interface can be removed since the parser handles the shape internally.

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
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const rawData = d.data;
  if (!Array.isArray(rawData)) return [];
  return rawData.map((r: unknown) => {
    const item = r as Record<string, unknown>;
    return {
      title: (item.title as string) || "",
      url: (item.url as string) || "",
      snippet: ((item.description as string) || "").slice(0, 500),
    };
  });
}
```

- [ ] **Step 2:** Add test to `tests/providers/parsers.test.ts`

```typescript
describe("parseJinaResults", () => {
  it("extracts results from valid response", () => {
    const data = {
      data: [
        { title: "Jina Result", url: "https://jina.ai/1", description: "Jina snippet" },
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
    expect(parseJinaResults({ data: "not-array" })).toEqual([]);
  });

  it("truncates snippets to 500 chars", () => {
    const long = "j".repeat(600);
    const data = { data: [{ title: "T", url: "http://u", description: long }] };
    const results = parseJinaResults(data);
    expect(results[0].snippet).toHaveLength(500);
  });

  it("handles items with missing fields gracefully", () => {
    const data = { data: [{ title: "Only Title" }, {}] };
    const results = parseJinaResults(data);
    expect(results[0]).toEqual({ title: "Only Title", url: "", snippet: "" });
    expect(results[1]).toEqual({ title: "", url: "", snippet: "" });
  });
});
```

- [ ] **Step 3:** Update `src/providers/jina.ts` — replace inline mapping in `search()`

```typescript
// Add import at top:
import { parseJinaResults } from "./parsers.ts";

// In search() method, replace (lines 55-59):
//   return (data.data ?? []).slice(0, maxResults).map((item) => ({
//     title: item.title,
//     url: item.url,
//     snippet: item.description,
//   }));
// With:
return parseJinaResults(data).slice(0, maxResults);
```

Note: The `JinaSearchResponse` interface can be removed since the parser handles the shape internally.

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
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const rawResults = d.results;
  if (!Array.isArray(rawResults)) return [];
  return rawResults.map((r: unknown) => {
    const item = r as Record<string, unknown>;
    return {
      title: (item.title as string) || "",
      url: (item.url as string) || "",
      snippet: ((item.content as string) || "").slice(0, 500),
    };
  });
}
```

- [ ] **Step 2:** Add test to `tests/providers/parsers.test.ts`

```typescript
describe("parseTavilyResults", () => {
  it("extracts results from valid response", () => {
    const data = {
      results: [
        { title: "Tavily Result", url: "https://tavily.com/1", content: "Tavily snippet" },
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
    expect(parseTavilyResults({ results: "not-array" })).toEqual([]);
  });

  it("truncates snippets to 500 chars", () => {
    const long = "t".repeat(600);
    const data = { results: [{ title: "T", url: "http://u", content: long }] };
    const results = parseTavilyResults(data);
    expect(results[0].snippet).toHaveLength(500);
  });

  it("handles items with missing fields gracefully", () => {
    const data = { results: [{ title: "Only Title" }, {}] };
    const results = parseTavilyResults(data);
    expect(results[0]).toEqual({ title: "Only Title", url: "", snippet: "" });
    expect(results[1]).toEqual({ title: "", url: "", snippet: "" });
  });
});
```

- [ ] **Step 3:** Update `src/providers/tavily.ts` — replace inline mapping in `search()`

```typescript
// Add import at top:
import { parseTavilyResults } from "./parsers.ts";

// In search() method, replace (lines 57-61):
//   return (data.results ?? []).slice(0, maxResults).map((r) => ({
//     title: r.title,
//     url: r.url,
//     snippet: r.content,
//   }));
// With:
return parseTavilyResults(data).slice(0, maxResults);
```

Note: The `TavilySearchResponse` interface can be removed since the parser handles the shape internally.

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
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const rawResults = d.results;
  if (!Array.isArray(rawResults)) return [];
  return rawResults.map((r: unknown) => {
    const item = r as Record<string, unknown>;
    return {
      title: (item.title as string) || "",
      url: (item.url as string) || "",
      snippet: ((item.content as string) || "").slice(0, 500),
    };
  });
}
```

- [ ] **Step 2:** Add test to `tests/providers/parsers.test.ts`

```typescript
describe("parseSearxngResults", () => {
  it("extracts results from valid response", () => {
    const data = {
      results: [
        { title: "SearXNG Result", url: "https://searx.info/1", content: "SearX snippet" },
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
    expect(parseSearxngResults({ results: "not-array" })).toEqual([]);
  });

  it("truncates snippets to 500 chars", () => {
    const long = "s".repeat(600);
    const data = { results: [{ title: "T", url: "http://u", content: long }] };
    const results = parseSearxngResults(data);
    expect(results[0].snippet).toHaveLength(500);
  });

  it("handles items with missing fields gracefully", () => {
    const data = { results: [{ title: "Only Title" }, {}] };
    const results = parseSearxngResults(data);
    expect(results[0]).toEqual({ title: "Only Title", url: "", snippet: "" });
    expect(results[1]).toEqual({ title: "", url: "", snippet: "" });
  });
});
```

- [ ] **Step 3:** Update `src/providers/searxng.ts` — replace inline mapping in `search()`

```typescript
// Add import at top:
import { parseSearxngResults } from "./parsers.ts";

// In search() method, replace (lines 57-61):
//   return (data.results ?? []).slice(0, maxResults).map((r) => ({
//     title: r.title,
//     url: r.url,
//     snippet: r.content,
//   }));
// With:
return parseSearxngResults(data).slice(0, maxResults);
```

Note: The `SearXNGSearchResponse` interface can be removed since the parser handles the shape internally.

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

After all 11 tasks complete:

```bash
pnpm test
pnpm run lint
pnpm run typecheck
```

All 11 provider parsers now live in `src/providers/parsers.ts` alongside the 7 parsers from Phases 2-5, giving 18 total pure parser functions with full test coverage.
