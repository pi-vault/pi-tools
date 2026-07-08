# Context7 Docs Lookup — Phase 4: web_docs_fetch Tool

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `web_docs_fetch` tool that retrieves focused library documentation via Context7, with truncation and content storage for large responses. Wire it into registration. This completes the feature.

**Architecture:** A `createWebDocsFetchTool` factory function takes `resolveProvider` and `store` (ContentStore) closures. When Context7 returns more than 15,000 chars, the full response is stored via ContentStore (retrievable with `web_read`) and the inline output is truncated. The tool is registered alongside `web_docs_search` in the conditional block.

**Tech Stack:** TypeScript, typebox, @earendil-works/pi-coding-agent, @earendil-works/pi-tui, ContentStore, truncateContent utility, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-07-context7-docs-lookup-design.md`
**Main plan:** `docs/superpowers/plans/2026-07-07-context7-docs-lookup.md`
**Reference:** `@mrclrchtr/supi-web` (`packages/supi-web/src/docs.ts`) — same Context7 tools, different codebase conventions

**Depends on:** Phase 3 (web_docs_search registered, docs provider wired)
**Produces:** Complete Context7 docs lookup feature — both tools registered and working.

---

## Context for the Engineer

After Phase 3:

- `web_docs_search` is registered and working
- `registry.selectDocs()` returns the Context7 provider when API key is present
- `src/index.ts` has a `docsProvider` block that registers `web_docs_search`

The `ContentStore` (`src/storage.ts`) is already used by `web_fetch` for storing large content:

- `store.store({ url, title, text, source })` returns a `contentId` string
- `store.get(id)` retrieves stored content
- The `source` field is currently typed as `"web_fetch" | "web_search"` — we need to add `"web_docs_fetch"`

The `truncateContent` utility (`src/utils/truncate.ts`):

```typescript
export function truncateContent(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const notice = `\n\n[truncated] showing ${limit} of ${text.length} chars`;
  return text.slice(0, limit - notice.length) + notice;
}
```

The `web_fetch` tool uses `INLINE_LIMIT = 15_000` — we match this for consistency.

The `isStoredContent` type guard in `src/index.ts` validates the `source` field on session restore.

Parameter naming uses camelCase (`libraryId`, `query`) to match pi-tools conventions and the Context7 API.

---

### Task 4.1: Extend StoredContent source union

**Files:**

- Modify: `src/storage.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Add "web_docs_fetch" to StoredContent.source**

In `src/storage.ts`, find the `StoredContent` interface (line 1-9). Change the `source` field on line 8:

From:

```typescript
source: "web_fetch" | "web_search";
```

To:

```typescript
source: "web_fetch" | "web_search" | "web_docs_fetch";
```

Also update the `store` method's input parameter type (around line 25, inside the `store()` method signature):

From:

```typescript
source: "web_fetch" | "web_search";
```

To:

```typescript
source: "web_fetch" | "web_search" | "web_docs_fetch";
```

- [ ] **Step 2: Update the type guard in index.ts**

In `src/index.ts`, find the `isStoredContent` function (around line 15-26). Update the source check:

From:

```typescript
d.source === "web_fetch" || d.source === "web_search"
```

To:

```typescript
d.source === "web_fetch" ||
  d.source === "web_search" ||
  d.source === "web_docs_fetch"
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/storage.ts src/index.ts
git commit -m "feat(storage): extend StoredContent source to include web_docs_fetch"
```

---

### Task 4.2: Implement web_docs_fetch tool

**Files:**

- Create: `src/tools/web-docs-fetch.ts`
- Create: `tests/tools/web-docs-fetch.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/tools/web-docs-fetch.test.ts`:

````typescript
import { describe, expect, it, vi } from "vitest";
import { createWebDocsFetchTool } from "../../src/tools/web-docs-fetch.ts";
import { makeCtx } from "../helpers.ts";
import { ContentStore } from "../../src/storage.ts";
import type { DocsProvider } from "../../src/providers/types.ts";
import { Context7Error } from "../../src/providers/context7.ts";

function mockDocsProvider(
  contextResponse: string = "# Docs\n\nSample documentation",
): DocsProvider {
  return {
    name: "context7",
    label: "Context7",
    searchLibrary: vi.fn().mockResolvedValue([]),
    getContext: vi.fn().mockResolvedValue(contextResponse),
  };
}

