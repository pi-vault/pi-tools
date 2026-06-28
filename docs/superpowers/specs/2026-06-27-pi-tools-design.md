# Pi Tools Extension Design

Pi extension providing code search, web fetch, and web search tools with multi-provider support and quota-aware rotation.

## Tools

Four tools registered via the Pi ExtensionAPI:

| Tool          | Purpose                       | Input                       | Provider(s)                                                    |
| ------------- | ----------------------------- | --------------------------- | -------------------------------------------------------------- |
| `web_search`  | Multi-provider web search     | query, numResults, provider | All 8 providers, auto-balanced by quota                        |
| `web_fetch`   | URL content extraction        | url                         | Extraction pipeline (Readability, RSC, Jina, Firecrawl/Tavily) |
| `code_search` | Web-based code/docs search    | query, numResults           | Exa Code context                                               |
| `web_read`    | Retrieve stored content by ID | contentId                   | None (memory lookup)                                           |

## Architecture

```
src/
├── index.ts                    # Extension entry: registers all tools, commands, events
├── config.ts                   # Load settings from env vars + config file, provider toggle
├── storage.ts                  # Session-local content store (in-memory + sidecar via appendEntry)
│
├── tools/
│   ├── web-search.ts           # web_search tool definition + execute
│   ├── web-fetch.ts            # web_fetch tool definition + execute
│   ├── code-search.ts          # code_search tool definition + execute
│   └── web-read.ts             # web_read tool definition + execute
│
├── providers/
│   ├── types.ts                # SearchProvider / FetchProvider / CodeSearchProvider interfaces
│   ├── registry.ts             # Provider registry, quota-aware selection, factory
│   ├── brave.ts                # Brave Search API
│   ├── exa.ts                  # Exa (search + code context + contents)
│   ├── tavily.ts               # Tavily (search + extract)
│   ├── jina.ts                 # Jina (search + reader)
│   ├── duckduckgo.ts           # DuckDuckGo (free, no key)
│   ├── serper.ts               # Google Serper
│   ├── perplexity.ts           # Perplexity Sonar
│   └── firecrawl.ts            # Firecrawl (search + scrape)
│
├── extract/
│   ├── pipeline.ts             # Orchestrator: tries extractors in order
│   ├── html.ts                 # Fetch + Readability + Turndown -> Markdown
│   ├── pdf.ts                  # PDF text extraction (unpdf)
│   ├── rsc.ts                  # Next.js React Server Components parser
│   └── jina-reader.ts          # Jina Reader fallback for JS-rendered pages
│
└── utils/
    ├── ssrf.ts                 # SSRF guard (block private IPs, metadata endpoints)
    ├── truncate.ts             # Bounded output + temp-file spillover
    └── errors.ts               # Error sanitization (redact credentials)
```

Key structural decisions:

- **Tools** own schema, description, guidance, and rendering. They delegate to providers and extractors.
- **Providers** implement role-based interfaces. The registry selects providers based on config, availability, and remaining quota.
- **Extract** pipeline handles the web_fetch fallback chain independently of providers.
- **Config** is the single source of truth for enabled providers and credentials.

## Provider System

### Interfaces

Three role-based contracts. A provider implements one or more:

```typescript
interface SearchProvider {
  readonly name: string;
  readonly label: string;
  search(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
  ): Promise<SearchResult[]>;
}

interface FetchProvider {
  readonly name: string;
  fetch(url: string, signal?: AbortSignal): Promise<FetchResult>;
}

interface CodeSearchProvider {
  readonly name: string;
  codeSearch(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
  ): Promise<CodeSearchResult[]>;
}
```

### Provider Registry

| Provider   | Search | Fetch          | Code Search        | Requires Key | Default Monthly Quota |
| ---------- | ------ | -------------- | ------------------ | ------------ | --------------------- |
| DuckDuckGo | yes    | -              | -                  | no           | unlimited             |
| Jina       | yes    | yes (reader)   | -                  | optional     | unlimited             |
| Brave      | yes    | -              | -                  | yes          | 2,000                 |
| Serper     | yes    | -              | -                  | yes          | 2,500                 |
| Tavily     | yes    | yes (extract)  | -                  | yes          | 1,000                 |
| Exa        | yes    | yes (contents) | yes (code context) | yes          | 1,000                 |
| Perplexity | yes    | -              | -                  | yes          | unlimited             |
| Firecrawl  | yes    | yes (scrape)   | -                  | optional     | 1,000                 |

