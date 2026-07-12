# Search Providers Expansion: 21 Providers (pi-search-hub Parity + Existing Uniques)

**Date:** 2026-07-12
**Status:** Approved
**Source:** `@ronnieops/pi-search-hub` at `/Users/lanh/Developer/pi-packages/ronnieops-pi-search-hub`

## Summary

Expand pi-tools' search provider ecosystem from 14 to 21 providers by porting 7 new providers from pi-search-hub, replacing `openai-native` with a dual-mode `openai-codex` provider, and adopting two cross-cutting improvements: credential resolution caching and pure response parser extraction. The final 21 count includes pi-search-hub's 19 providers plus pi-tools' unique `context7` and `parallel` providers.

## Scope

### New providers (7 net new + 1 replacement)

| Provider     | Tier | Key Required           | Capabilities   | API Endpoint                                      |
| ------------ | ---- | ---------------------- | -------------- | ------------------------------------------------- |
| marginalia   | 3    | No (public shared key) | Search         | `https://api2.marginalia-search.com/search`       |
| langsearch   | 2    | Yes (free, no CC)      | Search         | `https://api.langsearch.com/v1/web-search`        |
| brave-llm    | 1    | Yes (shares brave key) | Search         | `https://api.search.brave.com/app/v1/llm/context` |
| linkup       | 2    | Yes                    | Search         | `https://api.linkup.so/v1/search`                 |
| youcom       | 2    | Yes                    | Search         | `https://api.you.com/v1/search`                   |
| fastcrw      | 2    | Yes                    | Search + Fetch | `https://api.fastcrw.com/v1/search`               |
| sofya        | 2    | Yes                    | Search + Fetch | `https://sofya.co/v1/search`                      |
| openai-codex | 1    | No (dual mode)         | Search         | Pi AuthStorage or OpenAI Responses API            |

### Cross-cutting improvements

1. **Credential resolution** -- caching, fallback env vars, safety checks
2. **Pure response parsers** -- extract all parsing into testable pure functions
3. **Existing provider review** -- incorporate pi-search-hub improvements

### Out of scope

- New tools (no new tool registrations)
- Changes to fusion/RRF logic
- Changes to extraction pipeline
- Changes to config file format (additive config options only)

## Phases

Ordered from simplest to most complex. Each phase produces a working, testable increment.

---

### Phase 1: Credential Resolution Improvements

**Goal:** Enhance `resolveApiKey()` with caching, fallback env vars, warnings, and safety checks.

**Changes to `src/config.ts`:**

- Add `commandValueCache` Map storing `{ value?: string, error?: string }` per shell command reference
- Add `clearCredentialCache()` export for config refresh and `/tools --reload`
- Add `FALLBACK_ENV_MAP` constant mapping provider names to conventional env var names:
  ```
  { brave: "BRAVE_API_KEY", exa: "EXA_API_KEY", jina: "JINA_API_KEY",
    tavily: "TAVILY_API_KEY", serper: "SERPER_API_KEY", firecrawl: "FIRECRAWL_API_KEY",
    perplexity: "PERPLEXITY_API_KEY", langsearch: "LANGSEARCH_API_KEY",
    linkup: "LINKUP_API_KEY", youcom: "YOUCOM_API_KEY", fastcrw: "FASTCRW_API_KEY",
    sofya: "SOFYA_API_KEY", websearchapi: "WEBSEARCHAPI_API_KEY",
    marginalia: "MARGINALIA_API_KEY" }
  ```
- Add safety check: reject literal values `"null"`, `"undefined"`, `"none"` (return `undefined`)
- Add `console.warn` when an ALL_CAPS reference doesn't resolve from env
- Add `resolveProviderKey(providerName: string, configKey?: string): string | undefined` that checks config key first, then `FALLBACK_ENV_MAP`

**Changes to `src/config-manager.ts`:**

- Call `clearCredentialCache()` on config refresh (30s TTL already triggers this)
- Use `resolveProviderKey()` during provider registration

**Behavior:**

- Shell commands (`!op read ...`) execute once per config cycle, result cached
- Setting `BRAVE_API_KEY` env var enables brave without config entry
- `apiKey: "null"` in config returns `undefined` instead of sending `"null"` as auth
- `apiKey: "MISSING_VAR"` logs warning if env is unset

**Tests:** `tests/config.test.ts` additions for cache behavior, fallback resolution, safety checks, cache invalidation on `clearCredentialCache()`.

---

### Phase 2: Marginalia Provider

**Goal:** Add marginalia as a tier 3 free search provider.

**New file: `src/providers/marginalia.ts`**

