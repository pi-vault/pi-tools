# /tools Dashboard Refactor Phase 2: Activity and Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live Activity tab and one persistent, leak-free activity widget to the Phase 1 dashboard.

**Architecture:** `ToolsDashboardComponent` reads activity through injected getters and owns only its overlay-lifetime repaint subscription. The `createToolsCommand()` closure owns the single persistent widget subscription shared by dashboard and legacy `monitor` paths; `resetMonitor()` removes the widget, unsubscribes, and clears entries.

**Tech Stack:** TypeScript, Pi TUI, existing `activityMonitor`/widget renderer, Vitest, Biome.

**Prerequisite:** Phase 1 is implemented and `pnpm check` passes.

**Usable result:** `/tools` switches between Status and live Activity. `w` toggles the activity widget from Activity, closing the overlay preserves it, and session shutdown removes it. Existing typed subcommands continue to work.

---

## Verified reference behavior

- `pi-usage/src/tui/dashboard.ts` uses `matchesKey(data, Key.tab)` plus `matchesKey(data, "shift+tab")`, wraps tab indexes, and renders through the shared frame/tab helpers already copied in Phase 1.
- Pi's `ExtensionUIContext.custom()` calls `component.dispose()` after the component calls `done()`. The dashboard currently also disposes itself in `finish()`, so Activity cleanup must be idempotent and tested with two disposal paths.
- Pi removes a named widget with `ctx.ui.setWidget(key, undefined)`. Replacing widget lines does not create an activity subscription; subscription ownership remains in `tools.ts`.
- `activityMonitor` already retains at most ten entries. The dashboard still applies `.slice(-10)` at its input boundary so tests and alternate injected sources obey the same limit.

No runtime import or dependency on `pi-usage` is added.

---

## File map

- Modify `src/commands/tools-dashboard.ts`: Status/Activity tabs, activity rendering, contextual keys/footer, repaint subscription, and idempotent disposal.
- Modify `src/monitor/widget.ts`: narrow the renderer theme contract to its four consumed foreground roles.
- Modify `src/commands/tools.ts`: one persistent widget owner shared by dashboard and legacy monitor dispatch.
- Modify `tests/commands/tools-dashboard.test.ts`: tab navigation, bounds, contextual actions, repainting, width, and double-disposal cleanup.
- Modify `tests/commands/tools.test.ts`: widget persistence, idempotent enabling, one subscription, and shutdown cleanup.

---

### Task 1: Add the Activity tab

**Files:**

- Modify: `src/commands/tools-dashboard.ts`
- Modify: `src/monitor/widget.ts`
- Modify: `tests/commands/tools-dashboard.test.ts`

- [ ] **Step 1: Extend the dashboard fixture and add failing behavior tests**

Add type imports for `DashboardTabId` and `ActivityEntry`, then replace the fixture with:

```ts
function dashboard(
  done = vi.fn(),
  activity: readonly ActivityEntry[] = [],
  subscribeActivity = vi.fn((_listener: () => void) => vi.fn()),
  initialTab: DashboardTabId = "status",
  widgetEnabled = false,
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
      widgetEnabled,
      initialTab,
      done,
    }),
  };
}
```

Add these cases while keeping the Phase 1 Status render, width, and close cases:

