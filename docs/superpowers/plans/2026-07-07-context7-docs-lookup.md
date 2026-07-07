# Context7 Docs Lookup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `web_docs_search` and `web_docs_fetch` tools backed by the Context7 API, letting the agent look up version-aware library documentation.

**Architecture:** New `DocsProvider` interface added to the provider type system. Context7 client implements it. Registry gains `registerDocs`/`selectDocs`. Two new tool factories follow the same pattern as existing `createCodeSearchTool`. Tools are conditionally registered when `CONTEXT7_API_KEY` is resolved.

**Tech Stack:** TypeScript, Node 24 native fetch, Vitest, existing pi-tools infrastructure (ProviderRegistry, ContentStore, truncateContent).

**Spec:** `docs/superpowers/specs/2026-07-07-context7-docs-lookup-design.md`

---

## Phases

This plan is split into 4 atomic phases, simplest to most complex. Each phase produces a working, testable result.

| Phase | Deliverable                                       | Depends On |
| ----- | ------------------------------------------------- | ---------- |
| 1     | DocsProvider interface + Context7 client + tests  | Nothing    |
| 2     | Registry extension + config + barrel export       | Phase 1    |
| 3     | web_docs_search tool + registration + tests       | Phase 2    |
| 4     | web_docs_fetch tool + storage integration + tests | Phase 3    |

---

## File Map

| Action | File                                  | Responsibility                                              |
| ------ | ------------------------------------- | ----------------------------------------------------------- |
| Create | `src/providers/context7.ts`           | Context7Error class, DocsProvider impl, providerMeta export |
| Create | `src/tools/web-docs-search.ts`        | web_docs_search tool factory                                |
| Create | `src/tools/web-docs-fetch.ts`         | web_docs_fetch tool factory                                 |
| Create | `tests/providers/context7.test.ts`    | Context7 client unit tests                                  |
| Create | `tests/tools/web-docs-search.test.ts` | Search tool tests                                           |
| Create | `tests/tools/web-docs-fetch.test.ts`  | Fetch tool tests                                            |
| Modify | `src/providers/types.ts`              | Add DocsSearchResult, DocsProvider interfaces               |
| Modify | `src/providers/registry.ts`           | Add registerDocs(), selectDocs()                            |
| Modify | `src/providers/all.ts`                | Add context7 to barrel                                      |
| Modify | `src/config.ts`                       | Add context7 to DEFAULT_CONFIG                              |
| Modify | `src/storage.ts`                      | Extend StoredContent.source union                           |
| Modify | `src/index.ts`                        | Wire docs registration + tool registration                  |

---

## Phase 1: Types & Context7 Client

### Task 1.1: Add DocsProvider interface to types.ts

**Files:**

- Modify: `src/providers/types.ts`

- [ ] **Step 1: Add DocsSearchResult and DocsProvider interfaces**

Append to the end of `src/providers/types.ts` (after the existing `ProviderMeta` interface):

```typescript
export interface DocsSearchResult {
  id: string;
  name: string;
  description: string;
  totalSnippets: number;
  trustScore: number;
  benchmarkScore: number;
  versions?: string[];
}

export interface DocsProvider {
  readonly name: string;
  readonly label: string;
  searchLibrary(
    libraryName: string,
    query: string,
    signal?: AbortSignal,
  ): Promise<DocsSearchResult[]>;
  getContext(
    libraryId: string,
    query: string,
    signal?: AbortSignal,
  ): Promise<string>;
}
```

- [ ] **Step 2: Add `docs` to ProviderMeta.create return type**

In `src/providers/types.ts`, change the `create` field of `ProviderMeta` from:

```typescript
  create: (key?: string, providerConfig?: ProviderConfigEntry) => {
    search?: SearchProvider;
    fetch?: FetchProvider;
    codeSearch?: CodeSearchProvider;
  };
```

to:

```typescript
  create: (key?: string, providerConfig?: ProviderConfigEntry) => {
    search?: SearchProvider;
    fetch?: FetchProvider;
    codeSearch?: CodeSearchProvider;
    docs?: DocsProvider;
  };
```

- [ ] **Step 3: Run typecheck to verify no breakage**

Run: `pnpm typecheck`
Expected: PASS (no existing code uses `docs` yet)

- [ ] **Step 4: Commit**

```bash
git add src/providers/types.ts
git commit -m "feat(types): add DocsProvider and DocsSearchResult interfaces"
```

---

### Task 1.2: Implement Context7 client

**Files:**

- Create: `src/providers/context7.ts`
- Test: `tests/providers/context7.test.ts`

- [ ] **Step 1: Write failing tests for Context7 client**

Create `tests/providers/context7.test.ts`:

````typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  Context7DocsProvider,
  Context7Error,
} from "../../src/providers/context7.ts";
import { stubFetch } from "../helpers.ts";

