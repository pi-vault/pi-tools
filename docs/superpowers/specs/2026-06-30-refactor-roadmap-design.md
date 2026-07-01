# pi-tools Refactor Roadmap

**Date:** 2026-06-30
**Status:** Draft
**Scope:** 6 phases covering robustness, search enrichment, fetch improvements, new providers, GitHub interception, and config/UX improvements.

## Context

Comparative analysis of 8 community Pi web-tools extensions identified gaps in pi-tools across resilience, feature surface, and configuration flexibility. This spec defines a phased roadmap to close those gaps, ordered from simplest architectural changes to the most complex, with each phase shipping an independently useful improvement.

### What pi-tools does well (preserve these)

- Clean architecture: typed provider interfaces, separated concerns (providers, tools, extract, utils)
- Comprehensive test suite (27 files, Vitest)
- Monthly quota tracking with file-persisted usage data
- Multi-tier extraction pipeline (Readability, RSC, Jina Reader, raw text)
- SSRF protection (private IP, localhost, link-local, credential blocking)
- Error sanitization (secret redaction, truncation)
- TUI renderers for all tools (collapsed/expanded/partial states)
- Three-form API key resolution (env var name, literal, shell command)

### Out of scope

- YouTube/video content extraction
- Gemini search provider
- Browser cookie authentication
- Curator/review UI
- Context7 library docs integration
- Streaming responses
- Disk-persisted content cache

## Phase 1: Provider Resilience

### Problem

When the auto-selected search provider fails (API error, timeout, rate limit), `web_search` throws. The model receives an error with no recourse. `web_fetch` similarly fails if the direct HTTP request fails, even when registered fetch providers (Exa, Firecrawl, Tavily, Jina) could retrieve the content.

### Changes

#### 1.1 Search fallback chain

Add `selectSearchCandidates(name?: string): SearchProvider[]` to `ProviderRegistry`. When `name` is `"auto"` or omitted, return all available providers ordered by the existing tier + remaining-quota logic. When `name` is a specific provider, return a single-element array (no fallback).

In `web_search`, loop through candidates: call `search()` on the first; if it throws, catch the error, record it, and try the next. Stop on first success.

#### 1.2 Fetch provider fallback

In `web_fetch`, when the direct HTTP fetch (the `extractContent` pipeline) fails, try each registered `FetchProvider` in order before throwing. Fallback triggers on: network errors (DNS failure, connection refused, timeout), HTTP 5xx server errors, and HTTP 429 rate limits. HTTP 4xx client errors (except 429) are not retried -- they indicate a problem with the request itself, not the provider. The extraction pipeline's own internal fallback chain (Readability -> RSC -> Jina Reader -> raw) is unchanged -- this new fallback only applies when the initial HTTP request itself fails.

#### 1.3 Aggregate error reporting

Add `AggregateProviderError` to `src/utils/errors.ts`. When all search candidates or all fetch providers fail, collect the per-provider error messages into a single result:

```
All search providers failed:
- brave: 429 Too Many Requests
- exa: Request timeout
- jina: 503 Service Unavailable
```

This gives the model actionable context about what went wrong.

### Files touched

- `src/providers/registry.ts` -- add `selectSearchCandidates()`
- `src/tools/web-search.ts` -- loop through candidates with try/catch
- `src/tools/web-fetch.ts` -- add fetch provider fallback after pipeline failure
- `src/utils/errors.ts` -- add `AggregateProviderError`
- New/updated tests for fallback behavior, aggregate errors

### What doesn't change

No new providers, no new parameters, no config changes. Pure internal resilience.

---

## Phase 2: Search Enrichment

### Problem

`web_search` accepts only `query`, `numResults`, and `provider`. Competing extensions support domain filtering, date filtering, and compact output formats that improve search precision and reduce context window usage.

### Changes

#### 2.1 Search filters

Add a `SearchFilters` type to `src/providers/types.ts`:

```ts
interface SearchFilters {
  includeDomains?: string[];
  excludeDomains?: string[];
  startDate?: string; // ISO 8601 date
  endDate?: string;   // ISO 8601 date
}
```

Extend `SearchProvider.search()` with an optional `filters` parameter:

