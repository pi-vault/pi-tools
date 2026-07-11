# Deep Research — Phase 6: Tool Definition and Registration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `web_research` tool definition with its parameter schema, execute function, TUI rendering, and conditionally register it when the Exa API key is available and deep research is enabled.

**Architecture:** `src/tools/web-research.ts` exports `createWebResearchTool()` following the same factory pattern as other tools (e.g., `createWebDocsFetchTool`). It orchestrates: mode application, client calls (potentially multi-query for full mode), result deduplication, report rendering, file writes via `withFileMutationQueue`, and session metadata tracking via `appendEntry`. Registration in `src/index.ts` gates on `resolveApiKey(exa.apiKey)` being truthy AND `deepResearch.enabled !== false`.

**Tech Stack:** TypeScript, Vitest, typebox (schema), `@earendil-works/pi-coding-agent` (`withFileMutationQueue`, `ToolDefinition`), `@earendil-works/pi-tui` (`Text`)

**Spec:** `docs/superpowers/specs/2026-07-11-deep-research-design.md`
**Main plan:** `docs/superpowers/plans/2026-07-11-deep-research.md`

**Depends on:** Phase 1 (types), Phase 2 (client), Phase 3 (prepare), Phase 4 (report), Phase 5 (config)
**Produces:** Working `web_research` tool, registered and functional end-to-end.

---

## Context for the Engineer

### How existing tools are structured

Each tool file (e.g., `src/tools/web-docs-fetch.ts`) exports a factory function:

```typescript
export function createWebDocsFetchTool(
  resolveProvider: () => DocsProvider | undefined,
  store: ContentStore,
  guidance?: GuidanceOverride,
): ToolDefinition<typeof Params, Details> { ... }
```

The factory returns a `ToolDefinition` object with:

- `name`, `label`, `description` — metadata
- `promptSnippet`, `promptGuidelines` — what the LLM sees
- `parameters` — typebox schema
- `execute(toolCallId, params, signal, onUpdate, ctx)` — main logic
- `renderCall(args, theme, context)` — TUI display during execution
- `renderResult(result, options, theme, context)` — TUI display of result

### Registration pattern (`src/index.ts`)

Tools are registered with `pi.registerTool(...)`. Conditional tools (like docs) check availability first:

```typescript
const docsProvider = registry.selectDocs();
if (docsProvider) {
  pi.registerTool(createWebDocsSearchTool(...));
}
```

### File writes

Use `withFileMutationQueue` from `@earendil-works/pi-coding-agent`:

```typescript
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
await withFileMutationQueue(path, async () => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
});
```

### Session tracking

Metadata-only entries via `pi.appendEntry`:

```typescript
pi.appendEntry("pi-tools-research", {
  query,
  outputPath,
  sourceCount,
  metadata,
});
```

### Test helpers

- `stubFetch()` — mocks `globalThis.fetch` with route-based matching
- `createMockPi()` — returns a mock `ExtensionAPI` that captures `registerTool` calls
- `makeCtx()` — returns a mock `ExtensionContext` with `cwd: "/tmp/test"`

---

### Task 6: web_research tool definition

**Files:**

