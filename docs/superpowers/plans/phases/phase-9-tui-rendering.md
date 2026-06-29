# Phase 9: TUI Rendering

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add custom `renderCall` and `renderResult` for all tools. After this phase, tool output is polished in the terminal with status indicators, previews, and streaming states.

**Spec:** `docs/superpowers/specs/2026-06-27-pi-tools-design.md`

**Depends on:** All previous phases (all 4 tools must exist)

**Produces:** Updated tool files with render methods

---

## API Reference (verified against @earendil-works/pi-tui@0.80.2)

- `Text` is a **class**: `new Text(text?: string, paddingX?: number, paddingY?: number)`
- It implements the `Component` interface (`render(width): string[]`, `invalidate()`)
- Idiomatic pattern: reuse `context.lastComponent` to avoid GC churn on re-renders
- Theme styling: `theme.bold(str)`, `theme.fg(color, str)` where color is a `ThemeColor`
- Relevant colors: `"toolTitle"`, `"accent"`, `"toolOutput"`, `"warning"`, `"muted"`

```typescript
// Pattern from built-in tools (grep, read, etc.):
renderCall(args, theme, context) {
  const text = context.lastComponent ?? new Text("", 0, 0);
  text.setText(formatString);
  return text;
},
```

---

## Task 9.1: TUI Renderers for All Tools

**Files:**

- Modify: `src/tools/web-search.ts`
- Modify: `src/tools/web-fetch.ts`
- Modify: `src/tools/code-search.ts`
- Modify: `src/tools/web-read.ts`
- Test: `tests/tools/rendering.test.ts`

- [ ] **Step 1: Write tests for rendering**

Tests verify that renderers exist, return `Component` instances, and produce expected styled output.