describe("Context7DocsProvider", () => {
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetchStub = stubFetch();
  });
  afterEach(() => {
    fetchStub.restore();
  });

  it("has correct name and label", () => {
    const provider = new Context7DocsProvider("ctx7sk_test");
    expect(provider.name).toBe("context7");
    expect(provider.label).toBe("Context7");
  });

  describe("searchLibrary", () => {
    it("returns mapped search results", async () => {
      fetchStub.addResponse("context7.com/api/v2/libs/search", {
        body: {
          results: [
            {
              id: "/facebook/react",
              title: "React",
              description: "A JavaScript library for building user interfaces",
              totalSnippets: 2500,
              trustScore: 10,
              benchmarkScore: 95.5,
              versions: ["v18.2.0", "v17.0.2"],
            },
          ],
          searchFilterApplied: false,
        },
      });

      const provider = new Context7DocsProvider("ctx7sk_test");
      const results = await provider.searchLibrary("react", "state management");

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("/facebook/react");
      expect(results[0].name).toBe("React");
      expect(results[0].trustScore).toBe(10);
      expect(results[0].versions).toEqual(["v18.2.0", "v17.0.2"]);
    });

    it("returns empty array when no results", async () => {
      fetchStub.addResponse("context7.com/api/v2/libs/search", {
        body: { results: [], searchFilterApplied: false },
      });

      const provider = new Context7DocsProvider("ctx7sk_test");
      const results = await provider.searchLibrary("nonexistent", "anything");
      expect(results).toEqual([]);
    });

    it("sends Authorization header", async () => {
      fetchStub.addResponse("context7.com/api/v2/libs/search", {
        body: { results: [], searchFilterApplied: false },
      });

      const provider = new Context7DocsProvider("ctx7sk_mykey");
      await provider.searchLibrary("react", "hooks");

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      expect(fetchCall[1].headers.Authorization).toBe("Bearer ctx7sk_mykey");
    });

    it("throws Context7Error on 401", async () => {
      fetchStub.addResponse("context7.com/api/v2/libs/search", {
        status: 401,
        body: { error: "invalid_api_key", message: "Invalid API key." },
      });

      const provider = new Context7DocsProvider("bad_key");
      await expect(provider.searchLibrary("react", "hooks")).rejects.toThrow(
        Context7Error,
      );
      await expect(provider.searchLibrary("react", "hooks")).rejects.toThrow(
        /API key/i,
      );
    });

    it("throws Context7Error on 429", async () => {
      fetchStub.addResponse("context7.com/api/v2/libs/search", {
        status: 429,
        body: { error: "rate_limited", message: "Too many requests." },
      });

      const provider = new Context7DocsProvider("ctx7sk_test");
      await expect(provider.searchLibrary("react", "hooks")).rejects.toThrow(
        Context7Error,
      );
    });

    it("passes abort signal to fetch", async () => {
      fetchStub.addResponse("context7.com/api/v2/libs/search", {
        body: { results: [], searchFilterApplied: false },
      });

      const controller = new AbortController();
      const provider = new Context7DocsProvider("ctx7sk_test");
      await provider.searchLibrary("react", "hooks", controller.signal);

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      expect(fetchCall[1].signal).toBe(controller.signal);
    });
  });

  describe("getContext", () => {
    it("returns text content directly", async () => {
      fetchStub.addResponse("context7.com/api/v2/context", {
        body: "### useState Hook\n\nSource: https://github.com/facebook/react\n\n```typescript\nconst [state, setState] = useState(0);\n```",
        headers: { "content-type": "text/plain" },
      });

      const provider = new Context7DocsProvider("ctx7sk_test");
      const result = await provider.getContext(
        "/facebook/react",
        "How to use useState",
      );

      expect(result).toContain("useState Hook");
      expect(result).toContain("```typescript");
    });

    it("sends libraryId and query as URL params", async () => {
      fetchStub.addResponse("context7.com/api/v2/context", {
        body: "docs content",
        headers: { "content-type": "text/plain" },
      });

      const provider = new Context7DocsProvider("ctx7sk_test");
      await provider.getContext(
        "/vercel/next.js@v15.1.8",
        "app router middleware",
      );

      const fetchCall = (globalThis.fetch as any).mock.calls[0];
      const url = fetchCall[0] as string;
      expect(url).toContain("libraryId=%2Fvercel%2Fnext.js%40v15.1.8");
      expect(url).toContain("query=app+router+middleware");
    });

    it("returns friendly message on 202 (library processing)", async () => {
      fetchStub.addResponse("context7.com/api/v2/context", {
        status: 202,
        body: {
          error: "library_processing",
          message: "Library is not finalized yet.",
        },
      });

      const provider = new Context7DocsProvider("ctx7sk_test");
      const result = await provider.getContext("/new/library", "anything");
      expect(result).toContain("being processed");
      expect(result).toContain("Try again");
    });

    it("throws Context7Error on 404", async () => {
      fetchStub.addResponse("context7.com/api/v2/context", {
        status: 404,
        body: { error: "library_not_found", message: "Library not found." },
      });

      const provider = new Context7DocsProvider("ctx7sk_test");
      await expect(
        provider.getContext("/nonexistent/lib", "anything"),
      ).rejects.toThrow(Context7Error);
    });

    it("throws Context7Error on 402 (spending limit)", async () => {
      fetchStub.addResponse("context7.com/api/v2/context", {
        status: 402,
        body: {
          error: "spending_limit_exceeded",
          message: "Monthly spending limit reached.",
        },
      });

      const provider = new Context7DocsProvider("ctx7sk_test");
      await expect(
        provider.getContext("/facebook/react", "hooks"),
      ).rejects.toThrow(Context7Error);
      await expect(
        provider.getContext("/facebook/react", "hooks"),
      ).rejects.toThrow(/spending limit/i);
    });

    it("follows 301 redirect", async () => {
      // Use regex patterns to differentiate the two calls by libraryId param
      fetchStub.addResponse(/libraryId=%2Fold%2Flibrary/, {
        status: 301,
        body: {
          error: "library_moved",
          message: "Moved",
          redirectUrl: "/new/location",
        },
      });
      fetchStub.addResponse(/libraryId=%2Fnew%2Flocation/, {
        body: "redirected docs",
        headers: { "content-type": "text/plain" },
      });

      const provider = new Context7DocsProvider("ctx7sk_test");
      const result = await provider.getContext("/old/library", "anything");
      expect(result).toContain("redirected docs");
    });
  });
});
````

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/providers/context7.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement Context7DocsProvider**

