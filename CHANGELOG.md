# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Provider usage persistence now lives at $PI_CODING_AGENT_DIR/cache/pi-tools/usage.json.
- Renamed the OpenAI web-search rewrite module to `openai-web-search-rewrite`.
- `openai-codex` now resolves Pi OAuth credentials through the active ModelRegistry and no longer uses an OpenAI API-key fallback.

### Fixed

- Codex authentication, stream, and empty-result failures now trigger provider fallback.

### Removed

- Removed legacy pi-tools.json config filename fallbacks.
- Removed the broken Exa MCP provider and the `openai-native` compatibility alias.

## [0.4.0] - 2026-07-16

### Added

- Search providers for Brave LLM Context, fastCRW, LangSearch, Linkup, Marginalia, Ollama, OpenAI web search, Sofya, and You.com.
- YouTube transcript and thumbnail extraction, local video analysis, and frame extraction through `web_fetch`.
- Scanned PDF OCR using model vision or Gemini, plus Gemini fallback for difficult HTML pages.
- Interactive `/tools` setup, provider management subcommands, connection tests, and an optional activity monitor widget.
- Cloudflare AI Gateway support for Gemini and environment-aware tool guidance for available command-line tools.
- Trust gating for sensitive project configuration, including credentials, browser cookies, and private-network exceptions.

### Changed

- Replaced `openai-native` with the dual-mode `openai-codex` provider while retaining the old name as a compatibility alias.
- Expanded credential resolution with environment-variable fallbacks, shell-command caching, and safer handling of invalid values.
- Added configurable DuckDuckGo backend, region, and time filters; Perplexity models; keyless Firecrawl; and optional Jina credentials.
- Added HEAD probes before large downloads and a second request with an honest user agent when Cloudflare returns a bot challenge.
- Consolidated HTTP provider adapters, response parsers, session lifecycle handling, configuration loading, and single/multi-URL fetching.
- Updated Pi development and peer dependencies to `0.80.10` and Biome to `2.5.4`.

### Fixed

- Provider fallback now stops immediately when a request is cancelled.
- Multi-URL fetches no longer duplicate extraction work and now preserve returned images.
- Session configuration now initializes from the active project directory after Pi records project trust.

## [0.3.0] - 2026-07-11

### Added

- `web_research`, an Exa Deep Search tool for evidence-backed research and optional findings reports.
- Context7-backed `web_docs_search` and `web_docs_fetch` tools for version-aware library documentation.
- Opt-in multi-provider search fusion using reciprocal rank fusion (RRF), with per-call `combine` overrides.
- Automatic configuration refresh, plus `/tools --reload` to force a reload.
- Provider performance scoring based on a rolling window of reliability, latency, and result quality.
- CIDR allow-ranges for configured SSRF exceptions, with expanded IPv4 and IPv6 private/reserved-address protection.

### Changed

- `web_search` supports domain and publication-date filters, compact output, and fused-result attribution in expanded views.
- `web_fetch` and `web_docs_fetch` retain large responses for follow-up retrieval with `web_read`.
- Provider status now reports rolling session outcomes and average latency.

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
