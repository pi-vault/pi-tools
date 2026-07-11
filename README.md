# @pi-vault/pi-tools

[![npm version](https://img.shields.io/npm/v/%40pi-vault%2Fpi-tools)](https://www.npmjs.com/package/@pi-vault/pi-tools)
[![Quality](https://github.com/pi-vault/pi-tools/actions/workflows/quality.yml/badge.svg?branch=master)](https://github.com/pi-vault/pi-tools/actions/workflows/quality.yml)
[![Node >= 24.15.0](https://img.shields.io/badge/node-%3E%3D24.15.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

Web-aware tools for [Pi](https://github.com/earendil-works/pi): live search, page extraction, code and library documentation lookup, and deep research.

## Install

```bash
pi install npm:@pi-vault/pi-tools
```

Reload Pi:

```text
/reload
```

The extension works without configuration through DuckDuckGo (requires the `ddgs` CLI) and Jina. Add API keys to unlock more providers and tools.

```bash
uv tool install ddgs
# or: pip install ddgs
```

## Use it

Ask Pi directly. The extension supplies seven tools:

| Tool              | Use it for                                                     |
| ----------------- | -------------------------------------------------------------- |
| `web_search`      | Current information, releases, and live web results            |
| `web_fetch`       | Reading one or more known URLs                                 |
| `web_read`        | Continuing a large fetch or docs response from its `contentId` |
| `code_search`     | Programming examples and technical documentation via Exa       |
| `web_docs_search` | Finding a Context7 library ID                                  |
| `web_docs_fetch`  | Retrieving focused, version-aware Context7 documentation       |
| `web_research`    | Multi-source Exa research and findings reports                 |

### Search the web

```text
Search the web for the latest Vitest mocking docs and summarize the best source.
Search npm release notes after 2026-01-01, using only npmjs.com.
```

`web_search` accepts a provider name, domain and date filters, compact output, and an optional `combine` flag. When search fusion is enabled, it queries multiple providers and merges ranked results.

### Fetch a page

```text
Fetch https://example.com/spec and summarize the main requirements.
Fetch these URLs and compare them: https://a.dev/docs, https://b.dev/docs
Fetch https://example.com/page in raw mode.
```

`web_fetch` accepts `url` or up to 20 `urls`, `raw` to return the HTTP body, and `fresh` to bypass its in-memory cache. It handles readable HTML, PDFs, GitHub repository/file URLs, some Next.js RSC pages, and Jina Reader fallback for JS-heavy pages.

Large `web_fetch` and `web_docs_fetch` responses provide a `contentId`; ask Pi to read that ID with `web_read`. Stored content is available only in the current session.

### Look up library documentation

```text
Find the React library in Context7 for hooks documentation.
Fetch Context7 docs for /facebook/react about useState hooks.
```

Use `web_docs_search` before `web_docs_fetch`. Include a focused question in each call, and pin a library version in the ID when reproducibility matters (for example, `/vercel/next.js@v15.1.8`).

### Run deep research

```text
Research the trade-offs between PostgreSQL logical replication and CDC. Save a findings report to docs/replication.md.
```

`web_research` uses Exa Deep Search for multi-source, evidence-backed findings. Choose `lite`, `standard`, or `full` depth; pass `outputPath` to write a report and optional raw metadata sidecar. It requires `EXA_API_KEY`.

## Configure

Create `~/.pi/agent/extensions/tools.json`. Project settings in `.pi/tools.json` override the global file; both are deep-merged with defaults. The legacy `pi-tools.json` filename remains a fallback.

```json
{
  "defaultProvider": "auto",
  "selectionStrategy": "auto",
  "combine": {
    "enabled": false,
    "mode": "targeted",
    "targetBackends": 3,
    "k": 60
  },
  "providers": {
    "brave": {
      "enabled": true,
      "monthlyQuota": 1000,
      "apiKey": "BRAVE_API_KEY"
    },
    "context7": {
      "enabled": true,
      "apiKey": "CONTEXT7_API_KEY"
    },
    "duckduckgo": {
      "enabled": true
    },
    "exa": {
      "enabled": true,
      "monthlyQuota": 1000,
      "apiKey": "EXA_API_KEY"
    },
    "exa-mcp": {
      "enabled": true
    },
    "firecrawl": {
      "enabled": true,
      "monthlyQuota": 1000,
      "apiKey": "FIRECRAWL_API_KEY"
    },
    "jina": {
      "enabled": true
    },
    "openai-native": {
      "enabled": true,
      "apiKey": "OPENAI_API_KEY"
    },
    "parallel": {
      "enabled": false,
      "apiKey": "PARALLEL_API_KEY"
    },
    "perplexity": {
      "enabled": false,
      "apiKey": "PERPLEXITY_API_KEY"
    },
    "searxng": {
      "enabled": false,
      "instanceUrl": "http://localhost:8080"
    },
    "serper": {
      "enabled": false,
      "apiKey": "SERPER_API_KEY"
    },
    "tavily": {
      "enabled": true,
      "monthlyQuota": 1000,
      "apiKey": "TAVILY_API_KEY"
    },
    "websearchapi": {
      "enabled": false,
      "apiKey": "WEBSEARCHAPI_API_KEY"
    }
  },
  "github": {
    "enabled": true,
    "maxRepoSizeMB": 350,
    "cloneTimeoutSeconds": 30
  },
  "deepResearch": {
    "enabled": true
  },
  "ssrf": {
    "allowRanges": []
  }
}
```

`apiKey` can be an environment-variable name (`"EXA_API_KEY"`), a literal key, or a shell command prefixed with `!` (for example, `"!op read op://pi/exa/api-key"`).

### Configuration reference

- `defaultProvider`: provider name or `auto`.
- `selectionStrategy`: `auto` (tier/availability) or `best-performing` (recent reliability, latency, and result quality).
- `combine`: enables optional multi-provider RRF fusion. `targeted` stops after enough useful providers respond; `all` queries all eligible providers.
- `ssrf.allowRanges`: explicit CIDR exceptions for private/reserved addresses in trusted network setups. URL protocol and credential protections still apply.
- `deepResearch`: configures `web_research`; it is registered only when Exa has a resolved API key.
- `guidance`: optional prompt overrides per standard tool; deep research guidance lives at `deepResearch.guidance`.

Pi checks configuration changes every 30 seconds. Use `/tools --reload` to refresh immediately, or `/tools --status` to inspect registered search providers and their session metrics.

### Providers

| Provider      | Search | Fetch | Code | Docs | Key required            |
| ------------- | ------ | ----- | ---- | ---- | ----------------------- |
| Brave         | Yes    | No    | No   | No   | Yes                     |
| Context7      | No     | No    | No   | Yes  | Yes                     |
| DuckDuckGo    | Yes    | No    | No   | No   | No; requires `ddgs` CLI |
| Exa           | Yes    | Yes   | Yes  | No   | Yes                     |
| Exa MCP       | Yes    | No    | No   | No   | No                      |
| Firecrawl     | Yes    | Yes   | No   | No   | Yes                     |
| Jina          | Yes    | Yes   | No   | No   | Optional                |
| OpenAI native | Yes    | No    | No   | No   | Yes                     |
| Parallel      | Yes    | Yes   | No   | No   | Yes                     |
| Perplexity    | Yes    | No    | No   | No   | Yes                     |
| SearXNG       | Yes    | No    | No   | No   | No; optional API key    |
| Serper        | Yes    | No    | No   | No   | Yes                     |
| Tavily        | Yes    | Yes   | No   | No   | Yes                     |
| WebSearchAPI  | Yes    | No    | No   | No   | Yes                     |

## Development

```bash
pnpm install
pnpm check
pnpm release:check
```

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md) for release notes.

## License

MIT — see [`LICENSE`](LICENSE).
