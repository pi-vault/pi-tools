# Phase 5: Interactive Setup & Activity Monitor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance `/tools` with composable subcommands (enable, disable, key, test, default, monitor) and an enhanced wizard, plus add a real-time activity monitor widget.

**Architecture:** Activity monitor is a standalone module. The `/tools` command is refactored from flag-based (`--status`, `--reload`) to subcommand-based (`/tools status`, `/tools enable brave`). The enhanced wizard replaces the current sequential provider iteration with a tiered quick-setup flow.

**Tech Stack:** TypeScript, Vitest, Pi ExtensionAPI (`@earendil-works/pi-coding-agent`)

**Spec:** `docs/superpowers/specs/2026-07-15-feature-adoption-design.md` (Phase 5)

> **Revision (2026-07-15):** Plan validated against actual Pi Extension API type
> signatures (`@earendil-works/pi-coding-agent` types.ts) and the reference
> `pi-web-access` extension. Key fixes:
>
> 1. **Widget rendering** uses `ctx.ui.setWidget(key, string[])` overload — no
>    `Text` import from `@earendil-works/pi-tui` needed.
> 2. **Theme access** via `ctx.ui.theme` (public property) — removed unsafe casts.
> 3. **widget.ts** is now a pure formatting module (exports `renderWidgetLines`
>    returning `string[]`); `updateWidget`/`removeWidget` helpers removed.
> 4. **`session_shutdown`** handler uses the properly-typed event name (removed
>    `as any` cast).
> 5. **Status indicator colors** use `"success"`/`"error"` theme keys (matching
>    Pi's theme contract) instead of `"green"`/`"red"`.

---

## File Overview

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/monitor/activity-monitor.ts` | ActivityMonitor class + singleton, entry types |
| Create | `src/monitor/widget.ts` | Widget rendering via `Text` from `@earendil-works/pi-tui` |
| Create | `src/commands/tools-subcommands.ts` | Subcommand handlers + `updateConfig` helper |
| Create | `src/commands/tools-setup.ts` | Enhanced wizard (diagnostic preamble, quick/full setup) |
| Modify | `src/commands/tools.ts` | Refactor to subcommand dispatch; keep `buildStatusTable` |
| Modify | `src/index.ts` | Session lifecycle for monitor; pass new deps to tools command |
| Create | `tests/monitor/activity-monitor.test.ts` | ActivityMonitor unit tests |
| Create | `tests/monitor/widget.test.ts` | Widget rendering tests |
| Create | `tests/commands/tools-subcommands.test.ts` | Subcommand handler tests |
| Create | `tests/commands/tools-setup.test.ts` | Enhanced wizard tests |
| Modify | `tests/commands/tools.test.ts` | Update for new arg parsing (subcommand style) |

---

## Task 1: ActivityMonitor — Core Class (standalone, no deps)

**Files:**
- Create: `src/monitor/activity-monitor.ts`
- Create: `tests/monitor/activity-monitor.test.ts`

- [ ] **Step 1: Write failing tests for ActivityMonitor**

Create `tests/monitor/activity-monitor.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActivityMonitor,
  type ActivityEntry,
} from "../../src/monitor/activity-monitor.ts";