- Create: `src/tools/web-research.ts`
- Test: `tests/tools/web-research.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/tools/web-research.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWebResearchTool } from "../../src/tools/web-research.ts";
import { stubFetch } from "../helpers.ts";
import { makeCtx } from "../helpers.ts";
import * as fsPromises from "node:fs/promises";

vi.mock("node:fs/promises");
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    withFileMutationQueue: async (_path: string, fn: () => Promise<void>) =>
      fn(),
  };
});

describe("createWebResearchTool", () => {
  let fetchStub: ReturnType<typeof stubFetch>;
  const appendEntry = vi.fn();

  beforeEach(() => {
    fetchStub = stubFetch();
    vi.mocked(fsPromises.readFile).mockRejectedValue(new Error("ENOENT"));
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);
  });
  afterEach(() => {
    fetchStub.restore();
    vi.restoreAllMocks();
  });

  function makeTool() {
    return createWebResearchTool(
      "test-exa-key",
      { enabled: true },
      appendEntry,
    );
  }

  it("has correct name and description", () => {
    const tool = makeTool();
    expect(tool.name).toBe("web_research");
    expect(tool.label).toBe("Web Research");
  });

  it("executes research and returns inline report when no outputPath", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: {
        results: [
          { title: "Source", url: "https://example.com", text: "content" },
        ],
        answer: "The answer is X.",
      },
    });

    const tool = makeTool();
    const result = await tool.execute(
      "call-1",
      { query: "What is X?" },
      undefined,
      vi.fn(),
      makeCtx(),
    );
    const text =
      result.content[0] && "text" in result.content[0]
        ? result.content[0].text
        : "";
    expect(text).toContain("Findings:");
    expect(text).toContain("The answer is X.");
  });

  it("writes report to outputPath when specified", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: { results: [], answer: "Answer" },
    });

    const tool = makeTool();
    await tool.execute(
      "call-2",
      { query: "test", outputPath: "findings.md" },
      undefined,
      vi.fn(),
      makeCtx(),
    );

    expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalled();
    const writeCall = vi.mocked(fsPromises.writeFile).mock.calls[0];
    expect(String(writeCall[0])).toContain("findings.md");
  });

  it("writes raw sidecar for findings format", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: { results: [], answer: "Answer" },
    });

    const tool = makeTool();
    await tool.execute(
      "call-3",
      { query: "test", outputPath: "findings.md", reportFormat: "findings" },
      undefined,
      vi.fn(),
      makeCtx(),
    );

    const writeCalls = vi.mocked(fsPromises.writeFile).mock.calls;
    expect(writeCalls.length).toBe(2);
    const sidecarPath = String(writeCalls[1][0]);
    expect(sidecarPath).toContain("findings.raw.json");
  });

  it("does not write raw sidecar for json format", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: { results: [], answer: "Answer" },
    });

    const tool = makeTool();
    await tool.execute(
      "call-4",
      { query: "test", outputPath: "out.json", reportFormat: "json" },
      undefined,
      vi.fn(),
      makeCtx(),
    );

    const writeCalls = vi.mocked(fsPromises.writeFile).mock.calls;
    expect(writeCalls.length).toBe(1);
  });

  it("calls appendEntry with research metadata", async () => {
    fetchStub.addResponse("api.exa.ai/search", {
      body: {
        results: [{ title: "A", url: "https://a.com", text: "text" }],
        answer: "Answer",
      },
    });

    const tool = makeTool();
    await tool.execute(
      "call-5",
      { query: "test" },
      undefined,
      vi.fn(),
      makeCtx(),
    );

    expect(appendEntry).toHaveBeenCalledWith(
      "pi-tools-research",
      expect.objectContaining({
        query: "test",
        sourceCount: 1,
      }),
    );
  });

  it("throws when deepResearch is disabled", async () => {
    const tool = createWebResearchTool("key", { enabled: false }, appendEntry);
    await expect(
      tool.execute("call-6", { query: "test" }, undefined, vi.fn(), makeCtx()),
    ).rejects.toThrow(/disabled/);
  });

  it("throws when query is missing", async () => {
    const tool = makeTool();
    await expect(
      tool.execute("call-7", {}, undefined, vi.fn(), makeCtx()),
    ).rejects.toThrow(/requires query/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npx vitest run tests/tools/web-research.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/tools/web-research.ts`:

```typescript
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, isAbsolute } from "node:path";
import { Type } from "typebox";
import type { Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { ExaDeepResearchClient } from "../providers/exa-deep-research.ts";
import type { DeepResearchConfig, GuidanceOverride } from "../config.ts";
import type { AppendEntryFn } from "../storage.ts";
import type { ExaDeepType, ReportFormat } from "../research/types.ts";
import {
  applyResearchMode,
  prepareResearchInput,
  resolveOutputPath,
} from "../research/prepare.ts";
import {
  buildRawSidecar,
  defaultRawOutputPath,
  renderFindingsReport,
} from "../research/report.ts";

const researchModes = ["lite", "standard", "full"] as const;
const reportFormats = ["findings", "markdown", "json"] as const;

const WebResearchParams = Type.Object({
  query: Type.Optional(
    Type.String({
      description: "Research question to investigate with Exa Deep Search.",
    }),
  ),
  queryFile: Type.Optional(
    Type.String({
      description: "Path to a file containing the research question.",
    }),
  ),
  contextFiles: Type.Optional(
    Type.Array(Type.String(), {
      description: "Context files to append to system prompt.",
    }),
  ),
  contextGlob: Type.Optional(
    Type.String({
      description: "Simple glob for context files (one * in filename).",
    }),
  ),
  researchMode: Type.Optional(
    Type.Union(
      researchModes.map((m) => Type.Literal(m)),
      { description: "Research depth: lite, standard (default), or full." },
    ),
  ),
  type: Type.Optional(
    Type.String({
      description:
        "Override Exa deep type: deep-reasoning, deep-lite, or deep.",
    }),
  ),
  systemPrompt: Type.Optional(
    Type.String({
      description: "Override the default research system prompt.",
    }),
  ),
  additionalQueries: Type.Optional(
    Type.Array(Type.String(), { description: "Extra queries for full mode." }),
  ),
  numResults: Type.Optional(
    Type.Number({ description: "Number of source results." }),
  ),
  textMaxCharacters: Type.Optional(
    Type.Number({ description: "Max text characters per source." }),
  ),
  highlightsMaxCharacters: Type.Optional(
    Type.Number({ description: "Max highlight characters." }),
  ),
  highlightNumSentences: Type.Optional(
    Type.Number({ description: "Sentences per highlight." }),
  ),
  highlightsPerUrl: Type.Optional(
    Type.Number({ description: "Highlights per URL." }),
  ),
  summaryQuery: Type.Optional(
    Type.String({ description: "Summary query for Exa." }),
  ),
  maxAgeHours: Type.Optional(
    Type.Number({ description: "Max age of sources in hours." }),
  ),
  category: Type.Optional(
    Type.String({ description: "Exa content category filter." }),
  ),
  includeDomains: Type.Optional(
    Type.Array(Type.String(), {
      description: "Only include results from these domains.",
    }),
  ),
  excludeDomains: Type.Optional(
    Type.Array(Type.String(), {
      description: "Exclude results from these domains.",
    }),
  ),
  startPublishedDate: Type.Optional(
    Type.String({
      description: "Only sources published after this date (ISO 8601).",
    }),
  ),
  endPublishedDate: Type.Optional(
    Type.String({
      description: "Only sources published before this date (ISO 8601).",
    }),
  ),
  outputSchema: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), {
      description: "Custom structured output schema.",
    }),
  ),
  outputPath: Type.Optional(
    Type.String({ description: "Path to write findings report." }),
  ),
  reportTitle: Type.Optional(
    Type.String({ description: "Custom title for the findings report." }),
  ),
  reportFormat: Type.Optional(
    Type.Union(
      reportFormats.map((f) => Type.Literal(f)),
      { description: "Report format: findings (default), markdown, or json." },
    ),
  ),
  rawOutputPath: Type.Optional(
    Type.String({ description: "Path for raw metadata sidecar." }),
  ),
});

interface WebResearchDetails {
  outputPath?: string;
  rawOutputPath?: string;
  sourceCount: number;
  metadata: Record<string, unknown>;
}

async function writeQueued(path: string, content: string): Promise<void> {
  await withFileMutationQueue(path, async () => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  });
}

function displayPath(cwd: string | undefined, filePath: string): string {
  if (!cwd) return filePath;
  const rel = relative(cwd, filePath);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : filePath;
}

export function createWebResearchTool(
  exaApiKey: string,
  deepResearchConfig: DeepResearchConfig,
  appendEntry: AppendEntryFn,
  guidance?: GuidanceOverride,
): ToolDefinition<typeof WebResearchParams, WebResearchDetails> {
  return {
    name: "web_research",
    label: "Web Research",
    description:
      "Run Exa Deep Search and optionally write a findings report. Requires EXA_API_KEY.",
    promptSnippet:
      guidance?.promptSnippet ??
      "Run Exa deep research for evidence-backed findings reports. Pass outputPath to save results to disk.",
    promptGuidelines: guidance?.promptGuidelines ?? [
      "Use web_research for multi-source research that needs structured findings reports.",
      "Choose researchMode based on depth: lite (quick, 5min), standard (default, 10min), full (thorough, 30min).",
      "Pass outputPath when the user asks for a saved report or findings file.",
    ],
    parameters: WebResearchParams,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (!deepResearchConfig.enabled) {
        throw new Error(
          "web_research is disabled via deepResearch.enabled config.",
        );
      }

      const cwd = ctx.cwd;
      const prepared = await prepareResearchInput(cwd, params);
      const mode = applyResearchMode(prepared, deepResearchConfig.modeDefaults);

      const client = new ExaDeepResearchClient(exaApiKey);

      // Full mode runs multiple queries with deduplication
      const queryList =
        mode.researchMode === "full"
          ? [prepared.query, ...(prepared.additionalQueries ?? [])]
              .map((q) => q.trim())
              .filter(Boolean)
          : [prepared.query];
      const uniqueQueries = Array.from(new Set(queryList));

      // Execute research queries
      const responses = [];
      for (const query of uniqueQueries) {
        responses.push(
          await client.deepResearch(
            {
              query,
              type: mode.type as ExaDeepType,
              numResults: mode.numResults,
              textMaxCharacters: mode.textMaxCharacters,
              highlightsMaxCharacters: mode.highlightsMaxCharacters,
              highlightNumSentences: mode.highlightNumSentences,
              highlightsPerUrl: mode.highlightsPerUrl,
              summaryQuery: mode.summaryQuery,
              maxAgeHours: mode.maxAgeHours,
              category: mode.category,
              includeDomains: prepared.includeDomains,
              excludeDomains: prepared.excludeDomains,
              startPublishedDate: prepared.startPublishedDate,
              endPublishedDate: prepared.endPublishedDate,
              additionalQueries:
                mode.researchMode === "full"
                  ? undefined
                  : prepared.additionalQueries,
              systemPrompt: prepared.systemPrompt,
              outputSchema: mode.outputSchema,
            },
            signal ?? undefined,
          ),
        );
      }

      // Deduplicate results across queries
      const seen = new Set<string>();
      const uniqueResults = [];
      let sourceCount = 0;
      for (const resp of responses) {
        sourceCount += resp.results.length;
        for (const r of resp.results) {
          const key = (r.url || r.title || JSON.stringify(r))
            .trim()
            .toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          uniqueResults.push(r);
        }
      }

      // Build merged response
      const mergedAnswer =
        responses
          .map((r) => r.answer?.trim())
          .filter(Boolean)
          .join("\n\n") || undefined;
      const mergedRaw =
        responses.length === 1
          ? responses[0].raw
          : {
              responses: responses.map((r) => r.raw),
              results: uniqueResults,
              answer: mergedAnswer,
            };
      const response = {
        answer: mergedAnswer,
        results: uniqueResults,
        raw: mergedRaw,
        metadata: {
          researchMode: mode.researchMode,
          type: mode.type,
          numResults: mode.numResults,
          textMaxCharacters: mode.textMaxCharacters,
          timeoutSeconds: mode.timeoutSeconds,
          queryCount: uniqueQueries.length,
          sourceCount,
          uniqueSourceCount: uniqueResults.length,
        },
      };

      // Determine output paths
      const format: ReportFormat =
        (params.reportFormat as ReportFormat) ?? "findings";
      let outputPath: string | undefined;
      let rawOutputPath: string | undefined;
      if (params.outputPath) {
        outputPath = resolveOutputPath(cwd, params.outputPath);
        if (format === "findings") {
          rawOutputPath = params.rawOutputPath
            ? resolveOutputPath(cwd, params.rawOutputPath)
            : defaultRawOutputPath(outputPath);
        } else if (format === "markdown" && params.rawOutputPath) {
          rawOutputPath = resolveOutputPath(cwd, params.rawOutputPath);
        }
      } else if (params.rawOutputPath) {
        rawOutputPath = resolveOutputPath(cwd, params.rawOutputPath);
      }

      // Render report
      const report =
        format === "json"
          ? JSON.stringify(response.raw, null, 2)
          : renderFindingsReport(prepared, response, { rawOutputPath });

      // Write files
      if (outputPath) {
        await writeQueued(outputPath, report);
      }
      if (rawOutputPath) {
        await writeQueued(
          rawOutputPath,
          JSON.stringify(buildRawSidecar(response, rawOutputPath), null, 2),
        );
      }

      // Track in session
      appendEntry("pi-tools-research", {
        query: prepared.query,
        outputPath,
        rawOutputPath,
        metadata: response.metadata,
        sourceCount: uniqueResults.length,
      });

      // Return result
      const text = outputPath
        ? `Exa deep research complete. Report: ${displayPath(cwd, outputPath)}\nSources: ${uniqueResults.length}${rawOutputPath ? `\nRaw metadata: ${displayPath(cwd, rawOutputPath)}` : ""}`
        : report;

      return {
        content: [{ type: "text" as const, text }],
        details: {
          outputPath,
          rawOutputPath,
          sourceCount: uniqueResults.length,
          metadata: response.metadata,
        },
      };
    },
    renderCall(args, theme: Theme, context) {
      const text =
        context.lastComponent instanceof Text
          ? context.lastComponent
          : new Text("", 0, 0);
      const mode = args.researchMode ?? "standard";
      const queryPreview = args.query ?? args.queryFile ?? "research";
      const preview =
        queryPreview.length > 60
          ? `${queryPreview.slice(0, 57)}...`
          : queryPreview;
      text.setText(
        `${theme.fg("toolTitle", theme.bold("web_research"))} ${theme.fg("accent", `"${preview}"`)} ${theme.fg("muted", `(${mode})`)}`,
      );
      return text;
    },
    renderResult(result, _options, theme: Theme, context) {
      const text =
        context.lastComponent instanceof Text
          ? context.lastComponent
          : new Text("", 0, 0);
      if (context.isError) {
        const errorText =
          result.content[0] && "text" in result.content[0]
            ? result.content[0].text
            : "failed";
        text.setText(theme.fg("error", `web_research failed: ${errorText}`));
        return text;
      }
      const details = result.details as WebResearchDetails | undefined;
      const sourceCount = details?.sourceCount ?? 0;
      const outputPath = details?.outputPath;
      const parts = [`web_research complete`, `${sourceCount} sources`];
      if (outputPath)
        parts.push(`report: ${displayPath(context.cwd, outputPath)}`);
      text.setText(theme.fg("toolOutput", parts.join(" - ")));
      return text;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npx vitest run tests/tools/web-research.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/web-research.ts tests/tools/web-research.test.ts
git commit -m "feat(tools): add web_research tool definition"
```

