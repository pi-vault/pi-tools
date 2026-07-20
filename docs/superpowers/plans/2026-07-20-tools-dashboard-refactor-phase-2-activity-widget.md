# /tools Dashboard Refactor Phase 2: Activity and Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Activity tab and a persistent, leak-free activity widget to the Phase 1 dashboard.

**Architecture:** Extend the dashboard with a second tab that reads the existing `activityMonitor`. The component owns only its short-lived repaint subscription; `tools.ts` remains the sole owner of the persistent widget subscription and clears it during `session_shutdown`.

**Tech Stack:** TypeScript, Pi TUI, existing `activityMonitor`/widget renderer, Vitest.

**Prerequisite:** Phase 1 is implemented and `pnpm check` passes.

**Usable result:** `/tools` displays live recent activity and can toggle the activity widget with `w`. Closing the overlay preserves the widget; session shutdown removes it. Existing typed subcommands still work.

---

## File map

- Modify `src/commands/tools-dashboard.ts`: add Status/Activity navigation, activity rendering, repaint subscription, and `toggle-widget` action.
- Modify `src/monitor/widget.ts`: narrow its testable theme contract to the four roles it actually consumes.
- Modify `src/commands/tools.ts`: consolidate dashboard and legacy monitor paths behind one persistent widget owner.
- Modify `tests/commands/tools-dashboard.test.ts`: activity bounds, navigation, repaint, and disposal.
- Modify `tests/commands/tools.test.ts`: widget persistence, single subscription, and shutdown cleanup.

---

### Task 1: Add the Activity tab

**Files:**
- Modify: `src/commands/tools-dashboard.ts`
- Modify: `src/monitor/widget.ts`
- Modify: `tests/commands/tools-dashboard.test.ts`

- [ ] **Step 1: Add failing Activity tests**

Extend the dashboard fixture with:

```ts
import type { ActivityEntry } from "../../src/monitor/activity-monitor.ts";

function dashboard(
  done = vi.fn(),
  activity: readonly ActivityEntry[] = [],
  subscribeActivity = vi.fn(() => vi.fn()),
) {
  const tui = { requestRender: vi.fn() } as never;
  return {
    done,
    tui,
    subscribeActivity,
    component: new ToolsDashboardComponent({
      tui,
      theme: noTheme,
      renderStatusTable: () => "Provider  Tier\nbrave    1",
      getActivity: () => activity,
      subscribeActivity,
      widgetEnabled: false,
      done,
    }),
  };
}
```

Add these cases:

```ts
it("switches between Status and Activity with Tab and Shift-Tab", () => {
  const { component, tui } = dashboard();
  component.handleInput("\t");
  expect(component.render(80).join("\n")).toContain("Activity");
  expect(tui.requestRender).toHaveBeenCalled();

  component.handleInput("\u001b[Z");
  expect(component.render(80).join("\n")).toContain("Status");
});

it("renders only the latest ten activity entries", () => {
  const entries = Array.from({ length: 11 }, (_, index) => ({
    id: String(index),
    type: "api" as const,
    startTime: 0,
    status: 200,
    query: `query-${index}`,
  }));
  const { component } = dashboard(vi.fn(), entries);
  component.handleInput("\t");
  const output = component.render(140).join("\n");
  expect(output).not.toContain("query-0");
  expect(output).toContain("query-10");
});

it("returns toggle-widget for w on Activity", () => {
  const { component, done } = dashboard();
  component.handleInput("\t");
  component.handleInput("w");
  expect(done).toHaveBeenCalledWith({ type: "toggle-widget" });
});

it("repaints on activity and unsubscribes on disposal", () => {
  let listener: (() => void) | undefined;
  const unsubscribe = vi.fn();
  const subscribe = vi.fn((next: () => void) => {
    listener = next;
    return unsubscribe;
  });
  const { component, tui } = dashboard(vi.fn(), [], subscribe);

  listener?.();
  expect(tui.requestRender).toHaveBeenCalled();
  component.dispose();
  expect(unsubscribe).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run the tests and verify failure**

```bash
pnpm exec vitest run tests/commands/tools-dashboard.test.ts
```

Expected: the new Activity tests fail.

- [ ] **Step 3: Narrow the existing widget theme contract**

In `src/monitor/widget.ts`, replace the broad `ThemeColor` dependency with the roles actually used:

```ts
export interface ThemeLike {
  fg: (
    color: "accent" | "muted" | "success" | "error",
    text: string,
  ) => string;
}
```

Remove the now-unused `ThemeColor` import. This lets both Pi's live theme and `DashboardTheme` satisfy the renderer without a cast.

- [ ] **Step 4: Extend the dashboard contracts and behavior**

Add to `DashboardAction`:

```ts
| { type: "toggle-widget" }
```

Add to `DashboardOptions`:

```ts
getActivity: () => readonly ActivityEntry[];
subscribeActivity: (listener: () => void) => () => void;
widgetEnabled: boolean;
```

Use these tabs:

```ts
type DashboardTabId = "status" | "activity";
const TABS = [
  { id: "status", label: "Status" },
  { id: "activity", label: "Activity" },
] satisfies DashboardTab[];
const SHIFT_TAB_KEY: "shift+tab" = "shift+tab";
```

Add `activeTab`, `activityUnsubscribe`, and this constructor subscription:

```ts
this.activityUnsubscribe = options.subscribeActivity(() => {
  options.tui.requestRender();
});
```

Implement tab navigation with `matchesKey(data, Key.tab)` and `matchesKey(data, SHIFT_TAB_KEY)`, wrapping in both directions and calling `tui.requestRender()` after the index changes. On Activity, `w` calls the existing `finish()` helper with `{ type: "toggle-widget" }`.

Render Activity with:

```ts
private renderActivity(contentWidth: number): string[] {
  const entries = this.options.getActivity().slice(-10);
  if (entries.length === 0) return [this.options.theme.dim("No activity yet")];
  return entries.map((entry) =>
    truncateVisible(formatEntryLine(entry, this.options.theme), contentWidth),
  );
}
```

The footer must show `w Enable widget` or `w Disable widget` from `widgetEnabled`. `dispose()` must call `activityUnsubscribe?.()` once and clear the field before marking the component disposed.

- [ ] **Step 5: Run focused tests**

```bash
pnpm exec vitest run tests/commands/tools-dashboard.test.ts tests/monitor/widget.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit the Activity component**

```bash
git add src/commands/tools-dashboard.ts src/monitor/widget.ts tests/commands/tools-dashboard.test.ts
git commit -m "feat: add tools activity dashboard tab"
```

---

### Task 2: Consolidate persistent widget ownership

**Files:**
- Modify: `src/commands/tools.ts`
- Modify: `tests/commands/tools.test.ts`

- [ ] **Step 1: Add failing widget lifecycle tests**

Add a `ctx` fixture with typed mock-compatible members:

```ts
function widgetCtx() {
  const ctx = makeCtx() as unknown as ExtensionCommandContext;
  (ctx.ui as any).custom = vi.fn();
  (ctx.ui as any).setWidget = vi.fn();
  (ctx.ui as any).theme = { fg: (_color: string, text: string) => text };
  return ctx;
}
```

Add tests that drive the dashboard through the values returned by `custom`:

```ts
it("keeps a dashboard-enabled widget after overlay close", async () => {
  const ctx = widgetCtx();
  (ctx.ui as any).custom
    .mockResolvedValueOnce({ type: "toggle-widget" })
    .mockResolvedValueOnce({ type: "close" });
  const command = createToolsCommand(mem(), new Map());

  await command.handler("", ctx);

  expect((ctx.ui as any).setWidget).toHaveBeenCalledWith(
    "pi-tools-activity",
    expect.any(Array),
  );
  expect((ctx.ui as any).setWidget.mock.calls.at(-1)?.[1]).toEqual(expect.any(Array));
});

it("uses one widget subscription across overlay reopen", async () => {
  const ctx = widgetCtx();
  (ctx.ui as any).custom
    .mockResolvedValueOnce({ type: "toggle-widget" })
    .mockResolvedValueOnce({ type: "close" });
  const command = createToolsCommand(mem(), new Map());
  await command.handler("", ctx);

  const before = (ctx.ui as any).setWidget.mock.calls.length;
  activityMonitor.logStart({ type: "api", query: "one" });
  expect((ctx.ui as any).setWidget.mock.calls.length).toBe(before + 1);
});

it("resetMonitor unsubscribes, clears the widget, and clears entries", async () => {
  const ctx = widgetCtx();
  (ctx.ui as any).custom
    .mockResolvedValueOnce({ type: "toggle-widget" })
    .mockResolvedValueOnce({ type: "close" });
  const command = createToolsCommand(mem(), new Map());
  await command.handler("", ctx);
  command.resetMonitor();

  expect((ctx.ui as any).setWidget).toHaveBeenLastCalledWith(
    "pi-tools-activity",
    undefined,
  );
  expect(activityMonitor.getEntries()).toEqual([]);
});
```