### Result Types

```typescript
interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface CodeSearchResult {
  title: string;
  url: string;
  snippet: string;
  language?: string;
}

interface FetchResult {
  text: string;
  title?: string;
  contentType?: string;
}
```

## Quota-Aware Provider Selection

### Usage Tracking

File: `~/.pi/agent/pi-tools-usage.json`

```json
{
  "resetAt": "2026-07",
  "counts": {
    "brave": 342,
    "exa": 187,
    "tavily": 91,
    "serper": 0,
    "perplexity": 220,
    "firecrawl": 55
  }
}
```

Resets automatically when the current month changes.

### Selection Logic (auto mode)

Providers are grouped into priority tiers:

- **Tier 1 — Finite-quota keyed providers** (Brave, Serper, Tavily, Exa, Firecrawl): selected by highest `remaining = monthlyQuota - usedThisMonth`. This naturally distributes load proportionally (a 2000-quota provider gets ~2x traffic vs a 1000-quota provider).
- **Tier 2 — Unlimited keyed providers** (Perplexity): used when all Tier 1 providers are exhausted or unavailable.
- **Tier 3 — Free keyless providers** (DuckDuckGo, Jina): final fallback, always available.

Selection steps:

1. Collect enabled Tier 1 providers with resolvable keys and remaining > 0.
2. Pick the one with the highest `remaining`.
3. On failure, try the next Tier 1 provider by remaining quota.
4. If all Tier 1 exhausted or failed, try Tier 2 (Perplexity).
5. If Tier 2 fails, try Tier 3 (DuckDuckGo, then Jina).
6. At 80% usage of any provider: notify via `ctx.ui.notify()`.
7. At 100% usage: skip that provider automatically.

### Rate Limit Header Integration

When a response includes `X-RateLimit-Remaining` or similar, use `min(headerValue, ourEstimate)` as the effective remaining count. Catches cases where other tools share the same API key.

### Increment on Success Only

Failed requests do not count against quota. Most providers do not charge for error responses.

## Extraction Pipeline (web_fetch)

Multi-tier fallback chain:

```
URL received
  |
  +-- SSRF guard (reject private IPs, metadata endpoints, non-http(s))
  |
  +-- Content-type detection (HEAD request or first bytes)
  |     +-- PDF -> unpdf extraction (first 100 pages)
  |     +-- Binary (image/audio/video/zip) -> reject with error
  |     +-- HTML/text -> continue
  |
  +-- Tier 1: Standard HTTP + Readability + Turndown
  |     +-- Success (>500 chars useful content) -> return markdown
  |     +-- Fail or thin content -> continue
  |
  +-- Tier 2: Next.js RSC parser (detect `self.__next_f.push`)
  |     +-- Success -> return extracted text
  |     +-- Not RSC or fail -> continue
  |
  +-- Tier 3: Jina Reader (handles JS-rendered pages)
  |     +-- Success -> return markdown
  |     +-- Fail -> continue
  |
  +-- Tier 4: Provider-based fallback (Firecrawl scrape or Tavily extract, if configured)
        +-- Success -> return content
        +-- Fail -> return error with all failure reasons
```

### HTML Extraction (Tier 1)

Pipeline: fetch with browser-like headers -> linkedom DOM parse -> strip script/style/noscript -> Readability article extraction -> Turndown HTML-to-Markdown (with GFM plugin for tables) -> normalize whitespace.

### Output Handling

- Content <= 15K chars: returned inline in tool result.
- Content > 15K chars: stored in session via `storage.ts`, truncated preview returned with content ID. Agent uses `web_read` to retrieve full text.

### SSRF Guard

Blocks before any fetch:

- Loopback: 127.0.0.1, ::1, localhost, \*.localhost
- RFC 1918: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
- Link-local: 169.254.0.0/16, fe80::/10
- Cloud metadata: 169.254.169.254
- Non-http(s) protocols
- Credentials in URL

### Extraction Chain Tracking

Each result carries metadata:

```typescript
interface ExtractedContent {
  text: string;
  title?: string;
  url: string;
  extractionChain: string[]; // e.g. ["http:200", "readability"]
  chars: number;
  truncated: boolean;
  contentId?: string;
}
```

## Tool Definitions

### web_search