```typescript
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
          count: String(maxResults),
        });
        return `https://api2.marginalia-search.com/search?${params}`;
      },
      method: "GET",
      buildHeaders: (apiKey) => ({ "Api-Key": apiKey }),
      extractResults: parseMarginaliaResults,
    }),
  }),
};
```

- Falls back to `"public"` shared key if no user key configured
- Optional user key for higher rate limits

**Changes:**

- Add to `src/providers/all.ts`
- Create `src/providers/parsers.ts` with `parseMarginaliaResults` as the first entry. This file grows incrementally through Phases 3-5 as new providers are added, and Phase 6 backfills it with parsers extracted from existing providers.

**Tests:** `tests/providers/marginalia.test.ts` -- mock HTTP, verify result mapping, public key fallback, rate limit error handling.

---

### Phase 3: LangSearch Provider

**Goal:** Add langsearch as a tier 2 search provider.

**New file: `src/providers/langsearch.ts`**

```typescript
export const providerMeta: ProviderMeta = {
  name: "langsearch",
  tier: 2,
  monthlyQuota: null,
  requiresKey: true,
  create: (key) => ({
    search: createHttpSearchProvider(key!, {
      name: "langsearch",
      label: "LangSearch",
      endpoint: "https://api.langsearch.com/v1/web-search",
      method: "POST",
      authPrefix: "Bearer ",
      buildBody: (query, maxResults) => ({
        query,
        max_results: Math.min(maxResults, 20),
      }),
      extractResults: parseLangSearchResults,
    }),
  }),
};
```

Response shape: `{ data: { webPages: { value: [{ name, url, snippet, description }] } } }` with fallback to `results` or `data` arrays. Parser maps `name` to `title`.

**Changes:** Add to `src/providers/all.ts`.

**Tests:** `tests/providers/langsearch.test.ts`.

---

### Phase 4: Brave LLM Provider

**Goal:** Add brave-llm as a tier 1 provider using Brave's AI context endpoint.

**New file: `src/providers/brave-llm.ts`**

```typescript
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

- Shares API key with `brave` (same subscription token)
- `tokenBudget` config option controls response size (optional)
- Response shape: `{ chunks: [{ content, relevance_score, source: { url, title }, type }] }` -- parser maps `source.title` to title, `source.url` to url, `content` to snippet

**Changes:**

- Add to `src/providers/all.ts`
- Add `tokenBudget?: number` to `ProviderConfigEntry` in `src/providers/types.ts`

**Tests:** `tests/providers/brave-llm.test.ts`.

---

### Phase 5: Linkup, You.com, fastCRW, Sofya Providers

**Goal:** Add 4 tier 2 paid providers.

#### `src/providers/linkup.ts`

- POST `https://api.linkup.so/v1/search`
- Bearer token auth
- Body: `{ query, outputType: "searchResults", depth: "standard" | "deep" }`
- Response: `{ searchResults: [{ url, title, content }] }` with fallbacks to `results` or `data`
- Config option: `depth: "standard" | "deep"` (default: `"standard"`)
- Capabilities: SearchProvider only

#### `src/providers/youcom.ts`

- GET `https://api.you.com/v1/search`
- Header: `X-API-Key`
- Params: `query`, `num_web_results`
- Response: `{ hits: [{ title, url, description, snippets[] }] }`
- Capabilities: SearchProvider only

#### `src/providers/fastcrw.ts`

- POST `https://api.fastcrw.com/v1/search` (configurable via `baseUrl`)
- Bearer token auth
- Body: `{ query, limit }` (max 20)
- Response: `{ success: true, data: [{ url, title, description }] }`
- Config option: `baseUrl` (override for self-hosted/proxy)
- Capabilities: SearchProvider only (pi-search-hub does not implement a fetch endpoint for fastcrw)
- Monthly quota: 500 free credits

#### `src/providers/sofya.ts`

- POST `https://sofya.co/v1/search`
- Bearer token auth
- Body: `{ query, search_depth, max_results, include_answer: false, topic }`
- Response: `{ results: [{ title, url, content, description, published_date }] }`
- Config options: `searchDepth: "snippets" | "basic"` (default: `"basic"`), `topic: "general" | "news"` (default: `"general"`)
- Capabilities: SearchProvider + FetchProvider (250+ content parsers)
- FetchProvider: POST `https://sofya.co/v1/fetch` with `{ urls: [url], include_raw_html: false }`, returns extracted content

**Changes to `src/providers/types.ts`:**

```typescript
// Additions to ProviderConfigEntry:
depth?: "standard" | "deep";       // linkup
baseUrl?: string;                   // fastcrw
searchDepth?: "snippets" | "basic"; // sofya
topic?: "general" | "news";        // sofya
```