describe("ActivityMonitor", () => {
  let monitor: ActivityMonitor;

  beforeEach(() => {
    monitor = new ActivityMonitor();
  });

  it("logStart creates an entry with status null", () => {
    const id = monitor.logStart({ type: "api", query: "react hooks" });

    expect(id).toBe("1");
    const entries = monitor.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "1",
      type: "api",
      query: "react hooks",
      status: null,
    });
    expect(entries[0].startTime).toBeGreaterThan(0);
    expect(entries[0].endTime).toBeUndefined();
  });

  it("logComplete updates entry with status and endTime", () => {
    const id = monitor.logStart({ type: "fetch", url: "https://example.com" });
    monitor.logComplete(id, 200);

    const entry = monitor.getEntries()[0];
    expect(entry.status).toBe(200);
    expect(entry.endTime).toBeGreaterThan(0);
    expect(entry.error).toBeUndefined();
  });

  it("logError updates entry with error and status -1", () => {
    const id = monitor.logStart({ type: "api", query: "test" });
    monitor.logError(id, "Connection refused");

    const entry = monitor.getEntries()[0];
    expect(entry.status).toBe(-1);
    expect(entry.error).toBe("Connection refused");
    expect(entry.endTime).toBeGreaterThan(0);
  });

  it("evicts oldest entry when buffer exceeds 10", () => {
    for (let i = 0; i < 12; i++) {
      monitor.logStart({ type: "api", query: `query-${i}` });
    }

    const entries = monitor.getEntries();
    expect(entries).toHaveLength(10);
    // Oldest two evicted: query-0 and query-1 gone
    expect(entries[0].query).toBe("query-2");
    expect(entries[9].query).toBe("query-11");
  });

  it("assigns incrementing IDs", () => {
    const id1 = monitor.logStart({ type: "api", query: "a" });
    const id2 = monitor.logStart({ type: "fetch", url: "https://b.com" });

    expect(id1).toBe("1");
    expect(id2).toBe("2");
  });

  it("clear removes all entries", () => {
    monitor.logStart({ type: "api", query: "a" });
    monitor.logStart({ type: "fetch", url: "https://b.com" });
    monitor.clear();

    expect(monitor.getEntries()).toHaveLength(0);
  });

  it("logComplete on unknown ID is a no-op", () => {
    monitor.logComplete("nonexistent", 200);
    expect(monitor.getEntries()).toHaveLength(0);
  });

  it("logError on unknown ID is a no-op", () => {
    monitor.logError("nonexistent", "fail");
    expect(monitor.getEntries()).toHaveLength(0);
  });

  describe("listeners", () => {
    it("onUpdate fires callback on logStart", () => {
      const cb = vi.fn();
      monitor.onUpdate(cb);
      monitor.logStart({ type: "api", query: "test" });

      expect(cb).toHaveBeenCalledTimes(1);
    });

    it("onUpdate fires callback on logComplete", () => {
      const cb = vi.fn();
      const id = monitor.logStart({ type: "api", query: "test" });
      monitor.onUpdate(cb);
      monitor.logComplete(id, 200);

      expect(cb).toHaveBeenCalledTimes(1);
    });

    it("onUpdate fires callback on logError", () => {
      const cb = vi.fn();
      const id = monitor.logStart({ type: "api", query: "test" });
      monitor.onUpdate(cb);
      monitor.logError(id, "fail");

      expect(cb).toHaveBeenCalledTimes(1);
    });

    it("unsubscribe stops callback from firing", () => {
      const cb = vi.fn();
      const unsub = monitor.onUpdate(cb);
      unsub();
      monitor.logStart({ type: "api", query: "test" });

      expect(cb).not.toHaveBeenCalled();
    });

    it("clear does not fire listeners", () => {
      const cb = vi.fn();
      monitor.logStart({ type: "api", query: "test" });
      monitor.onUpdate(cb);
      monitor.clear();

      expect(cb).not.toHaveBeenCalled();
    });
  });

  it("getEntries returns a read-only snapshot", () => {
    monitor.logStart({ type: "api", query: "test" });
    const entries = monitor.getEntries();
    expect(entries).toHaveLength(1);

    // Mutating the returned array should not affect internal state
    (entries as ActivityEntry[]).length = 0;
    expect(monitor.getEntries()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run tests/monitor/activity-monitor.test.ts
```

Expected: FAIL — module `../../src/monitor/activity-monitor.ts` does not exist.

- [ ] **Step 3: Implement ActivityMonitor**

Create `src/monitor/activity-monitor.ts`:

```typescript
export interface ActivityEntry {
  id: string;
  type: "api" | "fetch";
  startTime: number;
  endTime?: number;
  query?: string;
  url?: string;
  status: number | null;
  error?: string;
}

const MAX_ENTRIES = 10;

export class ActivityMonitor {
  private entries: ActivityEntry[] = [];
  private listeners = new Set<() => void>();
  private nextId = 1;

  logStart(
    partial: Omit<ActivityEntry, "id" | "startTime" | "status">,
  ): string {
    const id = String(this.nextId++);
    const entry: ActivityEntry = {
      ...partial,
      id,
      startTime: Date.now(),
      status: null,
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    }
    this.notify();
    return id;
  }

  logComplete(id: string, status: number): void {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return;
    entry.status = status;
    entry.endTime = Date.now();
    this.notify();
  }

  logError(id: string, error: string): void {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return;
    entry.status = -1;
    entry.error = error;
    entry.endTime = Date.now();
    this.notify();
  }

  getEntries(): ReadonlyArray<ActivityEntry> {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }

  onUpdate(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  private notify(): void {
    for (const cb of this.listeners) {
      cb();
    }
  }
}

export const activityMonitor = new ActivityMonitor();
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run tests/monitor/activity-monitor.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/monitor/activity-monitor.ts tests/monitor/activity-monitor.test.ts
git commit -m "feat: add ActivityMonitor core class with ring buffer and listeners

Standalone module that tracks up to 10 activity entries (API calls and
URL fetches) with start/complete/error lifecycle. Supports listener
subscriptions for widget updates.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

## Task 2: Activity Monitor Widget Rendering

**Files:**
- Create: `src/monitor/widget.ts`
- Create: `tests/monitor/widget.test.ts`

- [ ] **Step 1: Write failing tests for widget rendering**

Create `tests/monitor/widget.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import {
  formatEntryLine,
  renderWidgetLines,
} from "../../src/monitor/widget.ts";
import type { ActivityEntry } from "../../src/monitor/activity-monitor.ts";

// Stub theme: no-op coloring (returns text unchanged)
const plainTheme = {
  fg: (_color: string, text: string) => text,
};

describe("formatEntryLine", () => {
  it("formats a completed API entry", () => {
    const entry: ActivityEntry = {
      id: "1",
      type: "api",
      startTime: 1000,
      endTime: 1200,
      query: "react hooks",
      status: 200,
    };
    const line = formatEntryLine(entry, plainTheme);

    expect(line).toContain("API");
    expect(line).toContain("react hooks");
    expect(line).toContain("200");
    expect(line).toContain("0.2s");
  });

  it("formats a completed fetch entry", () => {
    const entry: ActivityEntry = {
      id: "2",
      type: "fetch",
      startTime: 1000,
      endTime: 1100,
      url: "https://example.com/page",
      status: 200,
    };
    const line = formatEntryLine(entry, plainTheme);

    expect(line).toContain("GET");
    expect(line).toContain("example.com/page");
    expect(line).toContain("200");
  });

  it("formats a pending entry with spinner indicator", () => {
    const entry: ActivityEntry = {
      id: "3",
      type: "api",
      startTime: Date.now() - 500,
      query: "typescript patterns",
      status: null,
    };
    const line = formatEntryLine(entry, plainTheme);

    expect(line).toContain("API");
    expect(line).toContain("...");
  });

  it("formats an error entry with failure indicator", () => {
    const entry: ActivityEntry = {
      id: "4",
      type: "api",
      startTime: 1000,
      endTime: 2200,
      query: "test query",
      status: 429,
    };
    const line = formatEntryLine(entry, plainTheme);

    expect(line).toContain("429");
  });

  it("truncates long URLs", () => {
    const entry: ActivityEntry = {
      id: "5",
      type: "fetch",
      startTime: 1000,
      endTime: 1100,
      url: "https://example.com/very/long/path/that/exceeds/the/maximum/column/width/for/display",
      status: 200,
    };
    const line = formatEntryLine(entry, plainTheme);

    // URL should be truncated to fit within display width
    expect(line.length).toBeLessThan(200);
  });

  it("strips https:// prefix from URLs", () => {
    const entry: ActivityEntry = {
      id: "6",
      type: "fetch",
      startTime: 1000,
      endTime: 1100,
      url: "https://example.com/page",
      status: 200,
    };
    const line = formatEntryLine(entry, plainTheme);

    expect(line).not.toContain("https://");
    expect(line).toContain("example.com/page");
  });
});

describe("renderWidgetLines", () => {
  it("renders empty state", () => {
    const lines = renderWidgetLines([], plainTheme);

    expect(lines.length).toBeGreaterThanOrEqual(3); // header + message + footer
    expect(lines.join("\n")).toContain("No activity yet");
  });

  it("renders entries with header and footer", () => {
    const entries: ActivityEntry[] = [
      {
        id: "1",
        type: "api",
        startTime: 1000,
        endTime: 1200,
        query: "test",
        status: 200,
      },
    ];
    const lines = renderWidgetLines(entries, plainTheme);
    const text = lines.join("\n");

    expect(text).toContain("Web Tools Activity");
    expect(text).toContain("API");
    expect(text).toContain("test");
  });

  it("renders multiple entries", () => {
    const entries: ActivityEntry[] = [
      {
        id: "1",
        type: "api",
        startTime: 1000,
        endTime: 1200,
        query: "query-a",
        status: 200,
      },
      {
        id: "2",
        type: "fetch",
        startTime: 1000,
        endTime: 1500,
        url: "https://b.com",
        status: 404,
      },
    ];
    const lines = renderWidgetLines(entries, plainTheme);
    const text = lines.join("\n");

    expect(text).toContain("query-a");
    expect(text).toContain("b.com");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run tests/monitor/widget.test.ts
```

Expected: FAIL — module `../../src/monitor/widget.ts` does not exist.

- [ ] **Step 3: Implement widget rendering**

Create `src/monitor/widget.ts`:

> **API note:** `ctx.ui.setWidget(key, content)` accepts `string[] | undefined`
> (simple text lines) or a factory function. We use the `string[]` overload
> which is simpler and avoids importing TUI components. Theme is accessed via
> `ctx.ui.theme` (a public property on `ExtensionUIContext`).

```typescript
import type { ActivityEntry } from "./activity-monitor.ts";

/** Minimal theme contract for testability — matches ctx.ui.theme at runtime. */
export interface ThemeLike {
  fg: (color: string, text: string) => string;
}

const TARGET_WIDTH = 34;

function formatDuration(startTime: number, endTime?: number): string {
  const elapsed = (endTime ?? Date.now()) - startTime;
  return `${(elapsed / 1000).toFixed(1)}s`;
}

function formatTarget(entry: ActivityEntry): string {
  if (entry.type === "api") {
    const q = entry.query ?? "?";
    const display = q.length > TARGET_WIDTH ? q.slice(0, TARGET_WIDTH - 1) + "\u2026" : q;
    return `"${display}"`;
  }
  const raw = (entry.url ?? "?")
    .replace(/^https?:\/\//, "");
  return raw.length > TARGET_WIDTH ? raw.slice(0, TARGET_WIDTH - 1) + "\u2026" : raw;
}

function statusIndicator(
  entry: ActivityEntry,
  theme: ThemeLike,
): string {
  if (entry.status === null) return "\u22EF"; // pending: ⋯
  if (entry.status >= 200 && entry.status < 400) return theme.fg("success", "\u2713"); // ✓
  return theme.fg("error", "\u2717"); // ✗
}

export function formatEntryLine(
  entry: ActivityEntry,
  theme: ThemeLike,
): string {
  const typeLabel = entry.type === "api" ? "API" : "GET";
  const target = formatTarget(entry);
  const statusStr = entry.status === null ? "..." : String(entry.status);
  const duration = formatDuration(entry.startTime, entry.endTime);
  const indicator = statusIndicator(entry, theme);

  return [
    typeLabel.padEnd(5),
    target.padEnd(TARGET_WIDTH + 2),
    statusStr.padStart(4),
    duration.padStart(6),
    indicator,
  ].join("  ");
}

export function renderWidgetLines(
  entries: ReadonlyArray<ActivityEntry>,
  theme: ThemeLike,
): string[] {
  const lines: string[] = [];

  lines.push(theme.fg("accent", "--- Web Tools Activity " + "-".repeat(37)));

  if (entries.length === 0) {
    lines.push(theme.fg("muted", "  No activity yet"));
  } else {
    for (const entry of entries) {
      lines.push("  " + formatEntryLine(entry, theme));
    }
  }

  lines.push(theme.fg("accent", "-".repeat(60)));
  return lines;
}
```

> **Removed from original plan:** `updateWidget(ctx)` and `removeWidget(ctx)`
> helper functions. These are no longer needed — the monitor toggle in
> `tools.ts` calls `renderWidgetLines` and `ctx.ui.setWidget` directly,
> which is simpler and avoids importing `activityMonitor` in widget.ts.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run tests/monitor/widget.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/monitor/widget.ts tests/monitor/widget.test.ts
git commit -m "feat: add activity monitor widget rendering

Pure formatting module that renders activity entries as string[] for
ctx.ui.setWidget(). Formats API calls and URL fetches with type, target,
status, duration, and status indicator. Supports empty state display.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

## Task 3: Add activity monitor instrumentation

**Files:**
- Modify: `src/providers/execute.ts`
- Modify: `src/providers/fusion.ts`
- Modify: `src/extract/pipeline.ts`
- Modify: `src/extract/gemini-api.ts`

- [ ] **Step 1: Instrument executeWithFallback**

In `src/providers/execute.ts`, add import and instrumentation:

```typescript
import { activityMonitor } from "../monitor/activity-monitor.ts";
```

Inside the `for` loop in `executeWithFallback`, wrap the candidate execution:

```typescript
  for (const candidate of candidates) {
    const entryId = activityMonitor.logStart({ type: "api", query: operation });
    const startMs = Date.now();
    try {
      const result = await candidate.execute();
      onSuccess?.(candidate.name, Date.now() - startMs);
      activityMonitor.logComplete(entryId, 200);
      return { result, providerName: candidate.name };
    } catch (error) {
      onFailure?.(candidate.name);
      activityMonitor.logError(entryId, error instanceof Error ? error.message : String(error));
      errors.push({
        provider: candidate.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
```

- [ ] **Step 2: Instrument executeWithFusion**

In `src/providers/fusion.ts`, add import:

```typescript
import { activityMonitor } from "../monitor/activity-monitor.ts";
```

Inside `executeTargeted`, in the `batch.map` callback, wrap execution:

```typescript
    const batchSettled = await Promise.all(
      batch.map(async (candidate) => {
        const entryId = activityMonitor.logStart({ type: "api", query: `fusion:${candidate.name}` });
        const startMs = Date.now();
        try {
          const results = await candidate.execute(perProvider);
          const latencyMs = Date.now() - startMs;
          onSuccess?.(candidate.name, latencyMs);
          activityMonitor.logComplete(entryId, 200);
          return { name: candidate.name, results, success: true as const };
        } catch (err) {
          onFailure?.(candidate.name);
          activityMonitor.logError(entryId, err instanceof Error ? err.message : String(err));
          return {
            name: candidate.name,
            error: err instanceof Error ? err.message : String(err),
            success: false as const,
          };
        }
      }),
    );
```

- [ ] **Step 3: Instrument pipeline.ts HTTP fetch**

In `src/extract/pipeline.ts`, add import:

```typescript
import { activityMonitor } from "../monitor/activity-monitor.ts";
```

Wrap the main `fetch()` call in `extractContent`:

```typescript
  const fetchEntryId = activityMonitor.logStart({ type: "fetch", url });
  let response: Response;
  try {
    response = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal,
      redirect: "follow",
    });
    activityMonitor.logComplete(fetchEntryId, response.status);
  } catch (err) {
    activityMonitor.logError(fetchEntryId, err instanceof Error ? err.message : String(err));
    throw new RetryableExtractionError(err instanceof Error ? err.message : String(err));
  }
```

- [ ] **Step 4: Instrument gemini-api.ts**

In `src/extract/gemini-api.ts`, add import:

```typescript
import { activityMonitor } from "../monitor/activity-monitor.ts";
```

Wrap the `fetch()` call in the Gemini request function:

```typescript
  const entryId = activityMonitor.logStart({ type: "api", query: `gemini:${model}` });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...buildAuthHeaders() },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    activityMonitor.logError(entryId, `HTTP ${res.status}`);
  } else {
    activityMonitor.logComplete(entryId, res.status);
  }
```

- [ ] **Step 5: Run all tests to check instrumentation doesn't break anything**

```bash
pnpm test
```

Expected: all tests PASS. The `activityMonitor` singleton is imported but its methods are no-ops in test unless explicitly tested.

- [ ] **Step 6: Commit**

```bash
git add src/providers/execute.ts src/providers/fusion.ts src/extract/pipeline.ts src/extract/gemini-api.ts
git commit -m "feat: instrument providers and extractors for activity monitor

Add activityMonitor.logStart/logComplete/logError calls to
executeWithFallback, executeWithFusion, pipeline HTTP fetch,
and Gemini API calls.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

## Task 4: Config Write Helper + Subcommand Handlers

**Files:**
- Create: `src/commands/tools-subcommands.ts`
- Create: `tests/commands/tools-subcommands.test.ts`

- [ ] **Step 1: Write failing tests for subcommand handlers**

Create `tests/commands/tools-subcommands.test.ts`:

```typescript
import * as fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  handleEnable,
  handleDisable,
  handleKey,
  handleDefault,
  handleTest,
  maskKey,
  updateConfig,
  parseArgs,
} from "../../src/commands/tools-subcommands.ts";
import { getConfigPath } from "../../src/config.ts";
import { makeCtx } from "../helpers.ts";

vi.mock("node:fs");

describe("parseArgs", () => {
  it("parses subcommand with no args", () => {
    const result = parseArgs("status");
    expect(result).toEqual({ subcommand: "status", rest: [] });
  });

  it("parses subcommand with one arg", () => {
    const result = parseArgs("enable brave");
    expect(result).toEqual({ subcommand: "enable", rest: ["brave"] });
  });

  it("parses subcommand with multiple args", () => {
    const result = parseArgs("key brave BSA_abc123def");
    expect(result).toEqual({
      subcommand: "key",
      rest: ["brave", "BSA_abc123def"],
    });
  });

  it("returns empty subcommand for empty string", () => {
    const result = parseArgs("");
    expect(result).toEqual({ subcommand: "", rest: [] });
  });

  it("handles extra whitespace", () => {
    const result = parseArgs("  enable   brave  ");
    expect(result).toEqual({ subcommand: "enable", rest: ["brave"] });
  });
});

describe("maskKey", () => {
  it("masks a long key", () => {
    expect(maskKey("BSA_abcdefghij7x2f")).toBe("BSA_...7x2f");
  });

  it("returns short keys unchanged", () => {
    expect(maskKey("abc")).toBe("abc");
  });

  it("masks key with exactly 8 characters", () => {
    expect(maskKey("12345678")).toBe("1234...5678");
  });
});

describe("updateConfig", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
  });

  it("reads existing config, applies updater, writes back", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ defaultProvider: "auto", providers: { brave: { enabled: true } } }),
    );

    updateConfig((config) => ({
      ...config,
      defaultProvider: "exa",
    }));

    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const [writePath, writeContent] = vi.mocked(fs.writeFileSync).mock.calls[0];
    expect(writePath).toBe(getConfigPath());
    const written = JSON.parse(writeContent as string);
    expect(written.defaultProvider).toBe("exa");
    expect(written.providers.brave.enabled).toBe(true);
  });

  it("creates new config when file does not exist", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });

    updateConfig((config) => ({
      ...config,
      providers: { brave: { enabled: true } },
    }));

    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const [, writeContent] = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeContent as string);
    expect(written.providers.brave.enabled).toBe(true);
  });
});

