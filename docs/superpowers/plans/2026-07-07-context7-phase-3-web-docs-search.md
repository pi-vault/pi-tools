# Context7 Docs Lookup — Phase 3: web_docs_search Tool

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `web_docs_search` tool that searches Context7 for libraries by name and returns a ranked markdown table. Wire it into the extension registration flow.

**Architecture:** A `createWebDocsSearchTool` factory function (same pattern as `createCodeSearchTool`) takes a `resolveProvider` closure and returns a `ToolDefinition`. The tool is conditionally registered in `src/index.ts` only when `registry.selectDocs()` returns a provider. Errors from the Context7 API propagate as throws (Pi marks the tool result as failed).

**Tech Stack:** TypeScript, typebox (schema), @earendil-works/pi-coding-agent (ToolDefinition), @earendil-works/pi-tui (Text for rendering), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-07-context7-docs-lookup-design.md`
**Main plan:** `docs/superpowers/plans/2026-07-07-context7-docs-lookup.md`

**Depends on:** Phase 2 (registry has `selectDocs()`, context7 is in the barrel)
**Produces:** Working `web_docs_search` tool, end-to-end registered when API key is present.

---

## Context for the Engineer

After Phase 2, the registry can store and retrieve a `DocsProvider`. The extension loop in `src/index.ts` already calls `registry.registerDocs(instances.docs)` when a provider's `create()` returns a `docs` field.

The closest existing tool to model from is `src/tools/code-search.ts`:

- Exports a `createCodeSearchTool(resolveProvider, onSuccess?, guidance?)` factory
- Uses `Type.Object({...})` for params schema
- Returns `{ content: [{ type: "text", text }], details: {...} }`
- Has `renderCall` and `renderResult` for TUI display
- Handles "provider unavailable" with a helpful message (does not throw)
- API errors ARE allowed to throw — Pi marks the tool result as failed

The `DocsProvider` interface (from Phase 1):

```typescript
interface DocsProvider {
  readonly name: string;
  readonly label: string;
  searchLibrary(
    libraryName: string,
    query: string,
    signal?: AbortSignal,
  ): Promise<DocsSearchResult[]>;
  getContext(
    libraryId: string,
    query: string,
    signal?: AbortSignal,
  ): Promise<string>;
}
```

---

### Task 3.1: Implement web_docs_search tool

**Files:**

- Create: `src/tools/web-docs-search.ts`
- Create: `tests/tools/web-docs-search.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/tools/web-docs-search.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { createWebDocsSearchTool } from "../../src/tools/web-docs-search.ts";
import { makeCtx } from "../helpers.ts";
import type {
  DocsProvider,
  DocsSearchResult,
} from "../../src/providers/types.ts";
import { Context7Error } from "../../src/providers/context7.ts";

function mockDocsProvider(results: DocsSearchResult[] = []): DocsProvider {
  return {
    name: "context7",
    label: "Context7",
    searchLibrary: vi.fn().mockResolvedValue(results),
    getContext: vi.fn().mockResolvedValue(""),
  };
}

const sampleResults: DocsSearchResult[] = [
  {
    id: "/facebook/react",
    name: "React",
    description: "A JavaScript library for building user interfaces",
    totalSnippets: 2500,
    trustScore: 10,
    benchmarkScore: 95.5,
    versions: ["v18.2.0", "v17.0.2"],
  },
  {
    id: "/preactjs/preact",
    name: "Preact",
    description: "Fast 3kB alternative to React",
    totalSnippets: 450,
    trustScore: 8,
    benchmarkScore: 78.0,
  },
];