Create `src/providers/context7.ts`:

```typescript
import type { DocsProvider, DocsSearchResult, ProviderMeta } from "./types.ts";
import type { ProviderConfigEntry } from "../config.ts";

const BASE_URL = "https://context7.com/api";

export class Context7Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Context7Error";
  }
}

interface ApiSearchResult {
  id: string;
  title: string;
  description: string;
  totalSnippets: number;
  trustScore: number;
  benchmarkScore: number;
  versions?: string[];
}

interface ApiSearchResponse {
  results: ApiSearchResult[];
  searchFilterApplied: boolean;
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const json = (await response.json()) as { message?: string };
    if (json.message) return json.message;
  } catch {
    // Fall through to status-based message
  }

  switch (response.status) {
    case 401:
      return "Invalid API key. API keys should start with 'ctx7sk' prefix.";
    case 402:
      return "Monthly spending limit exceeded. Raise the limit at context7.com/dashboard/billing.";
    case 404:
      return "Library not found. Check the library ID or search again.";
    case 429:
      return "Rate limited. Try again later.";
    default:
      return `Context7 API error (${response.status}).`;
  }
}

export class Context7DocsProvider implements DocsProvider {
  readonly name = "context7";
  readonly label = "Context7";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async searchLibrary(
    libraryName: string,
    query: string,
    signal?: AbortSignal,
  ): Promise<DocsSearchResult[]> {
    const url = new URL(`${BASE_URL}/v2/libs/search`);
    url.searchParams.set("libraryName", libraryName);
    url.searchParams.set("query", query);

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal,
    });

    if (!response.ok) {
      throw new Context7Error(await parseErrorMessage(response));
    }

    const data = (await response.json()) as ApiSearchResponse;
    return (data.results ?? []).map((r) => ({
      id: r.id,
      name: r.title,
      description: r.description,
      totalSnippets: r.totalSnippets,
      trustScore: r.trustScore,
      benchmarkScore: r.benchmarkScore,
      versions: r.versions,
    }));
  }

  async getContext(
    libraryId: string,
    query: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const url = new URL(`${BASE_URL}/v2/context`);
    url.searchParams.set("libraryId", libraryId);
    url.searchParams.set("query", query);

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal,
    });

    // 202: library still processing — return friendly message
    if (response.status === 202) {
      return "Library is being processed. Try again in a few minutes.";
    }

    // 301: library moved — follow redirect
    if (response.status === 301) {
      try {
        const body = (await response.json()) as { redirectUrl?: string };
        if (body.redirectUrl) {
          return this.getContext(body.redirectUrl, query, signal);
        }
      } catch {
        // Fall through to error
      }
      throw new Context7Error(
        "Library has moved but no redirect URL provided.",
      );
    }

    if (!response.ok) {
      throw new Context7Error(await parseErrorMessage(response));
    }

    return response.text();
  }
}

export const providerMeta: ProviderMeta = {
  name: "context7",
  tier: 1,
  monthlyQuota: null,
  requiresKey: true,
  create: (key?: string, _providerConfig?: ProviderConfigEntry) => ({
    docs: key ? new Context7DocsProvider(key) : undefined,
  }),
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/providers/context7.test.ts`
Expected: PASS (all tests green)

- [ ] **Step 5: Run full check**