```ts
search(
  query: string,
  maxResults: number,
  signal?: AbortSignal,
  filters?: SearchFilters,
): Promise<SearchResult[]>;
```

This is backward compatible -- existing providers that don't implement filtering ignore the parameter.

#### 2.2 New web_search parameters

Add to `WebSearchParams`:

- `includeDomains?: string[]` -- restrict results to these domains
- `excludeDomains?: string[]` -- exclude results from these domains
- `startDate?: string` -- only results published after this date
- `endDate?: string` -- only results published before this date

Pass these through to the provider as a `SearchFilters` object.

#### 2.3 Provider filter mapping

Map filters to provider-native API parameters where supported:

| Provider | includeDomains | excludeDomains | startDate | endDate |
|----------|---------------|----------------|-----------|---------|
| Brave | query `site:` | query `-site:` | `freshness` param | `freshness` param |
| Exa | `includeDomains` | `excludeDomains` | `startPublishedDate` | `endPublishedDate` |
| Tavily | `include_domains` | `exclude_domains` | not supported | not supported |
| Serper | query `site:` | query `-site:` | `tbs` param | `tbs` param |
| Firecrawl | not supported | not supported | not supported | not supported |
| DuckDuckGo | query `site:` | query `-site:` | `ddgsTimelimit` (approximate) | not supported |
| Jina | not supported | not supported | not supported | not supported |
| Perplexity | not supported | not supported | not supported | not supported |

Providers that don't support a filter silently ignore it. No error, best-effort.

#### 2.4 Compact output format

Add `compact?: boolean` parameter to `web_search`. When true, results use a single-line format:

```
1. Title -- URL
2. Title -- URL
```

Instead of the current multi-line format with snippets. The `details` object stays the same.

### Files touched

- `src/providers/types.ts` -- add `SearchFilters`, extend `search()` signature
- `src/tools/web-search.ts` -- add parameters, pass filters, add compact formatter
- `src/providers/brave.ts`, `exa.ts`, `tavily.ts`, `serper.ts` -- map filters
- `src/providers/duckduckgo.ts`, `jina.ts`, `perplexity.ts`, `firecrawl.ts` -- accept and ignore filters
- New/updated tests for filtering and compact output

### What doesn't change

No new providers, no changes to fetch, no config changes.

---

## Phase 3: Fetch Improvements

### Problem

`web_fetch` accepts a single URL, has no caching, and always returns extracted markdown. Competing extensions support multi-URL fetch with aggregate caps, raw HTML mode, and content caching.

### Changes

#### 3.1 Multi-URL support

Add `urls?: string[]` parameter alongside `url`. When `urls` is provided, fetch all URLs concurrently (max 5 concurrent). Each result includes URL, title, char count, and extracted text.

Aggregate sizing rules:

| URL count | Per-URL cap | Behavior |
|-----------|------------|----------|
| 1 | `INLINE_LIMIT` (15,000) | Current behavior, full content |
| 2-5 | `floor(INLINE_LIMIT / count)` | Split budget, full content stored via `web_read` |
| 6+ | 512 chars | Manifest mode: short previews, all full content stored |

Full content is always stored in `ContentStore` for retrieval via `web_read` with the returned `contentId`. The `details` object for multi-URL responses includes an array of per-URL metadata (url, title, chars, truncated, contentId).

Validation: exactly one of `url` or `urls` must be provided. `urls` max length: 20.

#### 3.2 Raw HTML mode

Add `raw?: boolean` parameter (default `false`). When true, return the HTTP response body as-is, skipping the Readability/Turndown extraction pipeline. SSRF validation and binary content-type blocking still apply.

In the extraction pipeline, `raw` is passed as an option to `extractContent()`. When set, the function fetches the URL, validates it, and returns the body text without parsing.

#### 3.3 Content caching

New `src/cache.ts` module with a bounded in-memory LRU cache:

```ts
class ContentCache {
  constructor(maxSize: number, ttlMs: number);
  get(url: string): ExtractedContent | undefined;
  set(url: string, content: ExtractedContent): void;
  clear(): void;
}
```

Defaults: `maxSize = 100`, `ttlMs = 300_000` (5 minutes).

`web_fetch` checks the cache before fetching. Cache hits return immediately. Cache misses fetch, then store the result.