```typescript
// tests/tools/rendering.test.ts
import { describe, expect, it } from "vitest";
import { Text } from "@earendil-works/pi-tui";
import { createWebSearchTool } from "../../src/tools/web-search.ts";
import { createWebFetchTool } from "../../src/tools/web-fetch.ts";
import { createCodeSearchTool } from "../../src/tools/code-search.ts";
import { createWebReadTool } from "../../src/tools/web-read.ts";
import { ContentStore } from "../../src/storage.ts";
import { DuckDuckGoProvider } from "../../src/providers/duckduckgo.ts";

// Minimal mock theme that passes through text unstyled (for assertion simplicity)
const mockTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as any;

// Minimal render context factory
function makeContext(
  overrides: Partial<{
    isPartial: boolean;
    expanded: boolean;
    lastComponent: any;
    argsComplete: boolean;
    executionStarted: boolean;
  }> = {},
) {
  return {
    args: {},
    toolCallId: "test-id",
    invalidate: () => {},
    lastComponent: undefined,
    state: undefined,
    cwd: "/tmp",
    executionStarted: true,
    argsComplete: true,
    isPartial: false,
    expanded: false,
    ...overrides,
  } as any;
}

describe("tool rendering", () => {
  describe("web_search", () => {
    const tool = createWebSearchTool(() => new DuckDuckGoProvider());

    it("renderCall returns a Text component with tool name and query", () => {
      const ctx = makeContext({ isPartial: false });
      const component = tool.renderCall!(
        { query: "vitest mocking", numResults: 5 },
        mockTheme,
        ctx,
      );
      expect(component).toBeInstanceOf(Text);
      const lines = component.render(120);
      expect(lines.join("")).toContain("web_search");
      expect(lines.join("")).toContain("vitest mocking");
    });

    it("renderCall shows streaming state when partial", () => {
      const ctx = makeContext({ isPartial: true, argsComplete: false });
      const component = tool.renderCall!({ query: "test" }, mockTheme, ctx);
      const lines = component.render(120);
      expect(lines.join("")).toContain("Searching");
    });

    it("renderResult shows result count when collapsed", () => {
      const result = {
        content: [
          {
            type: "text" as const,
            text: "1. [Result](https://example.com)\n   snippet",
          },
        ],
        details: { provider: "duckduckgo", resultCount: 3 },
      };
      const ctx = makeContext();
      const component = tool.renderResult!(
        result,
        { expanded: false, isPartial: false },
        mockTheme,
        ctx,
      );
      expect(component).toBeInstanceOf(Text);
      const lines = component.render(120);
      expect(lines.join("")).toContain("3");
      expect(lines.join("")).toContain("duckduckgo");
    });

    it("renderResult shows preview when expanded", () => {
      const result = {
        content: [
          {
            type: "text" as const,
            text: "1. [My Title](https://example.com)\n   A long snippet here",
          },
        ],
        details: { provider: "duckduckgo", resultCount: 1 },
      };
      const ctx = makeContext({ expanded: true });
      const component = tool.renderResult!(
        result,
        { expanded: true, isPartial: false },
        mockTheme,
        ctx,
      );
      const lines = component.render(120);
      expect(lines.join("\n")).toContain("My Title");
    });
  });

  describe("web_fetch", () => {
    const store = new ContentStore(() => {});
    const tool = createWebFetchTool(store);

    it("renderCall shows URL", () => {
      const ctx = makeContext();
      const component = tool.renderCall!(
        { url: "https://example.com/page" },
        mockTheme,
        ctx,
      );
      const lines = component.render(120);
      expect(lines.join("")).toContain("web_fetch");
      expect(lines.join("")).toContain("example.com/page");
    });

    it("renderCall shows streaming state when partial", () => {
      const ctx = makeContext({ isPartial: true, argsComplete: false });
      const component = tool.renderCall!(
        { url: "https://example.com" },
        mockTheme,
        ctx,
      );
      const lines = component.render(120);
      expect(lines.join("")).toContain("Fetching");
    });

    it("renderResult shows char count", () => {
      const result = {
        content: [{ type: "text" as const, text: "page content" }],
        details: {
          url: "https://example.com",
          chars: 4200,
          truncated: false,
          extractionChain: ["readability"],
        },
      };
      const ctx = makeContext();
      const component = tool.renderResult!(
        result,
        { expanded: false, isPartial: false },
        mockTheme,
        ctx,
      );
      const lines = component.render(120);
      expect(lines.join("")).toContain("4200");
    });

    it("renderResult notes truncation", () => {
      const result = {
        content: [{ type: "text" as const, text: "..." }],
        details: {
          url: "https://example.com",
          chars: 20000,
          truncated: true,
          extractionChain: ["readability"],
        },
      };
      const ctx = makeContext();
      const component = tool.renderResult!(
        result,
        { expanded: false, isPartial: false },
        mockTheme,
        ctx,
      );
      const lines = component.render(120);
      expect(lines.join("")).toContain("truncated");
    });
  });

  describe("code_search", () => {
    const tool = createCodeSearchTool(() => undefined);

    it("renderCall shows query", () => {
      const ctx = makeContext();
      const component = tool.renderCall!(
        { query: "async iterator pattern" },
        mockTheme,
        ctx,
      );
      const lines = component.render(120);
      expect(lines.join("")).toContain("code_search");
      expect(lines.join("")).toContain("async iterator pattern");
    });

    it("renderResult shows result count", () => {
      const result = {
        content: [{ type: "text" as const, text: "results..." }],
        details: { provider: "exa", resultCount: 5 },
      };
      const ctx = makeContext();
      const component = tool.renderResult!(
        result,
        { expanded: false, isPartial: false },
        mockTheme,
        ctx,
      );
      const lines = component.render(120);
      expect(lines.join("")).toContain("5");
    });
  });

  describe("web_read", () => {
    const store = new ContentStore(() => {});
    const tool = createWebReadTool(store);

    it("renderCall shows content ID", () => {
      const ctx = makeContext();
      const component = tool.renderCall!(
        { contentId: "abc123" },
        mockTheme,
        ctx,
      );
      const lines = component.render(120);
      expect(lines.join("")).toContain("web_read");
      expect(lines.join("")).toContain("abc123");
    });

    it("renderResult shows char count", () => {
      const result = {
        content: [{ type: "text" as const, text: "x".repeat(500) }],
        details: undefined,
      };
      const ctx = makeContext();
      const component = tool.renderResult!(
        result,
        { expanded: false, isPartial: false },
        mockTheme,
        ctx,
      );
      const lines = component.render(120);
      expect(lines.join("")).toContain("500");
    });
  });

  describe("component reuse", () => {
    it("reuses lastComponent when available", () => {
      const tool = createWebSearchTool(() => new DuckDuckGoProvider());
      const existing = new Text("old");
      const ctx = makeContext({ lastComponent: existing });
      const component = tool.renderCall!({ query: "test" }, mockTheme, ctx);
      expect(component).toBe(existing); // same instance reused
    });
  });
});
```

