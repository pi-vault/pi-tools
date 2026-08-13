# Pi Tools Phase 1: Explicit Search Filter Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop search providers from silently ignoring requested domain/date filters.

**Architecture:** Add a small filter-support contract to `SearchProvider`. Providers declare whether domain filters are native, locally post-filtered, or unsupported, and whether date filters are native or unsupported. `web_search` removes unsupported candidates before execution and applies the existing safe domain post-filter where declared.

**Tech Stack:** TypeScript, native `URL`, existing filter helpers, Vitest.

---

## Atomic result

After this phase, an unfiltered search behaves exactly as before. A filtered search either uses a provider that enforces every requested filter, locally filters domains when the provider declares that mode, or returns an explicit error naming unsupported filter groups. Provider ordering, budgets, fallback, and fusion remain unchanged for eligible providers.

## File map

Modify:

- `src/providers/types.ts` — define `SearchFilterMode`, `SearchFilterSupport`, and require `SearchProvider.filterSupport`.
- `src/utils/filters.ts` — add safe host-based domain post-filtering and unsupported-filter detection.
- `src/providers/http-adapter.ts` — carry filter-support metadata through the shared HTTP adapter.
- `src/providers/http-providers.ts` — declare support for each HTTP provider configuration.
- `src/providers/duckduckgo.ts` — declare query-domain post-filter support and unsupported date semantics.
- `src/providers/exa.ts` — declare native domain/date support.
- `src/providers/tavily.ts` — declare native domain support and unsupported date semantics.
- `src/providers/serper.ts` — declare native domain/date support.
- `src/providers/tinyfish.ts` — declare native domain/date support.
- `src/providers/firecrawl.ts`, `src/providers/jina.ts`, `src/providers/ollama.ts`, `src/providers/openai-codex.ts`, `src/providers/openai-web-search.ts`, `src/providers/parallel.ts`, `src/providers/searxng.ts`, `src/providers/sofya.ts` — declare unsupported filter groups instead of accepting silent no-ops.
- `src/providers/registry.ts` — preserve `filterSupport` when wrapping registered providers.
- `src/tools/web-search.ts` — reject or filter candidates before fallback/fusion and apply local domain filtering.
- Search-provider test fixtures in `tests/config-manager.test.ts`, `tests/commands/tools.test.ts`, `tests/commands/tools-actions.test.ts`, `tests/commands/tools-dashboard.test.ts`, `tests/providers/registry.test.ts`, `tests/providers/types.test.ts`, and `tests/tools/web-search.test.ts` — satisfy the required provider contract.

Create:

- `tests/providers/filter-support.test.ts` — support matrix and domain filtering contract tests.

## Tasks

### Task 1: Add the filter-support contract and failing tests

**Files:**

- Modify: `src/providers/types.ts`
- Modify: `src/utils/filters.ts`
- Create: `tests/providers/filter-support.test.ts`
- Modify: `tests/providers/types.test.ts`

- [ ] **Step 1: Define the support types.**

Add the following types beside `SearchFilters` in `src/providers/types.ts`:

```ts
export type SearchFilterMode = "native" | "post-filter" | "unsupported";

export interface SearchFilterSupport {
  domains: SearchFilterMode;
  dates: Exclude<SearchFilterMode, "post-filter">;
}

export const UNSUPPORTED_SEARCH_FILTERS: SearchFilterSupport = {
  domains: "unsupported",
  dates: "unsupported",
};
```

Add `readonly filterSupport: SearchFilterSupport;` to `SearchProvider`. Requiring the field makes a production adapter’s filter contract visible at its interface; test doubles will use `UNSUPPORTED_SEARCH_FILTERS` when they do not model filters.

- [ ] **Step 2: Add safe domain filtering and unsupported-group detection.**

Append these functions to `src/utils/filters.ts`:

```ts
import type { SearchFilterSupport, SearchFilters, SearchResult } from "../providers/types.ts";

function hostMatchesDomain(urlValue: string, domain: string): boolean {
  try {
    const host = new URL(urlValue).hostname.toLowerCase();
    const normalized = domain.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
    return normalized.length > 0 && (host === normalized || host.endsWith(`.${normalized}`));
  } catch {
    return false;
  }
}

export function filterResultsByDomains(
  results: SearchResult[],
  filters?: SearchFilters,
): SearchResult[] {
  if (!filters?.includeDomains?.length && !filters?.excludeDomains?.length) return results;

  return results.filter((result) => {
    const included =
      !filters.includeDomains?.length ||
      filters.includeDomains.some((domain) => hostMatchesDomain(result.url, domain));
    const excluded =
      filters.excludeDomains?.some((domain) => hostMatchesDomain(result.url, domain)) ?? false;
    return included && !excluded;
  });
}

export function unsupportedSearchFilters(
  filters: SearchFilters | undefined,
  support: SearchFilterSupport,
): string[] {
  const unsupported: string[] = [];
  if ((filters?.includeDomains?.length || filters?.excludeDomains?.length) && support.domains === "unsupported") {
    unsupported.push("domains");
  }
  if ((filters?.startDate || filters?.endDate) && support.dates === "unsupported") {
    unsupported.push("dates");
  }
  return unsupported;
}
```

Keep `applyDomainFilters()` unchanged; it remains useful for providers that translate domains into upstream query syntax. The new post-filter must compare exact hosts and subdomains so `notexample.com` does not satisfy `example.com`.

- [ ] **Step 3: Write the failing contract tests.**

Add tests to `tests/providers/filter-support.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  filterResultsByDomains,
  unsupportedSearchFilters,
} from "../../src/utils/filters.ts";
import {
  UNSUPPORTED_SEARCH_FILTERS,
  type SearchFilterSupport,
  type SearchResult,
} from "../../src/providers/types.ts";

const results: SearchResult[] = [
  { title: "Docs", url: "https://docs.example.com/a", snippet: "docs" },
  { title: "Root", url: "https://example.com/b", snippet: "root" },
  { title: "Lookalike", url: "https://notexample.com/c", snippet: "other" },
];

describe("search filter support", () => {
  it("filters included domains by host and subdomain", () => {
    expect(filterResultsByDomains(results, { includeDomains: ["example.com"] })).toEqual(
      results.slice(0, 2),
    );
  });

  it("filters excluded domains without matching lookalike hosts", () => {
    expect(filterResultsByDomains(results, { excludeDomains: ["example.com"] })).toEqual([
      results[2],
    ]);
  });

  it("reports unsupported domain and date groups", () => {
    expect(
      unsupportedSearchFilters(
        {
          includeDomains: ["example.com"],
          startDate: "2026-01-01",
        },
        UNSUPPORTED_SEARCH_FILTERS,
      ),
    ).toEqual(["domains", "dates"]);
  });

  it("allows native domains and dates", () => {
    const support: SearchFilterSupport = { domains: "native", dates: "native" };
    expect(
      unsupportedSearchFilters(
        { includeDomains: ["example.com"], endDate: "2026-08-12" },
        support,
      ),
    ).toEqual([]);
  });
});
```

Update every `SearchProvider` test double to include `filterSupport: UNSUPPORTED_SEARCH_FILTERS`. Do not give a fixture native support unless that test is specifically testing filter behavior.

- [ ] **Step 4: Run the focused tests and confirm they fail for the missing contract.**

Run:

```bash
pnpm exec vitest run tests/providers/filter-support.test.ts tests/providers/types.test.ts
```

Expected: collection/type failures until the new types and functions exist.

### Task 2: Declare support on production adapters

**Files:**

- Modify: `src/providers/http-adapter.ts`
- Modify: `src/providers/http-providers.ts`
- Modify: `src/providers/duckduckgo.ts`
- Modify: `src/providers/exa.ts`
- Modify: `src/providers/tavily.ts`
- Modify: `src/providers/serper.ts`
- Modify: `src/providers/tinyfish.ts`
- Modify: `src/providers/firecrawl.ts`
- Modify: `src/providers/jina.ts`
- Modify: `src/providers/ollama.ts`
- Modify: `src/providers/openai-codex.ts`
- Modify: `src/providers/openai-web-search.ts`
- Modify: `src/providers/parallel.ts`
- Modify: `src/providers/searxng.ts`
- Modify: `src/providers/sofya.ts`