```typescript
{
  name: "web_search",
  label: "Web Search",
  promptSnippet: "Search the web for up-to-date information.",
  promptGuidelines: [
    "Use web_search for information beyond training data -- recent events, current library versions, live API docs.",
    "After answering, include a Sources: section listing relevant URLs as markdown hyperlinks.",
    "Use one web_search call per search angle rather than batching multiple queries.",
  ],
  parameters: Type.Object({
    query: Type.String({ description: "Search query" }),
    numResults: Type.Optional(Type.Number({ minimum: 1, maximum: 20, default: 5 })),
    provider: Type.Optional(Type.String({ description: "Provider name or 'auto' (default)" })),
  }),
}
```

Execute: resolve provider via quota-aware selection -> call `provider.search()` -> format results as numbered markdown list -> store in session -> return with details `{ provider, resultCount }`.

### web_fetch

```typescript
{
  name: "web_fetch",
  label: "Web Fetch",
  promptSnippet: "Fetch a URL and extract readable content as markdown. Supports HTML, PDFs, and JS-rendered pages.",
  promptGuidelines: [
    "Use web_fetch when you have a specific URL to read.",
    "For large pages, use web_read with the returned contentId to retrieve the full text.",
  ],
  parameters: Type.Object({
    url: Type.String({ description: "HTTP(S) URL to fetch" }),
  }),
}
```

Execute: SSRF validate -> run extraction pipeline -> store if >15K chars -> return markdown + details `{ url, title, chars, truncated, contentId?, extractionChain }`.

### code_search

```typescript
{
  name: "code_search",
  label: "Code Search",
  promptSnippet: "Search code, library APIs, and technical documentation across the web.",
  promptGuidelines: [
    "Use code_search for finding code examples, library documentation, and API references.",
    "Prefer code_search over web_search for programming-related queries.",
  ],
  parameters: Type.Object({
    query: Type.String({ description: "Code or technical documentation search query" }),
    numResults: Type.Optional(Type.Number({ minimum: 1, maximum: 10, default: 5 })),
  }),
}
```

Execute: requires Exa API key -> call Exa Code context endpoint -> format results with language annotations -> return with details `{ provider, resultCount }`. Returns error with setup instructions if no Exa key configured.

### web_read

```typescript
{
  name: "web_read",
  label: "Web Read",
  promptSnippet: "Retrieve previously fetched web content by its content ID without re-fetching.",
  parameters: Type.Object({
    contentId: Type.String({ description: "Content ID from a previous web_fetch or web_search result" }),
  }),
}
```

Execute: look up content ID in session storage -> return full text. Error if ID not found.

### Custom TUI Rendering

All tools implement `renderCall` and `renderResult`:

- **renderCall**: tool name in bold + key argument (query or URL, truncated to 70 chars) in accent color.
- **renderResult collapsed**: status line -- result count for search, char count for fetch.
- **renderResult expanded**: preview of content or results.
- **isPartial**: shows "Searching..." or "Fetching..." in warning color during execution.

## Configuration

### Config File

Location: `~/.pi/agent/extensions/pi-tools.json`

```json
{
  "defaultProvider": "auto",
  "providers": {
    "brave": {
      "enabled": true,
      "monthlyQuota": 2000,
      "apiKey": "BRAVE_API_KEY"
    },
    "exa": { "enabled": true, "monthlyQuota": 1000, "apiKey": "EXA_API_KEY" },
    "tavily": { "enabled": false, "apiKey": "TAVILY_API_KEY" },
    "jina": { "enabled": true },
    "duckduckgo": { "enabled": true },
    "serper": { "enabled": false, "apiKey": "SERPER_API_KEY" },
    "perplexity": { "enabled": true, "apiKey": "PERPLEXITY_API_KEY" },
    "firecrawl": { "enabled": true, "apiKey": "FIRECRAWL_API_KEY" }
  }
}
```

### API Key Resolution (3-tier, first wins)

1. **Environment variable**: per-provider env var (e.g. `BRAVE_API_KEY` from `process.env`).
2. **Config file `apiKey` field**: value interpretation depends on format:
   - Matches `/^[A-Z][A-Z0-9_]+$/` → treat as env var name, resolve from `process.env`.
   - Starts with `!` → shell command (e.g. `!pass show api/exa`), executed with 5s timeout, result cached until config reload.
   - Otherwise → literal API key value.
