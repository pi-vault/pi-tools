# Deep Research (`web_research`) Design

**Date:** 2026-07-11
**Status:** Approved
**Reference:** `@vanillagreen/pi-web-tools` `src/tools/web-research.ts`

## Problem

pi-tools provides web search, fetch, code search, and docs tools -- all designed for quick, targeted lookups. There is no tool for in-depth, evidence-backed research that synthesizes information from many sources into structured findings reports. The `@vanillagreen/pi-web-tools` extension already ships `web_research` powered by Exa's Deep Search API; pi-tools needs the same capability.

## Solution

Add a `web_research` tool to pi-tools as a full 1:1 port of pi-web-tools' implementation. The tool uses Exa's Deep Search API (deep-reasoning/deep-lite types) to run multi-source research and produce structured findings reports with raw metadata sidecars.

## Design Decisions

- **Separate Exa client.** A new `ExaDeepResearchClient` handles deep search API calls independently of the existing `ExaProvider`. Deep research uses a much richer request shape (contents config, highlights, system prompts, output schemas) than regular search, and returns fundamentally different data. Keeping them separate avoids bloating the existing clean provider abstraction.
- **Independent file writes.** Research produces disk artifacts (findings reports, raw JSON sidecars) rather than in-memory content. Files are written via `withFileMutationQueue` from the `@earendil-works/pi-coding-agent` peer dependency. Session tracking uses `pi.appendEntry` with metadata only (no full report text in memory).
- **Full config integration.** A `deepResearch` section in `tools.json` provides an enabled toggle, per-mode default overrides, and a global output schema. Resolution order: per-call param > config modeDefaults > built-in defaults.
- **Conditional registration.** The tool is only registered when the Exa API key is configured and `deepResearch.enabled` is not `false`. Matches the pattern used by `web_docs_search`/`web_docs_fetch`.
- **Simple TUI rendering.** Matches pi-tools' existing `Text`-based renderCall/renderResult style. No source trees, expandable views, or custom glyphs.

## Architecture

### New Files

| File                                 | Purpose                                                       |
| ------------------------------------ | ------------------------------------------------------------- |
| `src/tools/web-research.ts`          | Tool definition, schema, execute, renderCall/renderResult     |
| `src/providers/exa-deep-research.ts` | `ExaDeepResearchClient` class                                 |
| `src/research/types.ts`              | Research mode defaults, interfaces, output schema             |
| `src/research/prepare.ts`            | Query/context resolution, mode application, input preparation |
| `src/research/report.ts`             | Findings report rendering (markdown/json formats)             |

### Modified Files

| File                    | Change                                                     |
| ----------------------- | ---------------------------------------------------------- |
| `src/index.ts`          | Conditionally register `web_research` when Exa key present |
| `src/config.ts`         | Add `DeepResearchConfig` interface and defaults            |
| `src/config-manager.ts` | Load/validate `deepResearch` config section                |

## ExaDeepResearchClient

Thin client that hits Exa's `/search` endpoint with deep search types. Owns its own API key, headers, and base URL (duplicates 3 lines from `ExaProvider` rather than sharing a base class).

```typescript
type ExaDeepType = "deep-reasoning" | "deep-lite" | "deep";

interface DeepResearchParams {
  query: string;
  type: ExaDeepType;
  numResults?: number;
  textMaxCharacters?: number;
  highlightsMaxCharacters?: number;
  highlightNumSentences?: number;
  highlightsPerUrl?: number;
  summaryQuery?: string;
  maxAgeHours?: number;
  category?: string;
  includeDomains?: string[];
  excludeDomains?: string[];
  startPublishedDate?: string;
  endPublishedDate?: string;
  additionalQueries?: string[];
  systemPrompt?: string;
  outputSchema?: Record<string, unknown>;
}

interface DeepResearchResult {
  title?: string;
  url?: string;
  text?: string;
  summary?: string;
  highlights?: string[];
  publishedDate?: string;
}

interface DeepResearchResponse {
  answer?: string;
  results: DeepResearchResult[];
  raw: unknown;
  metadata: Record<string, unknown>;
}
```