- [ ] **Step 1: Make the shared HTTP adapter carry support metadata.**

Add an optional field to `HttpSearchConfig` and copy it onto the returned provider:

```ts
export interface HttpSearchConfig {
  // existing fields...
  filterSupport?: SearchFilterSupport;
}

export function createHttpSearchProvider(apiKey: string, config: HttpSearchConfig): SearchProvider {
  return {
    name: config.name,
    label: config.label,
    filterSupport: config.filterSupport ?? UNSUPPORTED_SEARCH_FILTERS,
    async search(/* existing parameters */) {
      // existing request and parser implementation
    },
  };
}
```

Use a new object spread or a frozen constant if needed to avoid a provider mutating the shared unsupported object.

- [ ] **Step 2: Mark native and post-filter adapters.**

Use these exact declarations:

```ts
const NATIVE_DOMAIN_DATE_FILTERS: SearchFilterSupport = {
  domains: "native",
  dates: "native",
};

const NATIVE_DOMAIN_FILTERS: SearchFilterSupport = {
  domains: "native",
  dates: "unsupported",
};

const POST_FILTER_DOMAIN_FILTERS: SearchFilterSupport = {
  domains: "post-filter",
  dates: "unsupported",
};
```

Set `filterSupport` as follows:

- Brave Search, Exa, Serper, and TinyFish: `NATIVE_DOMAIN_DATE_FILTERS`.
- Tavily: `NATIVE_DOMAIN_FILTERS`.
- DuckDuckGo: `POST_FILTER_DOMAIN_FILTERS`; its date timelimit is approximate and its end date is not enforced, so dates remain unsupported.
- Brave LLM, fastCRW, LangSearch, Linkup, Marginalia, Perplexity, WebSearchAPI, and You.com: `UNSUPPORTED_SEARCH_FILTERS`.
- Firecrawl, Jina, Ollama, OpenAI Codex, OpenAI web search, Parallel, SearXNG, and Sofya: `UNSUPPORTED_SEARCH_FILTERS`.

For class-based providers, add `readonly filterSupport = ...` beside `name` and `label`. For HTTP providers, pass the value in each `createHttpSearchProvider` config. Import the constants as type-safe values from `src/providers/types.ts`.

- [ ] **Step 3: Preserve metadata through registry wrappers.**

In `ProviderRegistry.registerProvider()`, copy the source metadata into the wrapped search provider:

```ts
provider: {
  name: provider.name,
  label: provider.label,
  filterSupport: provider.filterSupport,
  search: async (query, maxResults, signal, filters) => {
    this.consume(options.name, { capability: "search", maxResults });
    return provider.search(query, maxResults, signal, filters);
  },
},
```

Do not apply filtering in the registry; the registry should preserve provider policy metadata and budget behavior, while the web-search module decides how requested filters affect a call.

- [ ] **Step 4: Run provider contract tests.**

Run:

```bash
pnpm exec vitest run tests/providers/filter-support.test.ts tests/providers/http-adapter.test.ts tests/providers/registry.test.ts tests/providers/types.test.ts
```

Expected: all focused tests pass.

### Task 3: Enforce the contract in `web_search`

**Files:**

- Modify: `src/tools/web-search.ts`
- Modify: `tests/tools/web-search.test.ts`

- [ ] **Step 1: Add the explicit unsupported-filter result shape.**

Extend `WebSearchDetails` without changing existing fields:

```ts
interface WebSearchDetails {
  provider: string;
  resultCount: number;
  unsupportedFilters?: string[];
  fusionMeta?: {
    providersUsed: string[];
    degraded: boolean;
    results: Array<{ url: string; providers: string[] }>;
  };
}
```

After `buildFilters(params)`, partition candidates with `unsupportedSearchFilters(filters, provider.filterSupport)`. If a candidate has unsupported groups, remove it. If no candidates remain and the original candidate list was non-empty, return:

