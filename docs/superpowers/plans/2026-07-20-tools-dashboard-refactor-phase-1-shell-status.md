# /tools Dashboard Refactor Phase 1: Shell and Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/tools` with no arguments open a tested `/usage`-style Status overlay while preserving every existing typed subcommand.

**Architecture:** Port the two rendering primitives from `pi-usage`, add a small Status-only `Component`, and route only the empty-argument command path through `ctx.ui.custom()`. Keep the old setup/subcommand modules intact so this phase is independently releasable and reversible.

**Tech Stack:** TypeScript, `@earendil-works/pi-tui`, `@earendil-works/pi-coding-agent`, Vitest, Biome.

**Prerequisite:** Start from the commit containing `docs/superpowers/specs/2026-07-20-tools-dashboard-refactor-design.md`. This phase intentionally implements only the shell and Status vertical slice from the parent plan.

**Usable result:** `/tools` opens a centered Status dashboard with reload and close controls. `/tools status`, `/tools monitor on`, and all other existing subcommands continue to work.

---

## File map

- Create `src/tui/dashboard-theme.ts`: local Pi theme adapter and ANSI-safe text helpers copied from `pi-usage`.
- Create `src/tui/overlay-render.ts`: local heavy frame and overflow-safe tab pill renderer copied from `pi-usage`.
- Create `src/commands/tools-dashboard.ts`: Status-only dashboard component and action contract.
- Create `tests/tui/dashboard-theme.test.ts`: theme helper regressions.
- Create `tests/tui/overlay-render.test.ts`: shell parity and width regressions.
- Create `tests/commands/tools-dashboard.test.ts`: Status rendering and key behavior.
- Modify `src/commands/tools.ts`: route empty arguments into the overlay; retain legacy dispatch for non-empty arguments.
- Modify `tests/commands/tools.test.ts`: command overlay/non-UI/reload coverage while preserving existing subcommand tests.

---

### Task 1: Port and verify the overlay shell

**Files:**
- Create: `src/tui/dashboard-theme.ts`
- Create: `src/tui/overlay-render.ts`
- Create: `tests/tui/dashboard-theme.test.ts`
- Create: `tests/tui/overlay-render.test.ts`

- [ ] **Step 1: Copy the reference modules locally**

```bash
mkdir -p src/tui tests/tui
cp /Users/lanh/Developer/pi-vault/pi-usage/src/tui/dashboard-theme.ts src/tui/dashboard-theme.ts
cp /Users/lanh/Developer/pi-vault/pi-usage/src/tui/overlay-render.ts src/tui/overlay-render.ts
```

In `src/tui/dashboard-theme.ts`, extend `DashboardColor` after `"text"` with the roles needed by later dashboard phases:

```ts
  | "success"
  | "error"
  | "warning";
```

Do not change the algorithms or add a `pi-usage` import. The copied modules must import only installed Pi packages and local files.

- [ ] **Step 2: Add focused helper tests**

Create `tests/tui/dashboard-theme.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  noTheme,
  padVisible,
  truncateVisible,
  wrapVisible,
} from "../../src/tui/dashboard-theme.ts";

describe("dashboard theme helpers", () => {
  it("provides every tools status color through the passthrough theme", () => {
    expect(noTheme.fg("success", "ok")).toBe("ok");
    expect(noTheme.fg("error", "bad")).toBe("bad");
    expect(noTheme.fg("warning", "warn")).toBe("warn");
    expect(noTheme.bg("selectedBg", "selected")).toBe("selected");
  });

  it("pads, truncates, and wraps visible text", () => {
    expect(padVisible("x", 3)).toBe("x  ");
    expect(truncateVisible("abcdef", 3)).toHaveLength(3);
    expect(wrapVisible("one two three", 7).every((line) => line.length <= 7)).toBe(true);
  });
});
```

Create `tests/tui/overlay-render.test.ts`:

```ts
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { noTheme } from "../../src/tui/dashboard-theme.ts";
import {
  frame,
  frameContentWidth,
  pad,
  renderTabBar,
} from "../../src/tui/overlay-render.ts";

describe("tools overlay shell", () => {
  it("pads and truncates by visible width", () => {
    expect(pad("hi", 5)).toBe("hi   ");
    expect(visibleWidth(pad("hello world", 5))).toBe(5);
  });

  it("calculates frame content width", () => {
    expect(frameContentWidth(20)).toBe(14);
    expect(frameContentWidth(0)).toBe(1);
  });

  it("renders the heavy frame within the supplied width", () => {
    for (const width of [20, 40, 80]) {
      const lines = frame(["hello"], width, noTheme);
      expect(lines[0]).toContain("┏");
      expect(lines.at(-1)).toContain("┛");
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
    }
  });

  it("renders an active Status pill", () => {
    const line = renderTabBar(
      [{ id: "status", label: "Status" }],
      "status",
      40,
      noTheme,
    );
    expect(line).toContain("Status");
    expect(visibleWidth(line)).toBe(40);
  });
});
```