Add `fresh?: boolean` parameter to `web_fetch`. When true, bypass the cache for this request (but still write the result back to the cache).

The cache is per-process, not persisted. Cleared when the process exits.

#### 3.4 Parameter schema update

Updated `WebFetchParams`:

```ts
const WebFetchParams = Type.Object({
  url: Type.Optional(Type.String({ description: "HTTP(S) URL to fetch" })),
  urls: Type.Optional(Type.Array(Type.String(), { maxItems: 20, description: "Multiple URLs to fetch" })),
  raw: Type.Optional(Type.Boolean({ default: false, description: "Return raw HTML without extraction" })),
  fresh: Type.Optional(Type.Boolean({ default: false, description: "Bypass content cache" })),
});
```

### Files touched

- `src/cache.ts` -- new LRU cache module
- `src/tools/web-fetch.ts` -- multi-URL orchestration, raw mode, cache integration, fresh param
- `src/extract/pipeline.ts` -- accept `raw` option for pass-through mode
- New/updated tests for multi-URL, raw mode, cache hit/miss/expiry/bypass

### What doesn't change

No new providers, no search changes, no config file changes.

---

## Phase 4: New Providers

### Problem

pi-tools has 8 providers. Several high-value providers are missing: Exa MCP (free, zero-config), OpenAI native (Pi-managed auth), Parallel, SearXNG (self-hosted), and WebSearchAPI (Google-powered). By this phase, the fallback chain from Phase 1 exists, so new providers benefit from automatic failover.

### Changes

#### 4.1 Exa MCP provider

**File:** `src/providers/exa-mcp.ts`

Free, zero-config endpoint at `https://mcp.exa.ai/mcp`. Uses JSON-RPC over HTTP to call the `web_search_exa` tool. No API key required. Registered as tier 3 (rate-limited free service). Implements `SearchProvider` only.

Enabled by default in config (no key required).

#### 4.2 OpenAI native provider

**File:** `src/providers/openai-native.ts`

Uses the OpenAI Responses API with the `web_search` tool type. API key resolved from `OPENAI_API_KEY` env var or config. Registered as tier 1. Implements `SearchProvider` only.

#### 4.3 Parallel provider

**File:** `src/providers/parallel.ts`

Search via `https://search.parallel.ai`. Requires `PARALLEL_API_KEY`. Registered as tier 1. Implements `SearchProvider` and `FetchProvider`.

#### 4.4 SearXNG provider

**File:** `src/providers/searxng.ts`

Self-hosted metasearch engine. Instance URL configurable via config (`instanceUrl`, default `http://localhost:8080`) or `SEARXNG_URL` env var. Optional API key via `SEARXNG_API_KEY`. Registered as tier 2. Implements `SearchProvider` only.

SSRF exemption: SearXNG instance URLs are intentionally on localhost/private networks. The SSRF validator skips validation for SearXNG's configured base URL.

#### 4.5 WebSearchAPI provider

**File:** `src/providers/websearchapi.ts`

Google-powered search via `https://api.websearchapi.com`. Requires `WEBSEARCHAPI_API_KEY`. Registered as tier 1. Implements `SearchProvider` only.

#### 4.6 Config and factory updates

Add all 5 providers to `providerFactories` in `src/index.ts`. Add default config entries in `src/config.ts`:

```json
{
  "exa-mcp": { "enabled": true },
  "openai-native": { "enabled": true, "apiKey": "OPENAI_API_KEY" },
  "parallel": { "enabled": false, "apiKey": "PARALLEL_API_KEY" },
  "searxng": { "enabled": false, "instanceUrl": "http://localhost:8080" },
  "websearchapi": { "enabled": false, "apiKey": "WEBSEARCHAPI_API_KEY" }
}
```

All disabled by default except Exa MCP (free, no config needed) and OpenAI native (uses standard env var).

#### 4.7 README update

Update the provider overview table to include all 13 providers with their capabilities and key requirements.

### Files touched

- 5 new files in `src/providers/`
- `src/index.ts` -- register new factories
- `src/config.ts` -- default config entries
- `README.md` -- updated provider table
- New tests for each provider (response parsing, error handling, auth)

### What doesn't change

No changes to existing providers, tools, or extraction pipeline. Pure additive.

---

## Phase 5: GitHub URL Interception