```ts
{
  content: [{ type: "text", text: `Search error: no eligible provider supports requested filters: ${groups.join(", ")}` }],
  details: { provider: "none", resultCount: 0, unsupportedFilters: groups },
}
```

If the original candidate list is empty, preserve the existing `Search error: No search providers available` result.

- [ ] **Step 2: Apply only declared local domain post-filtering.**

Add a local function in `web-search.ts`:

```ts
function executeSearch(
  provider: SearchProvider,
  query: string,
  maxResults: number,
  signal: AbortSignal | undefined,
  filters: SearchFilters | undefined,
): Promise<SearchResult[]> {
  return provider.search(query, maxResults, signal, filters).then((results) =>
    provider.filterSupport.domains === "post-filter"
      ? filterResultsByDomains(results, filters)
      : results,
  );
}
```

Use `executeSearch()` in both the fusion candidate mapping and the ordinary `executeWithFallback()` mapping. Do not post-filter native providers; their upstream contract already enforces domains and local filtering could alter provider ranking unexpectedly.

- [ ] **Step 3: Add regression tests for explicit and post-filter behavior.**

Add tests to `tests/tools/web-search.test.ts` that prove:

1. An unsupported date provider is not called and returns a message containing `dates`.
2. A provider with `domains: "post-filter"` returns only exact-domain/subdomain results.
3. A fusion call excludes unsupported candidates before execution and still fuses the eligible providers.
4. An unfiltered call still sends the same candidate list and returns the same result formatting.

Use providers shaped like this in the tests:

```ts
const unsupported: SearchProvider = {
  name: "unsupported",
  label: "Unsupported",
  filterSupport: UNSUPPORTED_SEARCH_FILTERS,
  search: vi.fn().mockResolvedValue([]),
};

const postFiltered: SearchProvider = {
  name: "post-filtered",
  label: "Post-filtered",
  filterSupport: { domains: "post-filter", dates: "unsupported" },
  search: vi.fn().mockResolvedValue([
    { title: "good", url: "https://docs.example.com/a", snippet: "good" },
    { title: "bad", url: "https://other.example/a", snippet: "bad" },
  ]),
};
```

- [ ] **Step 4: Run focused tool tests.**

Run:

```bash
pnpm exec vitest run tests/tools/web-search.test.ts tests/providers/filter-support.test.ts
```

Expected: all tests pass.

### Task 4: Complete fixture updates and commit the phase

**Files:**

- Modify: `tests/config-manager.test.ts`
- Modify: `tests/commands/tools.test.ts`
- Modify: `tests/commands/tools-actions.test.ts`
- Modify: `tests/commands/tools-dashboard.test.ts`
- Modify: `tests/providers/registry.test.ts`
- Modify: `tests/providers/types.test.ts`

- [ ] **Step 1: Update all remaining SearchProvider fixtures.**

Add `filterSupport: UNSUPPORTED_SEARCH_FILTERS` to each fixture returned or inline-constructed in the listed tests. Keep the field explicit rather than using a cast, so future test providers cannot silently omit the contract.

- [ ] **Step 2: Run the complete phase gate.**

Run:

```bash
pnpm exec vitest run tests/providers/filter-support.test.ts tests/providers/http-adapter.test.ts tests/providers/registry.test.ts tests/providers/types.test.ts tests/tools/web-search.test.ts tests/commands/tools.test.ts tests/commands/tools-actions.test.ts tests/commands/tools-dashboard.test.ts tests/config-manager.test.ts
pnpm check
git diff --check
```

Expected: focused tests and the full suite pass; only the documented pre-existing Biome and Node-engine warnings remain.

- [ ] **Step 3: Commit the atomic phase.**

```bash
git add src/providers src/utils/filters.ts src/tools/web-search.ts tests
git commit -m "feat: make search filter support explicit"
```

The commit must not include catalog, runtime lifecycle, operation-policy, or extraction changes.

## Phase completion gate

- Filter support is declared on every production `SearchProvider`.
- Unsupported filtered calls fail explicitly before a provider request.
- Post-filter domains use exact host/subdomain matching.
- Unfiltered search behavior is unchanged.
- Focused tests, `pnpm check`, and `git diff --check` pass.