---

### Task 7: Register web_research in index.ts

**Files:**

- Modify: `src/index.ts`
- Test: `tests/index-research.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/index-research.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createMockPi } from "./helpers.ts";

vi.mock("../src/config.ts", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    loadMergedConfig: vi.fn(),
  };
});

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    withFileMutationQueue: async (_path: string, fn: () => Promise<void>) =>
      fn(),
  };
});

describe("web_research registration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("registers web_research when exa API key is available", async () => {
    const { loadMergedConfig } = await import("../src/config.ts");
    vi.mocked(loadMergedConfig).mockReturnValue({
      defaultProvider: "auto",
      selectionStrategy: "auto",
      providers: {
        exa: { enabled: true, apiKey: "test-key" },
      },
      github: { enabled: true, maxRepoSizeMB: 350, cloneTimeoutSeconds: 30 },
      ssrf: { allowRanges: [] },
      combine: { enabled: false, mode: "targeted", targetBackends: 3, k: 60 },
      deepResearch: { enabled: true },
    } as any);

    process.env.EXA_API_KEY = "test-exa-key";
    const pi = createMockPi();
    const { default: createExtension } = await import("../src/index.ts");
    createExtension(pi as any);

    const toolNames = pi.tools.map((t) => t.name);
    expect(toolNames).toContain("web_research");
    delete process.env.EXA_API_KEY;
  });

  it("does not register web_research when exa API key is missing", async () => {
    const { loadMergedConfig } = await import("../src/config.ts");
    vi.mocked(loadMergedConfig).mockReturnValue({
      defaultProvider: "auto",
      selectionStrategy: "auto",
      providers: {
        exa: { enabled: true, apiKey: "EXA_API_KEY" },
      },
      github: { enabled: true, maxRepoSizeMB: 350, cloneTimeoutSeconds: 30 },
      ssrf: { allowRanges: [] },
      combine: { enabled: false, mode: "targeted", targetBackends: 3, k: 60 },
      deepResearch: { enabled: true },
    } as any);

    delete process.env.EXA_API_KEY;
    const pi = createMockPi();
    const { default: createExtension } = await import("../src/index.ts");
    createExtension(pi as any);

    const toolNames = pi.tools.map((t) => t.name);
    expect(toolNames).not.toContain("web_research");
  });

  it("does not register web_research when deepResearch.enabled is false", async () => {
    const { loadMergedConfig } = await import("../src/config.ts");
    vi.mocked(loadMergedConfig).mockReturnValue({
      defaultProvider: "auto",
      selectionStrategy: "auto",
      providers: {
        exa: { enabled: true, apiKey: "test-key" },
      },
      github: { enabled: true, maxRepoSizeMB: 350, cloneTimeoutSeconds: 30 },
      ssrf: { allowRanges: [] },
      combine: { enabled: false, mode: "targeted", targetBackends: 3, k: 60 },
      deepResearch: { enabled: false },
    } as any);

    process.env.EXA_API_KEY = "test-exa-key";
    const pi = createMockPi();
    const { default: createExtension } = await import("../src/index.ts");
    createExtension(pi as any);

    const toolNames = pi.tools.map((t) => t.name);
    expect(toolNames).not.toContain("web_research");
    delete process.env.EXA_API_KEY;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npx vitest run tests/index-research.test.ts`