describe("web_docs_search tool", () => {
  it("has correct tool metadata", () => {
    const tool = createWebDocsSearchTool(() => mockDocsProvider());
    expect(tool.name).toBe("web_docs_search");
    expect(tool.label).toBe("Docs Search");
  });

  it("returns formatted markdown table on success", async () => {
    const tool = createWebDocsSearchTool(() => mockDocsProvider(sampleResults));
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-1",
      { libraryName: "react", query: "state management" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;

    expect(text).toContain("/facebook/react");
    expect(text).toContain("React");
    expect(text).toContain("10");      // trustScore
    expect(text).toContain("95.5");    // benchmarkScore
    expect(text).toContain("2500");    // totalSnippets
    expect(text).toContain("v18.2.0"); // versions
    expect(text).toContain("/preactjs/preact");
    expect(text).toContain("web_docs_fetch"); // footer guidance
  });

  it("returns 'no libraries found' for empty results", async () => {
    const tool = createWebDocsSearchTool(() => mockDocsProvider([]));
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-2",
      { libraryName: "nonexistent", query: "anything" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;

    expect(text).toContain("No libraries found");
  });

  it("returns setup message when provider unavailable", async () => {
    const tool = createWebDocsSearchTool(() => undefined);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-3",
      { libraryName: "react", query: "hooks" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;

    expect(text).toContain("CONTEXT7_API_KEY");
  });

  it("throws on API errors", async () => {
    const failing: DocsProvider = {
      name: "context7",
      label: "Context7",
      searchLibrary: vi
        .fn()
        .mockRejectedValue(new Context7Error("Rate limited.")),
      getContext: vi.fn(),
    };
    const tool = createWebDocsSearchTool(() => failing);
    const ctx = makeCtx();

    await expect(
      tool.execute(
        "call-4",
        { libraryName: "react", query: "hooks" },
        undefined,
        undefined,
        ctx,
      ),
    ).rejects.toThrow(Context7Error);
  });

  it("passes signal to provider", async () => {
    const provider = mockDocsProvider([]);
    const tool = createWebDocsSearchTool(() => provider);
    const ctx = makeCtx();
    const controller = new AbortController();

    await tool.execute(
      "call-5",
      { libraryName: "react", query: "hooks" },
      controller.signal,
      undefined,
      ctx,
    );

    expect(provider.searchLibrary).toHaveBeenCalledWith(
      "react",
      "hooks",
      controller.signal,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/tools/web-docs-search.test.ts`
Expected: FAIL with "Cannot find module '../../src/tools/web-docs-search.ts'"

- [ ] **Step 3: Implement web_docs_search tool**

Create `src/tools/web-docs-search.ts`:

```typescript
import { Type } from "typebox";
import type { Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { DocsProvider, DocsSearchResult } from "../providers/types.ts";
import type { GuidanceOverride } from "../config.ts";

const MAX_SEARCH_RESULTS = 10;
const MAX_DESCRIPTION_CHARS = 120;
const MAX_VERSION_COUNT = 5;

const WebDocsSearchParams = Type.Object({
  libraryName: Type.String({
    description:
      "Library name to search for (e.g. 'react', 'next.js', 'express')",
  }),
  query: Type.String({
    description: "What you are trying to do — used for relevance ranking",
  }),
});

interface WebDocsSearchDetails {
  provider: string;
  resultCount: number;
}

function escapeMd(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function truncateCell(text: string, maxChars: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, maxChars - 1).trimEnd()}…`;
}

function formatVersions(versions?: string[]): string {
  if (!versions?.length) return "";
  const visible = versions.slice(0, MAX_VERSION_COUNT);
  const hidden = versions.length - visible.length;
  return `${visible.join(", ")}${hidden > 0 ? `, +${hidden}` : ""}`;
}

function formatResultsTable(
  libraryName: string,
  results: DocsSearchResult[],
): string {
  if (results.length === 0) {
    return `No libraries found for "${libraryName}". Try a different search term.`;
  }

  const visible = results.slice(0, MAX_SEARCH_RESULTS);
  const hidden = results.length - visible.length;
  const noun = results.length === 1 ? "library" : "libraries";

  const headerLine =
    `Found ${results.length} Context7 ${noun} for "${libraryName}"` +
    (hidden > 0 ? `; showing top ${visible.length}` : "") +
    ":";

  const header = "| ID | Name | Trust | Bench | Snippets | Versions | Description |";
  const separator = "|---|---|---|---|---|---|---|";
  const rows = visible.map((r) => {
    const cells = [
      `\`${escapeMd(r.id)}\``,
      escapeMd(r.name),
      String(r.trustScore ?? ""),
      String(r.benchmarkScore ?? ""),
      String(r.totalSnippets ?? ""),
      escapeMd(formatVersions(r.versions)),
      escapeMd(truncateCell(r.description ?? "", MAX_DESCRIPTION_CHARS)),
    ];
    return `| ${cells.join(" | ")} |`;
  });

  const hiddenNote =
    hidden > 0
      ? [`_${hidden} more omitted; refine \`libraryName\` or \`query\` if needed._`, ""]
      : [];

  return [
    headerLine,
    "",
    header,
    separator,
    ...rows,
    "",
    ...hiddenNote,
    "> Use `web_docs_fetch` with the chosen ID.",
  ].join("\n");
}

export function createWebDocsSearchTool(
  resolveProvider: () => DocsProvider | undefined,
  guidance?: GuidanceOverride,
): ToolDefinition<typeof WebDocsSearchParams, WebDocsSearchDetails> {
  return {
    name: "web_docs_search",
    label: "Docs Search",
    description:
      "Search for library documentation. Returns matching libraries you can query with web_docs_fetch.",
    promptSnippet:
      guidance?.promptSnippet ??
      "Search for library documentation by name. Use the returned library ID with web_docs_fetch.",
    promptGuidelines: guidance?.promptGuidelines ?? [
      "Use web_docs_search to find library IDs before calling web_docs_fetch.",
      "Prefer web_docs_search + web_docs_fetch over web_search for library/framework documentation.",
    ],
    parameters: WebDocsSearchParams,
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const provider = resolveProvider();
      if (!provider) {
        return {
          content: [
            {
              type: "text" as const,
              text: "web_docs_search requires a Context7 API key. Set the CONTEXT7_API_KEY environment variable or configure it in ~/.pi/agent/extensions/tools.json under providers.context7.apiKey.",
            },
          ],
          details: { provider: "none", resultCount: 0 },
        };
      }

      const results = await provider.searchLibrary(
        params.libraryName,
        params.query,
        signal ?? undefined,
      );
      const text = formatResultsTable(params.libraryName, results);

      return {
        content: [{ type: "text" as const, text }],
        details: { provider: provider.name, resultCount: results.length },
      };
    },
    renderCall(args, theme: Theme, context) {
      const text =
        context.lastComponent instanceof Text
          ? context.lastComponent
          : new Text("", 0, 0);
      if (!context.argsComplete) {
        text.setText(theme.fg("warning", "Searching docs..."));
        return text;
      }
      const lib =
        args.libraryName.length > 40
          ? `${args.libraryName.slice(0, 37)}...`
          : args.libraryName;
      text.setText(
        `${theme.fg("toolTitle", theme.bold("web_docs_search"))} ${theme.fg("accent", `"${lib}"`)}`,
      );
      return text;
    },
    renderResult(result, options, theme: Theme, context) {
      const text =
        context.lastComponent instanceof Text
          ? context.lastComponent
          : new Text("", 0, 0);
      if (context.isPartial) {
        text.setText(theme.fg("warning", "Searching docs..."));
        return text;
      }
      const count = result.details?.resultCount ?? 0;
      if (options.expanded) {
        const raw =
          result.content[0] && "text" in result.content[0]
            ? result.content[0].text
            : "";
        const lines = raw.split("\n").slice(0, 12);
        text.setText(lines.map((l) => theme.fg("toolOutput", l)).join("\n"));
      } else {
        text.setText(
          theme.fg(
            "toolOutput",
            `${count} ${count === 1 ? "library" : "libraries"} found`,
          ),
        );
      }
      return text;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/tools/web-docs-search.test.ts`
Expected: PASS (all 5 tests green)

- [ ] **Step 5: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/tools/web-docs-search.ts tests/tools/web-docs-search.test.ts
git commit -m "feat(tools): add web_docs_search tool"
```

---

### Task 3.2: Wire web_docs_search registration in index.ts

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 1: Add import and registration**

In `src/index.ts`, add the import at the top (after the existing `createCodeSearchTool` import on line 11):

```typescript
import { createWebDocsSearchTool } from "./tools/web-docs-search.ts";
```

After the existing `pi.registerTool(createCodeSearchTool(...))` block (around line 105), add:

```typescript
// Register docs tools when Context7 provider is available
const docsProvider = registry.selectDocs();
if (docsProvider) {
  pi.registerTool(
    createWebDocsSearchTool(
      () => docsProvider,
      config.guidance?.web_docs_search,
    ),
  );
}
```

- [ ] **Step 2: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(index): wire web_docs_search tool registration"
```
