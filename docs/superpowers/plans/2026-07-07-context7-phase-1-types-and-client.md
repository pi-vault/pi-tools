# Context7 Docs Lookup — Phase 1: Types & Client

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `DocsProvider` interface to the type system and implement the Context7 REST API client with full test coverage.

**Architecture:** New `DocsSearchResult` and `DocsProvider` interfaces extend the existing provider type system (`src/providers/types.ts`). A `Context7DocsProvider` class in `src/providers/context7.ts` implements the interface using Node 24's native `fetch` against Context7's v2 REST API. The provider also exports `providerMeta` following the same pattern as all other providers (e.g., `src/providers/exa.ts`).

**Tech Stack:** TypeScript, Node 24 native fetch, Vitest, existing test helpers (`stubFetch` from `tests/helpers.ts`).

**Spec:** `docs/superpowers/specs/2026-07-07-context7-docs-lookup-design.md`
**Main plan:** `docs/superpowers/plans/2026-07-07-context7-docs-lookup.md`

**Depends on:** Nothing (first phase)
**Produces:** Tested `DocsProvider` interface + `Context7DocsProvider` implementation ready for registry integration.

---

## Context for the Engineer

The existing provider type system lives in `src/providers/types.ts` and defines:

- `SearchProvider` (web search)
- `FetchProvider` (URL content fetching)
- `CodeSearchProvider` (code-specific search)
- `ProviderMeta` (provider registration metadata with a `create` factory)

Each provider file (e.g., `src/providers/exa.ts`) exports a `providerMeta: ProviderMeta` that gets imported in `src/providers/all.ts`.

Tests use `stubFetch()` from `tests/helpers.ts` which mocks `globalThis.fetch` with route-based matching. Pattern: `beforeEach(() => fetchStub = stubFetch())` / `afterEach(() => fetchStub.restore())`.

**Context7 API reference:** https://context7.com/docs/api-guide

**Endpoints we use:**

- `GET /api/v2/libs/search` — params: `libraryName` (required), `query` (required), `fast` (optional, out of scope)
- `GET /api/v2/context` — params: `libraryId` (required), `query` (required), `type` (`json`|`txt`, default `txt`, JSON mode out of scope), `fast` (optional, out of scope)
- Auth: `Authorization: Bearer <key>`
- All errors return `{ error: string, message: string }`

**Status codes we handle (from API docs):**

| Code | Meaning | Our handling |
|---|---|---|
| 200 | Success | Parse response normally |
| 202 | Library not finalized | Return friendly "try again" message (getContext only) |
| 301 | Library redirected | Follow `redirectUrl` from JSON body (getContext only; no HTTP Location header — application-level redirect) |
| 401 | Invalid API key | Throw `Context7Error` |
| 402 | Spending limit exceeded | Throw `Context7Error` |
| 404 | Library not found | Throw `Context7Error` |
| 429 | Rate limited | Throw `Context7Error` |
| Other (400, 403, 422, 500, 503) | Various errors | Throw `Context7Error` via generic fallback |

---

### Task 1.1: Add DocsProvider interface to types.ts

**Files:**

- Modify: `src/providers/types.ts`

- [ ] **Step 1: Add DocsSearchResult and DocsProvider interfaces**

Append to the end of `src/providers/types.ts` (after the existing `ProviderMeta` interface, which ends around line 66):

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
Expected: PASS (no existing code uses `docs` yet — the field is optional)

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
        body: { error: "rate_limit_exceeded", message: "Rate limit exceeded. Please try again later." },
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

    it("returns friendly message on 202 (library not finalized)", async () => {
      fetchStub.addResponse("context7.com/api/v2/context", {
        status: 202,
        body: {
          error: "library_not_finalized",
          message: "Library /new/library not finalized yet.",
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
      // Context7 uses application-level redirects: JSON body with redirectUrl,
      // no HTTP Location header. fetch(redirect:"follow") returns 301 as-is.
      fetchStub.addResponse(/libraryId=%2Fold%2Flibrary/, {
        status: 301,
        body: {
          error: "library_redirected",
          message: "Library /old/library has been redirected to this library: /new/location.",
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
Expected: FAIL with "Cannot find module '../../src/providers/context7.ts'"

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

    // 301: library redirected — application-level redirect (JSON body, no Location header)
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
Expected: PASS (lint + typecheck + tests all pass)

- [ ] **Step 6: Commit**

```bash
git add src/providers/context7.ts tests/providers/context7.test.ts
git commit -m "feat(context7): add Context7 DocsProvider client with tests"
```