Expected: FAIL — `web_research` not in registered tools

- [ ] **Step 3: Wire registration in index.ts**

Add import at top of `src/index.ts` (after the existing tool imports, around line 15):

```typescript
import { createWebResearchTool } from "./tools/web-research.ts";
import { resolveApiKey } from "./config.ts";
```

Add registration block after the docs tools block (after line 119, before the tier map comment):

```typescript
// Register web_research when Exa key is available and deep research enabled
const exaConfig = configManager.current.providers?.exa;
const resolvedExaKey = resolveApiKey(exaConfig?.apiKey);
if (resolvedExaKey && configManager.current.deepResearch?.enabled !== false) {
  pi.registerTool(
    createWebResearchTool(
      resolvedExaKey,
      configManager.current.deepResearch,
      (customType, data) => pi.appendEntry(customType, data),
      configManager.current.deepResearch?.guidance,
    ),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npx vitest run tests/index-research.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Run typecheck**

Run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/index.ts tests/index-research.test.ts
git commit -m "feat: register web_research tool conditionally on Exa key"
```

---

### Task 8: Final verification and cleanup

- [ ] **Step 1: Run the full check command**

Run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npm run check`
Expected: lint, typecheck, and all tests pass

- [ ] **Step 2: Fix any biome lint/format issues**

If biome reports formatting issues:

Run: `cd /Users/lanh/Developer/pi-vault/pi-tools && npm run format`

Then re-run: `npm run check`

- [ ] **Step 3: Commit cleanup if needed**

```bash
git add -A
git commit -m "chore: formatting and lint fixes"
```
