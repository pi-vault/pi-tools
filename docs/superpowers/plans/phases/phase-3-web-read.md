# Phase 3: Content Storage Integration + web_read Tool

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the content store to the extension lifecycle and add the `web_read` tool. After this phase, large content can be stored and retrieved by content ID.

**Spec:** `docs/superpowers/specs/2026-06-27-pi-tools-design.md`

**Depends on:** Phase 1 (storage), Phase 2 (index.ts with web_search)

**Produces:** `src/tools/web-read.ts`, updated `src/index.ts` with session restoration

---

## Task 3.1: web_read Tool

**Files:**
- Create: `src/tools/web-read.ts`
- Test: `tests/tools/web-read.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/tools/web-read.test.ts
import { describe, expect, it } from "vitest";
import { createWebReadTool } from "../../src/tools/web-read.ts";
import { ContentStore } from "../../src/storage.ts";
import { makeCtx } from "../helpers.ts";

describe("web_read tool", () => {
  it("has correct tool metadata", () => {
    const store = new ContentStore(() => {});
    const tool = createWebReadTool(store);
    expect(tool.name).toBe("web_read");
    expect(tool.label).toBe("Web Read");
  });

  it("retrieves stored content by ID", async () => {
    const store = new ContentStore(() => {});
    const id = store.store({
      url: "https://example.com",
      title: "Example",
      text: "Full content here",
      source: "web_fetch",
    });

    const tool = createWebReadTool(store);
    const ctx = makeCtx();
    const result = await tool.execute("call-1", { contentId: id }, undefined, undefined, ctx);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Full content here");
  });

  it("returns error for unknown content ID", async () => {
    const store = new ContentStore(() => {});
    const tool = createWebReadTool(store);
    const ctx = makeCtx();
    const result = await tool.execute(
      "call-2",
      { contentId: "wc-nonexistent" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text.toLowerCase()).toContain("not found");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- tests/tools/web-read.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement web_read tool**

```typescript
// src/tools/web-read.ts
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ContentStore } from "../storage.ts";

const WebReadParams = Type.Object({
  contentId: Type.String({ description: "Content ID from a previous web_fetch or web_search result" }),
});

export function createWebReadTool(
  store: ContentStore,
): ToolDefinition<typeof WebReadParams> {
  return {
    name: "web_read",
    label: "Web Read",
    description:
      "Retrieve previously fetched web content by its content ID without re-fetching.",
    promptSnippet:
      "Retrieve previously fetched web content by its content ID without re-fetching.",
    parameters: WebReadParams,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const content = store.get(params.contentId);
      if (!content) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Content not found: ${params.contentId}. The content ID may have expired or is from a different session.`,
            },
          ],
          details: undefined,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `# ${content.title ?? content.url}\n\nSource: ${content.url}\nChars: ${content.chars}\n\n${content.text}`,
          },
        ],
        details: undefined,
      };
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test -- tests/tools/web-read.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Wire into index.ts**

```typescript
// src/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.ts";
import { ContentStore, type StoredContent } from "./storage.ts";
import { DuckDuckGoProvider } from "./providers/duckduckgo.ts";
import type { SearchProvider } from "./providers/types.ts";
import { createWebSearchTool } from "./tools/web-search.ts";
import { createWebReadTool } from "./tools/web-read.ts";

export default function createExtension(pi: ExtensionAPI): void {
  const _config = loadConfig();
  const store = new ContentStore((customType, data) =>
    pi.appendEntry(customType, data),
  );
  const duckduckgo = new DuckDuckGoProvider();

  function resolveSearchProvider(_name?: string): SearchProvider {
    // Phase 2: only DuckDuckGo. Phase 5 adds the full registry.
    return duckduckgo;
  }

  // Restore stored content from previous session
  pi.on("session_start", (_event, ctx) => {
    const entries = ctx.sessionManager.getEntries();
    const restored = entries
      .filter((e) => e.type === "custom" && e.customType === "pi-tools-content" && e.data)
      .map((e) => (e as { data: StoredContent }).data);
    if (restored.length > 0) {
      store.restore(restored);
    }
  });

  pi.registerTool(createWebSearchTool(resolveSearchProvider));
  pi.registerTool(createWebReadTool(store));
}
```

- [ ] **Step 6: Update index test**

Add to `tests/index.test.ts`:

```typescript
  it("registers web_read tool", () => {
    const pi = createMockPi();
    createExtension(pi as any);
    expect(pi.tools.some((t) => t.name === "web_read")).toBe(true);
  });
```

- [ ] **Step 7: Run all tests**

Run: `pnpm check`
Expected: All pass.

- [ ] **Step 8: Commit**

```bash
git add src/tools/web-read.ts src/index.ts tests/tools/web-read.test.ts tests/index.test.ts
git commit -m "feat: add web_read tool with content storage integration"
```

## Phase 3 Checkpoint

The extension now has `web_search` and `web_read`. Content storage is wired up. Large fetched content (added in Phase 4) will be stored and retrievable.