The client builds the full Exa request body (contents with text limits, highlights options, summary query, output schema) and normalizes the response. Matches pi-web-tools' `ExaClient.buildSearchBody()` + `normalizeResults()` logic.

## Research Modes

Three modes with built-in defaults:

| Mode       | Exa Type         | Results | Text Cap | Highlights Cap | Sentences | Per-URL | Timeout | Output Schema |
| ---------- | ---------------- | ------- | -------- | -------------- | --------- | ------- | ------- | ------------- |
| `lite`     | `deep-lite`      | 15      | 10,000   | 600            | 3         | 1       | 300s    | No            |
| `standard` | `deep-reasoning` | 50      | 16,000   | 900            | 4         | 2       | 600s    | Yes           |
| `full`     | `deep-reasoning` | 150     | 24,000   | 1,200          | 5         | 3       | 1800s   | Yes           |

`standard` and `full` include a default structured output schema:

```typescript
const defaultResearchOutputSchema = {
  type: "object",
  required: [
    "executiveSummary",
    "keyFindings",
    "recommendation",
    "risks",
    "revisitConditions",
  ],
  properties: {
    executiveSummary: {
      type: "string",
      description: "Concise source-grounded summary.",
    },
    keyFindings: {
      type: "array",
      items: { type: "string" },
      description: "Important findings with specifics.",
    },
    tradeoffs: {
      type: "array",
      items: { type: "string" },
      description: "Tradeoffs and alternatives.",
    },
    recommendation: {
      type: "string",
      description: "Recommended decision or criteria.",
    },
    risks: {
      type: "array",
      items: { type: "string" },
      description: "Known risks or uncertainties.",
    },
    revisitConditions: {
      type: "array",
      items: { type: "string" },
      description: "Conditions that trigger re-research.",
    },
  },
};
```

## Tool Schema

Full parameter set matching pi-web-tools:

- `query` / `queryFile` -- research question (one required)
- `researchMode` -- `lite` | `standard` | `full` (default: `standard`)
- `type` -- override Exa deep type directly
- `contextFiles` / `contextGlob` -- up to 25 context files injected into system prompt
- `additionalQueries` -- extra queries for `full` mode
- `systemPrompt` -- override the default research system prompt
- `numResults`, `textMaxCharacters`, `highlightsMaxCharacters`, `highlightNumSentences`, `highlightsPerUrl` -- per-call overrides
- `summaryQuery`, `maxAgeHours`, `category` -- Exa-specific params
- `includeDomains`, `excludeDomains`, `startPublishedDate`, `endPublishedDate` -- search filters
- `outputSchema` -- custom structured output schema
- `outputPath` / `reportFormat` / `reportTitle` -- findings report destination and format
- `rawOutputPath` -- explicit path for raw metadata sidecar

## Config Schema

New `DeepResearchConfig` in `tools.json`:

```typescript
interface DeepResearchConfig {
  enabled: boolean; // default: true (when Exa key present)
  modeDefaults?: Partial<Record<ResearchMode, Partial<ResearchModeDefaults>>>;
  outputSchema?: Record<string, unknown> | null; // global override
  guidance?: GuidanceOverride; // promptSnippet override, same as other tools
}
```

Example config:

```json
{
  "deepResearch": {
    "enabled": true,
    "modeDefaults": {
      "lite": { "numResults": 20 },
      "standard": { "numResults": 60, "textMaxCharacters": 20000 }
    },
    "outputSchema": null
  }
}
```

Resolution order: per-call param > config `modeDefaults[mode]` > built-in defaults.

## Registration

Conditional, matching the `web_docs` pattern:

```typescript
const exaKey = configManager.current.providers?.exa?.apiKey;
if (exaKey && configManager.current.deepResearch?.enabled !== false) {
  pi.registerTool(createWebResearchTool(exaKey, configManager, pi.appendEntry));
}
```

## Execution Flow