```ts
it("switches between Status and Activity with Tab and Shift-Tab", () => {
  const { component, tui } = dashboard();

  component.handleInput("\t");
  expect(component.render(80).join("\n")).toContain("Activity");
  expect(tui.requestRender).toHaveBeenCalledTimes(1);

  component.handleInput("\u001b[Z");
  expect(component.render(80).join("\n")).toContain("Status");
  expect(tui.requestRender).toHaveBeenCalledTimes(2);
});

it("renders only the latest ten activity entries", () => {
  const entries = Array.from({ length: 11 }, (_, index) => ({
    id: String(index),
    type: "api" as const,
    startTime: 0,
    endTime: 100,
    status: 200,
    query: `query-${index}`,
  }));
  const { component } = dashboard(vi.fn(), entries, undefined, "activity");
  const output = component.render(140).join("\n");

  expect(output).not.toContain("query-0");
  expect(output).toContain("query-10");
});

it("renders the Activity empty state and current widget action", () => {
  expect(
    dashboard(vi.fn(), [], undefined, "activity", false)
      .component.render(80)
      .join("\n"),
  ).toContain("w Enable widget");
  expect(
    dashboard(vi.fn(), [], undefined, "activity", true)
      .component.render(80)
      .join("\n"),
  ).toContain("w Disable widget");
});

it("returns contextual actions with resume state", () => {
  const status = dashboard();
  status.component.handleInput("r");
  expect(status.done).toHaveBeenCalledWith({
    type: "reload",
    activeTab: "status",
  });

  const activity = dashboard(vi.fn(), [], undefined, "activity");
  activity.component.handleInput("w");
  expect(activity.done).toHaveBeenCalledWith({
    type: "toggle-widget",
    activeTab: "activity",
  });
});

it("ignores tab-specific keys on the other tab", () => {
  const status = dashboard();
  status.component.handleInput("w");
  expect(status.done).not.toHaveBeenCalled();

  const activity = dashboard(vi.fn(), [], undefined, "activity");
  activity.component.handleInput("r");
  expect(activity.done).not.toHaveBeenCalled();
});

it("repaints on activity and unsubscribes once across both disposal paths", () => {
  let listener: (() => void) | undefined;
  const unsubscribe = vi.fn();
  const subscribe = vi.fn((next: () => void) => {
    listener = next;
    return unsubscribe;
  });
  const { component, tui } = dashboard(vi.fn(), [], subscribe);

  listener?.();
  expect(tui.requestRender).toHaveBeenCalledOnce();

  component.handleInput("q"); // finish() disposal
  component.dispose(); // Pi custom() disposal
  expect(unsubscribe).toHaveBeenCalledOnce();

  listener?.();
  expect(tui.requestRender).toHaveBeenCalledOnce();
});

it.each([40, 80, 140])("keeps Activity within width %i", (width) => {
  const entries: ActivityEntry[] = [
    {
      id: "1",
      type: "api",
      startTime: 0,
      endTime: 100,
      status: 200,
      query: "x".repeat(100),
    },
  ];
  expect(
    dashboard(vi.fn(), entries, undefined, "activity")
      .component.render(width)
      .every((line) => visibleWidth(line) <= width),
  ).toBe(true);
});
```

- [ ] **Step 2: Run the dashboard tests and verify red**

```bash
pnpm exec vitest run tests/commands/tools-dashboard.test.ts
```

Expected: the new tab, activity, action-shape, and subscription cases fail against the Status-only component.

- [ ] **Step 3: Narrow the widget renderer's theme contract**

In `src/monitor/widget.ts`, remove the `ThemeColor` import and use the exact roles consumed by this renderer:

```ts
export interface ThemeLike {
  fg: (color: "accent" | "muted" | "success" | "error", text: string) => string;
}
```

Do not change widget formatting in this task.

- [ ] **Step 4: Replace the Status-only dashboard behavior**

In `src/commands/tools-dashboard.ts`:

1. Extend the existing imports with:

```ts
import type { ActivityEntry } from "../monitor/activity-monitor.ts";
import { formatEntryLine } from "../monitor/widget.ts";
import { truncateVisible, wrapVisible } from "../tui/dashboard-theme.ts";
import {
  type DashboardTab,
  frame,
  frameContentWidth,
  renderTabBar,
} from "../tui/overlay-render.ts";
```

Keep the existing Pi TUI and `DashboardTheme` imports, and remove the old standalone `wrapVisible` and overlay-render imports they replace.

2. Replace the action/options/tab contracts with:

```ts
export type DashboardTabId = "status" | "activity";

export type DashboardAction =
  | { type: "reload"; activeTab: DashboardTabId }
  | { type: "toggle-widget"; activeTab: DashboardTabId }
  | { type: "close" };

export interface DashboardOptions {
  tui: TUI;
  theme: DashboardTheme;
  renderStatusTable: () => string;
  getActivity: () => readonly ActivityEntry[];
  subscribeActivity: (listener: () => void) => () => void;
  widgetEnabled: boolean;
  initialTab?: DashboardTabId;
  done: (action: DashboardAction) => void;
}

const TABS = [
  { id: "status", label: "Status" },
  { id: "activity", label: "Activity" },
] satisfies DashboardTab[];
const SHIFT_TAB_KEY: "shift+tab" = "shift+tab";
```

