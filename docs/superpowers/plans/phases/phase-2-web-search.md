# Phase 2: DuckDuckGo Provider + web_search Tool

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a working `web_search` tool using DuckDuckGo (free, no key). After this phase, the extension registers a functional search tool that returns real results.

**Spec:** `docs/superpowers/specs/2026-06-27-pi-tools-design.md`

**Depends on:** Phase 1 (types, test helpers, config)

**Produces:** `src/providers/duckduckgo.ts`, `src/tools/web-search.ts`, updated `src/index.ts`

---

## Task 2.1: DuckDuckGo Search Provider

**Files:**
- Create: `src/providers/duckduckgo.ts`
- Test: `tests/providers/duckduckgo.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/providers/duckduckgo.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DuckDuckGoProvider } from "../../src/providers/duckduckgo.ts";
import { stubFetch } from "../helpers.ts";
import type { SearchResult } from "../../src/providers/types.ts";

describe("DuckDuckGoProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;
  let provider: DuckDuckGoProvider;

  beforeEach(() => {
    fetchStub = stubFetch();
    provider = new DuckDuckGoProvider();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct name and label", () => {
    expect(provider.name).toBe("duckduckgo");
    expect(provider.label).toBe("DuckDuckGo");
  });

  it("returns normalized search results", async () => {
    fetchStub.addResponse("duckduckgo.com", {
      body: {
        RelatedTopics: [
          {
            Text: "Example Result - This is a snippet about example",
            FirstURL: "https://example.com",
          },
          {
            Text: "Another Result - More information here",
            FirstURL: "https://another.com",
          },
        ],
      },
    });

    const results = await provider.search("test query", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty("title");
    expect(results[0]).toHaveProperty("url");
    expect(results[0]).toHaveProperty("snippet");
  });

  it("respects maxResults", async () => {
    fetchStub.addResponse("duckduckgo.com", {
      body: {
        RelatedTopics: [
          { Text: "Result 1 - snippet", FirstURL: "https://1.com" },
          { Text: "Result 2 - snippet", FirstURL: "https://2.com" },
          { Text: "Result 3 - snippet", FirstURL: "https://3.com" },
        ],
      },
    });

    const results = await provider.search("test", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("throws on non-2xx response", async () => {
    fetchStub.addResponse("duckduckgo.com", { status: 503, body: "Service Unavailable" });
    await expect(provider.search("test", 5)).rejects.toThrow();
  });

  it("respects abort signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(provider.search("test", 5, controller.signal)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- tests/providers/duckduckgo.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement DuckDuckGo provider**

```typescript
// src/providers/duckduckgo.ts
import type { SearchProvider, SearchResult } from "./types.ts";

interface DDGTopic {
  Text?: string;
  FirstURL?: string;
  Topics?: DDGTopic[];
}

interface DDGResponse {
  RelatedTopics?: DDGTopic[];
  AbstractText?: string;
  AbstractURL?: string;
  AbstractSource?: string;
}

function flattenTopics(topics: DDGTopic[]): DDGTopic[] {
  const flat: DDGTopic[] = [];
  for (const topic of topics) {
    if (topic.FirstURL && topic.Text) {
      flat.push(topic);
    }
    if (topic.Topics) {
      flat.push(...flattenTopics(topic.Topics));
    }
  }
  return flat;
}

function parseTitle(text: string): { title: string; snippet: string } {
  const dashIdx = text.indexOf(" - ");
  if (dashIdx > 0) {
    return { title: text.slice(0, dashIdx), snippet: text.slice(dashIdx + 3) };
  }
  return { title: text, snippet: text };
}

export class DuckDuckGoProvider implements SearchProvider {
  readonly name = "duckduckgo";
  readonly label = "DuckDuckGo";

  async search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
  ): Promise<SearchResult[]> {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const response = await fetch(url, { signal });

    if (!response.ok) {
      throw new Error(`DuckDuckGo API error: ${response.status} ${response.statusText}`);
    }

    const data: DDGResponse = await response.json();
    const topics = flattenTopics(data.RelatedTopics ?? []);
    const results: SearchResult[] = [];

    // Include abstract if available
    if (data.AbstractText && data.AbstractURL) {
      results.push({
        title: data.AbstractSource ?? "Abstract",
        url: data.AbstractURL,
        snippet: data.AbstractText,
      });
    }

    for (const topic of topics) {
      if (results.length >= maxResults) break;
      if (!topic.Text || !topic.FirstURL) continue;
      const { title, snippet } = parseTitle(topic.Text);
      results.push({ title, url: topic.FirstURL, snippet });
    }

    return results.slice(0, maxResults);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test -- tests/providers/duckduckgo.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/duckduckgo.ts tests/providers/duckduckgo.test.ts
git commit -m "feat: add DuckDuckGo search provider"
```

## Task 2.2: web_search Tool Definition

**Files:**
- Create: `src/tools/web-search.ts`
- Test: `tests/tools/web-search.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/tools/web-search.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWebSearchTool } from "../../src/tools/web-search.ts";
import { DuckDuckGoProvider } from "../../src/providers/duckduckgo.ts";
import { stubFetch } from "../helpers.ts";
import { makeCtx } from "../helpers.ts";