1. **Validate** -- check `deepResearch.enabled`, resolve query from `query` or `queryFile`
2. **Prepare context** -- resolve `contextFiles`/`contextGlob` paths (max 25), read contents, build system prompt with context appended
3. **Apply mode** -- merge per-call > config modeDefaults > built-in defaults to produce final params
4. **Execute** -- `full` mode: run primary query + `additionalQueries` sequentially, deduplicate results by URL. `lite`/`standard`: single query.
5. **Render report** -- format as findings markdown, raw JSON, or plain markdown based on `reportFormat`
6. **Write files** -- if `outputPath` set, write report via `withFileMutationQueue`. Write raw sidecar to `rawOutputPath` (defaults to `<findings>.raw.json`).
7. **Track** -- `pi.appendEntry("pi-tools-research", { query, outputPath, rawOutputPath, metadata, sourceCount })`
8. **Return** -- if `outputPath`: brief confirmation with path + source count. Otherwise: full report inline.

## File Writes

Uses `withFileMutationQueue` from `@earendil-works/pi-coding-agent` peer dependency:

```typescript
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";

async function writeReport(path: string, content: string): Promise<void> {
  await withFileMutationQueue(path, async () => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  });
}
```

## Report Format

The `findings` format (default) produces a structured markdown document:

```markdown
# Findings: <title>

## Research Question

<query>

## Executive Summary

<answer or structured executiveSummary>

## Key Findings

<bullet list from structured output or top results>

## Evidence and Sources

<numbered source list with URLs and dates>
<per-source evidence snippets>

## Tradeoffs / Alternatives

<from structured output or defaults>

## Recommendation / Decision Criteria

<from structured output>

## Risks / Unknowns

<from structured output or defaults>

## Revisit Conditions

<from structured output or defaults>

## Research Metadata

- Mode: standard
- Exa type: deep-reasoning
- Queries: 1
- Sources: 42 unique
- Raw metadata sidecar: ./findings.raw.json
```

The `json` format writes `JSON.stringify(response.raw, null, 2)` (no raw sidecar generated). The `markdown` format produces the same structured report as `findings` but does not auto-generate a raw sidecar path (user can still pass `rawOutputPath` explicitly).

## Raw Metadata Sidecar

Written alongside findings reports (default: `<outputPath>.raw.json`):

```json
{
  "metadata": {
    "researchMode": "standard",
    "type": "deep-reasoning",
    "numResults": 50,
    "queryCount": 1,
    "sourceCount": 50,
    "uniqueSourceCount": 42,
    "elapsedMs": 45000
  },
  "raw": {
    /* full Exa API response */
  }
}
```

## TUI Rendering

Simple `Text`-based rendering matching pi-tools style:

**renderCall:**

```
web_research "query text" (standard/deep-reasoning)
```

**renderResult (success):**

```
web_research complete - 42 sources - report: ./findings.md
```

**renderResult (error):**

```
web_research failed: <error message>
```

## Context File Resolution

Matches pi-web-tools behavior:

- `contextFiles`: array of paths (absolute or relative to cwd). Leading `@` stripped.
- `contextGlob`: simple glob with one `*` in filename only (e.g., `docs/context-*.md`). Max 25 matches.
- Context file contents are appended to the system prompt separated by `---`.
- `queryFile`: path to a file containing the research question text.

## Testing

- Unit tests for `ExaDeepResearchClient` (mock fetch, verify request body shape)
- Unit tests for `prepareResearchInput` (context resolution, mode application)
- Unit tests for `renderFindingsReport` (structured output rendering, fallback paths)
- Unit tests for config validation (deep research section parsing, defaults)
- Integration test: mock Exa response end-to-end through tool execute, verify file output

## Error Handling

- Missing Exa API key at registration: tool not registered (silent)
- `deepResearch.enabled: false`: tool not registered
- Missing both `query` and `queryFile`: throw with clear message
- `contextGlob` matches > 25 files: throw with count and limit
- `contextGlob` with multiple `*` wildcards: throw with guidance
- Exa API error (non-2xx): throw with status and body text
- File write failure: propagate filesystem error (mkdir/writeFile)
