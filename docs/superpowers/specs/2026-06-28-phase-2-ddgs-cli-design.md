# Phase 2 Refactor: DuckDuckGo Provider via ddgs CLI

Replaces the DuckDuckGo instant answer API with the `ddgs` CLI tool for real web search results.

## Context

The original Phase 2 plan uses the DuckDuckGo instant answer API (`api.duckduckgo.com/?q=...&format=json`), which returns `RelatedTopics` -- encyclopedia-style related links, not actual web search results. The `ddgs` CLI (Python package `duckduckgo-search`) performs real web searches and returns proper results with titles, URLs, and snippets.

This refactor changes the `DuckDuckGoProvider` internals while preserving the `SearchProvider` interface contract. Nothing above the provider layer changes.

## Decisions

- **Execution model**: CLI subprocess via `child_process.execFile`. No long-running server, no MCP client. Simplest option with acceptable latency (~200-500ms overhead per call).
- **Provider identity**: Replaces the existing `duckduckgo` provider. Same name, better results. Not a new provider.
- **Installation**: `ddgs` must be pre-installed on the user's system. The extension checks for it in PATH and disables the provider with a helpful error if missing.
- **Backend**: Relies on ddgs default (`auto`). No explicit `--backend` flag passed, no user-configurable backend selection.

## DuckDuckGoProvider Implementation

### Execution Flow

1. `search(query, maxResults, signal?)` is called
2. Generate temp file path: `<os.tmpdir()>/ddgs-<crypto.randomUUID()>.json`
3. Spawn: `ddgs text -q "<query>" -m <maxResults> -o <tmpFile>` via `execFile`
4. If `signal` is provided, wire it to kill the child process on abort
5. Read and parse the JSON file
6. Map ddgs output to `SearchResult[]`
7. Clean up temp file (best-effort, in `finally` block)

### ddgs Output Format

```json
[
  {
    "title": "TypeScript: Documentation - Generics",
    "href": "https://www.typescriptlang.org/docs/handbook/2/generics.html",
    "body": "When creating factories in TypeScript using generics..."
  }
]
```

### Result Mapping

| ddgs field | SearchResult field |
| ---------- | ------------------ |
| `title`    | `title`            |
| `href`     | `url`              |
| `body`     | `snippet`          |

### Binary Discovery

Detected lazily on first `search()` call. If `execFile` returns ENOENT (binary not found), `runDdgs` throws:

> `ddgs CLI not found. Install with: pip install ddgs (or: uv tool install ddgs)`

ENOENT from `execFile` (binary missing) is distinguished from ENOENT from `fs.readFile` (output file missing) by handling them in separate try/catch blocks. The former produces the install hint; the latter produces "Failed to parse ddgs output".

### Error Reporting

When `ddgs` exits non-zero, stderr is included in the thrown error message (e.g., `"ddgs failed: rate limited"`). This surfaces ddgs-specific error details instead of a generic execFile error.

### Timeout and Abort

- `execFile` timeout: 15 seconds
- `AbortSignal`: if provided, wired to kill the child process

### Temp File Handling

- **Path**: `os.tmpdir()` + `ddgs-<crypto.randomUUID()>.json` -- cross-platform, collision-free
- **Cleanup**: `fs.unlink` in a `finally` block, best-effort (silently ignore failures)
- **Parse failure**: If ddgs exits 0 but JSON is malformed or file is missing, throw `"Failed to parse ddgs output"`. Cleanup still runs.
- **Lifetime**: File exists only for the duration of a single `search()` call (under a second). No accumulation risk.

## Test Strategy

### New Test Helper: `stubExec()`

Added to `tests/helpers.ts`. Similar shape to `stubFetch()` -- intercepts `child_process.execFile` calls and writes fixture data to the requested output path.

### Provider Tests (`tests/providers/duckduckgo.test.ts`)

Tests mock `execFile` and filesystem calls via `stubExec()`:

1. **`has correct name and label`** -- unchanged
2. **`returns normalized search results`** -- mock execFile to succeed, write fixture JSON, verify `SearchResult[]` mapping (`href` -> `url`, `body` -> `snippet`)
3. **`respects maxResults`** -- verify `-m N` is passed in spawned command args
4. **`throws on ddgs CLI failure`** -- mock execFile with non-zero exit code, expect thrown error
5. **`throws when ddgs not found`** -- construct provider with ddgs unavailable, expect error with pip/uv install hint
6. **`respects abort signal`** -- pass already-aborted signal, verify child process is killed
7. **`cleans up temp file`** -- verify no `ddgs-*.json` files remain in tmpdir after search completes
8. **`includes stderr in error on CLI failure`** -- mock execFile with error message, verify it appears in thrown error

### Tool Tests (`tests/tools/web-search.test.ts`)

Tool tests use an inline stub implementing `SearchProvider` instead of the real `DuckDuckGoProvider`. This keeps the tool layer provider-agnostic -- tool tests don't know or care about CLI internals.

## Impact on Phase 2 Plan

### Task 2.1 (DuckDuckGo Provider) -- Rewritten

- Tests use `stubExec()` instead of `stubFetch()`
- Implementation replaces HTTP fetch with `execFile` + temp file JSON parsing
- `stubExec()` added to `tests/helpers.ts`
- Same test coverage, adapted for CLI execution model

### Task 2.2 (web_search Tool + Wiring) -- Minimal Changes

- `createWebSearchTool()` is unchanged -- calls `provider.search()` regardless of implementation
- Tool tests switch from real `DuckDuckGoProvider` + `stubFetch()` to inline stub providers
- Tool definition, schema, formatting, error handling all unchanged
- `src/index.ts` wiring unchanged

## Dependencies

- **Runtime**: `ddgs` CLI (pre-installed by user via `pip install ddgs` or `uv tool install ddgs`)
- **Node.js built-ins used**: `child_process.execFile`, `fs.readFile`, `fs.unlink`, `os.tmpdir`, `crypto.randomUUID`
- **No new npm dependencies**