function createStore(): ContentStore {
  return new ContentStore(vi.fn());
}

describe("web_docs_fetch tool", () => {
  it("has correct tool metadata", () => {
    const tool = createWebDocsFetchTool(
      () => mockDocsProvider(),
      createStore(),
    );
    expect(tool.name).toBe("web_docs_fetch");
    expect(tool.label).toBe("Docs Fetch");
  });

  it("rejects empty libraryId", async () => {
    const tool = createWebDocsFetchTool(() => mockDocsProvider(), createStore());
    const ctx = makeCtx();
    await expect(
      tool.execute("call-1", { libraryId: "  ", query: "hooks" }, undefined, undefined, ctx),
    ).rejects.toThrow("libraryId");
  });

  it("rejects empty query", async () => {
    const tool = createWebDocsFetchTool(() => mockDocsProvider(), createStore());
    const ctx = makeCtx();
    await expect(
      tool.execute("call-1", { libraryId: "/facebook/react", query: "" }, undefined, undefined, ctx),
    ).rejects.toThrow("query");
  });

  it("returns documentation content on success", async () => {
    const content =
      "### useState\n\n```typescript\nconst [s, setS] = useState(0);\n```";
    const onUpdate = vi.fn();
    const tool = createWebDocsFetchTool(
      () => mockDocsProvider(content),
      createStore(),
    );
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-1",
      { libraryId: "/facebook/react", query: "How to use useState" },
      undefined,
      onUpdate,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;

    expect(text).toContain("useState");
    expect(text).toContain("```typescript");

    // Verify onUpdate was called for progress
    expect(onUpdate).toHaveBeenCalled();
  });

  it("trims libraryId before calling provider", async () => {
    const provider = mockDocsProvider("docs");
    const tool = createWebDocsFetchTool(() => provider, createStore());
    const ctx = makeCtx();
    await tool.execute(
      "call-1",
      { libraryId: "  /facebook/react  ", query: "hooks" },
      undefined,
      undefined,
      ctx,
    );
    expect(provider.getContext).toHaveBeenCalledWith("/facebook/react", "hooks", undefined);
  });

  it("truncates and stores large content", async () => {
    const largeContent = "x".repeat(20_000);
    const store = createStore();
    const tool = createWebDocsFetchTool(
      () => mockDocsProvider(largeContent),
      store,
    );
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-2",
      { libraryId: "/facebook/react", query: "everything" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;

    // Should be truncated
    expect(text.length).toBeLessThan(20_000);
    expect(text).toContain("[truncated]");

    // Should have a contentId in details
    expect(result.details?.contentId).toBeDefined();

    // Store should have the full content
    const stored = store.get(result.details!.contentId!);
    expect(stored).toBeDefined();
    expect(stored!.text).toBe(largeContent);
    expect(stored!.source).toBe("web_docs_fetch");
  });

  it("does not store small content", async () => {
    const smallContent = "Short docs";
    const store = createStore();
    const tool = createWebDocsFetchTool(
      () => mockDocsProvider(smallContent),
      store,
    );
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-2b",
      { libraryId: "/facebook/react", query: "hooks" },
      undefined,
      undefined,
      ctx,
    );

    expect(result.details?.contentId).toBeUndefined();
    expect(result.details?.truncated).toBe(false);
  });

  it("returns setup message when provider unavailable", async () => {
    const tool = createWebDocsFetchTool(() => undefined, createStore());
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-3",
      { libraryId: "/facebook/react", query: "hooks" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;

    expect(text).toContain("CONTEXT7_API_KEY");
  });

  it("returns friendly message for 202 (processing)", async () => {
    const provider: DocsProvider = {
      name: "context7",
      label: "Context7",
      searchLibrary: vi.fn(),
      getContext: vi
        .fn()
        .mockResolvedValue(
          "Library is being processed. Try again in a few minutes.",
        ),
    };
    const tool = createWebDocsFetchTool(() => provider, createStore());
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-4",
      { libraryId: "/new/lib", query: "anything" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;

    expect(text).toContain("being processed");
  });

  it("throws on API errors", async () => {
    const failing: DocsProvider = {
      name: "context7",
      label: "Context7",
      searchLibrary: vi.fn(),
      getContext: vi
        .fn()
        .mockRejectedValue(new Context7Error("Library not found.")),
    };
    const tool = createWebDocsFetchTool(() => failing, createStore());
    const ctx = makeCtx();

    await expect(
      tool.execute(
        "call-5",
        { libraryId: "/nonexistent/lib", query: "anything" },
        undefined,
        undefined,
        ctx,
      ),
    ).rejects.toThrow(Context7Error);
  });

  it("passes signal to provider", async () => {
    const provider = mockDocsProvider("docs");
    const tool = createWebDocsFetchTool(() => provider, createStore());
    const ctx = makeCtx();
    const controller = new AbortController();

    await tool.execute(
      "call-6",
      { libraryId: "/facebook/react", query: "hooks" },
      controller.signal,
      undefined,
      ctx,
    );

    expect(provider.getContext).toHaveBeenCalledWith(
      "/facebook/react",
      "hooks",
      controller.signal,
    );
  });
});
````

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/tools/web-docs-fetch.test.ts`
Expected: FAIL with "Cannot find module '../../src/tools/web-docs-fetch.ts'"

- [ ] **Step 3: Implement web_docs_fetch tool**

Create `src/tools/web-docs-fetch.ts`:

```typescript
import { Type } from "typebox";
import type { Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { DocsProvider } from "../providers/types.ts";
import type { ContentStore } from "../storage.ts";
import { truncateContent } from "../utils/truncate.ts";
import type { GuidanceOverride } from "../config.ts";

const INLINE_LIMIT = 15_000;

const WebDocsFetchParams = Type.Object({
  libraryId: Type.String({
    description:
      "Context7 library ID (e.g. '/facebook/react', '/vercel/next.js@v15.1.8')",
  }),
  query: Type.String({
    description:
      "Specific question about the library (drives relevance ranking)",
  }),
});

interface WebDocsFetchDetails {
  provider: string;
  libraryId: string;
  chars: number;
  truncated: boolean;
  contentId?: string;
}

export function createWebDocsFetchTool(
  resolveProvider: () => DocsProvider | undefined,
  store: ContentStore,
  guidance?: GuidanceOverride,
): ToolDefinition<typeof WebDocsFetchParams, WebDocsFetchDetails> {
  return {
    name: "web_docs_fetch",
    label: "Docs Fetch",
    description:
      "Retrieve up-to-date documentation for a specific library via Context7.",
    promptSnippet:
      guidance?.promptSnippet ??
      "Retrieve focused documentation for a library. Use web_docs_search first to find the library ID.",
    promptGuidelines: guidance?.promptGuidelines ?? [
      "Use web_docs_fetch after web_docs_search to get documentation for a specific library.",
      "Always provide a specific question in the query parameter for best results.",
      "Pin a version with /owner/repo@version for consistent results.",
    ],
    parameters: WebDocsFetchParams,
    async execute(_toolCallId, params, signal, onUpdate, _ctx) {
      const libraryId = params.libraryId?.trim();
      const query = params.query?.trim();

      if (!libraryId) throw new Error("'libraryId' parameter is required");
      if (!query) throw new Error("'query' parameter is required");

      const provider = resolveProvider();
      if (!provider) {
        return {
          content: [
            {
              type: "text" as const,
              text: "web_docs_fetch requires a Context7 API key. Set the CONTEXT7_API_KEY environment variable or configure it in ~/.pi/agent/extensions/tools.json under providers.context7.apiKey.",
            },
          ],
          details: {
            provider: "none",
            libraryId,
            chars: 0,
            truncated: false,
          },
        };
      }

      onUpdate?.({
        content: [{ type: "text" as const, text: `Fetching Context7 docs for ${libraryId}...` }],
        details: { provider: provider.name, libraryId, chars: 0, truncated: false },
      });

      const text = await provider.getContext(
        libraryId,
        query,
        signal ?? undefined,
      );
      const chars = text.length;
      let outputText: string;
      let contentId: string | undefined;
      let truncated = false;

      if (chars > INLINE_LIMIT) {
        contentId = store.store({
          url: `context7://${libraryId}`,
          title: `Docs: ${libraryId}`,
          text,
          source: "web_docs_fetch",
        });
        outputText = truncateContent(text, INLINE_LIMIT);
        truncated = true;
      } else {
        outputText = text;
      }

      const header = truncated
        ? `Docs: ${libraryId} (${chars} chars, truncated — use web_read with contentId "${contentId}" for full text)\n\n`
        : "";

      return {
        content: [{ type: "text" as const, text: header + outputText }],
        details: {
          provider: provider.name,
          libraryId,
          chars,
          truncated,
          contentId,
        },
      };
    },
    renderCall(args, theme: Theme, context) {
      const text =
        context.lastComponent instanceof Text
          ? context.lastComponent
          : new Text("", 0, 0);
      if (!context.argsComplete) {
        text.setText(theme.fg("warning", "Fetching docs..."));
        return text;
      }
      const lib =
        args.libraryId.length > 30
          ? `${args.libraryId.slice(0, 27)}...`
          : args.libraryId;
      const q =
        args.query.length > 40 ? `${args.query.slice(0, 37)}...` : args.query;
      text.setText(
        `${theme.fg("toolTitle", theme.bold("web_docs_fetch"))} ${theme.fg("accent", lib)} ${theme.fg("dim", `"${q}"`)}`,
      );
      return text;
    },
    renderResult(result, options, theme: Theme, context) {
      const text =
        context.lastComponent instanceof Text
          ? context.lastComponent
          : new Text("", 0, 0);
      if (context.isPartial) {
        text.setText(theme.fg("warning", "Fetching docs..."));
        return text;
      }
      const chars = result.details?.chars ?? 0;
      if (options.expanded) {
        const raw =
          result.content[0] && "text" in result.content[0]
            ? result.content[0].text
            : "";
        const lines = raw.split("\n").slice(0, 15);
        text.setText(lines.map((l) => theme.fg("toolOutput", l)).join("\n"));
      } else {
        const suffix = result.details?.truncated ? " (truncated)" : "";
        text.setText(theme.fg("toolOutput", `${chars} chars of docs${suffix}`));
      }
      return text;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/tools/web-docs-fetch.test.ts`
Expected: PASS (all 10 tests green)

- [ ] **Step 5: Commit**

```bash
git add src/tools/web-docs-fetch.ts tests/tools/web-docs-fetch.test.ts
git commit -m "feat(tools): add web_docs_fetch tool with content storage"
```

---

### Task 4.3: Wire web_docs_fetch registration in index.ts

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 1: Add import and registration**

In `src/index.ts`, add the import (after the `createWebDocsSearchTool` import added in Phase 3):

```typescript
import { createWebDocsFetchTool } from "./tools/web-docs-fetch.ts";
```

Update the docs registration block (added in Phase 3, Task 3.2) to also register web_docs_fetch. Change it from:

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

To:

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
  pi.registerTool(
    createWebDocsFetchTool(
      () => docsProvider,
      store,
      config.guidance?.web_docs_fetch,
    ),
  );
}
```

- [ ] **Step 2: Run full check**

Run: `pnpm check`
Expected: PASS (all lint + typecheck + tests green)

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(index): wire web_docs_fetch tool registration"
```

---

### Task 4.4: Final integration verification

- [ ] **Step 1: Run the full test suite**

Run: `pnpm check`
Expected: All tests pass, no lint errors, no type errors.

- [ ] **Step 2: Verify conditional registration in existing index test**

Run: `pnpm test -- tests/index.test.ts`
Expected: PASS (existing tests still pass — context7 won't be registered without a resolved API key in the test environment, so no new tools appear in the mock)

- [ ] **Step 3: Final commit (if any stray changes)**

```bash
git status
# If clean, nothing to commit. If any formatting changes from biome:
git add -A
git commit -m "chore: formatting"
```

---

## Done

At this point the full Context7 docs lookup feature is complete:

- `web_docs_search` finds libraries by name
- `web_docs_fetch` retrieves documentation for a specific library
- Both tools are conditionally registered when `CONTEXT7_API_KEY` is configured
- Large responses are truncated with `contentId` for retrieval via `web_read`
- Input validation: empty/whitespace params throw clear errors
- Streaming progress: `onUpdate` is called before network requests
- All new code has test coverage