3. Add state and subscribe in the constructor:

```ts
private activeTab: DashboardTabId;
private activityUnsubscribe?: () => void;
private disposed = false;

constructor(private readonly options: DashboardOptions) {
  this.activeTab = options.initialTab ?? "status";
  this.activityUnsubscribe = options.subscribeActivity(() => {
    if (!this.disposed) options.tui.requestRender();
  });
}
```

4. Split content rendering into these methods:

```ts
private renderStatus(contentWidth: number): string[] {
  return this.options
    .renderStatusTable()
    .split("\n")
    .flatMap((line) => wrapVisible(line, contentWidth));
}

private renderActivity(contentWidth: number): string[] {
  const entries = this.options.getActivity().slice(-10);
  if (entries.length === 0) {
    return [this.options.theme.dim("No activity yet")];
  }
  return entries.map((entry) =>
    truncateVisible(formatEntryLine(entry, this.options.theme), contentWidth),
  );
}

private renderFooter(contentWidth: number): string {
  const action =
    this.activeTab === "status"
      ? "r Reload"
      : `w ${this.options.widgetEnabled ? "Disable" : "Enable"} widget`;
  return this.options.theme.dim(
    truncateVisible(`${action} • Tab/Shift-Tab Switch tab • q Close`, contentWidth),
  );
}
```

5. Replace `render()` with:

```ts
render(width: number): string[] {
  const contentWidth = frameContentWidth(width);
  const content =
    this.activeTab === "status"
      ? this.renderStatus(contentWidth)
      : this.renderActivity(contentWidth);
  return frame(
    [
      renderTabBar(TABS, this.activeTab, contentWidth, this.options.theme),
      "",
      ...content,
      "",
      this.renderFooter(contentWidth),
    ],
    width,
    this.options.theme,
  );
}
```

6. Add wrapped navigation and contextual actions:

```ts
private switchTab(delta: number): void {
  const index = TABS.findIndex((tab) => tab.id === this.activeTab);
  this.activeTab = TABS[(index + delta + TABS.length) % TABS.length]
    .id as DashboardTabId;
  this.options.tui.requestRender();
}

handleInput(data: string): void {
  if (data === "q" || matchesKey(data, Key.escape)) {
    this.finish({ type: "close" });
    return;
  }
  if (matchesKey(data, Key.tab)) {
    this.switchTab(1);
    return;
  }
  if (matchesKey(data, SHIFT_TAB_KEY)) {
    this.switchTab(-1);
    return;
  }
  if (this.activeTab === "status" && data === "r") {
    this.finish({ type: "reload", activeTab: this.activeTab });
    return;
  }
  if (this.activeTab === "activity" && data === "w") {
    this.finish({ type: "toggle-widget", activeTab: this.activeTab });
  }
}
```

7. Keep `invalidate()` as a no-op because Pi uses it for render-cache invalidation, not teardown. Make `dispose()` idempotent:

```ts
dispose(): void {
  const unsubscribe = this.activityUnsubscribe;
  this.activityUnsubscribe = undefined;
  unsubscribe?.();
  this.disposed = true;
}
```

Keep the existing guarded `finish()` method. It intentionally disposes before `done()`; Pi's later disposal is safe because the subscription field is cleared first.

- [ ] **Step 5: Run focused tests**

```bash
pnpm exec vitest run tests/commands/tools-dashboard.test.ts tests/monitor/widget.test.ts
```

Expected: all focused tests pass.

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

- [ ] **Step 1: Add tracked cleanup and failing widget lifecycle tests**

In `tests/commands/tools.test.ts`, import `afterEach` and `activityMonitor`. Add a tracked command helper so every test that enables the singleton-backed widget releases its listener:

```ts
const trackedCommands = new Set<ReturnType<typeof createToolsCommand>>();

function trackedToolsCommand(...args: Parameters<typeof createToolsCommand>) {
  const command = createToolsCommand(...args);
  trackedCommands.add(command);
  return command;
}

afterEach(() => {
  for (const command of trackedCommands) command.resetMonitor();
  trackedCommands.clear();
  activityMonitor.clear();
});

function widgetCtx() {
  const ctx = makeCtx() as unknown as ExtensionCommandContext;
  (ctx.ui as any).custom = vi.fn();
  (ctx.ui as any).setWidget = vi.fn();
  (ctx.ui as any).theme = { fg: (_color: string, text: string) => text };
  return ctx;
}
```

Use `trackedToolsCommand()` instead of `createToolsCommand()` in the existing `tools monitor subcommand` tests. Change “monitor on twice” to assert both the subscription and initial render are idempotent:

```ts
it("monitor on twice keeps one subscription and one initial render", async () => {
  const onUpdate = vi.spyOn(activityMonitor, "onUpdate");
  const command = trackedToolsCommand(mem(), new Map());
  const ctx = widgetCtx();

  await command.handler("monitor on", ctx);
  const renders = (ctx.ui as any).setWidget.mock.calls.length;
  await command.handler("monitor on", ctx);

  expect(onUpdate).toHaveBeenCalledOnce();
  expect((ctx.ui as any).setWidget).toHaveBeenCalledTimes(renders);
});
```

Add dashboard lifecycle cases:

```ts
describe("tools dashboard widget lifecycle", () => {
  it("keeps a dashboard-enabled widget after overlay close", async () => {
    const ctx = widgetCtx();
    (ctx.ui as any).custom
      .mockResolvedValueOnce({ type: "toggle-widget", activeTab: "activity" })
      .mockResolvedValueOnce({ type: "close" });
    const command = trackedToolsCommand(mem(), new Map());

    await command.handler("", ctx);

    expect((ctx.ui as any).setWidget).toHaveBeenCalledWith(
      "pi-tools-activity",
      expect.any(Array),
    );
    expect((ctx.ui as any).setWidget.mock.calls.at(-1)?.[1]).toEqual(
      expect.any(Array),
    );
  });

  it("uses one persistent subscription across overlay reopen", async () => {
    const onUpdate = vi.spyOn(activityMonitor, "onUpdate");
    const ctx = widgetCtx();
    (ctx.ui as any).custom
      .mockResolvedValueOnce({ type: "toggle-widget", activeTab: "activity" })
      .mockResolvedValueOnce({ type: "close" });
    const command = trackedToolsCommand(mem(), new Map());

    await command.handler("", ctx);
    expect(onUpdate).toHaveBeenCalledOnce();

    const before = (ctx.ui as any).setWidget.mock.calls.length;
    activityMonitor.logStart({ type: "api", query: "one" });
    expect((ctx.ui as any).setWidget).toHaveBeenCalledTimes(before + 1);
  });

  it("resetMonitor unsubscribes, removes the widget, and clears entries", async () => {
    const ctx = widgetCtx();
    (ctx.ui as any).custom
      .mockResolvedValueOnce({ type: "toggle-widget", activeTab: "activity" })
      .mockResolvedValueOnce({ type: "close" });
    const command = trackedToolsCommand(mem(), new Map());

    await command.handler("", ctx);
    activityMonitor.logStart({ type: "api", query: "before-reset" });
    command.resetMonitor();

    expect((ctx.ui as any).setWidget).toHaveBeenLastCalledWith(
      "pi-tools-activity",
      undefined,
    );
    expect(activityMonitor.getEntries()).toEqual([]);

    const callsAfterReset = (ctx.ui as any).setWidget.mock.calls.length;
    activityMonitor.logStart({ type: "api", query: "after-reset" });
    expect((ctx.ui as any).setWidget).toHaveBeenCalledTimes(callsAfterReset);
  });
});
```

- [ ] **Step 2: Run command tests and verify red**

```bash
pnpm exec vitest run tests/commands/tools.test.ts
```

Expected: dashboard widget actions are not handled, repeated legacy enable still re-subscribes/re-renders, and reset does not remove the widget.

- [ ] **Step 3: Create one command-closure widget owner**

In `src/commands/tools.ts`, import `DashboardTabId` with the existing dashboard imports. Replace `monitorUnsubscribe` with:

```ts
let widgetUnsubscribe: (() => void) | undefined;
let widgetContext: ExtensionCommandContext | undefined;

const isWidgetEnabled = (): boolean => widgetUnsubscribe !== undefined;

const clearWidget = (): void => {
  const unsubscribe = widgetUnsubscribe;
  const context = widgetContext;
  widgetUnsubscribe = undefined;
  widgetContext = undefined;
  unsubscribe?.();
  context?.ui.setWidget("pi-tools-activity", undefined);
};

const setWidget = (ctx: ExtensionCommandContext, enabled: boolean): void => {
  if (!enabled) {
    clearWidget();
    return;
  }
  if (widgetUnsubscribe) return;

  const repaint = () => {
    ctx.ui.setWidget(
      "pi-tools-activity",
      renderWidgetLines(activityMonitor.getEntries(), ctx.ui.theme),
    );
  };
  widgetContext = ctx;
  widgetUnsubscribe = activityMonitor.onUpdate(repaint);
  repaint();
};
```

`widgetUnsubscribe` is the single source of truth; do not add a second mutable `widgetEnabled` boolean.

In the empty-argument dashboard branch, initialize resume state before the loop:

```ts
let initialTab: DashboardTabId = "status";
```

Pass these options to every component instance:

```ts
getActivity: () => activityMonitor.getEntries(),
subscribeActivity: (listener) => activityMonitor.onUpdate(listener),
widgetEnabled: isWidgetEnabled(),
initialTab,
```

Replace the action handling after `ctx.ui.custom()` with:

```ts
if (!action || action.type === "close") return;
initialTab = action.activeTab;
if (action.type === "toggle-widget") {
  setWidget(ctx, !isWidgetEnabled());
  continue;
}
onReload?.();
```

Route legacy monitor dispatch through the same owner:

```ts
case "monitor": {
  const action = rest[0];
  if (action === "on") {
    setWidget(ctx, true);
    ctx.ui.notify("Activity monitor enabled");
  } else if (action === "off") {
    setWidget(ctx, false);
    ctx.ui.notify("Activity monitor disabled");
  } else {
    ctx.ui.notify("Usage: /tools monitor [on|off]");
  }
  break;
}
```

Replace `resetMonitor()` with:

```ts
resetMonitor(): void {
  clearWidget();
  activityMonitor.clear();
}
```

Do not clear the widget when the overlay closes. `src/index.ts` already calls `resetMonitor()` from `session_shutdown`; no index change is needed.

- [ ] **Step 4: Run focused and full checks**

```bash
pnpm exec vitest run tests/commands/tools-dashboard.test.ts tests/commands/tools.test.ts tests/monitor/widget.test.ts
pnpm exec biome format src/commands/tools-dashboard.ts src/monitor/widget.ts src/commands/tools.ts tests/commands/tools-dashboard.test.ts tests/commands/tools.test.ts
pnpm check
```

Expected: focused tests and the full lint/type/test command pass. Existing typed subcommand tests remain green.

- [ ] **Step 5: Commit widget ownership**

```bash
git add src/commands/tools.ts tests/commands/tools.test.ts
git commit -m "refactor: centralize tools activity widget lifecycle"
```

---

### Task 3: Phase verification

- [ ] **Step 1: Verify ownership boundaries**

```bash
grep -RIn --include='*.ts' 'activityMonitor.onUpdate' src/commands src/monitor
grep -RIn --include='*.ts' 'pi-usage' src || true
grep -n 'session_shutdown' src/index.ts
```

Expected:

- `tools.ts` contains the persistent widget subscription and the injected short-lived dashboard subscription callback.
- `tools-dashboard.ts` never imports the `activityMonitor` singleton.
- no source file imports `pi-usage`.
- `src/index.ts` still routes `session_shutdown` to `toolsCommand.resetMonitor()`.

- [ ] **Step 2: Verify the releasable checkpoint**

```bash
test -f src/commands/tools-subcommands.ts
test -f src/commands/tools-setup.ts
git diff --check
pnpm exec biome format src/commands/tools-dashboard.ts src/monitor/widget.ts src/commands/tools.ts tests/commands/tools-dashboard.test.ts tests/commands/tools.test.ts
pnpm check
git status --short
```

Expected: legacy files remain, formatting and all checks pass, and the worktree is clean after the two task commits.
