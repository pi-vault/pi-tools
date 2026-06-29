# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