describe("handleEnable", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ providers: { brave: { enabled: false } } }),
    );
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
  });

  it("enables a provider in config", () => {
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    const allProviderNames = ["brave", "exa", "duckduckgo"];

    handleEnable(ctx, "brave", allProviderNames);

    const [, writeContent] = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeContent as string);
    expect(written.providers.brave.enabled).toBe(true);
    expect(ctx.ui.notify).toHaveBeenCalled();
  });

  it("notifies on unknown provider name", () => {
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    const allProviderNames = ["brave", "exa"];

    handleEnable(ctx, "nonexistent", allProviderNames);

    expect(fs.writeFileSync).not.toHaveBeenCalled();
    const msg = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(msg.toLowerCase()).toContain("unknown");
  });
});

describe("handleDisable", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ providers: { brave: { enabled: true } } }),
    );
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
  });

  it("disables a provider in config", () => {
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    const allProviderNames = ["brave", "exa"];

    handleDisable(ctx, "brave", allProviderNames);

    const [, writeContent] = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeContent as string);
    expect(written.providers.brave.enabled).toBe(false);
  });
});

describe("handleKey", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ providers: { brave: { enabled: true } } }),
    );
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
  });

  it("sets API key for a provider", () => {
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    const allProviderNames = ["brave", "exa"];

    handleKey(ctx, "brave", "BSA_newkey12345678", allProviderNames);

    const [, writeContent] = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeContent as string);
    expect(written.providers.brave.apiKey).toBe("BSA_newkey12345678");
    // Should display masked key in notification
    const msg = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(msg).toContain("BSA_...5678");
  });

  it("notifies when value is missing", () => {
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    const allProviderNames = ["brave"];

    handleKey(ctx, "brave", undefined, allProviderNames);

    expect(fs.writeFileSync).not.toHaveBeenCalled();
    const msg = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(msg.toLowerCase()).toContain("usage");
  });
});

