# @pi-vault/pi-tools

[![npm version](https://img.shields.io/npm/v/%40pi-vault%2Fpi-tools)](https://www.npmjs.com/package/@pi-vault/pi-tools)
[![Quality](https://github.com/pi-vault/pi-tools/actions/workflows/quality.yml/badge.svg?branch=master)](https://github.com/pi-vault/pi-tools/actions/workflows/quality.yml)
[![Node >= 24.15.0](https://img.shields.io/badge/node-%3E%3D24.15.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

Add six web-aware tools to Pi: `web_search`, `web_fetch`, `web_read`, `code_search`, `web_docs_search`, and `web_docs_fetch`.

## What it adds

- `web_search` — search the live web through multiple providers
- `web_fetch` — fetch a URL and extract readable content
- `web_read` — reopen large fetched content stored in the current session
- `code_search` — search code examples and technical documentation on the web
- `web_docs_search` — search for library documentation via Context7
- `web_docs_fetch` — retrieve focused documentation for a specific library via Context7

## Install

Install from npm:

```bash
pi install npm:@pi-vault/pi-tools
```

Then reload Pi:

```text
/reload
```

## Configure

Create `~/.pi/agent/extensions/tools.json`:

```json
{
  "defaultProvider": "auto",
  "selectionStrategy": "auto",
  "providers": {
    "duckduckgo": { "enabled": true },
    "jina": { "enabled": true },
    "brave": {
      "enabled": true,
      "monthlyQuota": 2000,
      "apiKey": "BRAVE_API_KEY"
    },
    "exa": { "enabled": true, "monthlyQuota": 1000, "apiKey": "EXA_API_KEY" },
    "exa-mcp": { "enabled": true },
    "firecrawl": { "enabled": true, "apiKey": "FIRECRAWL_API_KEY" },
    "openai-native": { "enabled": true, "apiKey": "OPENAI_API_KEY" },
    "parallel": { "enabled": false, "apiKey": "PARALLEL_API_KEY" },
    "perplexity": { "enabled": true, "apiKey": "PERPLEXITY_API_KEY" },
    "searxng": { "enabled": false, "instanceUrl": "http://localhost:8080" },
    "serper": { "enabled": false, "apiKey": "SERPER_API_KEY" },
    "tavily": { "enabled": false, "apiKey": "TAVILY_API_KEY" },
    "websearchapi": { "enabled": false, "apiKey": "WEBSEARCHAPI_API_KEY" },
    "context7": { "enabled": true, "apiKey": "CONTEXT7_API_KEY" }
  },
  "github": {
    "enabled": true,
    "maxRepoSizeMB": 350,
    "cloneTimeoutSeconds": 30
  }
}
```

## Configuration features

- Preferred config file: `~/.pi/agent/extensions/tools.json`
- Legacy fallback: `pi-tools.json`
- Project override file: `.pi/tools.json`
- `selectionStrategy`: `auto` or `best-performing`
- `github`: controls GitHub URL extraction limits
- `guidance`: optional per-tool prompt overrides

The legacy filename `pi-tools.json` is still supported as a fallback.

`apiKey` supports three forms:

- environment variable name: `"EXA_API_KEY"`
- literal key value: `"exa_live_..."`
- shell command prefixed with `!`: `"!op read op://pi/exa/api-key"`

## Provider overview

| Provider      | Web search | Web fetch | Code search | Docs lookup | Key required                             |
| ------------- | ---------- | --------- | ----------- | ----------- | ---------------------------------------- |
| DuckDuckGo    | Yes        | No        | No          | No          | No, but requires `ddgs` CLI              |
| Jina          | Yes        | Yes       | No          | No          | Optional                                 |
| Brave         | Yes        | No        | No          | No          | Yes                                      |
| Exa           | Yes        | Yes       | Yes         | No          | Yes                                      |
| Exa MCP       | Yes        | No        | No          | No          | No                                       |
| Firecrawl     | Yes        | Yes       | No          | No          | Yes                                      |
| OpenAI native | Yes        | No        | No          | No          | Yes                                      |
| Parallel      | Yes        | Yes       | No          | No          | Yes                                      |
| Perplexity    | Yes        | No        | No          | No          | Yes                                      |
| SearXNG       | Yes        | No        | No          | No          | No, optional API key for self-hosted use |
| Serper        | Yes        | No        | No          | No          | Yes                                      |
| Tavily        | Yes        | Yes       | No          | No          | Yes                                      |
| WebSearchAPI  | Yes        | No        | No          | No          | Yes                                      |
| Context7      | No         | No        | No          | Yes         | Yes                                      |

DuckDuckGo support shells out to the `ddgs` CLI. Install it with one of:

```bash
pip install ddgs
# or
uv tool install ddgs
```

## Usage

Ask Pi to use the tools directly when needed.

### `web_search`

Use it for current information, release notes, API docs, and anything beyond model training data.

Example prompt:

```text
Search the web for the latest Vitest mocking docs and summarize the best source.
```

### `web_fetch`

Use it when you already have a URL and want the page content, not a fresh search.

Example prompts:

```text
Fetch https://example.com/spec and summarize the main requirements.
Fetch these URLs and compare them: https://a.dev/docs, https://b.dev/docs
Fetch https://example.com/page in raw mode.
```

`web_fetch` supports:

- `url` for one page
- `urls` for up to 20 URLs in one call
- `raw` to return the HTTP body without readability extraction
- `fresh` to bypass the in-memory cache

It can extract content from normal HTML pages, PDFs, GitHub repository/file URLs, some Next.js RSC pages, and JS-heavy pages that work through the Jina Reader fallback.

### `web_read`

Use it after a large `web_fetch` result comes back truncated with a `contentId`.

Example prompt:

```text
Read content ID abc123 from the previous fetch.
```

### `code_search`

Use it for programming questions, library APIs, and code examples.

Example prompt:

```text
Find TypeScript examples for AbortSignal.timeout using code_search.
```

`code_search` is only available when Exa is configured.

### `web_docs_search`

Use it to find library documentation when you need up-to-date API docs or framework guides.

Example prompt:

```text
Search for React documentation about hooks.
```

Returns a table of matching libraries with IDs that can be passed to `web_docs_fetch`.

### `web_docs_fetch`

Use it after `web_docs_search` to retrieve focused documentation for a specific library.

Example prompt:

```text
Fetch Context7 docs for /facebook/react about useState hooks.
```

`web_docs_fetch` supports:

- `libraryId` — Context7 library ID from a previous search (e.g. `/facebook/react`)
- `query` — specific question for relevance ranking

Large documentation responses are truncated and stored for retrieval via `web_read`.

Both `web_docs_search` and `web_docs_fetch` require a Context7 API key (`CONTEXT7_API_KEY`).

## Notes and limits

- In `auto` mode, `web_search` chooses among enabled providers based on availability.
- Large `web_fetch` and `web_docs_fetch` results are truncated in the initial response and stored for follow-up reads through `web_read`.
- `web_read` retrieves stored content from the current session only.
- `web_fetch` blocks unsupported binary content types.
- `web_docs_search` and `web_docs_fetch` are only available when Context7 is configured with an API key.

## Provider status

Use the built-in command to inspect configured search providers:

```text
/tools --status
```

Run `/tools` with no arguments for interactive setup.

## Development and verification

```bash
pnpm install
pnpm check
pnpm release:check
```

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md) for release notes.

## License

MIT — see [`LICENSE`](LICENSE).
