# Context7 Docs Lookup

Add `web_docs_search` and `web_docs_fetch` tools backed by the Context7 API, enabling the agent to look up version-aware library documentation on demand.

## Motivation

When the agent needs library/framework documentation, web_search returns generic results that may be outdated or irrelevant. Context7 provides LLM-reranked, up-to-date documentation snippets for thousands of libraries. Adding dedicated docs tools gives the agent a direct path to accurate library docs without scraping documentation sites.

## Tools

### web_docs_search

Search Context7 for libraries by name. Returns a ranked table of matching libraries the agent can choose from.

**Parameters:**

| Param     | Type   | Required | Description                                                          |
| --------- | ------ | -------- | -------------------------------------------------------------------- |
| `library` | string | yes      | Library name to search for (e.g. "react", "next.js", "express")      |
| `query`   | string | yes      | What the agent is trying to do — drives Context7's relevance ranking |

**Output:** Compact markdown table with top 10 results:

```
| ID | Name | Trust | Snippets | Description |
|----|------|-------|----------|-------------|
| /facebook/react | React | 10 | 2500 | A JavaScript library for... |
| /preactjs/preact | Preact | 8 | 450 | Fast 3kB alternative... |
```

If more than 10 results exist, appends "(N more omitted)".

**Prompt guidelines:**

- "Use web_docs_search to find library IDs before calling web_docs_fetch."
- "Prefer web_docs_search + web_docs_fetch over web_search for library/framework documentation."

**Error handling:**

- Zero results: returns "No libraries found matching '{library}'." (valid result, not a throw)
- API failures (network, 401, 429): throws from execute() so Pi marks the tool call as failed

### web_docs_fetch

Retrieve focused documentation for a specific library. Uses the library ID obtained from web_docs_search.

**Parameters:**

| Param       | Type   | Required | Description                                                             |
| ----------- | ------ | -------- | ----------------------------------------------------------------------- |
| `libraryId` | string | yes      | Context7 library ID (e.g. "/facebook/react", "/vercel/next.js@v15.1.8") |
| `query`     | string | yes      | Specific question about the library (drives relevance ranking)          |

**Output:** Pre-formatted markdown from Context7's `type=txt` response. Contains code snippets with source links, documentation sections with breadcrumbs, and library-specific rules when available.

**Truncation:** When the response exceeds the inline limit, the full content is stored via ContentStore with a `contentId`. The truncated output includes a notice directing the agent to use `web_read` with the contentId. This reuses the existing pattern from web_fetch.

**Prompt guidelines:**

- "Use web_docs_fetch after web_docs_search to get documentation for a specific library."
- "Always provide a specific question in the query parameter for best results."
- "Pin a version with /owner/repo@version for consistent results."

**Error handling:**

- 202 (library still processing): returns "Library is being processed. Try again in a few minutes." (not a throw — temporary state)
- 301 (redirect): follows redirectUrl automatically, transparent to agent
- 404 (library not found): throws
- 401, 402, 429: throws with descriptive message

## Architecture

### New Interface: DocsProvider

Added to `src/providers/types.ts`:

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

This extends the existing provider interface pattern (SearchProvider, FetchProvider, CodeSearchProvider) with a fourth capability. The interface is intentionally a single combined type because the two operations are tightly coupled — searchLibrary provides the ID that getContext requires.

### Provider Implementation: context7

`src/providers/context7.ts` implements DocsProvider by wrapping Context7's REST API:

- `GET https://context7.com/api/v2/libs/search` with params `libraryName`, `query`
- `GET https://context7.com/api/v2/context` with params `libraryId`, `query`, `type=txt`

The provider exports `providerMeta` following the standard pattern:

```typescript
export const providerMeta: ProviderMeta = {
  name: "context7",
  tier: 1,
  monthlyQuota: null,
  requiresKey: true,
  create: (key) => ({
    docs: createContext7DocsProvider(key!),
  }),
};
```

**API key:** Resolved through our existing `resolveApiKey()` — supports env var name (`CONTEXT7_API_KEY`), literal value, or `!command` shell execution.

**Auth header:** `Authorization: Bearer <key>`

**Error handling:** Custom `Context7Error` class with status-specific messages:

- 401: "Invalid API key. API keys should start with 'ctx7sk' prefix."
- 402: "Spending limit exceeded. Raise the limit at context7.com/dashboard/billing."
- 404: "Library not found. Check the library ID or search again."
- 429: "Rate limited. Try again after {Retry-After} seconds."