Run: `pnpm check`
Expected: PASS (lint + typecheck + test)

- [ ] **Step 6: Commit**

```bash
git add src/providers/context7.ts tests/providers/context7.test.ts
git commit -m "feat(context7): add Context7 DocsProvider client with tests"
```

---

## Phase 2: Registry Extension & Config

### Task 2.1: Add registerDocs/selectDocs to ProviderRegistry

**Files:**

- Modify: `src/providers/registry.ts`
- Test: `tests/providers/registry.test.ts` (add to existing)

- [ ] **Step 1: Write failing test for registerDocs/selectDocs**

Append to `tests/providers/registry.test.ts`:

```typescript
describe("docs provider registration", () => {
  it("selectDocs returns undefined when no docs provider registered", () => {
    const registry = new ProviderRegistry(mockPersistence());
    expect(registry.selectDocs()).toBeUndefined();
  });

  it("registerDocs and selectDocs round-trip", () => {
    const registry = new ProviderRegistry(mockPersistence());
    const docsProvider = {
      name: "context7",
      label: "Context7",
      searchLibrary: vi.fn(),
      getContext: vi.fn(),
    };
    registry.registerDocs(docsProvider);
    expect(registry.selectDocs()).toBe(docsProvider);
  });
});
```

Note: `mockPersistence()` should already exist in this test file. If it doesn't, add:

```typescript
function mockPersistence(): PersistenceAdapter {
  return { load: () => ({}), save: () => {} };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/providers/registry.test.ts -t "docs provider"`
Expected: FAIL (registerDocs/selectDocs not defined)

- [ ] **Step 3: Implement registerDocs and selectDocs**

In `src/providers/registry.ts`, add the import for DocsProvider at line 4:

```typescript
import type {
  SearchProvider,
  FetchProvider,
  CodeSearchProvider,
  DocsProvider,
  ProviderTier,
} from "./types.ts";
```

Add a private field after line 44:

```typescript
  private docsProvider: DocsProvider | undefined;
```

Add methods after `selectCodeSearch()` (after line 209):

```typescript
  registerDocs(provider: DocsProvider): void {
    this.docsProvider = provider;
  }

  selectDocs(): DocsProvider | undefined {
    return this.docsProvider;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/providers/registry.test.ts -t "docs provider"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/providers/registry.ts tests/providers/registry.test.ts
git commit -m "feat(registry): add registerDocs/selectDocs for DocsProvider"
```

---

### Task 2.2: Add context7 to config defaults and provider barrel

**Files:**

- Modify: `src/config.ts`
- Modify: `src/providers/all.ts`

- [ ] **Step 1: Add context7 to DEFAULT_CONFIG in config.ts**

In `src/config.ts`, add after the `websearchapi` entry in the `providers` object (around line 62):

```typescript
    context7: { enabled: true, apiKey: "CONTEXT7_API_KEY" },
```

- [ ] **Step 2: Add context7 to providers barrel**

In `src/providers/all.ts`, add the import:

```typescript
import { providerMeta as context7 } from "./context7.ts";
```

Add `context7` to the `allProviders` array:

```typescript
export const allProviders: ProviderMeta[] = [
  brave,
  context7,
  duckduckgo,
  exa,
  exaMcp,
  firecrawl,
  jina,
  openaiNative,
  parallel,
  perplexity,
  searxng,
  serper,
  tavily,
  websearchapi,
];
```

- [ ] **Step 3: Add docs registration to the loop in index.ts**

In `src/index.ts`, add after line 53 (`if (instances.codeSearch) {` block):

```typescript
if (instances.docs) {
  registry.registerDocs(instances.docs);
}
```

- [ ] **Step 4: Run typecheck and tests**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/providers/all.ts src/index.ts
git commit -m "feat(config): add context7 provider to defaults and barrel"
```

---

## Phase 3: web_docs_search Tool

### Task 3.1: Implement web_docs_search tool

**Files:**

- Create: `src/tools/web-docs-search.ts`
- Create: `tests/tools/web-docs-search.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/tools/web-docs-search.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { createWebDocsSearchTool } from "../../src/tools/web-docs-search.ts";
import { makeCtx } from "../helpers.ts";
import type {
  DocsProvider,
  DocsSearchResult,
} from "../../src/providers/types.ts";
import { Context7Error } from "../../src/providers/context7.ts";

function mockDocsProvider(results: DocsSearchResult[] = []): DocsProvider {
  return {
    name: "context7",
    label: "Context7",
    searchLibrary: vi.fn().mockResolvedValue(results),
    getContext: vi.fn().mockResolvedValue(""),
  };
}

const sampleResults: DocsSearchResult[] = [
  {
    id: "/facebook/react",
    name: "React",
    description: "A JavaScript library for building user interfaces",
    totalSnippets: 2500,
    trustScore: 10,
    benchmarkScore: 95.5,
    versions: ["v18.2.0", "v17.0.2"],
  },
  {
    id: "/preactjs/preact",
    name: "Preact",
    description: "Fast 3kB alternative to React",
    totalSnippets: 450,
    trustScore: 8,
    benchmarkScore: 78.0,
  },
];