- [ ] **Step 2: Add renderCall and renderResult to web-search.ts**

Add import at top of file:

```typescript
import { Text } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
```

Add to the returned tool object (after `execute`):

```typescript
    renderCall(args, theme, context) {
      const text = context.lastComponent ?? new Text("", 0, 0);
      if (!context.argsComplete) {
        text.setText(theme.fg("warning", "Searching..."));
        return text;
      }
      const q = args.query.length > 70 ? args.query.slice(0, 67) + "..." : args.query;
      text.setText(
        theme.fg("toolTitle", theme.bold("web_search")) + " " + theme.fg("accent", `"${q}"`)
      );
      return text;
    },
    renderResult(result, options, theme, context) {
      const text = context.lastComponent ?? new Text("", 0, 0);
      if (context.isPartial) {
        text.setText(theme.fg("warning", "Searching..."));
        return text;
      }
      const count = result.details?.resultCount ?? 0;
      const provider = result.details?.provider ?? "unknown";
      if (options.expanded) {
        const raw = result.content[0] && "text" in result.content[0] ? result.content[0].text : "";
        const lines = raw.split("\n").slice(0, 15);
        text.setText(lines.map((l) => theme.fg("toolOutput", l)).join("\n"));
      } else {
        text.setText(theme.fg("toolOutput", `${count} results via ${provider}`));
      }
      return text;
    },
```

- [ ] **Step 3: Add renderCall and renderResult to web-fetch.ts**

Add import at top of file:

```typescript
import { Text } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
```

Add to the returned tool object (after `execute`):

```typescript
    renderCall(args, theme, context) {
      const text = context.lastComponent ?? new Text("", 0, 0);
      if (!context.argsComplete) {
        text.setText(theme.fg("warning", "Fetching..."));
        return text;
      }
      const u = args.url.length > 70 ? args.url.slice(0, 67) + "..." : args.url;
      text.setText(
        theme.fg("toolTitle", theme.bold("web_fetch")) + " " + theme.fg("accent", `"${u}"`)
      );
      return text;
    },
    renderResult(result, options, theme, context) {
      const text = context.lastComponent ?? new Text("", 0, 0);
      if (context.isPartial) {
        text.setText(theme.fg("warning", "Fetching..."));
        return text;
      }
      const details = result.details;
      if (!details || details.chars === 0) {
        text.setText(theme.fg("error", "fetch error"));
        return text;
      }
      if (options.expanded) {
        const raw = result.content[0] && "text" in result.content[0] ? result.content[0].text : "";
        const lines = raw.split("\n").slice(0, 20);
        text.setText(lines.map((l) => theme.fg("toolOutput", l)).join("\n"));
      } else {
        const info = `${details.chars} chars` + (details.truncated ? theme.fg("warning", " (truncated)") : "");
        text.setText(theme.fg("toolOutput", info));
      }
      return text;
    },
```