### ProviderMeta Extension

The `ProviderMeta.create()` return type gains an optional `docs` field:

```typescript
create: (key?: string, providerConfig?: ProviderConfigEntry) => {
  search?: SearchProvider;
  fetch?: FetchProvider;
  codeSearch?: CodeSearchProvider;
  docs?: DocsProvider;  // NEW
};
```

### Registry Extension

`ProviderRegistry` gains two methods:

- `registerDocs(provider: DocsProvider): void` — stores the docs provider
- `selectDocs(): DocsProvider | undefined` — returns the registered docs provider (or undefined if none)

No tier-based selection or fallback needed — there's currently only one docs provider. The interface supports future alternatives without code changes.

### Registration Flow

In `src/index.ts`, the existing provider registration loop gains a `docs` check:

```typescript
// Inside the existing for-loop over allProviders:
if (instances.docs) {
  registry.registerDocs(instances.docs);
}
```

After the loop, conditional tool registration:

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

Tools only appear when context7 is enabled and has a resolved API key.

### Config

`context7` added to DEFAULT_CONFIG in `src/config.ts`:

```typescript
providers: {
  // ... existing ...
  context7: { enabled: true, apiKey: "CONTEXT7_API_KEY" },
}
```

Users configure via:

- Environment variable: `export CONTEXT7_API_KEY=ctx7sk_...`
- Global config: `~/.pi/agent/extensions/tools.json` → `providers.context7.apiKey`
- Project config: `.pi/tools.json` → `providers.context7.apiKey`
- Shell command: `"!op read op://pi/context7/api-key"`

## File Changes

| Action   | File                                  | Change                                              |
| -------- | ------------------------------------- | --------------------------------------------------- |
| New      | `src/providers/context7.ts`           | Context7 DocsProvider implementation + providerMeta |
| New      | `src/tools/web-docs-search.ts`        | web_docs_search tool factory                        |
| New      | `src/tools/web-docs-fetch.ts`         | web_docs_fetch tool factory                         |
| Modified | `src/providers/types.ts`              | Add DocsSearchResult, DocsProvider interfaces       |
| Modified | `src/providers/all.ts`                | Add context7 to provider barrel                     |
| Modified | `src/providers/registry.ts`           | Add registerDocs(), selectDocs()                    |
| Modified | `src/config.ts`                       | Add context7 to DEFAULT_CONFIG providers            |
| Modified | `src/index.ts`                        | Register docs tools when docs provider available    |
| New      | `tests/providers/context7.test.ts`    | Client/provider unit tests                          |
| New      | `tests/tools/web-docs-search.test.ts` | Search tool tests                                   |
| New      | `tests/tools/web-docs-fetch.test.ts`  | Fetch tool tests                                    |

## Dependencies

None. Uses Node 24's built-in `fetch`. No new npm packages required.

## Testing Strategy

### tests/providers/context7.test.ts

- Mocks global fetch
- searchLibrary: successful response parsing, empty results, API title-to-name mapping
- getContext: txt mode returns string directly, handles 202 (returns message), follows 301 redirects
- Error cases: 401, 402, 404, 429 with correct error messages
- AbortSignal forwarded to fetch calls

### tests/tools/web-docs-search.test.ts

- Provider unavailable (no key): returns setup instructions
- Successful search: formats markdown table correctly
- Zero results: returns "No libraries found" text (does not throw)
- API error: throws (Pi marks as failed)
- Rendering: renderCall shows query, renderResult shows count collapsed / table rows expanded

### tests/tools/web-docs-fetch.test.ts

- Provider unavailable (no key): returns setup instructions
- Successful fetch: returns markdown content
- Large response: truncates with contentId, stored in ContentStore
- 202 response: returns "try again later" message (does not throw)
- 404 response: throws
- Rendering: renderCall shows libraryId + query, renderResult shows char count

## Out of Scope

- JSON mode (`type=json`) for getContext — txt mode is sufficient for agent consumption. JSON mode can be added later if structured parsing is needed.
- Retry logic with exponential backoff — keep consistent with other providers (no retry).
- Caching — Context7 recommends caching but we'll defer to a future enhancement. The agent rarely queries the same library+question twice in one session.
- The `fast` query parameter — LLM reranking is the whole point; skipping it defeats the purpose.