describe("handleDefault", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ defaultProvider: "auto" }),
    );
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
  });

  it("sets default provider", () => {
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    const allProviderNames = ["brave", "exa"];

    handleDefault(ctx, "exa", allProviderNames);

    const [, writeContent] = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeContent as string);
    expect(written.defaultProvider).toBe("exa");
  });

  it("accepts 'auto' as default", () => {
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    const allProviderNames = ["brave", "exa"];

    handleDefault(ctx, "auto", allProviderNames);

    const [, writeContent] = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeContent as string);
    expect(written.defaultProvider).toBe("auto");
  });

  it("rejects unknown provider name", () => {
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    const allProviderNames = ["brave", "exa"];

    handleDefault(ctx, "nonexistent", allProviderNames);

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });
});

describe("handleTest", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("tests a specific provider by making a search call", async () => {
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    const mockSearch = vi.fn().mockResolvedValue([
      { title: "Test", url: "https://test.com", snippet: "test" },
    ]);
    const registry = {
      getSearchProviderNames: () => ["brave"],
      selectSearchCandidates: (name: string) =>
        name === "brave" ? [{ name: "brave", label: "Brave", search: mockSearch }] : [],
    };

    await handleTest(ctx, "brave", registry as any);

    expect(mockSearch).toHaveBeenCalled();
    const msg = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(msg.toLowerCase()).toContain("brave");
  });

  it("reports failure when provider is not found", async () => {
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    const registry = {
      getSearchProviderNames: () => [],
      selectSearchCandidates: () => [],
    };

    await handleTest(ctx, "nonexistent", registry as any);

    const msg = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(msg.toLowerCase()).toContain("not found");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run tests/commands/tools-subcommands.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement subcommand handlers**

Create `src/commands/tools-subcommands.ts`:

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getConfigPath } from "../config.ts";
import type { ProviderRegistry } from "../providers/registry.ts";

export function parseArgs(argsStr: string): {
  subcommand: string;
  rest: string[];
} {
  const parts = argsStr.trim().split(/\s+/).filter(Boolean);
  return { subcommand: parts[0] ?? "", rest: parts.slice(1) };
}

export function maskKey(key: string): string {
  if (key.length <= 8) return key;
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

export function updateConfig(
  updater: (
    config: Record<string, unknown>,
  ) => Record<string, unknown>,
): string {
  const configPath = getConfigPath();
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    // No existing config — start fresh
  }
  const updated = updater(existing);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(updated, null, 2));
  return configPath;
}

function isKnownProvider(name: string, allProviderNames: string[]): boolean {
  return allProviderNames.includes(name);
}

export function handleEnable(
  ctx: ExtensionCommandContext,
  name: string,
  allProviderNames: string[],
): void {
  if (!isKnownProvider(name, allProviderNames)) {
    ctx.ui.notify(`Unknown provider "${name}". Available: ${allProviderNames.join(", ")}`);
    return;
  }
  const configPath = updateConfig((config) => {
    const providers = (config.providers ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    providers[name] = { ...providers[name], enabled: true };
    return { ...config, providers };
  });
  ctx.ui.notify(`Enabled ${name}. Config saved to ${configPath}`);
}

export function handleDisable(
  ctx: ExtensionCommandContext,
  name: string,
  allProviderNames: string[],
): void {
  if (!isKnownProvider(name, allProviderNames)) {
    ctx.ui.notify(`Unknown provider "${name}". Available: ${allProviderNames.join(", ")}`);
    return;
  }
  const configPath = updateConfig((config) => {
    const providers = (config.providers ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    providers[name] = { ...providers[name], enabled: false };
    return { ...config, providers };
  });
  ctx.ui.notify(`Disabled ${name}. Config saved to ${configPath}`);
}

export function handleKey(
  ctx: ExtensionCommandContext,
  name: string,
  value: string | undefined,
  allProviderNames: string[],
): void {
  if (!value) {
    ctx.ui.notify("Usage: /tools key <provider> <api-key>");
    return;
  }
  if (!isKnownProvider(name, allProviderNames)) {
    ctx.ui.notify(`Unknown provider "${name}". Available: ${allProviderNames.join(", ")}`);
    return;
  }
  updateConfig((config) => {
    const providers = (config.providers ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    providers[name] = { ...providers[name], apiKey: value };
    return { ...config, providers };
  });
  ctx.ui.notify(`API key for ${name} set to ${maskKey(value)}`);
}

export function handleDefault(
  ctx: ExtensionCommandContext,
  name: string,
  allProviderNames: string[],
): void {
  if (name !== "auto" && !isKnownProvider(name, allProviderNames)) {
    ctx.ui.notify(`Unknown provider "${name}". Use "auto" or one of: ${allProviderNames.join(", ")}`);
    return;
  }
  updateConfig((config) => ({
    ...config,
    defaultProvider: name,
  }));
  ctx.ui.notify(`Default provider set to "${name}"`);
}

export async function handleTest(
  ctx: ExtensionCommandContext,
  name: string | undefined,
  registry: ProviderRegistry,
): Promise<void> {
  const providerNames = name ? [name] : registry.getSearchProviderNames();

  if (providerNames.length === 0) {
    ctx.ui.notify("No providers to test.");
    return;
  }

  const results: string[] = [];

  for (const providerName of providerNames) {
    const candidates = registry.selectSearchCandidates(providerName);
    if (candidates.length === 0) {
      results.push(`${providerName}: not found or not enabled`);
      continue;
    }

    const provider = candidates[0];
    const startMs = Date.now();
    try {
      const searchResults = await provider.search("test", 1);
      const elapsed = Date.now() - startMs;
      results.push(
        `${providerName}: OK (${elapsed}ms, ${searchResults.length} result${searchResults.length !== 1 ? "s" : ""})`,
      );
    } catch (err) {
      const elapsed = Date.now() - startMs;
      const msg = err instanceof Error ? err.message : String(err);
      results.push(`${providerName}: FAIL (${elapsed}ms) — ${msg}`);
    }
  }

  ctx.ui.notify(results.join("\n"));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run tests/commands/tools-subcommands.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/tools-subcommands.ts tests/commands/tools-subcommands.test.ts
git commit -m "feat: add /tools subcommand handlers and config write helper

Adds parseArgs, updateConfig, maskKey, and handlers for enable, disable,
key, default, and test subcommands. Config writes use read-modify-write
pattern on the global config file.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

## Task 5: Enhanced Wizard (tools-setup.ts)

**Files:**
- Create: `src/commands/tools-setup.ts`
- Create: `tests/commands/tools-setup.test.ts`

- [ ] **Step 1: Write failing tests for enhanced wizard**

Create `tests/commands/tools-setup.test.ts`:

```typescript
import * as fs from "node:fs";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleEnhancedSetup, buildDiagnosticPreamble } from "../../src/commands/tools-setup.ts";
import { makeCtx } from "../helpers.ts";
import type { ProviderTier } from "../../src/providers/types.ts";

vi.mock("node:fs");

describe("buildDiagnosticPreamble", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reports detected environment keys", () => {
    const original = process.env.BRAVE_API_KEY;
    process.env.BRAVE_API_KEY = "test-key";

    const preamble = buildDiagnosticPreamble(
      ["brave", "exa"],
      new Map<string, ProviderTier>([["brave", 1], ["exa", 1]]),
    );
    expect(preamble).toContain("BRAVE_API_KEY");
    expect(preamble).toContain("detected");

    if (original !== undefined) {
      process.env.BRAVE_API_KEY = original;
    } else {
      delete process.env.BRAVE_API_KEY;
    }
  });

  it("reports config file status", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const preamble = buildDiagnosticPreamble(
      ["brave"],
      new Map<string, ProviderTier>([["brave", 1]]),
    );
    expect(preamble).toContain("Config file");
  });
});

describe("handleEnhancedSetup", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  it("shows status when user chooses 'Just show status'", async () => {
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    vi.mocked(ctx.ui.select).mockResolvedValueOnce("status");

    const allProviderNames = ["brave", "exa"];
    const tierMap = new Map<string, ProviderTier>([["brave", 1], ["exa", 1]]);

    await handleEnhancedSetup(ctx, allProviderNames, tierMap);

    // Should have shown diagnostic preamble + called select
    expect(ctx.ui.select).toHaveBeenCalledTimes(1);
    // Status path notifies the user
    expect(ctx.ui.notify).toHaveBeenCalled();
  });

  it("runs quick setup for tier-1 providers", async () => {
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    // User picks "Quick setup"
    vi.mocked(ctx.ui.select).mockResolvedValueOnce("quick");
    // Prompt for brave API key
    vi.mocked(ctx.ui.input)
      .mockResolvedValueOnce("BSA_testkey12345678")
      .mockResolvedValueOnce(""); // exa: skip
    // Default provider selection
    vi.mocked(ctx.ui.select).mockResolvedValueOnce("auto");

    const allProviderNames = ["brave", "exa"];
    const tierMap = new Map<string, ProviderTier>([["brave", 1], ["exa", 1]]);

    await handleEnhancedSetup(ctx, allProviderNames, tierMap);

    // Should have written config
    expect(fs.writeFileSync).toHaveBeenCalled();
    const [, writeContent] = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeContent as string);
    expect(written.providers.brave.apiKey).toBe("BSA_testkey12345678");
    expect(written.providers.brave.enabled).toBe(true);
  });

  it("runs full setup iterating all providers", async () => {
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    // User picks "Full setup"
    vi.mocked(ctx.ui.select).mockResolvedValueOnce("full");
    // brave: enable, exa: disable
    vi.mocked(ctx.ui.confirm)
      .mockResolvedValueOnce(true)   // brave: yes
      .mockResolvedValueOnce(false); // exa: no
    // API key for brave
    vi.mocked(ctx.ui.input).mockResolvedValueOnce("my-key");
    // Default provider
    vi.mocked(ctx.ui.select).mockResolvedValueOnce("auto");

    const allProviderNames = ["brave", "exa"];
    const tierMap = new Map<string, ProviderTier>([["brave", 1], ["exa", 1]]);

    await handleEnhancedSetup(ctx, allProviderNames, tierMap);

    expect(fs.writeFileSync).toHaveBeenCalled();
    const [, writeContent] = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeContent as string);
    expect(written.providers.brave.enabled).toBe(true);
    expect(written.providers.exa.enabled).toBe(false);
  });

  it("handles no providers available", async () => {
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    const tierMap = new Map<string, ProviderTier>();

    await handleEnhancedSetup(ctx, [], tierMap);

    const msg = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(msg).toContain("No providers available");
  });

  it("handles user cancellation (select returns undefined)", async () => {
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    vi.mocked(ctx.ui.select).mockResolvedValueOnce(undefined);

    const allProviderNames = ["brave"];
    const tierMap = new Map<string, ProviderTier>([["brave", 1]]);

    await handleEnhancedSetup(ctx, allProviderNames, tierMap);

    // Should not crash; no config written
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run tests/commands/tools-setup.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement enhanced wizard**

Create `src/commands/tools-setup.ts`:

```typescript
import * as fs from "node:fs";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getConfigPath, FALLBACK_ENV_MAP } from "../config.ts";
import { updateConfig, maskKey } from "./tools-subcommands.ts";
import type { ProviderTier } from "../providers/types.ts";

export function buildDiagnosticPreamble(
  allProviderNames: string[],
  tierMap: ReadonlyMap<string, ProviderTier>,
): string {
  const lines: string[] = [];
  lines.push("=== Pi Tools Setup ===\n");

  // Environment keys
  const envKeys = Object.entries(FALLBACK_ENV_MAP);
  const detected: string[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();

  for (const [, envVar] of envKeys) {
    if (seen.has(envVar)) continue;
    seen.add(envVar);
    if (process.env[envVar]) {
      detected.push(`  ${envVar}: detected`);
    } else {
      missing.push(`  ${envVar}: not set`);
    }
  }

  if (detected.length > 0) {
    lines.push("Environment keys:");
    lines.push(...detected);
    if (missing.length > 0) lines.push(`  ... and ${missing.length} not set`);
    lines.push("");
  }

  // Config file status
  const configPath = getConfigPath();
  const configExists = fs.existsSync(configPath);
  lines.push(`Config file: ${configExists ? configPath : "not created yet"}`);

  // Provider summary
  const tier1 = allProviderNames.filter((n) => tierMap.get(n) === 1);
  const tier2 = allProviderNames.filter((n) => tierMap.get(n) === 2);
  const tier3 = allProviderNames.filter(
    (n) => tierMap.get(n) === 3 || !tierMap.has(n),
  );
  lines.push(
    `Providers: ${tier1.length} tier-1, ${tier2.length} tier-2, ${tier3.length} tier-3 (${allProviderNames.length} total)`,
  );

  return lines.join("\n");
}

async function runQuickSetup(
  ctx: ExtensionCommandContext,
  allProviderNames: string[],
  tierMap: ReadonlyMap<string, ProviderTier>,
): Promise<void> {
  const tier1Providers = allProviderNames.filter((n) => tierMap.get(n) === 1);
  if (tier1Providers.length === 0) {
    ctx.ui.notify("No tier-1 providers found for quick setup.");
    return;
  }

  const providers: Record<string, { enabled: boolean; apiKey?: string }> = {};
  const enabledNames: string[] = [];

  for (const name of tier1Providers) {
    const envVar = FALLBACK_ENV_MAP[name];
    const hasEnvKey = envVar ? !!process.env[envVar] : false;
    const keyHint = hasEnvKey ? ` (${envVar} detected)` : "";

    const apiKey = await ctx.ui.input(
      `API key for ${name}${keyHint}`,
      hasEnvKey ? "Press Enter to use env var" : "Paste key or leave empty to skip",
    );

    if (apiKey && apiKey.trim().length > 0) {
      providers[name] = { enabled: true, apiKey: apiKey.trim() };
      enabledNames.push(name);
      ctx.ui.notify(`${name}: key set to ${maskKey(apiKey.trim())}`);
    } else if (hasEnvKey) {
      providers[name] = { enabled: true };
      enabledNames.push(name);
    } else {
      providers[name] = { enabled: false };
    }
  }

  // Default provider selection
  const defaultOptions = ["auto", ...enabledNames];
  const defaultProvider =
    (await ctx.ui.select("Default provider:", defaultOptions)) ?? "auto";

  updateConfig((config) => {
    const existingProviders = (config.providers ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    for (const [name, entry] of Object.entries(providers)) {
      existingProviders[name] = { ...existingProviders[name], ...entry };
    }
    return { ...config, defaultProvider, providers: existingProviders };
  });

  ctx.ui.notify(
    `Quick setup complete! ${enabledNames.length} provider${enabledNames.length !== 1 ? "s" : ""} configured.`,
  );
}

async function runFullSetup(
  ctx: ExtensionCommandContext,
  allProviderNames: string[],
): Promise<void> {
  const providers: Record<string, { enabled: boolean; apiKey?: string }> = {};
  const enabledNames: string[] = [];

  for (const name of allProviderNames) {
    const enabled = await ctx.ui.confirm("Provider setup", `Enable ${name}?`);
    providers[name] = { enabled };

    if (enabled) {
      enabledNames.push(name);
      const apiKey = await ctx.ui.input(
        `API key for ${name}`,
        "Leave empty to skip",
      );
      if (apiKey && apiKey.trim().length > 0) {
        providers[name].apiKey = apiKey.trim();
      }
    }
  }

  const defaultOptions = ["auto", ...enabledNames];
  const defaultProvider =
    (await ctx.ui.select("Default provider:", defaultOptions)) ?? "auto";

  updateConfig((config) => {
    const existingProviders = (config.providers ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    for (const [name, entry] of Object.entries(providers)) {
      existingProviders[name] = { ...existingProviders[name], ...entry };
    }
    return { ...config, defaultProvider, providers: existingProviders };
  });

  ctx.ui.notify(
    `Setup complete! ${enabledNames.length} provider${enabledNames.length !== 1 ? "s" : ""} enabled.`,
  );
}

export async function handleEnhancedSetup(
  ctx: ExtensionCommandContext,
  allProviderNames: string[],
  tierMap: ReadonlyMap<string, ProviderTier>,
): Promise<void> {
  if (allProviderNames.length === 0) {
    ctx.ui.notify("No providers available for configuration.");
    return;
  }

  // Show diagnostic preamble
  const preamble = buildDiagnosticPreamble(allProviderNames, tierMap);
  ctx.ui.notify(preamble);

  // Offer setup mode
  const mode = await ctx.ui.select("Setup mode:", [
    "quick",
    "full",
    "status",
  ]);

  if (!mode) return; // User cancelled

  if (mode === "status") {
    ctx.ui.notify("Use /tools status for the provider status table.");
    return;
  }

  if (mode === "quick") {
    await runQuickSetup(ctx, allProviderNames, tierMap);
    return;
  }

  if (mode === "full") {
    await runFullSetup(ctx, allProviderNames);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run tests/commands/tools-setup.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/tools-setup.ts tests/commands/tools-setup.test.ts
git commit -m "feat: add enhanced /tools wizard with diagnostic preamble and tiered setup

Replaces the sequential all-provider iteration with a setup mode picker:
quick (tier-1 only), full (all providers), or just show status. Displays
environment key detection, config file status, and provider tier summary
before prompting.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

## Task 6: Refactor tools.ts — Subcommand Dispatch

**Files:**
- Modify: `src/commands/tools.ts`
- Modify: `tests/commands/tools.test.ts`

- [ ] **Step 1: Update existing tests for subcommand-style args**

Replace the contents of `tests/commands/tools.test.ts`:

```typescript
import * as fs from "node:fs";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createToolsCommand } from "../../src/commands/tools.ts";
import { getConfigPath } from "../../src/config.ts";
import { ProviderRegistry } from "../../src/providers/registry.ts";
import type { ProviderTier, SearchProvider } from "../../src/providers/types.ts";
import { makeCtx } from "../helpers.ts";

vi.mock("node:fs");

const mem = () => new ProviderRegistry({ load: () => ({}), save: () => {} });

function mockProvider(name: string, label: string): SearchProvider {
  return {
    name,
    label,
    search: vi.fn().mockResolvedValue([]),
  };
}

describe("tools status subcommand", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
  });

  it("displays provider status table with metrics", async () => {
    const registry = mem();
    const brave = mockProvider("brave", "Brave");
    const exa = mockProvider("exa", "Exa");
    const ddg = mockProvider("duckduckgo", "DuckDuckGo");

    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });
    registry.registerSearch(exa, { tier: 1, monthlyQuota: 1000 });
    registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

    registry.recordOutcome("brave", { success: true, latencyMs: 340 });
    registry.recordOutcome("brave", { success: true, latencyMs: 340 });
    registry.recordOutcome("brave", { success: false });
    registry.recordOutcome("exa", { success: true, latencyMs: 520 });

    const tierMap = new Map<string, ProviderTier>([
      ["brave", 1],
      ["exa", 1],
      ["duckduckgo", 3],
    ]);

    const command = createToolsCommand(registry, tierMap);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("status", ctx);

    expect(ctx.ui.notify).toHaveBeenCalled();
    const output = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;

    expect(output).toContain("brave");
    expect(output).toContain("exa");
    expect(output).toContain("duckduckgo");
    expect(output).toContain("1");
    expect(output).toContain("3");
    expect(output).toContain("2/1");
    expect(output).toContain("1,997");
    expect(output).toMatch(/unlimited/i);
  });

  it("shows -- for avg latency when no successful calls", async () => {
    const registry = mem();
    const ddg = mockProvider("duckduckgo", "DuckDuckGo");
    registry.registerSearch(ddg, { tier: 3, monthlyQuota: null });

    const tierMap = new Map<string, ProviderTier>([["duckduckgo", 3]]);
    const command = createToolsCommand(registry, tierMap);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("status", ctx);

    const output = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(output).toContain("--");
  });

  it("handles empty registry gracefully", async () => {
    const registry = mem();
    const tierMap = new Map<string, ProviderTier>();

    const command = createToolsCommand(registry, tierMap);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("status", ctx);

    expect(ctx.ui.notify).toHaveBeenCalled();
    const output = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(output).toContain("No providers registered");
  });

  it("also accepts legacy --status flag", async () => {
    const registry = mem();
    const brave = mockProvider("brave", "Brave");
    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

    const tierMap = new Map<string, ProviderTier>([["brave", 1]]);
    const command = createToolsCommand(registry, tierMap);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("--status", ctx);

    expect(ctx.ui.notify).toHaveBeenCalled();
    const output = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(output).toContain("brave");
  });
});

describe("tools reload subcommand", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls onReload callback when reload is passed", async () => {
    const registry = mem();
    const brave = mockProvider("brave", "Brave");
    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

    const tierMap = new Map<string, ProviderTier>([["brave", 1]]);
    const onReload = vi.fn();
    const command = createToolsCommand(registry, tierMap, ["brave"], onReload);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("reload", ctx);

    expect(onReload).toHaveBeenCalledTimes(1);
    expect(ctx.ui.notify).toHaveBeenCalled();
    const output = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(output).toContain("brave");
  });

  it("also accepts legacy --reload flag", async () => {
    const registry = mem();
    const brave = mockProvider("brave", "Brave");
    registry.registerSearch(brave, { tier: 1, monthlyQuota: 2000 });

    const tierMap = new Map<string, ProviderTier>([["brave", 1]]);
    const onReload = vi.fn();
    const command = createToolsCommand(registry, tierMap, ["brave"], onReload);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("--reload", ctx);

    expect(onReload).toHaveBeenCalledTimes(1);
  });
});

describe("tools subcommand dispatch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  it("dispatches enable subcommand", async () => {
    const registry = mem();
    const tierMap = new Map<string, ProviderTier>([["brave", 1]]);
    const command = createToolsCommand(registry, tierMap, ["brave"]);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("enable brave", ctx);

    expect(fs.writeFileSync).toHaveBeenCalled();
    const [, writeContent] = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeContent as string);
    expect(written.providers.brave.enabled).toBe(true);
  });

  it("dispatches disable subcommand", async () => {
    const registry = mem();
    const tierMap = new Map<string, ProviderTier>([["brave", 1]]);
    const command = createToolsCommand(registry, tierMap, ["brave"]);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("disable brave", ctx);

    expect(fs.writeFileSync).toHaveBeenCalled();
    const [, writeContent] = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeContent as string);
    expect(written.providers.brave.enabled).toBe(false);
  });

  it("dispatches key subcommand", async () => {
    const registry = mem();
    const tierMap = new Map<string, ProviderTier>([["brave", 1]]);
    const command = createToolsCommand(registry, tierMap, ["brave"]);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("key brave BSA_abc123def456", ctx);

    expect(fs.writeFileSync).toHaveBeenCalled();
    const [, writeContent] = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeContent as string);
    expect(written.providers.brave.apiKey).toBe("BSA_abc123def456");
  });

  it("dispatches default subcommand", async () => {
    const registry = mem();
    const tierMap = new Map<string, ProviderTier>([["exa", 1]]);
    const command = createToolsCommand(registry, tierMap, ["exa"]);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("default exa", ctx);

    expect(fs.writeFileSync).toHaveBeenCalled();
    const [, writeContent] = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeContent as string);
    expect(written.defaultProvider).toBe("exa");
  });

  it("shows usage for unknown subcommand", async () => {
    const registry = mem();
    const tierMap = new Map<string, ProviderTier>();
    const command = createToolsCommand(registry, tierMap, []);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("foobar", ctx);

    const msg = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(msg.toLowerCase()).toContain("unknown");
  });

  it("runs enhanced wizard when no args", async () => {
    const registry = mem();
    const tierMap = new Map<string, ProviderTier>([["brave", 1]]);
    const command = createToolsCommand(registry, tierMap, ["brave"]);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    // User cancels setup mode selection
    vi.mocked(ctx.ui.select).mockResolvedValueOnce(undefined);

    await command.handler("", ctx);

    // Should have shown preamble via notify and prompted via select
    expect(ctx.ui.notify).toHaveBeenCalled();
    expect(ctx.ui.select).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Refactor tools.ts handler to use subcommand dispatch**

Replace the contents of `src/commands/tools.ts`:

```typescript
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ProviderRegistry } from "../providers/registry.ts";
import type { ProviderTier } from "../providers/types.ts";
import {
  parseArgs,
  handleEnable,
  handleDisable,
  handleKey,
  handleDefault,
  handleTest,
} from "./tools-subcommands.ts";
import { handleEnhancedSetup } from "./tools-setup.ts";
import { activityMonitor } from "../monitor/activity-monitor.ts";
import { renderWidgetLines } from "../monitor/widget.ts";

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "unlimited";
  return n.toLocaleString("en-US");
}

export function buildStatusTable(
  registry: ProviderRegistry,
  tierMap: ReadonlyMap<string, ProviderTier>,
): string {
  const names = registry.getSearchProviderNames();
  if (names.length === 0) return "No providers registered.";

  const rows: Array<{
    name: string;
    tier: string;
    remaining: string;
    session: string;
    latency: string;
  }> = [];

  for (const name of names) {
    const tier = tierMap.get(name) ?? 3;
    const remaining = registry.getRemaining(name);
    const metrics = registry.getMetrics(name);

    const successes = metrics?.successes ?? 0;
    const failures = metrics?.failures ?? 0;
    const sessionStr = `${successes}/${failures}`;

    let latencyStr = "--";
    if (metrics && metrics.latencySamples > 0) {
      const avgMs = Math.round(metrics.avgLatency);
      latencyStr = `${avgMs}ms`;
    }

    rows.push({
      name,
      tier: String(tier),
      remaining: formatNumber(remaining),
      session: sessionStr,
      latency: latencyStr,
    });
  }

  const headers = {
    name: "Provider",
    tier: "Tier",
    remaining: "Remaining",
    session: "Session (ok/fail)",
    latency: "Avg Latency",
  };

  const colWidths = {
    name: Math.max(headers.name.length, ...rows.map((r) => r.name.length)),
    tier: Math.max(headers.tier.length, ...rows.map((r) => r.tier.length)),
    remaining: Math.max(headers.remaining.length, ...rows.map((r) => r.remaining.length)),
    session: Math.max(headers.session.length, ...rows.map((r) => r.session.length)),
    latency: Math.max(headers.latency.length, ...rows.map((r) => r.latency.length)),
  };

  const sep = "  ";
  const headerLine = [
    headers.name.padEnd(colWidths.name),
    headers.tier.padEnd(colWidths.tier),
    headers.remaining.padStart(colWidths.remaining),
    headers.session.padStart(colWidths.session),
    headers.latency.padStart(colWidths.latency),
  ].join(sep);

  const divider = "-".repeat(headerLine.length);

  const dataLines = rows.map((r) =>
    [
      r.name.padEnd(colWidths.name),
      r.tier.padEnd(colWidths.tier),
      r.remaining.padStart(colWidths.remaining),
      r.session.padStart(colWidths.session),
      r.latency.padStart(colWidths.latency),
    ].join(sep),
  );

  return [headerLine, divider, ...dataLines].join("\n");
}

const USAGE = `Usage: /tools [subcommand]

Subcommands:
  (no args)          Interactive setup wizard
  status             Show provider status table
  reload             Refresh config from disk
  enable <name>      Enable a provider
  disable <name>     Disable a provider
  key <name> <value> Set API key for a provider
  test [name]        Test provider connection
  default <name>     Set default provider
  monitor [on|off]   Toggle activity monitor widget`;

export function createToolsCommand(
  registry: ProviderRegistry,
  tierMap: ReadonlyMap<string, ProviderTier>,
  allProviderNames?: string[],
  onReload?: () => void,
) {
  let monitorUnsubscribe: (() => void) | null = null;

  return {
    name: "tools",
    description:
      "Manage search/fetch providers. Run with no args for setup wizard, or use subcommands (status, enable, disable, key, test, default, reload, monitor).",

    async handler(args: string, ctx: ExtensionCommandContext) {
      const providers = allProviderNames ?? [];
      const { subcommand, rest } = parseArgs(args);

      // Legacy flag support
      if (subcommand === "--status") {
        ctx.ui.notify(buildStatusTable(registry, tierMap));
        return;
      }
      if (subcommand === "--reload") {
        onReload?.();
        ctx.ui.notify(buildStatusTable(registry, tierMap));
        return;
      }

      switch (subcommand) {
        case "":
          await handleEnhancedSetup(ctx, providers, tierMap);
          break;

        case "status":
          ctx.ui.notify(buildStatusTable(registry, tierMap));
          break;

        case "reload":
          onReload?.();
          ctx.ui.notify(buildStatusTable(registry, tierMap));
          break;

        case "enable":
          handleEnable(ctx, rest[0] ?? "", providers);
          onReload?.();
          break;

        case "disable":
          handleDisable(ctx, rest[0] ?? "", providers);
          onReload?.();
          break;

        case "key":
          handleKey(ctx, rest[0] ?? "", rest[1], providers);
          onReload?.();
          break;

        case "test":
          await handleTest(ctx, rest[0], registry);
          break;

        case "default":
          handleDefault(ctx, rest[0] ?? "", providers);
          onReload?.();
          break;

        case "monitor": {
          const action = rest[0];
          if (action === "on") {
            monitorUnsubscribe?.();
            // Subscribe: re-render widget on every activity update
            monitorUnsubscribe = activityMonitor.onUpdate(() => {
              const lines = renderWidgetLines(activityMonitor.getEntries(), ctx.ui.theme);
              ctx.ui.setWidget("pi-tools-activity", lines);
            });
            // Initial render
            const lines = renderWidgetLines(activityMonitor.getEntries(), ctx.ui.theme);
            ctx.ui.setWidget("pi-tools-activity", lines);
            ctx.ui.notify("Activity monitor enabled");
          } else if (action === "off") {
            monitorUnsubscribe?.();
            monitorUnsubscribe = null;
            ctx.ui.setWidget("pi-tools-activity", undefined);
            ctx.ui.notify("Activity monitor disabled");
          } else {
            ctx.ui.notify("Usage: /tools monitor [on|off]");
          }
          break;
        }

        default:
          ctx.ui.notify(
            `Unknown subcommand "${subcommand}".\n\n${USAGE}`,
          );
      }
    },

    /** Called during session lifecycle to clean up monitor state. */
    resetMonitor(): void {
      monitorUnsubscribe?.();
      monitorUnsubscribe = null;
      activityMonitor.clear();
    },
  };
}
```

> **Changes from original plan:**
> - Import `renderWidgetLines` instead of `updateWidget`/`removeWidget` — widget.ts is now a pure formatting module
> - Monitor "on" builds `string[]` via `renderWidgetLines` and passes to `ctx.ui.setWidget(key, lines)`
> - Monitor "off" passes `undefined` to `ctx.ui.setWidget` (removes widget)
> - Theme accessed via `ctx.ui.theme` directly (public property, no cast needed)
> - Removed unused `SUBCOMMANDS` array

- [ ] **Step 3: Run all tools tests to verify they pass**

```bash
pnpm vitest run tests/commands/
```

Expected: all tests in `tests/commands/tools.test.ts`, `tests/commands/tools-subcommands.test.ts`, and `tests/commands/tools-setup.test.ts` PASS.

- [ ] **Step 4: Run full test suite to verify no regressions**

```bash
pnpm test
```

Expected: all existing tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/tools.ts tests/commands/tools.test.ts
git commit -m "refactor: convert /tools from flag-based to subcommand dispatch

The handler now parses 'enable brave', 'key brave BSA_xxx', etc. via
parseArgs(). Legacy --status and --reload flags still work. No-arg
invocation runs the enhanced wizard. Unknown subcommands show a usage
message listing all available subcommands.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

## Task 7: Session Lifecycle + Monitor Integration in index.ts

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add session lifecycle hooks for the activity monitor**

In `src/index.ts`, update the import for `createToolsCommand` and add session lifecycle handling. After the existing `session_start` handler (around line 47), add the monitor reset logic.

Add at the top of the file (new imports):

```typescript
import { activityMonitor } from "./monitor/activity-monitor.ts";
```

After the tools command registration (after line 151), capture the return value and add lifecycle hooks:

Replace lines 143-151:

```typescript
  // Register /tools command
  const allProviderNames = allProviders.map((m) => m.name);
  const toolsCommand = createToolsCommand(registry, tierMap, allProviderNames, () =>
    configManager.refresh(true),
  );
  pi.registerCommand(toolsCommand.name, {
    description: toolsCommand.description,
    handler: toolsCommand.handler,
  });
```

with:

```typescript
  // Register /tools command
  const allProviderNames = allProviders.map((m) => m.name);
  const toolsCommand = createToolsCommand(registry, tierMap, allProviderNames, () =>
    configManager.refresh(true),
  );
  pi.registerCommand(toolsCommand.name, {
    description: toolsCommand.description,
    handler: toolsCommand.handler,
  });

  // Session lifecycle: reset activity monitor on session boundaries
  pi.on("session_shutdown", () => {
    toolsCommand.resetMonitor();
  });
```

- [ ] **Step 2: Run index tests to verify no regressions**

```bash
pnpm vitest run tests/index.test.ts
```

Expected: all tests PASS.

- [ ] **Step 3: Run full test suite**

```bash
pnpm test
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire activity monitor lifecycle to session events

Reset the activity monitor and unsubscribe widget listeners on
session_shutdown to prevent stale state across sessions.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

## Task 8: Monitor Subcommand Integration Tests

**Files:**
- Add to: `tests/commands/tools.test.ts`

- [ ] **Step 1: Add monitor subcommand tests to tools.test.ts**

Append the following `describe` block to `tests/commands/tools.test.ts`:

```typescript
describe("tools monitor subcommand", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("monitor on subscribes and shows notification", async () => {
    const registry = mem();
    const tierMap = new Map<string, ProviderTier>();
    const command = createToolsCommand(registry, tierMap);
    // makeCtx() doesn't include setWidget — add it manually
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    (ctx.ui as any).setWidget = vi.fn();
    (ctx.ui as any).theme = { fg: (_c: string, t: string) => t };

    await command.handler("monitor on", ctx);

    const msg = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(msg.toLowerCase()).toContain("enabled");
    expect((ctx.ui as any).setWidget).toHaveBeenCalledWith(
      "pi-tools-activity",
      expect.arrayContaining([expect.any(String)]),
    );
  });

  it("monitor off removes widget and shows notification", async () => {
    const registry = mem();
    const tierMap = new Map<string, ProviderTier>();
    const command = createToolsCommand(registry, tierMap);
    // makeCtx() doesn't include setWidget — add it manually
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    (ctx.ui as any).setWidget = vi.fn();
    (ctx.ui as any).theme = { fg: (_c: string, t: string) => t };

    // First turn on
    await command.handler("monitor on", ctx);
    // Then turn off
    await command.handler("monitor off", ctx);

    const lastCall = (ctx.ui as any).setWidget.mock.calls.at(-1);
    expect(lastCall[0]).toBe("pi-tools-activity");
    expect(lastCall[1]).toBeUndefined();

    const notifyCalls = vi.mocked(ctx.ui.notify).mock.calls;
    const lastNotify = notifyCalls.at(-1)?.[0] as string;
    expect(lastNotify.toLowerCase()).toContain("disabled");
  });

  it("monitor without on/off shows usage", async () => {
    const registry = mem();
    const tierMap = new Map<string, ProviderTier>();
    const command = createToolsCommand(registry, tierMap);
    const ctx = makeCtx() as unknown as ExtensionCommandContext;

    await command.handler("monitor", ctx);

    const msg = vi.mocked(ctx.ui.notify).mock.calls[0][0] as string;
    expect(msg.toLowerCase()).toContain("usage");
  });

  it("resetMonitor clears entries and unsubscribes", async () => {
    const registry = mem();
    const tierMap = new Map<string, ProviderTier>();
    const command = createToolsCommand(registry, tierMap);
    // makeCtx() doesn't include setWidget — add it manually
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    (ctx.ui as any).setWidget = vi.fn();
    (ctx.ui as any).theme = { fg: (_c: string, t: string) => t };

    // Turn on monitor
    await command.handler("monitor on", ctx);
    // Reset
    command.resetMonitor();

    // Monitor should be disconnected — new events should not trigger setWidget
    const callCountBefore = (ctx.ui as any).setWidget.mock.calls.length;
    const { activityMonitor } = await import("../../src/monitor/activity-monitor.ts");
    activityMonitor.logStart({ type: "api", query: "after-reset" });
    const callCountAfter = (ctx.ui as any).setWidget.mock.calls.length;
    expect(callCountAfter).toBe(callCountBefore);
  });
});
```

- [ ] **Step 2: Run all command tests**

```bash
pnpm vitest run tests/commands/
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/commands/tools.test.ts
git commit -m "test: add integration tests for /tools monitor subcommand

Tests monitor on (widget created), monitor off (widget removed), usage
hint for bare 'monitor', and resetMonitor() disconnecting listeners.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

## Task 9: Typecheck + Full Test Suite + Final Verification

- [ ] **Step 1: Run typecheck**

```bash
pnpm run typecheck
```

Expected: no type errors.

- [ ] **Step 2: Run full test suite**

```bash
pnpm test
```

Expected: all tests PASS including new tests in:
- `tests/monitor/activity-monitor.test.ts`
- `tests/monitor/widget.test.ts`
- `tests/commands/tools-subcommands.test.ts`
- `tests/commands/tools-setup.test.ts`
- `tests/commands/tools.test.ts` (updated)

- [ ] **Step 3: Verify new file count matches plan**

```bash
# New source files (4)
ls -la src/monitor/activity-monitor.ts src/monitor/widget.ts src/commands/tools-subcommands.ts src/commands/tools-setup.ts

# New test files (4)
ls -la tests/monitor/activity-monitor.test.ts tests/monitor/widget.test.ts tests/commands/tools-subcommands.test.ts tests/commands/tools-setup.test.ts

# Modified files (3)
git diff --name-only HEAD~7
```

Expected:
- 4 new source files
- 4 new test files
- 3 modified files (`src/commands/tools.ts`, `src/index.ts`, `tests/commands/tools.test.ts`)

- [ ] **Step 4: Final commit (if any fixups needed)**

```bash
# Only if typecheck or test failures required fixes
git add -A
git commit -m "fix: resolve typecheck/test issues from Phase 5

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

**Phase 5 complete.** The `/tools` command now supports composable subcommands (`enable`, `disable`, `key`, `test`, `default`, `monitor`, `status`, `reload`), an enhanced setup wizard with diagnostic preamble and tiered quick-setup, and a real-time activity monitor widget toggled via `/tools monitor on|off`.