- [ ] **Step 3: Run the shell tests**

```bash
pnpm exec vitest run tests/tui/dashboard-theme.test.ts tests/tui/overlay-render.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Commit the shell**

```bash
git add src/tui tests/tui
git commit -m "feat: add tools dashboard rendering shell"
```

---

### Task 2: Add the Status dashboard component

**Files:**
- Create: `src/commands/tools-dashboard.ts`
- Create: `tests/commands/tools-dashboard.test.ts`

- [ ] **Step 1: Write failing component tests**

Create `tests/commands/tools-dashboard.test.ts`:

```ts
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { ToolsDashboardComponent } from "../../src/commands/tools-dashboard.ts";
import { noTheme } from "../../src/tui/dashboard-theme.ts";

function dashboard(done = vi.fn()) {
  const tui = { requestRender: vi.fn() } as never;
  return {
    done,
    tui,
    component: new ToolsDashboardComponent({
      tui,
      theme: noTheme,
      renderStatusTable: () => "Provider  Tier\nbrave    1",
      done,
    }),
  };
}

describe("ToolsDashboardComponent status slice", () => {
  it("renders the Status tab and existing status table", () => {
    const output = dashboard().component.render(80).join("\n");
    expect(output).toContain("Status");
    expect(output).toContain("Provider");
    expect(output).toContain("brave");
    expect(output).toContain("┏");
    expect(output).toContain("┛");
  });

  it.each([40, 80, 140])("keeps every line within width %i", (width) => {
    expect(
      dashboard().component.render(width).every((line) => visibleWidth(line) <= width),
    ).toBe(true);
  });

  it("returns reload for r", () => {
    const { component, done } = dashboard();
    component.handleInput("r");
    expect(done).toHaveBeenCalledWith({ type: "reload" });
  });

  it("returns close for q and Escape", () => {
    const first = dashboard();
    first.component.handleInput("q");
    expect(first.done).toHaveBeenCalledWith({ type: "close" });

    const second = dashboard();
    second.component.handleInput("\u001b");
    expect(second.done).toHaveBeenCalledWith({ type: "close" });
  });
});
```

- [ ] **Step 2: Confirm the test fails**

```bash
pnpm exec vitest run tests/commands/tools-dashboard.test.ts
```

Expected: FAIL because `tools-dashboard.ts` does not exist.

- [ ] **Step 3: Implement the minimal Status component**

Create `src/commands/tools-dashboard.ts` with these public contracts:

```ts
import { Key, matchesKey, type Component, type TUI } from "@earendil-works/pi-tui";
import type { DashboardTheme } from "../tui/dashboard-theme.ts";
import { wrapVisible } from "../tui/dashboard-theme.ts";
import { frame, frameContentWidth, renderTabBar } from "../tui/overlay-render.ts";

export type DashboardAction = { type: "reload" } | { type: "close" };

export interface DashboardOptions {
  tui: TUI;
  theme: DashboardTheme;
  renderStatusTable: () => string;
  done: (action: DashboardAction) => void;
}

const TABS = [{ id: "status", label: "Status" }] as const;

export class ToolsDashboardComponent implements Component {
  private disposed = false;

  constructor(private readonly options: DashboardOptions) {}

  render(width: number): string[] {
    const contentWidth = frameContentWidth(width);
    const status = this.options
      .renderStatusTable()
      .split("\n")
      .flatMap((line) => wrapVisible(line, contentWidth));
    return frame(
      [
        renderTabBar([...TABS], "status", contentWidth, this.options.theme),
        "",
        ...status,
        "",
        this.options.theme.dim("r Reload • q Close"),
      ],
      width,
      this.options.theme,
    );
  }

  handleInput(data: string): void {
    if (data === "q" || matchesKey(data, Key.escape)) {
      this.finish({ type: "close" });
      return;
    }
    if (data === "r") this.finish({ type: "reload" });
  }

  invalidate(): void {}

  dispose(): void {
    this.disposed = true;
  }

  private finish(action: DashboardAction): void {
    if (this.disposed) return;
    this.dispose();
    this.options.done(action);
  }
}
```

This is deliberately one tab. Do not add unavailable Providers/Test/Activity tabs.

- [ ] **Step 4: Run component tests**

```bash
pnpm exec vitest run tests/commands/tools-dashboard.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit the component**

