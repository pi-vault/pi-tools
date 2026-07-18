# @pi-vault/pi-tools

[![npm version](https://img.shields.io/npm/v/%40pi-vault%2Fpi-tools)](https://www.npmjs.com/package/@pi-vault/pi-tools)
[![Quality](https://github.com/pi-vault/pi-tools/actions/workflows/quality.yml/badge.svg?branch=master)](https://github.com/pi-vault/pi-tools/actions/workflows/quality.yml)
[![Node >= 24.15.0](https://img.shields.io/badge/node-%3E%3D24.15.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

Web search, content extraction, documentation lookup, and deep research tools for [Pi](https://github.com/earendil-works/pi).

## Install

```bash
pi install npm:@pi-vault/pi-tools
```

Reload Pi after installation:

```text
/reload
```

The extension can use keyless providers such as Jina. DuckDuckGo also works without an API key after you install the `ddgs` CLI:

```bash
uv tool install ddgs
# or: pip install ddgs
```

Run `/tools` in Pi to configure more providers. The setup wizard detects available environment variables and can write the global config for you.

```text
/tools
```

## Use it

Ask Pi in plain language. The extension registers up to seven tools, depending on which providers you configure:

| Tool              | Use it for                                                          |
| ----------------- | ------------------------------------------------------------------- |
| `web_search`      | Current information, releases, and live web results                 |
| `web_fetch`       | Web pages, PDFs, GitHub URLs, YouTube videos, and local video files |
| `web_read`        | Full text from a large response using its `contentId`               |
| `code_search`     | Programming examples and technical documentation through Exa        |
| `web_docs_search` | Finding a Context7 library ID                                       |
| `web_docs_fetch`  | Focused, version-aware Context7 documentation                       |
| `web_research`    | Multi-source Exa research and saved findings reports                |

### Search the web

```text
Search the web for the latest Vitest mocking documentation.
Search npm release notes after 2026-01-01, using only npmjs.com.
Search for current SQLite performance guidance and combine multiple providers.
```

`web_search` supports provider selection, domain filters, publication dates, compact results, and optional multi-provider fusion. If a provider fails, Pi Tools tries the next eligible provider unless the request was cancelled.

### Fetch pages and files

```text
Fetch https://example.com/spec and summarize the requirements.
Fetch these URLs and compare them: https://a.dev/docs, https://b.dev/docs
Fetch https://example.com/page in raw mode.
```

`web_fetch` accepts one URL or up to 20 URLs. It extracts readable HTML, PDFs, GitHub repositories and files, and some Next.js RSC pages. It can fall back to Jina, Gemini, or a configured fetch provider when direct extraction is not enough.

Large responses include a `contentId`. Ask Pi to pass that ID to `web_read` for the full text. Stored content lasts for the current session.

### Work with YouTube, video, and PDFs

```text
Fetch https://www.youtube.com/watch?v=VIDEO_ID and summarize the transcript.
Extract 4 frames from https://www.youtube.com/watch?v=VIDEO_ID between 02:00 and 03:00.
Analyze /absolute/path/to/demo.mp4 and list the main steps shown.
Fetch https://example.com/scanned-report.pdf and summarize it.
```

YouTube transcript extraction can use Gemini or Perplexity. Frame extraction uses `yt-dlp` and `ffmpeg`. Local video analysis uses Gemini. Scanned PDF OCR uses `pdftoppm` and either the active model's image support or Gemini as a fallback.

### Look up code and library documentation

```text
Find TypeScript examples for AbortSignal timeout handling.
Find the React library in Context7 for hooks documentation.
Fetch Context7 docs for /facebook/react about useState hooks.
```

Use `web_docs_search` before `web_docs_fetch`. Include a focused question, and pin a version in the library ID when reproducibility matters, such as `/vercel/next.js@v15.1.8`.

### Run deep research

```text
Research the trade-offs between PostgreSQL logical replication and CDC. Save a findings report to docs/replication.md.
```

`web_research` supports `lite`, `standard`, and `full` modes. It requires `EXA_API_KEY`. Pass `outputPath` to save a report and `rawOutputPath` to keep the source metadata.

## Manage providers

Use `/tools` without arguments for guided setup, or run a subcommand directly:

| Command                     | Action                                                       |
| --------------------------- | ------------------------------------------------------------ |
| `/tools`                    | Open the setup wizard                                        |
| `/tools status`             | Show enabled providers, quota, outcomes, and average latency |
| `/tools reload`             | Reload configuration from disk                               |
| `/tools enable <name>`      | Enable a provider                                            |
| `/tools disable <name>`     | Disable a provider                                           |
| `/tools key <name> <value>` | Save a provider API key or environment-variable reference    |
| `/tools test [name]`        | Test one provider, or all enabled search providers           |
| `/tools default <name>`     | Set the default provider or `auto`                           |
| `/tools monitor on`         | Show the activity monitor widget                             |
| `/tools monitor off`        | Hide the activity monitor widget                             |

Provider configuration refreshes automatically every 30 seconds. Use `/tools reload` when you need an immediate refresh.

### Available providers

| Provider          | Capabilities                  | Setup                              |
| ----------------- | ----------------------------- | ---------------------------------- |
| Brave             | Search                        | `BRAVE_API_KEY`                    |
| Brave LLM         | Search                        | `BRAVE_API_KEY`                    |
| Context7          | Docs                          | `CONTEXT7_API_KEY`                 |
| DuckDuckGo        | Search                        | `ddgs` CLI                         |
| Exa               | Search, fetch, code, research | `EXA_API_KEY`                      |
| fastCRW           | Search                        | `FASTCRW_API_KEY`                  |
| Firecrawl         | Search, fetch                 | API key optional                   |
| Jina              | Search, fetch                 | API key optional                   |
| LangSearch        | Search                        | `LANGSEARCH_API_KEY`               |
| Linkup            | Search                        | `LINKUP_API_KEY`                   |
| Marginalia        | Search                        | No API key                         |
| Ollama            | Search, fetch                 | Local Ollama server                |
| OpenAI Codex      | Search                        | Pi `/login` OAuth                  |
| OpenAI web search | Search                        | `OPENAI_API_KEY`                   |
| Parallel          | Search, fetch                 | `PARALLEL_API_KEY`                 |
| Perplexity        | Search, YouTube fallback      | `PERPLEXITY_API_KEY`               |
| SearXNG           | Search                        | SearXNG instance, API key optional |
| Serper            | Search                        | `SERPER_API_KEY`                   |
| Sofya             | Search, fetch                 | `SOFYA_API_KEY`                    |
| Tavily            | Search, fetch                 | `TAVILY_API_KEY`                   |
| WebSearchAPI      | Search                        | `WEBSEARCHAPI_API_KEY`             |
| You.com           | Search                        | `YOUCOM_API_KEY`                   |

Pi Tools ranks providers by tier, availability, quota, and optionally recent session performance. Provider-specific date and domain filters depend on the upstream API; unsupported filters are applied locally where possible.

OpenAI Codex uses the active Pi OAuth session. Run `/login` and select `openai-codex` before using it. To search with `OPENAI_API_KEY` instead, configure `openai-web-search`.

## Configure files and credentials

The global config is `~/.pi/agent/extensions/tools.json`. A project `.pi/tools.json` overrides it. Pi Tools deep-merges project settings, global settings, and built-in defaults in that order. The old `pi-tools.json` filename remains a fallback.

A provider `apiKey` can be:

- an environment-variable name, such as `"EXA_API_KEY"`
- a literal key
- a shell command prefixed with `!`, such as `"!op read op://pi/exa/api-key"`

Shell-command credentials are cached until the next config refresh. Sensitive fields in project config are ignored until Pi marks the project as trusted.

The following safe example includes every configuration section and all registered providers. Keyless providers are enabled. Providers that need credentials or a local service are disabled until you configure them.

```json
{
  "defaultProvider": "auto",
  "selectionStrategy": "auto",
  "providers": {
    "brave": {
      "enabled": false,
      "monthlyQuota": 2000,
      "apiKey": "BRAVE_API_KEY"
    },
    "brave-llm": {
      "enabled": false,
      "monthlyQuota": 2000,
      "apiKey": "BRAVE_API_KEY",
      "tokenBudget": 4096
    },
    "context7": {
      "enabled": false,
      "apiKey": "CONTEXT7_API_KEY"
    },
    "duckduckgo": {
      "enabled": true,
      "ddgsBackend": "api",
      "ddgsRegion": "us-en"
    },
    "exa": {
      "enabled": false,
      "monthlyQuota": 1000,
      "apiKey": "EXA_API_KEY"
    },
    "fastcrw": {
      "enabled": false,
      "monthlyQuota": 500,
      "apiKey": "FASTCRW_API_KEY",
      "baseUrl": "https://api.fastcrw.com"
    },
    "firecrawl": {
      "enabled": true
    },
    "jina": {
      "enabled": true
    },
    "langsearch": {
      "enabled": false,
      "apiKey": "LANGSEARCH_API_KEY"
    },
    "linkup": {
      "enabled": false,
      "apiKey": "LINKUP_API_KEY",
      "depth": "standard"
    },
    "marginalia": {
      "enabled": true
    },
    "ollama": {
      "enabled": false,
      "baseUrl": "http://localhost:11434"
    },
    "openai-codex": {
      "enabled": true
    },
    "openai-web-search": {
      "enabled": false,
      "apiKey": "OPENAI_API_KEY",
      "model": "gpt-4.1-mini"
    },
    "parallel": {
      "enabled": false,
      "apiKey": "PARALLEL_API_KEY"
    },
    "perplexity": {
      "enabled": false,
      "apiKey": "PERPLEXITY_API_KEY",
      "model": "sonar"
    },
    "searxng": {
      "enabled": false,
      "instanceUrl": "http://localhost:8080"
    },
    "serper": {
      "enabled": false,
      "apiKey": "SERPER_API_KEY"
    },
    "sofya": {
      "enabled": false,
      "apiKey": "SOFYA_API_KEY",
      "searchDepth": "basic",
      "topic": "general"
    },
    "tavily": {
      "enabled": false,
      "apiKey": "TAVILY_API_KEY"
    },
    "websearchapi": {
      "enabled": false,
      "apiKey": "WEBSEARCHAPI_API_KEY"
    },
    "youcom": {
      "enabled": false,
      "apiKey": "YOUCOM_API_KEY"
    }
  },
  "github": {
    "enabled": true,
    "maxRepoSizeMB": 350,
    "cloneTimeoutSeconds": 30
  },
  "combine": {
    "enabled": false,
    "mode": "targeted",
    "targetBackends": 3,
    "k": 60
  },
  "gemini": {
    "apiKey": "GEMINI_API_KEY",
    "baseUrl": "https://generativelanguage.googleapis.com",
    "cloudflareApiKey": "CLOUDFLARE_API_KEY",
    "allowBrowserCookies": false,
    "chromeProfile": "Default"
  },
  "youtube": {
    "enabled": true,
    "preferredModel": "gemini-3-flash-preview"
  },
  "video": {
    "enabled": true,
    "preferredModel": "gemini-3-flash-preview",
    "maxSizeMB": 50
  },
  "pdf": {
    "ocrEnabled": true,
    "ocrMaxPages": 5,
    "ocrDpi": 150
  },
  "deepResearch": {
    "enabled": true,
    "modeDefaults": {
      "lite": {
        "type": "deep-lite",
        "numResults": 15,
        "textMaxCharacters": 10000,
        "timeoutSeconds": 300,
        "highlightsMaxCharacters": 600,
        "highlightNumSentences": 3,
        "highlightsPerUrl": 1
      },
      "standard": {
        "type": "deep-reasoning",
        "numResults": 50,
        "textMaxCharacters": 16000,
        "timeoutSeconds": 600,
        "highlightsMaxCharacters": 900,
        "highlightNumSentences": 4,
        "highlightsPerUrl": 2
      },
      "full": {
        "type": "deep-reasoning",
        "numResults": 150,
        "textMaxCharacters": 24000,
        "timeoutSeconds": 1800,
        "highlightsMaxCharacters": 1200,
        "highlightNumSentences": 5,
        "highlightsPerUrl": 3
      }
    },
    "outputSchema": null,
    "guidance": {}
  },
  "guidance": {
    "web_search": {},
    "web_fetch": {},
    "web_read": {},
    "code_search": {},
    "web_docs_search": {},
    "web_docs_fetch": {}
  },
  "ssrf": {
    "allowRanges": []
  }
}
```

Useful advanced settings:

- `selectionStrategy`: `auto` or `best-performing`
- `combine`: optional reciprocal-rank fusion across eligible providers
- `github`: GitHub repository size and clone timeout limits
- `gemini`: API key, custom base URL, Cloudflare AI Gateway key, and browser-cookie access
- `youtube` and `video`: enablement, preferred Gemini model, and local video size limit
- `pdf`: OCR enablement, page limit, and rasterization DPI
- `deepResearch`: mode defaults, structured output schema, and report guidance
- `guidance`: prompt overrides for individual tools
- `ssrf.allowRanges`: explicit CIDR exceptions for trusted private networks

To use Gemini browser cookies, set `PI_ALLOW_BROWSER_COOKIES=1` or enable `gemini.allowBrowserCookies` in the global config. Project config cannot enable sensitive cookie or network access unless the project is trusted.

### Optional command-line tools

| Tool                    | Enables                                                 |
| ----------------------- | ------------------------------------------------------- |
| `ddgs`                  | Keyless DuckDuckGo search                               |
| `gh`                    | Richer GitHub repository access when Pi chooses the CLI |
| `yt-dlp`                | YouTube stream lookup and frame extraction              |
| `ffmpeg`                | YouTube and local video frame extraction                |
| `pdftoppm` from Poppler | Scanned PDF rasterization for OCR                       |

## Development

```bash
pnpm install
pnpm check
pnpm release:check
```

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md) for release notes.

## License

MIT. See [`LICENSE`](LICENSE).
