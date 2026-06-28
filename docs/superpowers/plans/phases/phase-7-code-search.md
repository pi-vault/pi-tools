# Phase 7: code_search Tool

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `code_search` tool using Exa's code context endpoint. After this phase, all four tools from the spec are functional.

**Spec:** `docs/superpowers/specs/2026-06-27-pi-tools-design.md`

**Depends on:** Phase 5 (registry with selectCodeSearch), Phase 6 (Exa provider with codeSearch)

**Produces:** `src/tools/code-search.ts`, updated `src/index.ts`

---

## Task 7.1: code_search Tool Definition

**Files:**
- Create: `src/tools/code-search.ts`
- Test: `tests/tools/code-search.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/tools/code-search.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCodeSearchTool } from "../../src/tools/code-search.ts";
import { stubFetch } from "../helpers.ts";
import { makeCtx } from "../helpers.ts";
import type { CodeSearchProvider } from "../../src/providers/types.ts";

function mockCodeSearch(): CodeSearchProvider {
  return {
    name: "exa",
    codeSearch: vi.fn().mockResolvedValue([
      { title: "React useState", url: "https://github.com/facebook/react", snippet: "const [state, setState] = useState(0);", language: "typescript" },
      { title: "Express Router", url: "https://github.com/expressjs/express", snippet: "const router = express.Router();", language: "javascript" },
    ]),
  };
}

describe("code_search tool", () => {
  it("has correct tool metadata", () => {
    const tool = createCodeSearchTool(() => mockCodeSearch());
    expect(tool.name).toBe("code_search");
    expect(tool.label).toBe("Code Search");
  });

  it("returns formatted code results", async () => {
    const tool = createCodeSearchTool(() => mockCodeSearch());
    const ctx = makeCtx();
    const result = await tool.execute("call-1", { query: "react hooks" }, undefined, undefined, ctx);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("React useState");
    expect(text).toContain("typescript");
  });

  it("returns error when no code search provider available", async () => {
    const tool = createCodeSearchTool(() => undefined);
    const ctx = makeCtx();
    const result = await tool.execute("call-2", { query: "test" }, undefined, undefined, ctx);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Exa");
    expect(text.toLowerCase()).toContain("api key");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- tests/tools/code-search.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement code_search tool**

```typescript
// src/tools/code-search.ts
import { Type, type Static } from "typebox";
import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { CodeSearchProvider, CodeSearchResult } from "../providers/types.ts";
import { sanitizeError } from "../utils/errors.ts";

const CodeSearchParams = Type.Object({
  query: Type.String({ description: "Code or technical documentation search query" }),
  numResults: Type.Optional(
    Type.Number({ minimum: 1, maximum: 10, default: 5, description: "Number of results (1-10, default 5)" }),
  ),
});

type CodeSearchInput = Static<typeof CodeSearchParams>;

interface CodeSearchDetails {
  provider: string;
  resultCount: number;
}

function formatCodeResults(results: CodeSearchResult[]): string {
  if (results.length === 0) return "No code results found.";
  return results
    .map(
      (r, i) =>
        `${i + 1}. [${r.title}](${r.url})${r.language ? ` (${r.language})` : ""}\n   ${r.snippet}`,
    )
    .join("\n\n");
}

export function createCodeSearchTool(
  resolveProvider: () => CodeSearchProvider | undefined,
): ToolDefinition<typeof CodeSearchParams, CodeSearchDetails> {
  return {
    name: "code_search",
    label: "Code Search",
    description:
      "Search code, library APIs, and technical documentation across the web.",
    promptSnippet:
      "Search code, library APIs, and technical documentation across the web.",
    promptGuidelines: [
      "Use code_search for finding code examples, library documentation, and API references.",
      "Prefer code_search over web_search for programming-related queries.",
    ],
    parameters: CodeSearchParams,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const provider = resolveProvider();
      if (!provider) {
        return {
          content: [
            {
              type: "text" as const,
              text: "code_search requires an Exa API key. Set the EXA_API_KEY environment variable or configure it in ~/.pi/agent/extensions/pi-tools.json.",
            },
          ],
          details: { provider: "none", resultCount: 0 },
        };
      }

      try {
        const maxResults = params.numResults ?? 5;
        const results = await provider.codeSearch(params.query, maxResults, signal ?? undefined);
        const text = formatCodeResults(results);

        return {
          content: [{ type: "text" as const, text }],
          details: { provider: provider.name, resultCount: results.length },
        };
      } catch (error) {
        const msg = sanitizeError(error);
        return {
          content: [{ type: "text" as const, text: `Code search error: ${msg}` }],
          details: { provider: provider.name, resultCount: 0 },
        };
      }
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test -- tests/tools/code-search.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Wire into index.ts**

Add after the existing tool registrations in `src/index.ts`:

```typescript
import { createCodeSearchTool } from "./tools/code-search.ts";
```

And in the `createExtension` function body, after the existing `registerTool` calls:

```typescript
  pi.registerTool(
    createCodeSearchTool(() => registry.selectCodeSearch()),
  );
```

- [ ] **Step 6: Update index test**

Add to `tests/index.test.ts`:

```typescript
  it("registers code_search tool", () => {
    const pi = createMockPi();
    createExtension(pi as any);
    expect(pi.tools.some((t) => t.name === "code_search")).toBe(true);
  });
```

- [ ] **Step 7: Run all tests**

Run: `pnpm check`
Expected: All pass.

- [ ] **Step 8: Commit**

```bash
git add src/tools/code-search.ts src/index.ts tests/tools/code-search.test.ts tests/index.test.ts
git commit -m "feat: add code_search tool using Exa code context"
```

## Phase 7 Checkpoint

All four tools are now registered and functional: `web_search`, `web_fetch`, `web_read`, `code_search`.
