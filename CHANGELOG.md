# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-07-03

### Added

- Search provider fallback and aggregate provider errors when all providers fail.
- Domain/date filters and compact output for `web_search`.
- Multi-URL `web_fetch`, raw mode, fresh-cache bypass, and in-memory content caching.
- GitHub URL interception for repository and file content extraction.
- Project-level `.pi/tools.json` support with global config deep-merge.
- `/tools` command with interactive setup and `--status` output.
- Prompt guidance overrides per tool.
- Session-based best-performing provider selection.
- New providers: Exa MCP, OpenAI native, Parallel, SearXNG, and WebSearchAPI.

### Changed

- Renamed the preferred config filename to `tools.json` while preserving `pi-tools.json` fallback.
- Collapsed provider registration into per-provider metadata exports.
- Extracted shared provider fallback execution logic.
- Consolidated usage tracking into `ProviderRegistry` persistence.
- Extracted shared HTTP search-provider scaffolding.

### Fixed

- `web_search` now honors configured `defaultProvider` when a tool call omits `provider`.

## [0.1.0] - 2026-06-28

### Added

- Initial public release of `@pi-vault/pi-tools` as a Pi package.
- `web_search` with auto/provider-specific routing across Brave, Serper, Tavily, Exa, Perplexity, Firecrawl, Jina, and DuckDuckGo.
- `web_fetch` for extracting readable content from URLs.
- `web_read` for reopening large fetched content stored in session state.
- `code_search` for web-based code and technical documentation search when Exa is configured.
- Quota-aware provider selection and usage tracking for keyed search providers.
- Extraction fallbacks covering HTML pages, PDFs, Next.js RSC payloads, and Jina Reader recovery for JS-heavy pages.
- Custom TUI rendering for tool calls and tool results.

### Changed

- Rewrote the README around installation, configuration, and real tool usage for the `0.1.0` release.
- Added packaged release assets: `CHANGELOG.md` and `LICENSE`.