Clear `activityMonitor` in `beforeEach`/`afterEach` so tests do not share entries.

- [ ] **Step 2: Run command tests and verify failure**

```bash
pnpm exec vitest run tests/commands/tools.test.ts
```

Expected: dashboard widget lifecycle cases fail.

- [ ] **Step 3: Create one command-closure widget owner**

Replace `monitorUnsubscribe` with closure state shared by legacy monitor dispatch and the dashboard:

```ts
let widgetEnabled = false;
let widgetUnsubscribe: (() => void) | undefined;
let widgetContext: ExtensionCommandContext | undefined;

const clearWidget = (): void => {
  widgetUnsubscribe?.();
  widgetUnsubscribe = undefined;
  widgetContext?.ui.setWidget("pi-tools-activity", undefined);
  widgetContext = undefined;
  widgetEnabled = false;
};

const setWidget = (ctx: ExtensionCommandContext, enabled: boolean): void => {
  if (!enabled) {
    clearWidget();
    return;
  }
  if (widgetUnsubscribe) return;
  widgetEnabled = true;
  widgetContext = ctx;
  const repaint = () => {
    ctx.ui.setWidget(
      "pi-tools-activity",
      renderWidgetLines(activityMonitor.getEntries(), ctx.ui.theme),
    );
  };
  widgetUnsubscribe = activityMonitor.onUpdate(repaint);
  repaint();
};
```

Pass these options into every dashboard instance:

```ts
getActivity: () => activityMonitor.getEntries(),
subscribeActivity: (listener) => activityMonitor.onUpdate(listener),
widgetEnabled,
```

In the dashboard loop, handle `{ type: "toggle-widget" }` before reload:

```ts
if (action.type === "toggle-widget") {
  setWidget(ctx, !widgetEnabled);
  continue;
}
```

Route the still-supported `monitor on|off` subcommand through `setWidget(ctx, true|false)` instead of maintaining a second subscription implementation. Update the existing “monitor on twice” test to assert that the second call adds neither a subscription nor another initial widget render; `setWidget()` is idempotent while enabled.

Implement shutdown cleanup against the same closure state:

```ts
resetMonitor(): void {
  clearWidget();
  activityMonitor.clear();
}
```

Do not clear the widget when the overlay closes.

- [ ] **Step 4: Run focused and full checks**

```bash
pnpm exec vitest run tests/commands/tools-dashboard.test.ts tests/commands/tools.test.ts
pnpm check
```

Expected: all tests pass, including the legacy monitor subcommand tests.

- [ ] **Step 5: Commit widget ownership**

```bash
git add src/commands/tools.ts tests/commands/tools.test.ts
git commit -m "refactor: centralize tools activity widget lifecycle"
```

---

### Task 3: Phase verification

- [ ] **Step 1: Check listener ownership and imports**

```bash
grep -RIn --include='*.ts' 'activityMonitor.onUpdate' src/commands src/monitor
grep -RIn --include='*.ts' 'pi-usage' src || true
```

Expected: one persistent subscription owner in `tools.ts`; the dashboard receives only the short-lived subscription callback; no `pi-usage` import.

- [ ] **Step 2: Verify the releasable checkpoint**

```bash
test -f src/commands/tools-subcommands.ts
test -f src/commands/tools-setup.ts
pnpm check
git status --short
```

Expected: legacy files remain, all checks pass, and the worktree is clean after commits.
