# Phase 9: TUI Rendering

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add custom `renderCall` and `renderResult` for all tools. After this phase, tool output is polished in the terminal with status indicators, previews, and streaming states.

**Spec:** `docs/superpowers/specs/2026-06-27-pi-tools-design.md`

**Depends on:** All previous phases (all 4 tools must exist)

**Produces:** Updated tool files with render methods, `src/tools/render-helpers.ts`

---

## Task 9.1: TUI Renderers for All Tools

**Files:**
- Modify: `src/tools/web-search.ts`
- Modify: `src/tools/web-fetch.ts`
- Modify: `src/tools/code-search.ts`
- Modify: `src/tools/web-read.ts`
- Create: `src/tools/render-helpers.ts`
- Test: `tests/tools/rendering.test.ts`

- [ ] **Step 1: Write tests for rendering**

```typescript
// tests/tools/rendering.test.ts
import { describe, expect, it, vi } from "vitest";
import { createWebSearchTool } from "../../src/tools/web-search.ts";
import { createWebFetchTool } from "../../src/tools/web-fetch.ts";
import { createCodeSearchTool } from "../../src/tools/code-search.ts";
import { createWebReadTool } from "../../src/tools/web-read.ts";
import { ContentStore } from "../../src/storage.ts";
import { DuckDuckGoProvider } from "../../src/providers/duckduckgo.ts";

describe("tool rendering", () => {
  it("web_search tool has renderCall and renderResult", () => {
    const tool = createWebSearchTool(() => new DuckDuckGoProvider());
    expect(tool.renderCall).toBeDefined();
    expect(tool.renderResult).toBeDefined();
  });

  it("web_fetch tool has renderCall and renderResult", () => {
    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);
    expect(tool.renderCall).toBeDefined();
    expect(tool.renderResult).toBeDefined();
  });

  it("code_search tool has renderCall and renderResult", () => {
    const tool = createCodeSearchTool(() => undefined);
    expect(tool.renderCall).toBeDefined();
    expect(tool.renderResult).toBeDefined();
  });

  it("web_read tool has renderCall and renderResult", () => {
    const store = new ContentStore(() => {});
    const tool = createWebReadTool(store);
    expect(tool.renderCall).toBeDefined();
    expect(tool.renderResult).toBeDefined();
  });
});
```

- [ ] **Step 2: Create shared render helpers**

```typescript
// src/tools/render-helpers.ts
import { Text, type Component } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

export function renderToolCall(
  toolLabel: string,
  argSummary: string,
  theme: Theme,
): Component {
  const truncated = argSummary.length > 70 ? argSummary.slice(0, 67) + "..." : argSummary;
  return Text(`${toolLabel} ${truncated}`);
}

export function renderStatusLine(
  text: string,
  isPartial: boolean,
  theme: Theme,
): Component {
  if (isPartial) {
    return Text(text);
  }
  return Text(text);
}
```

Note: The exact TUI rendering depends on the `@earendil-works/pi-tui` API. Check the `Text` and `Component` exports before implementing. If `Text` is not the right constructor, use whatever the existing tools in the Pi codebase use. The pattern here is minimal -- just return a `Text` component with the formatted string.

- [ ] **Step 3: Add renderCall and renderResult to each tool**

Add to `src/tools/web-search.ts` in the returned tool object:

```typescript
    renderCall(args, theme, context) {
      const q = args.query.length > 70 ? args.query.slice(0, 67) + "..." : args.query;
      return Text(context.isPartial ? `Searching...` : `web_search "${q}"`);
    },
    renderResult(result, options, theme, context) {
      if (context.isPartial) return Text("Searching...");
      const count = result.details?.resultCount ?? 0;
      if (options.expanded) {
        const text = result.content[0] && "text" in result.content[0] ? result.content[0].text : "";
        return Text(text.slice(0, 500));
      }
      return Text(`${count} results via ${result.details?.provider ?? "unknown"}`);
    },
```

Add to `src/tools/web-fetch.ts`:

```typescript
    renderCall(args, theme, context) {
      const u = args.url.length > 70 ? args.url.slice(0, 67) + "..." : args.url;
      return Text(context.isPartial ? "Fetching..." : `web_fetch "${u}"`);
    },
    renderResult(result, options, theme, context) {
      if (context.isPartial) return Text("Fetching...");
      const details = result.details;
      const info = details ? `${details.chars} chars${details.truncated ? " (truncated)" : ""}` : "error";
      return Text(info);
    },
```

Add to `src/tools/code-search.ts`:

```typescript
    renderCall(args, theme, context) {
      const q = args.query.length > 70 ? args.query.slice(0, 67) + "..." : args.query;
      return Text(context.isPartial ? "Searching code..." : `code_search "${q}"`);
    },
    renderResult(result, options, theme, context) {
      if (context.isPartial) return Text("Searching code...");
      const count = result.details?.resultCount ?? 0;
      return Text(`${count} code results`);
    },
```

Add to `src/tools/web-read.ts`:

```typescript
    renderCall(args, theme, context) {
      return Text(`web_read "${args.contentId}"`);
    },
    renderResult(result, options, theme, context) {
      const text = result.content[0] && "text" in result.content[0] ? result.content[0].text : "";
      return Text(`${text.length} chars`);
    },
```

Each tool file will need this import at the top:

```typescript
import { Text } from "@earendil-works/pi-tui";
```

- [ ] **Step 4: Run tests**

Run: `pnpm check`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/tools/web-search.ts src/tools/web-fetch.ts src/tools/code-search.ts src/tools/web-read.ts src/tools/render-helpers.ts tests/tools/rendering.test.ts
git commit -m "feat: add TUI renderers for all tools"
```

## Phase 9 Checkpoint

All tools now have custom TUI rendering. The extension is feature-complete per the design spec.

Run final check: `pnpm check`
Expected: All lint, typecheck, and tests pass.

---

## Summary

| Phase | Deliverable | Tools Working After |
|-------|------------|-------------------|
| 1 | Types, config, errors, SSRF, storage, truncation, test helpers, deps | - |
| 2 | DuckDuckGo provider + web_search tool | `web_search` |
| 3 | Content storage + web_read tool | `web_search`, `web_read` |
| 4 | HTML extraction + web_fetch tool | `web_search`, `web_fetch`, `web_read` |
| 5 | Provider registry + quota-aware selection | `web_search` (multi-provider), `web_fetch`, `web_read` |
| 6 | All 8 search providers | `web_search` (all providers), `web_fetch`, `web_read` |
| 7 | code_search tool | All 4 tools |
| 8 | PDF, RSC, Jina Reader, provider extraction fallbacks | All 4 tools (enhanced) |
| 9 | TUI rendering for all tools | All 4 tools (polished) |