**Changes:** Add all 4 to `src/providers/all.ts`.

**Tests:** One test file per provider.

---

### Phase 6: Pure Parser Extraction (Existing Providers)

**Goal:** Extract inline response parsing from existing provider files into `src/providers/parsers.ts` (which already contains parsers for new providers added in Phases 2-5).

**Additions to `src/providers/parsers.ts`**

Backfill with parsers extracted from existing providers:

- `parseBraveResults(data: unknown): SearchResult[]`
- `parseDuckDuckGoResults(data: unknown): SearchResult[]`
- `parseExaResults(data: unknown): SearchResult[]`
- `parseFirecrawlResults(data: unknown): SearchResult[]`
- `parseJinaResults(data: unknown): SearchResult[]`
- `parsePerplexityResults(data: unknown): SearchResult[]`
- `parseSearxngResults(data: unknown): SearchResult[]`
- `parseSerperResults(data: unknown): SearchResult[]`
- `parseTavilyResults(data: unknown): SearchResult[]`
- `parseWebSearchApiResults(data: unknown): SearchResult[]`

(Parsers for marginalia, langsearch, brave-llm, linkup, youcom, fastcrw, sofya already exist from Phases 2-5.)

**Function contract:**

- Accepts raw API response typed as `unknown`
- Returns `SearchResult[]` (title, url, snippet)
- Pure: no HTTP calls, no side effects, no imports beyond types
- Handles malformed input gracefully (returns `[]`)
- Truncates snippets to 500 characters

**Excluded from extraction:**

- `openai-codex` -- tool call argument parsing is not standard HTTP JSON
- `exa-mcp` -- MCP protocol response format
- `exa-deep-research` -- research-specific format

**Changes to existing provider files:**

- Remove inline `extractResults` lambdas
- Import corresponding parser function
- Pass as `extractResults: parseBraveResults` to `createHttpSearchProvider`
- For custom-class providers (tavily, exa): call parser inside the search method

**No changes to `http-adapter.ts`** -- the `extractResults` field already accepts any function reference.

**New file: `tests/providers/parsers.test.ts`**

- One test per parser with representative API response fixture
- Tests malformed/empty input returns `[]`
- Tests snippet truncation at 500 chars
- Pure unit tests requiring no HTTP mocking

**Migration strategy:** Extract parsers one at a time. Each extraction is a tiny commit. Existing provider tests continue passing since behavior is unchanged.

---

### Phase 7: Dual-Mode OpenAI Codex

**Goal:** Replace `openai-native` with `openai-codex` supporting Pi AuthStorage with public API fallback.

**Replace: `src/providers/openai-native.ts` -> `src/providers/openai-codex.ts`**

```typescript
export const providerMeta: ProviderMeta = {
  name: "openai-codex",
  tier: 1,
  monthlyQuota: null,
  requiresKey: false, // either Pi auth or user key
  create: (key, providerConfig) => {
    // Dynamic detection of available auth mode
    const provider = createOpenAICodexProvider(key, providerConfig);
    if (!provider) return {};
    return { search: provider };
  },
};
```

**Dual-mode resolution in `createOpenAICodexProvider()`:**

Note: `ProviderMeta.create()` is synchronous, but `AuthStorage.getApiKey()` is async (`Promise<string | undefined>`). Mode detection must be deferred to first `search()` call or use a lazy initialization pattern where `create()` returns a provider that resolves its mode on first use.

1. **Try Mode A (Codex):** Dynamic import `@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai`. If available and `AuthStorage.getApiKey("openai-codex", { includeFallback: false })` resolves, use streaming Codex mode.
2. **Fallback Mode B (Responses API):** If Mode A fails (packages not available or auth not configured), use user-provided `OPENAI_API_KEY` with the Responses API endpoint.
3. **Neither available:** Return empty results or throw (provider registered optimistically since either Pi auth or env key may become available).

**Mode A behavior:**

- Uses `openAICodexResponsesStreams.stream` from `@earendil-works/pi-ai` (the non-deprecated API; `streamOpenAICodexResponses` is deprecated)
- Model: `gpt-5.4-mini` (configurable via `providerConfig.model`)
- Injects `web_search` tool with `external_web_access: true`
- System prompt instructs model to call `submit_search_results` with structured results
- Rich snippets: 450-500 char dense paragraphs
- Options: `{ reasoningEffort: "minimal", textVerbosity: "low" }`

**Mode B behavior:**

- POST `https://api.openai.com/v1/responses`
- Model: `gpt-4.1-nano` (configurable via `providerConfig.model`)
- Tools: `[{ type: "web_search" }]`, `tool_choice: "required"`
- Extracts URL citations from response annotations
- Deduplicates by URL