### Problem

When the model calls `web_fetch` with a `github.com` URL, it gets scraped HTML -- navigation chrome, JS-rendered content, often unusable. The content should come from the actual repository files.

### Changes

#### 5.1 GitHub URL parser

**File:** `src/extract/github.ts`

Parse `github.com` URLs into structured components:

```ts
interface GitHubUrl {
  owner: string;
  repo: string;
  ref?: string;    // branch, tag, or commit SHA
  path?: string;   // file or directory path within repo
  type: "tree" | "blob" | "root" | "raw" | "unknown";
}
```

Non-content URLs (issues, PRs, discussions, actions, settings, wiki) return `type: "unknown"` and are not intercepted -- they fall through to the normal extraction pipeline.

#### 5.2 Three-tier fetch strategy

When `web_fetch` receives a recognized GitHub content URL, try in order:

**Tier 1 -- Raw URL rewrite** (blob URLs only):
Rewrite `github.com/{owner}/{repo}/blob/{ref}/{path}` to `raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}`. Direct HTTP fetch, no auth needed. Only used for blob (individual file) URLs -- not for tree or root URLs.

**Tier 2 -- Clone cache** (root and tree URLs, or blob fallback when Tier 1 fails):
Shallow clone: `git clone --depth=1 --filter=blob:none --single-branch --branch={ref}`.
Cache location: temp directory, keyed by `{owner}/{repo}@{ref}`.
Session-scoped: clones persist for the process lifetime, not across sessions.

Return content based on URL type:
- Root URL: README content (truncated at 8,000 chars) + tree listing
- Tree URL: directory listing + README if present
- Blob URL (Tier 1 fallback): file content (truncated at 100,000 chars)

Tree listings capped at 200 entries. Noise directories filtered: `node_modules`, `.git`, `dist`, `build`, `vendor`, `__pycache__`, `.next`.

Clone size guard: check repo size via GitHub API before cloning. Skip to Tier 3 if above `maxRepoSizeMB` (default 350).

**Tier 3 -- GitHub API fallback** (large repos, clone failures):
Use `https://api.github.com/repos/{owner}/{repo}` endpoints:
- `/contents/{path}` for file content
- `/git/trees/{ref}?recursive=1` for tree listings

Works without auth (60 req/hour rate limit). If `GITHUB_TOKEN` env var is set, use it for higher limits (5,000 req/hour).

#### 5.3 Binary file detection

Check file extensions against a known binary list (`.png`, `.jpg`, `.gif`, `.ico`, `.woff`, `.woff2`, `.ttf`, `.zip`, `.tar`, `.gz`, `.exe`, `.dll`, `.so`, `.dylib`, `.o`, `.class`, `.pyc`). Also detect null bytes in the first 8KB of content.

Binary files return a short notice: `"Binary file: {path} ({size} bytes)"`.

#### 5.4 Integration point

The GitHub interceptor runs as the first check in `extractContent()`, before the HTTP fetch. If the URL is a recognized GitHub content URL and the interceptor succeeds, return its result directly. If it fails or the URL is not a content URL, fall through to the existing pipeline.

#### 5.5 Configuration

Add `github` section to config:

```json
{
  "github": {
    "enabled": true,
    "maxRepoSizeMB": 350,
    "cloneTimeoutSeconds": 30
  }
}
```

Enabled by default. `GITHUB_TOKEN` env var used for API calls when available (resolved via the existing `resolveApiKey` pattern).

### Files touched

- `src/extract/github.ts` -- new: URL parser, clone cache, API client, binary detection
- `src/extract/pipeline.ts` -- insert GitHub check at top of `extractContent()`
- `src/config.ts` -- add `github` config section with defaults
- New tests for URL parsing, clone logic, API fallback, binary detection, fallthrough

### What doesn't change

No changes to search, providers, or other extraction methods. Self-contained subsystem.

---

## Phase 6: Config & UX

### Problem

pi-tools has global config only. No project-level overrides, no interactive setup, no visibility into provider performance, and no way for users to customize tool prompt guidance.

### Changes

#### 6.1 Project-level config

Look for `.pi/pi-tools.json` in the current working directory (or nearest ancestor with a `.pi/` directory). If found, deep-merge with global config. Project settings override global settings per-key.