3. **No key**: provider skipped in auto mode. Error if explicitly requested.

### Provider Toggle

- `providers[name].enabled` controls availability.
- A provider with `enabled: true` but no resolvable key is skipped with a warning.
- DuckDuckGo and Jina (keyless) are always available if enabled.
- `defaultProvider: "auto"` uses quota-aware selection among enabled providers with keys, with DuckDuckGo as final fallback.

### Config Loading

- Config read on `session_start` event, cached in memory.
- Env vars checked at resolve time (not cached) to allow mid-session changes.
- Missing or malformed config file degrades to defaults: all free providers enabled, auto mode.

## Content Storage

Session-local in-memory store with sidecar persistence:

```typescript
interface StoredContent {
  id: string; // "wc-<timestamp>-<random>"
  url: string;
  title?: string;
  text: string;
  chars: number;
  storedAt: string; // ISO timestamp
  source: "web_fetch" | "web_search";
}
```

- On store: add to in-memory Map + call `pi.appendEntry("pi-tools-content", stored)` for session persistence.
- On `session_start`: restore from `ctx.sessionManager` entries with matching custom type.
- Content IDs are stable within a session. Agent references them via `web_read`.

## Error Handling

### Error Sanitization

All provider errors pass through a sanitizer before surfacing:

- Redact Bearer tokens, API keys, authorization headers.
- Truncate to 300 chars max.
- Pattern: `/(bearer|token|api[-_]?key|authorization|secret|password)\s*[:=]?\s*[\w.\/-]{8,}/gi` -> `[redacted]`.

### Tool Errors

Tools never throw. They return `{ content: [{ type: "text", text: "..." }], isError: true }` per Pi convention.

### Provider Failure Behavior

- **Auto mode**: silently tries next provider by remaining quota. Surfaces combined error only if all fail.
- **Explicit provider**: returns error immediately with setup instructions.
- **Timeout**: 30s default per request.

### Extraction Pipeline Errors

- Each tier logs its failure reason in `extractionChain` metadata.
- Only the final "all tiers failed" produces a user-visible error.
- Error message includes which tiers were tried and why each failed.

## Dependencies

### Production (to add)

| Package                | Purpose                                         |
| ---------------------- | ----------------------------------------------- |
| `@mozilla/readability` | HTML article extraction                         |
| `linkedom`             | Lightweight DOM parser                          |
| `turndown`             | HTML -> Markdown conversion                     |
| `turndown-plugin-gfm`  | GFM support (tables, strikethrough, task lists) |
| `unpdf`                | PDF text extraction                             |

### Already Present

- `typebox` -- schema validation for tool parameters
- `@earendil-works/pi-coding-agent` -- ExtensionAPI (peer dependency)
- `@earendil-works/pi-tui` -- Text, Component for TUI rendering (peer dependency)

### No External HTTP Library

Uses native `fetch()` (Node 22+). No axios, undici, or similar.

## Testing Strategy

### Unit Tests (mocked fetch)

- **Each provider**: request format, response parsing, error handling, auth headers.
- **Extraction pipeline**: each tier independently, fallback chain, SSRF rejection.
- **Config**: loading, env var resolution, shell command resolution, malformed file.
- **SSRF guard**: private IPs, cloud metadata, non-http schemes, edge cases.
- **Storage**: store, retrieve, session restore, ID not found.
- **Quota tracking**: increment, monthly reset, selection logic, 80%/100% thresholds.

### Matrix-Driven Provider Tests

```typescript
const PROVIDERS = [
  { name: "brave", envVar: "BRAVE_API_KEY", urlMatch: "api.search.brave.com" },
  { name: "exa", envVar: "EXA_API_KEY", urlMatch: "api.exa.ai" },
  // ...
];

describe.each(PROVIDERS)("web_search -- $name", ({ name, envVar, urlMatch }) => {
  it("sends auth header when key configured", ...);
  it("returns normalized SearchResult[]", ...);
  it("throws descriptive error on non-2xx", ...);
  it("respects abort signal", ...);
});
```

### Test Utilities

- `createMockPi()` -- captures registered tools, commands, events.
- `stubFetch()` -- intercept fetch calls by URL pattern.
- `makeCtx()` -- minimal ExtensionContext for execute calls.

### Integration Tests (optional, skipped without keys)

- Real API calls to DuckDuckGo and Jina (free, no key required).
- Validates end-to-end request/response flow.
