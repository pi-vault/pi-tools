# Phase 1: Explicit Search Filter Semantics

## Status

Approved revised design after repository review. The existing Phase 1 implementation plan is close but must be revised with the decisions and gates below before implementation starts.

## Review outcome

The repository is clean on branch `20260812-architecture-deepening-phase-1-filters`. The baseline `pnpm check` passes with 87 test files and 1,410 tests; the existing Biome warnings and Node 23 engine warning remain documented pre-existing conditions.

The current `SearchProvider` accepts domain and date filters without declaring whether an adapter enforces them. Several adapters ignore one or both groups. The original plan therefore addresses the right seam, but it was not implementation-ready because it did not specify the shared constant location, deterministic unsupported-group aggregation, cancellation at the early rejection path, runtime metadata-preservation tests, a production support-matrix test, or the user-facing README change.

## Goal

Prevent filtered searches from silently losing requested domain or date constraints.

For every filtered search, each eligible provider must either enforce every requested filter natively, declare safe local domain post-filtering, or be excluded before execution. If no candidate can enforce the request, `web_search` returns an explicit structured error.

## Non-goals

- Change provider ordering, selection strategy, budgets, fallback order, or fusion behavior.
- Add result top-up requests after local post-filtering.
- Redesign provider registration or introduce a general policy framework.
- Change invalid-date handling already performed by `buildFilters`.
- Clean unrelated lint warnings or modify the Node engine requirement.

## Filter-support contract

`src/providers/types.ts` owns the contract and its shared values:

```ts
export type SearchFilterMode = "native" | "post-filter" | "unsupported";

export interface SearchFilterSupport {
  readonly domains: SearchFilterMode;
  readonly dates: Exclude<SearchFilterMode, "post-filter">;
}

export const NATIVE_DOMAIN_DATE_FILTERS: SearchFilterSupport = {
  domains: "native",
  dates: "native",
};

export const NATIVE_DOMAIN_FILTERS: SearchFilterSupport = {
  domains: "native",
  dates: "unsupported",
};

export const POST_FILTER_DOMAIN_FILTERS: SearchFilterSupport = {
  domains: "post-filter",
  dates: "unsupported",
};

export const UNSUPPORTED_SEARCH_FILTERS: SearchFilterSupport = {
  domains: "unsupported",
  dates: "unsupported",
};
```

`SearchProvider` requires `readonly filterSupport: SearchFilterSupport`. This makes every production adapter and typed test double declare its filter policy. The HTTP adapter accepts optional metadata for configuration convenience and defaults to `UNSUPPORTED_SEARCH_FILTERS`, so an omitted declaration cannot silently become permissive.

The registry copies `filterSupport` into its budget-wrapped search provider. It preserves the metadata but does not apply filter logic; `web_search` remains the policy boundary.

## Production support matrix

| Providers | Domains | Dates |
| --- | --- | --- |
| Brave Search, Exa, Serper, TinyFish | native | native |
| Tavily | native | unsupported |
| DuckDuckGo | post-filter | unsupported |
| Brave LLM, fastCRW, LangSearch, Linkup, Marginalia, Perplexity, WebSearchAPI, You.com, Firecrawl, Jina, Ollama, OpenAI Codex, OpenAI web search, Parallel, SearXNG, Sofya | unsupported | unsupported |

Native means the provider adapter sends the provider-supported domain/date parameters or query syntax. `post-filter` means the provider may narrow its query, but returned URLs are centrally checked by exact host/subdomain matching before they are exposed. Unsupported means the candidate is excluded from a request that asks for that group.

## Domain post-filter

Add `filterResultsByDomains(results, filters)` and `unsupportedSearchFilters(filters, support)` to `src/utils/filters.ts`.

Domain matching parses each result URL with the native `URL` class, lowercases the hostname, trims surrounding dots from the requested domain, and accepts only an exact host or a subdomain. Thus `docs.example.com` matches `example.com`, while `notexample.com` does not. Invalid result URLs do not match an include or exclude domain.

The post-filter applies only when `support.domains === "post-filter"`. Native providers are not locally re-filtered, preserving their upstream ranking and semantics.

## `web_search` data flow

1. Resolve candidates through the existing selection and combine strategy.
2. If the original list is empty, preserve the existing `Search error: No search providers available` result.
3. Build the existing normalized filters.
4. Evaluate every candidate with `unsupportedSearchFilters`. Keep candidates with no unsupported groups in their original order. Collect the union of unsupported groups in deterministic `domains`, then `dates` order.
5. If no candidates remain, honor an already-aborted signal before returning an explicit unsupported-filter result. Do not call providers, reserve budget, create activity entries, or invoke success/failure/result callbacks.
6. Execute the eligible candidates through the existing fallback or fusion executor. Each provider call is wrapped so a post-filter-domain provider applies `filterResultsByDomains` to its returned results.
7. Preserve the existing executor behavior: ordinary fallback accepts a successful empty result, while fusion treats an empty result as unusable and continues. Do not make additional requests to refill results removed by local filtering.

Unfiltered searches pass the original candidate list and follow the current execution and formatting paths unchanged.

## Error behavior

When the original candidate list is non-empty but every candidate is ineligible, return:

```ts
{
  content: [{
    type: "text",
    text: "Search error: no eligible provider supports requested filters: domains, dates",
  }],
  details: {
    provider: "none",
    resultCount: 0,
    unsupportedFilters: ["domains", "dates"],
  },
}
```

The message lists only the requested groups that prevented eligibility. Unsupported candidates are not provider failures, so they do not affect activity, failure metrics, or fallback error aggregation. Provider failures, budget errors, cancellation handling, callbacks, and fusion metadata remain governed by the existing executors.

## Test design

- Contract tests cover exact host and subdomain inclusion, exclusion without lookalike matches, malformed URLs, unsupported-group detection, and native/post-filter combinations.
- A production support-matrix test asserts the declared policy for every registered search provider.
- HTTP-adapter tests cover custom metadata and the unsupported default.
- Registry tests assert that the budget wrapper preserves `filterSupport` at runtime.
- `web-search` tests cover unsupported providers not being called, explicit structured errors, partial eligibility, post-filter results, fusion candidate exclusion, early cancellation, and unchanged unfiltered behavior.
- All existing typed test fixtures update to provide `UNSUPPORTED_SEARCH_FILTERS` explicitly; no casts are added to bypass the contract.

## Files in scope

Modify the existing Phase 1 implementation file map:

- `src/providers/types.ts`
- `src/utils/filters.ts`
- `src/providers/http-adapter.ts`
- `src/providers/http-providers.ts`
- `src/providers/duckduckgo.ts`
- `src/providers/exa.ts`
- `src/providers/tavily.ts`
- `src/providers/serper.ts`
- `src/providers/tinyfish.ts`
- `src/providers/firecrawl.ts`
- `src/providers/jina.ts`
- `src/providers/ollama.ts`
- `src/providers/openai-codex.ts`
- `src/providers/openai-web-search.ts`
- `src/providers/parallel.ts`
- `src/providers/searxng.ts`
- `src/providers/sofya.ts`
- `src/providers/registry.ts`
- `src/tools/web-search.ts`
- the existing typed search-provider fixtures and focused tests
- `README.md`

Create:

- `tests/providers/filter-support.test.ts`

No Phase 2–5 files are in scope.

## Verification gate

Run the focused provider and tool tests, then:

```bash
pnpm check
git diff --check
git status --short
```

The phase is ready to merge only when all focused tests and the full suite pass, the diff contains only intended Phase 1 changes, and the README accurately describes native, post-filtered, and explicitly unsupported filter behavior.