**Package changes (`package.json`):**

```json
{
  "peerDependencies": {
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-coding-agent": "*"
  },
  "peerDependenciesMeta": {
    "@earendil-works/pi-ai": { "optional": true },
    "@earendil-works/pi-coding-agent": { "optional": true }
  }
}
```

**Backward compatibility:**

- Config key `openai-native` resolves as alias to `openai-codex` with deprecation warning
- Existing `OPENAI_API_KEY` env var continues to work (Mode B)

**Changes to `src/providers/all.ts`:**

- Replace `openai-native` import with `openai-codex`

**Tests: `tests/providers/openai-codex.test.ts`**

- Test Mode A: mock Pi package imports, verify streaming call + tool result parsing
- Test Mode B: mock fetch, verify Responses API call and annotation extraction
- Test fallback: Pi imports fail -> Mode B activates with user key
- Test neither available -> provider not registered
- Test config alias: `openai-native` config maps to `openai-codex`

---

### Phase 8: Review Existing Providers

**Goal:** Compare 11 overlapping providers with pi-search-hub implementations and incorporate improvements.

**Review process per provider:** Diff implementations side-by-side, identify additive improvements, apply as small targeted changes.

**Expected improvements:**

| Provider   | Improvement                     | Change                                                                              |
| ---------- | ------------------------------- | ----------------------------------------------------------------------------------- |
| duckduckgo | Regional/time filtering options | Add `ddgsBackend`, `ddgsRegion`, `ddgsTimelimit` config options, pass to subprocess |
| exa        | Quota warning at threshold      | Log warning when monthly usage exceeds 800/1000                                     |
| firecrawl  | Keyless mode                    | Allow `requiresKey: false` with keyless endpoint (1000 credits/mo)                  |
| jina       | Optional key mode               | Change to `requiresKey: false`, key optional for higher rate limits                 |
| perplexity | Model selection                 | Add `model` config option (sonar, sonar-pro, etc.), pass to API body                |
| searxng    | Auth header support             | Pass optional Bearer token in headers when configured                               |

**No changes expected for:** brave, exa-mcp, serper, tavily, websearchapi (pi-tools implementations already match or exceed pi-search-hub).

**Changes to `src/providers/types.ts`:**

```typescript
// Additions to ProviderConfigEntry:
ddgsBackend?: string;
ddgsRegion?: string;
ddgsTimelimit?: string;
// model?: string already added in Phase 7
```

**Tests:** Update existing provider tests to cover new config options.

---

## Testing Strategy

- Each phase has its own test additions
- All existing tests must continue passing throughout
- Pure parser tests (`parsers.test.ts`) cover the extraction refactor
- Provider tests use the established mock pattern (stubFetch, stubExec)
- Integration test: verify all 21 providers register correctly given appropriate config

## Provider Count After Completion

| Category  | Count  | Providers                                                                                     |
| --------- | ------ | --------------------------------------------------------------------------------------------- |
| Tier 1    | 5      | brave, brave-llm, exa, firecrawl, openai-codex                                                |
| Tier 2    | 9      | context7 (docs), fastcrw, langsearch, linkup, perplexity, sofya, tavily, websearchapi, youcom |
| Tier 3    | 5      | duckduckgo, exa-mcp, jina, marginalia, searxng                                                |
| Special   | 2      | parallel, serper                                                                              |
| **Total** | **21** |                                                                                               |

Note: context7 is docs-only (not search). serper and parallel may shift tiers during Phase 8 review.

## Dependencies

**New production dependencies:** None (all HTTP via native fetch).

**New optional peer dependencies (Phase 7):**

- `@earendil-works/pi-ai: *` (for `openAICodexResponsesStreams.stream`)
- `@earendil-works/pi-coding-agent: *` (for `AuthStorage.getApiKey()`)

Both declared with `peerDependenciesMeta: { optional: true }` so the extension works without them (falls back to Mode B or skips the provider).

## Risk

- **API documentation accuracy:** Provider API shapes are validated against pi-search-hub source code. Minor discrepancies were caught during spec review and corrected. If upstream APIs change, we may need adjustments during implementation.
- **Codex mode availability:** Mode A depends on Pi internals that may change. The `streamOpenAICodexResponses` alias is already deprecated in favor of `openAICodexResponsesStreams.stream`. The fallback to Mode B ensures the provider always works.
- **Async initialization:** `AuthStorage.getApiKey()` is async but `ProviderMeta.create()` is sync. Requires lazy init pattern (mode resolved on first `search()` call).
- **Parser extraction regressions:** Mitigated by extracting one parser at a time with existing tests passing at each step.