Resolution order (highest priority first):
1. Project `.pi/pi-tools.json`
2. Global `~/.pi/agent/extensions/pi-tools.json`
3. Built-in defaults

Deep merge: nested objects merge recursively; scalars and arrays from higher-priority sources replace lower-priority values.

#### 6.2 `/tools` slash command

Register a Pi command via `pi.registerCommand()`:

**`/tools`** (no args): Interactive provider setup. Prompts for:
- Which providers to enable/disable
- API keys for enabled providers
- Default provider selection (auto or specific)

Writes changes to the global config file.

**`/tools --status`**: Display a status table:

```
Provider     Tier  Enabled  Remaining  Session (ok/fail)  Avg Latency
brave        1     yes      1,847      12/1               340ms
exa          1     yes      982        8/0                520ms
duckduckgo   3     yes      unlimited  3/0                890ms
perplexity   2     yes      unlimited  0/0                --
```

Uses session metrics from 6.3 for the ok/fail and latency columns. Monthly remaining from the existing `UsageTracker`.

#### 6.3 Session-level backend scoring

Track per-provider metrics in memory during the session:

```ts
interface ProviderMetrics {
  successes: number;
  failures: number;
  totalLatencyMs: number;
}
```

Recorded in `ProviderRegistry` after each search call (success increments `successes` and adds latency; failure increments `failures`).

Add an optional `"best-performing"` selection strategy. When configured, `selectSearchCandidates()` sorts by a composite score:

```
score = (success_rate * 0.5) + (speed_score * 0.3) + (tier_score * 0.2)
```

Where `speed_score = 1 - (avg_latency / max_latency)` and `tier_score` maps tier 1 = 1.0, tier 2 = 0.6, tier 3 = 0.3.

This is opt-in via config: `"selectionStrategy": "best-performing"`. The default remains the existing tier-based selection.

Config field:

```json
{
  "selectionStrategy": "auto" | "best-performing"
}
```

`"auto"` is the existing behavior (tier + quota). `"best-performing"` uses session metrics.

#### 6.4 Prompt guidance overrides

Allow per-tool `promptSnippet` and `promptGuidelines` customization via config:

```json
{
  "guidance": {
    "web_search": {
      "promptSnippet": "Custom snippet text",
      "promptGuidelines": ["Guideline 1", "Guideline 2"]
    },
    "web_fetch": {
      "promptGuidelines": ["Custom fetch guideline"]
    }
  }
}
```

When set, these replace the built-in values for that tool. When absent, built-in defaults apply. Validated at config load time: `promptSnippet` must be a string, `promptGuidelines` must be an array of strings. Invalid values fall back to defaults.

### Files touched

- `src/config.ts` -- project config discovery, deep merge, `selectionStrategy`, `guidance` fields
- `src/index.ts` -- register `/tools` command
- `src/commands/tools.ts` -- new: interactive setup + status display
- `src/providers/registry.ts` -- session metrics tracking, `"best-performing"` selection logic
- `src/tools/web-search.ts`, `web-fetch.ts`, `web-read.ts`, `code-search.ts` -- read guidance overrides
- New/updated tests for config merging, command output, scoring, guidance

### What doesn't change

No new providers, no changes to extraction or fetch logic.

---

## Phase Dependencies

Phases build on each other where natural but each ships independently:

```
Phase 1 (resilience) -- no dependencies
Phase 2 (search)     -- no dependencies (can parallel with 1)
Phase 3 (fetch)      -- no dependencies (can parallel with 1, 2)
Phase 4 (providers)  -- benefits from Phase 1 (fallback chain) but works without it
Phase 5 (GitHub)     -- benefits from Phase 3 (caching) but works without it
Phase 6 (config/UX)  -- benefits from Phase 1 (metrics) but works without it
```

Recommended order is sequential (1 through 6) for cleanest integration, but phases 1-3 could run in parallel if needed.

## Release Strategy

Flexible. Each phase produces a working, testable improvement. Release when natural -- some phases may bundle into a single version bump, others may ship independently.

## Testing Strategy

Each phase includes tests for all new and modified code. The existing test suite (27 files) serves as a regression baseline. All phases must pass `pnpm check` (lint + typecheck + test) before merging.
