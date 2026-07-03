# @pi-vault/pi-tools

[![npm version](https://img.shields.io/npm/v/%40pi-vault%2Fpi-tools)](https://www.npmjs.com/package/@pi-vault/pi-tools)
[![Quality](https://github.com/pi-vault/pi-tools/actions/workflows/quality.yml/badge.svg?branch=master)](https://github.com/pi-vault/pi-tools/actions/workflows/quality.yml)
[![Node >= 24.15.0](https://img.shields.io/badge/node-%3E%3D24.15.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

Add four web-aware tools to Pi: `web_search`, `web_fetch`, `web_read`, and `code_search`.

## What it adds

- `web_search` — search the live web through multiple providers
- `web_fetch` — fetch a URL and extract readable content
- `web_read` — reopen large fetched content stored in the current session
- `code_search` — search code examples and technical documentation on the web

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
  "providers": {
    "duckduckgo": { "enabled": true },
    "jina": { "enabled": true },
    "brave": {
      "enabled": true,
      "monthlyQuota": 2000,
      "apiKey": "BRAVE_API_KEY"
    },
    "exa": { "enabled": true, "monthlyQuota": 1000, "apiKey": "EXA_API_KEY" },
    "firecrawl": { "enabled": true, "apiKey": "FIRECRAWL_API_KEY" },
    "tavily": { "enabled": false, "apiKey": "TAVILY_API_KEY" },
    "serper": { "enabled": false, "apiKey": "SERPER_API_KEY" },
    "perplexity": { "enabled": true, "apiKey": "PERPLEXITY_API_KEY" }
  }
}
```

`apiKey` supports three forms:

- environment variable name: `"EXA_API_KEY"`
- literal key value: `"exa_live_..."`
- shell command prefixed with `!`: `"!op read op://pi/exa/api-key"`

## Provider overview

| Provider   | Web search | Web fetch | Code search | Key required                |
| ---------- | ---------- | --------- | ----------- | --------------------------- |
| DuckDuckGo | Yes        | No        | No          | No, but requires `ddgs` CLI |
| Jina       | Yes        | Yes       | No          | Optional                    |
| Brave      | Yes        | No        | No          | Yes                         |
| Exa        | Yes        | Yes       | Yes         | Yes                         |
| Firecrawl  | Yes        | Yes       | No          | Yes                         |
| Tavily     | Yes        | Yes       | No          | Yes                         |
| Serper     | Yes        | No        | No          | Yes                         |
| Perplexity | Yes        | No        | No          | Yes                         |

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

Example prompt:

```text
Fetch https://example.com/spec and summarize the main requirements.
```

`web_fetch` can extract content from normal HTML pages, PDFs, some Next.js RSC pages, and JS-heavy pages that work through the Jina Reader fallback.

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

## Notes and limits

- In `auto` mode, `web_search` chooses among enabled providers based on availability.
- Large `web_fetch` results are truncated in the initial response and stored for follow-up reads through `web_read`.
- `web_read` retrieves stored content from the current session only.
- `web_fetch` blocks unsupported binary content types.

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