describe("web_docs_search tool", () => {
  it("has correct tool metadata", () => {
    const tool = createWebDocsSearchTool(() => mockDocsProvider());
    expect(tool.name).toBe("web_docs_search");
    expect(tool.label).toBe("Docs Search");
  });

  it("returns formatted markdown table on success", async () => {
    const tool = createWebDocsSearchTool(() => mockDocsProvider(sampleResults));
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-1",
      { library: "react", query: "state management" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;

    expect(text).toContain("/facebook/react");
    expect(text).toContain("React");
    expect(text).toContain("10");
    expect(text).toContain("2500");
    expect(text).toContain("/preactjs/preact");
  });

  it("returns 'no libraries found' for empty results", async () => {
    const tool = createWebDocsSearchTool(() => mockDocsProvider([]));
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-2",
      { library: "nonexistent", query: "anything" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;

    expect(text).toContain("No libraries found");
  });

  it("returns setup message when provider unavailable", async () => {
    const tool = createWebDocsSearchTool(() => undefined);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-3",
      { library: "react", query: "hooks" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;

    expect(text).toContain("CONTEXT7_API_KEY");
  });

  it("throws on API errors", async () => {
    const failing: DocsProvider = {
      name: "context7",
      label: "Context7",
      searchLibrary: vi
        .fn()
        .mockRejectedValue(new Context7Error("Rate limited.")),
      getContext: vi.fn(),
    };
    const tool = createWebDocsSearchTool(() => failing);
    const ctx = makeCtx();

    await expect(
      tool.execute(
        "call-4",
        { library: "react", query: "hooks" },
        undefined,
        undefined,
        ctx,
      ),
    ).rejects.toThrow(Context7Error);
  });

  it("passes signal to provider", async () => {
    const provider = mockDocsProvider([]);
    const tool = createWebDocsSearchTool(() => provider);
    const ctx = makeCtx();
    const controller = new AbortController();

    await tool.execute(
      "call-5",
      { library: "react", query: "hooks" },
      controller.signal,
      undefined,
      ctx,
    );

    expect(provider.searchLibrary).toHaveBeenCalledWith(
      "react",
      "hooks",
      controller.signal,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/tools/web-docs-search.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement web_docs_search tool**

Create `src/tools/web-docs-search.ts`:

```typescript
import { Type } from "typebox";
import type { Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { DocsProvider, DocsSearchResult } from "../providers/types.ts";
import type { GuidanceOverride } from "../config.ts";

const WebDocsSearchParams = Type.Object({
  library: Type.String({
    description:
      "Library name to search for (e.g. 'react', 'next.js', 'express')",
  }),
  query: Type.String({
    description: "What you are trying to do — used for relevance ranking",
  }),
});

interface WebDocsSearchDetails {
  provider: string;
  resultCount: number;
}

function formatResultsTable(results: DocsSearchResult[]): string {
  if (results.length === 0) return "No libraries found.";

  const header = "| ID | Name | Trust | Snippets | Description |";
  const separator = "|----|------|-------|----------|-------------|";
  const rows = results.slice(0, 10).map((r) => {
    const desc =
      r.description.length > 60
        ? `${r.description.slice(0, 57)}...`
        : r.description;
    return `| ${r.id} | ${r.name} | ${r.trustScore} | ${r.totalSnippets} | ${desc} |`;
  });

  const table = [header, separator, ...rows].join("\n");
  const suffix =
    results.length > 10 ? `\n\n(${results.length - 10} more omitted)` : "";
  return table + suffix;
}

export function createWebDocsSearchTool(
  resolveProvider: () => DocsProvider | undefined,
  guidance?: GuidanceOverride,
): ToolDefinition<typeof WebDocsSearchParams, WebDocsSearchDetails> {
  return {
    name: "web_docs_search",
    label: "Docs Search",
    description:
      "Search for library documentation. Returns matching libraries you can query with web_docs_fetch.",
    promptSnippet:
      guidance?.promptSnippet ??
      "Search for library documentation by name. Use the returned library ID with web_docs_fetch.",
    promptGuidelines: guidance?.promptGuidelines ?? [
      "Use web_docs_search to find library IDs before calling web_docs_fetch.",
      "Prefer web_docs_search + web_docs_fetch over web_search for library/framework documentation.",
    ],
    parameters: WebDocsSearchParams,
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const provider = resolveProvider();
      if (!provider) {
        return {
          content: [
            {
              type: "text" as const,
              text: "web_docs_search requires a Context7 API key. Set the CONTEXT7_API_KEY environment variable or configure it in ~/.pi/agent/extensions/tools.json under providers.context7.apiKey.",
            },
          ],
          details: { provider: "none", resultCount: 0 },
        };
      }

      const results = await provider.searchLibrary(
        params.library,
        params.query,
        signal ?? undefined,
      );
      const text = formatResultsTable(results);

      return {
        content: [{ type: "text" as const, text }],
        details: { provider: provider.name, resultCount: results.length },
      };
    },
    renderCall(args, theme: Theme, context) {
      const text =
        context.lastComponent instanceof Text
          ? context.lastComponent
          : new Text("", 0, 0);
      if (!context.argsComplete) {
        text.setText(theme.fg("warning", "Searching docs..."));
        return text;
      }
      const lib =
        args.library.length > 40
          ? `${args.library.slice(0, 37)}...`
          : args.library;
      text.setText(
        `${theme.fg("toolTitle", theme.bold("web_docs_search"))} ${theme.fg("accent", `"${lib}"`)}`,
      );
      return text;
    },
    renderResult(result, options, theme: Theme, context) {
      const text =
        context.lastComponent instanceof Text
          ? context.lastComponent
          : new Text("", 0, 0);
      if (context.isPartial) {
        text.setText(theme.fg("warning", "Searching docs..."));
        return text;
      }
      const count = result.details?.resultCount ?? 0;
      if (options.expanded) {
        const raw =
          result.content[0] && "text" in result.content[0]
            ? result.content[0].text
            : "";
        const lines = raw.split("\n").slice(0, 12);
        text.setText(lines.map((l) => theme.fg("toolOutput", l)).join("\n"));
      } else {
        text.setText(
          theme.fg(
            "toolOutput",
            `${count} ${count === 1 ? "library" : "libraries"} found`,
          ),
        );
      }
      return text;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/tools/web-docs-search.test.ts`
Expected: PASS

- [ ] **Step 5: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/tools/web-docs-search.ts tests/tools/web-docs-search.test.ts
git commit -m "feat(tools): add web_docs_search tool"
```

---

### Task 3.2: Wire web_docs_search registration in index.ts

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 1: Add import and registration**

In `src/index.ts`, add the import at the top (after the `createCodeSearchTool` import):

```typescript
import { createWebDocsSearchTool } from "./tools/web-docs-search.ts";
```

After the existing `pi.registerTool(createCodeSearchTool(...))` block (around line 105), add:

```typescript
// Register docs tools when Context7 provider is available
const docsProvider = registry.selectDocs();
if (docsProvider) {
  pi.registerTool(
    createWebDocsSearchTool(
      () => docsProvider,
      config.guidance?.web_docs_search,
    ),
  );
}
```

- [ ] **Step 2: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(index): wire web_docs_search tool registration"
```

---

## Phase 4: web_docs_fetch Tool

### Task 4.1: Extend StoredContent source union

**Files:**

- Modify: `src/storage.ts`

- [ ] **Step 1: Add "web_docs_fetch" to StoredContent.source**

In `src/storage.ts`, change line 8:

From:

```typescript
source: "web_fetch" | "web_search";
```

To:

```typescript
source: "web_fetch" | "web_search" | "web_docs_fetch";
```

Also update the `store` method's input type (around line 25):

From:

```typescript
source: "web_fetch" | "web_search";
```

To:

```typescript
source: "web_fetch" | "web_search" | "web_docs_fetch";
```

- [ ] **Step 2: Update the type guard in index.ts**

In `src/index.ts`, update the `isStoredContent` function (around line 25):

From:

```typescript
d.source === "web_fetch" || d.source === "web_search";
```

To:

```typescript
d.source === "web_fetch" ||
  d.source === "web_search" ||
  d.source === "web_docs_fetch";
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/storage.ts src/index.ts
git commit -m "feat(storage): extend StoredContent source to include web_docs_fetch"
```

---

### Task 4.2: Implement web_docs_fetch tool

**Files:**

- Create: `src/tools/web-docs-fetch.ts`
- Create: `tests/tools/web-docs-fetch.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/tools/web-docs-fetch.test.ts`:

````typescript
import { describe, expect, it, vi } from "vitest";
import { createWebDocsFetchTool } from "../../src/tools/web-docs-fetch.ts";
import { makeCtx } from "../helpers.ts";
import { ContentStore } from "../../src/storage.ts";
import type { DocsProvider } from "../../src/providers/types.ts";
import { Context7Error } from "../../src/providers/context7.ts";

function mockDocsProvider(
  contextResponse: string = "# Docs\n\nSample documentation",
): DocsProvider {
  return {
    name: "context7",
    label: "Context7",
    searchLibrary: vi.fn().mockResolvedValue([]),
    getContext: vi.fn().mockResolvedValue(contextResponse),
  };
}

function createStore(): ContentStore {
  return new ContentStore(vi.fn());
}

describe("web_docs_fetch tool", () => {
  it("has correct tool metadata", () => {
    const tool = createWebDocsFetchTool(
      () => mockDocsProvider(),
      createStore(),
    );
    expect(tool.name).toBe("web_docs_fetch");
    expect(tool.label).toBe("Docs Fetch");
  });

  it("returns documentation content on success", async () => {
    const content =
      "### useState\n\n```typescript\nconst [s, setS] = useState(0);\n```";
    const tool = createWebDocsFetchTool(
      () => mockDocsProvider(content),
      createStore(),
    );
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-1",
      { libraryId: "/facebook/react", query: "How to use useState" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;

    expect(text).toContain("useState");
    expect(text).toContain("```typescript");
  });

  it("truncates and stores large content", async () => {
    const largeContent = "x".repeat(20_000);
    const store = createStore();
    const tool = createWebDocsFetchTool(
      () => mockDocsProvider(largeContent),
      store,
    );
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-2",
      { libraryId: "/facebook/react", query: "everything" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;

    // Should be truncated
    expect(text.length).toBeLessThan(20_000);
    expect(text).toContain("[truncated]");

    // Should have a contentId in details
    expect(result.details?.contentId).toBeDefined();

    // Store should have the full content
    const stored = store.get(result.details!.contentId!);
    expect(stored).toBeDefined();
    expect(stored!.text).toBe(largeContent);
    expect(stored!.source).toBe("web_docs_fetch");
  });

  it("returns setup message when provider unavailable", async () => {
    const tool = createWebDocsFetchTool(() => undefined, createStore());
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-3",
      { libraryId: "/facebook/react", query: "hooks" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;

    expect(text).toContain("CONTEXT7_API_KEY");
  });

  it("returns friendly message for 202 (processing)", async () => {
    const provider: DocsProvider = {
      name: "context7",
      label: "Context7",
      searchLibrary: vi.fn(),
      getContext: vi
        .fn()
        .mockResolvedValue(
          "Library is being processed. Try again in a few minutes.",
        ),
    };
    const tool = createWebDocsFetchTool(() => provider, createStore());
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-4",
      { libraryId: "/new/lib", query: "anything" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;

    expect(text).toContain("being processed");
  });

  it("throws on 404 errors", async () => {
    const failing: DocsProvider = {
      name: "context7",
      label: "Context7",
      searchLibrary: vi.fn(),
      getContext: vi
        .fn()
        .mockRejectedValue(new Context7Error("Library not found.")),
    };
    const tool = createWebDocsFetchTool(() => failing, createStore());
    const ctx = makeCtx();

    await expect(
      tool.execute(
        "call-5",
        { libraryId: "/nonexistent/lib", query: "anything" },
        undefined,
        undefined,
        ctx,
      ),
    ).rejects.toThrow(Context7Error);
  });

  it("passes signal to provider", async () => {
    const provider = mockDocsProvider("docs");
    const tool = createWebDocsFetchTool(() => provider, createStore());
    const ctx = makeCtx();
    const controller = new AbortController();

    await tool.execute(
      "call-6",
      { libraryId: "/facebook/react", query: "hooks" },
      controller.signal,
      undefined,
      ctx,
    );

    expect(provider.getContext).toHaveBeenCalledWith(
      "/facebook/react",
      "hooks",
      controller.signal,
    );
  });
});
````

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/tools/web-docs-fetch.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement web_docs_fetch tool**

Create `src/tools/web-docs-fetch.ts`:

```typescript
import { Type } from "typebox";
import type { Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { DocsProvider } from "../providers/types.ts";
import type { ContentStore } from "../storage.ts";
import { truncateContent } from "../utils/truncate.ts";
import type { GuidanceOverride } from "../config.ts";

const INLINE_LIMIT = 15_000;

const WebDocsFetchParams = Type.Object({
  libraryId: Type.String({
    description:
      "Context7 library ID (e.g. '/facebook/react', '/vercel/next.js@v15.1.8')",
  }),
  query: Type.String({
    description:
      "Specific question about the library (drives relevance ranking)",
  }),
});

interface WebDocsFetchDetails {
  provider: string;
  libraryId: string;
  chars: number;
  truncated: boolean;
  contentId?: string;
}

export function createWebDocsFetchTool(
  resolveProvider: () => DocsProvider | undefined,
  store: ContentStore,
  guidance?: GuidanceOverride,
): ToolDefinition<typeof WebDocsFetchParams, WebDocsFetchDetails> {
  return {
    name: "web_docs_fetch",
    label: "Docs Fetch",
    description:
      "Retrieve up-to-date documentation for a specific library via Context7.",
    promptSnippet:
      guidance?.promptSnippet ??
      "Retrieve focused documentation for a library. Use web_docs_search first to find the library ID.",
    promptGuidelines: guidance?.promptGuidelines ?? [
      "Use web_docs_fetch after web_docs_search to get documentation for a specific library.",
      "Always provide a specific question in the query parameter for best results.",
      "Pin a version with /owner/repo@version for consistent results.",
    ],
    parameters: WebDocsFetchParams,
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const provider = resolveProvider();
      if (!provider) {
        return {
          content: [
            {
              type: "text" as const,
              text: "web_docs_fetch requires a Context7 API key. Set the CONTEXT7_API_KEY environment variable or configure it in ~/.pi/agent/extensions/tools.json under providers.context7.apiKey.",
            },
          ],
          details: {
            provider: "none",
            libraryId: params.libraryId,
            chars: 0,
            truncated: false,
          },
        };
      }

      const text = await provider.getContext(
        params.libraryId,
        params.query,
        signal ?? undefined,
      );
      const chars = text.length;
      let outputText: string;
      let contentId: string | undefined;
      let truncated = false;

      if (chars > INLINE_LIMIT) {
        contentId = store.store({
          url: `context7://${params.libraryId}`,
          title: `Docs: ${params.libraryId}`,
          text,
          source: "web_docs_fetch",
        });
        outputText = truncateContent(text, INLINE_LIMIT);
        truncated = true;
      } else {
        outputText = text;
      }

      const header = truncated
        ? `Docs: ${params.libraryId} (${chars} chars, truncated — use web_read with contentId "${contentId}" for full text)\n\n`
        : "";

      return {
        content: [{ type: "text" as const, text: header + outputText }],
        details: {
          provider: provider.name,
          libraryId: params.libraryId,
          chars,
          truncated,
          contentId,
        },
      };
    },
    renderCall(args, theme: Theme, context) {
      const text =
        context.lastComponent instanceof Text
          ? context.lastComponent
          : new Text("", 0, 0);
      if (!context.argsComplete) {
        text.setText(theme.fg("warning", "Fetching docs..."));
        return text;
      }
      const lib =
        args.libraryId.length > 30
          ? `${args.libraryId.slice(0, 27)}...`
          : args.libraryId;
      const q =
        args.query.length > 40 ? `${args.query.slice(0, 37)}...` : args.query;
      text.setText(
        `${theme.fg("toolTitle", theme.bold("web_docs_fetch"))} ${theme.fg("accent", lib)} ${theme.fg("dim", `"${q}"`)}`,
      );
      return text;
    },
    renderResult(result, options, theme: Theme, context) {
      const text =
        context.lastComponent instanceof Text
          ? context.lastComponent
          : new Text("", 0, 0);
      if (context.isPartial) {
        text.setText(theme.fg("warning", "Fetching docs..."));
        return text;
      }
      const chars = result.details?.chars ?? 0;
      if (options.expanded) {
        const raw =
          result.content[0] && "text" in result.content[0]
            ? result.content[0].text
            : "";
        const lines = raw.split("\n").slice(0, 15);
        text.setText(lines.map((l) => theme.fg("toolOutput", l)).join("\n"));
      } else {
        const suffix = result.details?.truncated ? " (truncated)" : "";
        text.setText(theme.fg("toolOutput", `${chars} chars of docs${suffix}`));
      }
      return text;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/tools/web-docs-fetch.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/web-docs-fetch.ts tests/tools/web-docs-fetch.test.ts
git commit -m "feat(tools): add web_docs_fetch tool with content storage"
```

---

### Task 4.3: Wire web_docs_fetch registration in index.ts

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 1: Add import and registration**

In `src/index.ts`, add the import (after the `createWebDocsSearchTool` import):

```typescript
import { createWebDocsFetchTool } from "./tools/web-docs-fetch.ts";
```

Update the docs registration block (added in Task 3.2) to also register web_docs_fetch:

From:

```typescript
const docsProvider = registry.selectDocs();
if (docsProvider) {
  pi.registerTool(
    createWebDocsSearchTool(
      () => docsProvider,
      config.guidance?.web_docs_search,
    ),
  );
}
```

To:

```typescript
const docsProvider = registry.selectDocs();
if (docsProvider) {
  pi.registerTool(
    createWebDocsSearchTool(
      () => docsProvider,
      config.guidance?.web_docs_search,
    ),
  );
  pi.registerTool(
    createWebDocsFetchTool(
      () => docsProvider,
      store,
      config.guidance?.web_docs_fetch,
    ),
  );
}
```

- [ ] **Step 2: Run full check**

Run: `pnpm check`
Expected: PASS (all lint + typecheck + tests green)

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(index): wire web_docs_fetch tool registration"
```

---

### Task 4.4: Final integration verification

- [ ] **Step 1: Run the full test suite**

Run: `pnpm check`
Expected: All tests pass, no lint errors, no type errors.

- [ ] **Step 2: Verify conditional registration in existing index test**

Run: `pnpm test -- tests/index.test.ts`
Expected: PASS (existing tests should still pass — context7 won't be registered without a resolved API key in test env)

- [ ] **Step 3: Final commit (if any stray changes)**

```bash
git status
# If clean, nothing to commit. If any formatting changes from biome:
git add -A
git commit -m "chore: formatting"
```