describe("web_search tool", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
    fetchStub.addResponse("duckduckgo.com", {
      body: {
        RelatedTopics: [
          { Text: "TypeScript - A typed superset of JavaScript", FirstURL: "https://typescriptlang.org" },
          { Text: "MDN Web Docs - Web technology reference", FirstURL: "https://developer.mozilla.org" },
        ],
      },
    });
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct tool metadata", () => {
    const providers = { duckduckgo: new DuckDuckGoProvider() };
    const tool = createWebSearchTool(() => providers.duckduckgo);
    expect(tool.name).toBe("web_search");
    expect(tool.label).toBe("Web Search");
    expect(tool.parameters).toBeDefined();
  });

  it("executes search and returns formatted results", async () => {
    const provider = new DuckDuckGoProvider();
    const tool = createWebSearchTool(() => provider);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-1",
      { query: "typescript" },
      undefined,
      undefined,
      ctx,
    );
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content[0]).toHaveProperty("type", "text");
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("TypeScript");
  });

  it("returns error result on provider failure", async () => {
    fetchStub.restore();
    const stub2 = stubFetch();
    stub2.addResponse("duckduckgo.com", { status: 500, body: "Server Error" });

    const provider = new DuckDuckGoProvider();
    const tool = createWebSearchTool(() => provider);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-2",
      { query: "test" },
      undefined,
      undefined,
      ctx,
    );
    // Tool should not throw — it returns an error in content
    expect(result.content[0]).toHaveProperty("type", "text");
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text.toLowerCase()).toContain("error");

    stub2.restore();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- tests/tools/web-search.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement web_search tool**

```typescript
// src/tools/web-search.ts
import { Type, type Static } from "typebox";
import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { SearchProvider, SearchResult } from "../providers/types.ts";
import { sanitizeError } from "../utils/errors.ts";

const WebSearchParams = Type.Object({
  query: Type.String({ description: "Search query" }),
  numResults: Type.Optional(
    Type.Number({ minimum: 1, maximum: 20, default: 5, description: "Number of results (1-20, default 5)" }),
  ),
  provider: Type.Optional(
    Type.String({ description: "Provider name or 'auto' (default)" }),
  ),
});

type WebSearchInput = Static<typeof WebSearchParams>;

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

export function createWebSearchTool(
  resolveProvider: (name?: string) => SearchProvider,
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
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      try {
        const provider = resolveProvider(params.provider);
        const maxResults = params.numResults ?? 5;
        const results = await provider.search(params.query, maxResults, signal ?? undefined);
        const text = formatResults(results);

        // Record successful usage for quota tracking (increment on success only)
        onSuccess?.(provider.name);

        return {
          content: [{ type: "text" as const, text }],
          details: { provider: provider.name, resultCount: results.length },
        };
      } catch (error) {
        const msg = sanitizeError(error);
        return {
          content: [{ type: "text" as const, text: `Search error: ${msg}` }],
          details: { provider: "unknown", resultCount: 0 },
        };
      }
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test -- tests/tools/web-search.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Wire up in index.ts**

Replace the contents of `src/index.ts`:

```typescript
// src/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig, resolveApiKey } from "./config.ts";
import { DuckDuckGoProvider } from "./providers/duckduckgo.ts";
import type { SearchProvider } from "./providers/types.ts";
import { createWebSearchTool } from "./tools/web-search.ts";

export default function createExtension(pi: ExtensionAPI): void {
  const config = loadConfig();
  const duckduckgo = new DuckDuckGoProvider();

  function resolveSearchProvider(name?: string): SearchProvider {
    // Phase 2: only DuckDuckGo. Phase 5 adds the full registry.
    return duckduckgo;
  }

  pi.registerTool(createWebSearchTool(resolveSearchProvider));
}
```

- [ ] **Step 6: Update existing test**

```typescript
// tests/index.test.ts
import { describe, expect, it } from "vitest";
import createExtension from "../src/index.ts";
import { createMockPi } from "./helpers.ts";

describe("tools extension", () => {
  it("exports a function", () => {
    expect(typeof createExtension).toBe("function");
  });

  it("registers web_search tool", () => {
    const pi = createMockPi();
    createExtension(pi as any);
    expect(pi.tools.some((t) => t.name === "web_search")).toBe(true);
  });
});
```

- [ ] **Step 7: Run all tests**

Run: `pnpm check`
Expected: All lint, typecheck, and tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/tools/web-search.ts src/index.ts tests/tools/web-search.test.ts tests/index.test.ts
git commit -m "feat: add web_search tool with DuckDuckGo provider"
```

## Phase 2 Checkpoint

The extension now registers a functional `web_search` tool. When loaded by Pi, agents can search the web using DuckDuckGo.