```bash
git add src/commands/tools-dashboard.ts tests/commands/tools-dashboard.test.ts
git commit -m "feat: add tools status dashboard"
```

---

### Task 3: Route empty `/tools` invocations into the overlay

**Files:**
- Modify: `src/commands/tools.ts`
- Modify: `tests/commands/tools.test.ts`

- [ ] **Step 1: Add command-level tests**

Add tests that provide `ctx.ui.custom = vi.fn()` explicitly:

```ts
it("opens the Status overlay for an empty argument string", async () => {
  const registry = mem();
  const command = createToolsCommand(registry, new Map());
  const ctx = makeCtx() as unknown as ExtensionCommandContext;
  const custom = vi.fn().mockResolvedValue({ type: "close" });
  (ctx.ui as any).custom = custom;

  await command.handler("", ctx);

  expect(custom).toHaveBeenCalledWith(expect.any(Function), {
    overlay: true,
    overlayOptions: { anchor: "center", maxHeight: "85%", width: "92%" },
  });
  expect(ctx.ui.select).not.toHaveBeenCalled();
});

it("reloads and reopens the Status overlay", async () => {
  const reload = vi.fn();
  const command = createToolsCommand(mem(), new Map(), [], reload);
  const ctx = makeCtx() as unknown as ExtensionCommandContext;
  const custom = vi
    .fn()
    .mockResolvedValueOnce({ type: "reload" })
    .mockResolvedValueOnce({ type: "close" });
  (ctx.ui as any).custom = custom;

  await command.handler("", ctx);

  expect(reload).toHaveBeenCalledOnce();
  expect(custom).toHaveBeenCalledTimes(2);
});

it("warns instead of opening the overlay without UI", async () => {
  const command = createToolsCommand(mem(), new Map());
  const ctx = makeCtx({ hasUI: false }) as unknown as ExtensionCommandContext;
  (ctx.ui as any).custom = vi.fn();

  await command.handler("", ctx);

  expect((ctx.ui as any).custom).not.toHaveBeenCalled();
  expect(ctx.ui.notify).toHaveBeenCalledWith(
    expect.stringContaining("interactive UI"),
    "warning",
  );
});
```

Keep the existing `status`, `reload`, provider mutation, test, and monitor subcommand tests unchanged. They prove this phase does not remove behavior early.

- [ ] **Step 2: Run the focused command tests and verify failure**

```bash
pnpm exec vitest run tests/commands/tools.test.ts
```

Expected: the new empty-argument tests fail because the setup wizard still runs.

- [ ] **Step 3: Add the overlay branch before legacy parsing**

Import `fromPiTheme`, `ToolsDashboardComponent`, and `DashboardAction`. At the start of `handler`, before `parseArgs(args)`, implement:

```ts
if (args.trim() === "") {
  if (!ctx.hasUI) {
    ctx.ui.notify("/tools requires interactive UI", "warning");
    return;
  }
  while (true) {
    const action = await ctx.ui.custom<DashboardAction>(
      (tui, theme, _keybindings, done) =>
        new ToolsDashboardComponent({
          tui,
          theme: fromPiTheme(theme),
          renderStatusTable: () => buildStatusTable(registry, tierMap),
          done,
        }),
      {
        overlay: true,
        overlayOptions: { anchor: "center", maxHeight: "85%", width: "92%" },
      },
    );
    if (!action || action.type === "close") return;
    onReload?.();
  }
}
```

Remove only the now-unreachable `case "": await handleEnhancedSetup(...)` branch and its `handleEnhancedSetup` import. Keep `tools-setup.ts` because it is deleted only in Phase 4 with the rest of the legacy implementation. Update the command description to state that no arguments open the Status dashboard while typed subcommands remain available.

- [ ] **Step 4: Run focused and full tests**

```bash
pnpm exec vitest run tests/commands/tools-dashboard.test.ts tests/commands/tools.test.ts
pnpm check
```

Expected: all checks pass, including existing typed-subcommand tests.

- [ ] **Step 5: Commit the command slice**

```bash
git add src/commands/tools.ts tests/commands/tools.test.ts
git commit -m "feat: open tools status overlay"
```

---

### Task 4: Phase verification

- [ ] **Step 1: Verify imports and dependencies**

```bash
grep -RIn --include='*.ts' 'pi-usage' src || true
git diff -- package.json pnpm-lock.yaml
```

Expected: no runtime `pi-usage` imports and no dependency changes.

- [ ] **Step 2: Verify this phase did not remove legacy commands**

```bash
test -f src/commands/tools-subcommands.ts
test -f src/commands/tools-setup.ts
pnpm check
```

Expected: both files exist and `pnpm check` passes.