- [ ] **Step 4: Add renderCall and renderResult to code-search.ts**

Add import at top of file:

```typescript
import { Text } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
```

Add to the returned tool object (after `execute`):

```typescript
    renderCall(args, theme, context) {
      const text = context.lastComponent ?? new Text("", 0, 0);
      if (!context.argsComplete) {
        text.setText(theme.fg("warning", "Searching code..."));
        return text;
      }
      const q = args.query.length > 70 ? args.query.slice(0, 67) + "..." : args.query;
      text.setText(
        theme.fg("toolTitle", theme.bold("code_search")) + " " + theme.fg("accent", `"${q}"`)
      );
      return text;
    },
    renderResult(result, options, theme, context) {
      const text = context.lastComponent ?? new Text("", 0, 0);
      if (context.isPartial) {
        text.setText(theme.fg("warning", "Searching code..."));
        return text;
      }
      const count = result.details?.resultCount ?? 0;
      if (options.expanded) {
        const raw = result.content[0] && "text" in result.content[0] ? result.content[0].text : "";
        const lines = raw.split("\n").slice(0, 15);
        text.setText(lines.map((l) => theme.fg("toolOutput", l)).join("\n"));
      } else {
        text.setText(theme.fg("toolOutput", `${count} code results`));
      }
      return text;
    },
```

- [ ] **Step 5: Add renderCall and renderResult to web-read.ts**

Add import at top of file:

```typescript
import { Text } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
```

Add to the returned tool object (after `execute`):

```typescript
    renderCall(args, theme, context) {
      const text = context.lastComponent ?? new Text("", 0, 0);
      text.setText(
        theme.fg("toolTitle", theme.bold("web_read")) + " " + theme.fg("accent", `"${args.contentId}"`)
      );
      return text;
    },
    renderResult(result, options, theme, context) {
      const text = context.lastComponent ?? new Text("", 0, 0);
      const raw = result.content[0] && "text" in result.content[0] ? result.content[0].text : "";
      if (options.expanded) {
        const lines = raw.split("\n").slice(0, 20);
        text.setText(lines.map((l) => theme.fg("toolOutput", l)).join("\n"));
      } else {
        text.setText(theme.fg("toolOutput", `${raw.length} chars`));
      }
      return text;
    },
```

- [ ] **Step 6: Run checks**

Run: `pnpm check`
Expected: All lint, typecheck, and tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/tools/web-search.ts src/tools/web-fetch.ts src/tools/code-search.ts src/tools/web-read.ts tests/tools/rendering.test.ts
git commit -m "feat: add TUI renderers for all tools"
```

## Phase 9 Checkpoint

All tools now have custom TUI rendering. The extension is feature-complete per the design spec.

Run final check: `pnpm check`
Expected: All lint, typecheck, and tests pass.

---

## Summary

| Phase | Deliverable                                                          | Tools Working After                                    |
| ----- | -------------------------------------------------------------------- | ------------------------------------------------------ |
| 1     | Types, config, errors, SSRF, storage, truncation, test helpers, deps | -                                                      |
| 2     | DuckDuckGo provider + web_search tool                                | `web_search`                                           |
| 3     | Content storage + web_read tool                                      | `web_search`, `web_read`                               |
| 4     | HTML extraction + web_fetch tool                                     | `web_search`, `web_fetch`, `web_read`                  |
| 5     | Provider registry + quota-aware selection                            | `web_search` (multi-provider), `web_fetch`, `web_read` |
| 6     | All 8 search providers                                               | `web_search` (all providers), `web_fetch`, `web_read`  |
| 7     | code_search tool                                                     | All 4 tools                                            |
| 8     | PDF, RSC, Jina Reader, provider extraction fallbacks                 | All 4 tools (enhanced)                                 |
| 9     | TUI rendering for all tools                                          | All 4 tools (polished)                                 |
