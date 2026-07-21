# pi-tools: Integrate Test Tab into Providers Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the dedicated Test tab from `/tools` and integrate test-connection logic into the Providers tab as a `t` row action, `T` (Shift+T) test-all action, and a Test result column.

**Architecture:** Drop the Test tab machinery from `src/commands/tools-dashboard.ts` (state, render method, input handler, tab id, footer branch, resume branching). Add `renderTestCell` helper, two new branches in `handleProviderInput` for `t`/`T`, and a Test cell to the Providers row loop. Convert `testResults` from array to `Map<string, TestResult>` keyed by provider name so results persist across navigations.

**Tech Stack:** TypeScript, `@earendil-works/pi-tui` (Key, matchesKey, Component), vitest, biome.

---

## File Structure

**Files modified:**

- `src/commands/tools-dashboard.ts` — drop Test tab machinery, add `renderTestCell`, add `t`/`T` handlers, convert `testResults` to Map
- `tests/commands/tools-dashboard.test.ts` — delete obsolete Test-tab tests, update tab-list references, add new Providers-tab test-connection tests

**Files NOT modified** (per spec):

- `src/commands/tools-actions.ts`
- `src/providers/registry.ts`
- `src/commands/tools.ts`
- `src/tui/dashboard-theme.ts`
- `src/tui/overlay-render.ts`
- `src/monitor/widget.ts`
- `README.md`

---

## Task 1: Delete obsolete Test-tab tests, update tab-list references, add failing new tests

**Files:**

- Modify: `tests/commands/tools-dashboard.test.ts` (delete obsolete tests, update tab-list iterators, add new tests)

- [ ] **Step 1.1: Delete obsolete Test-tab tests**

In `tests/commands/tools-dashboard.test.ts`, delete these `it(...)` blocks entirely:

- `it("renders the exact Test empty state when no search providers are enabled", ...)` (around line 237)
- `it("changes the selected Test provider with up/down", ...)` (around line 246)
- `it("tests the selected provider and repaints exactly before and after", ...)` (around line 255)
- `it("tests every registered search provider and renders exact details", ...)` (around line 274)
- `it("aborts a replaced test and ignores its later completion", ...)` (around line 309)
- `it("dispose aborts a pending test and ignores its later completion", ...)` (around line 345)
- `it.each(["q", "[A"])("%j aborts an active test, closes once, and unsubscribes once", ...)` (around line 370)
- `it("keeps narrow Test rows and the Showing line bounded", ...)` (around line 427)
- `it("renders the indicator only on the selected Test row", ...)` (around line 562)
- `it("preserves delimiter glyphs in Test detail and footer", ...)` (around line 574)

- [ ] **Step 1.2: Update cycle test to drop "test" tab**

In `it("cycles Providers, Status, Test, Activity and wraps both ways", ...)` (around line 203):

- Rename the test to `"cycles Providers, Status, Activity and wraps both ways"`
- Update the `component.handleInput("	")` cycles: 4 cycles now reach Activity instead of 5 (Providers → Status → Activity → Providers). Adjust the assertions accordingly — each `expect(component.render(80).join("\n")).toContain(...)` should match the tab at that position in the new cycle.
- Drop the `expect(component.render(80).join("\n")).toContain("Enter/t Test • a Test all")` line — that footer no longer exists.
- The final assertion `expect(tui.requestRender).toHaveBeenCalledTimes(5)` becomes `expect(tui.requestRender).toHaveBeenCalledTimes(4)` (one fewer cycle).

The updated cycle test:

```ts
it("cycles Providers, Status, Activity and wraps both ways", () => {
  const { component, tui } = dashboard();

  component.handleInput("[Z");
  expect(component.render(80).join("\n")).toContain("w Enable widget");
  component.handleInput("	");
  expect(component.render(80).join("\n")).toContain("Enter Toggle");
  component.handleInput("	");
  expect(component.render(80).join("\n")).toContain("r Reload");
  component.handleInput("	");
  expect(component.render(80).join("\n")).toContain("w Enable widget");
  expect(tui.requestRender).toHaveBeenCalledTimes(4);
});
```

- [ ] **Step 1.3: Update "switches scope" test to drop "test" iteration**

In `it("switches scope with left/right only from Providers", ...)` (around line 219), the inner loop iterates `for (const tab of ["status", "test", "activity"] as const)`. Change to `for (const tab of ["status", "activity"] as const)` to drop the "test" entry.

- [ ] **Step 1.4: Update "ignores tab-specific keys on other tabs" test**

In `it("ignores tab-specific keys on other tabs", ...)` (around line 472):

- The first loop iterates `for (const key of ["w", "a", "d", "k", "\r"])` on the status tab. Drop `"a"` since `a` is no longer a Test-tab key — but actually `a` IS still a Providers-tab key (Auto default), so it stays.
- The second loop `component.handleInput("r")` on the activity tab — `r` is no longer a Test-tab key, but it WAS still a Status-tab reload. With the Test tab removed, `r` on activity tab should be ignored. The current assertion is already `expect(activity.done).not.toHaveBeenCalled()` — that still passes.
- The loop variables stay the same; the assertion logic is unchanged.

(No code change needed; this step is informational. The test continues to pass because no `r` binding exists on the activity tab.)

- [ ] **Step 1.5: Update width-each test to drop "test" tab**

In `it.each([40, 80, 140])("keeps every tab within width %i", ...)` (around line 504):

- Change the inner `for (const tab of ["providers", "status", "test", "activity"] as const)` to `for (const tab of ["providers", "status", "activity"] as const)`.
- The `if (width === 140)` block checks `expect(lines.join("\n")).toContain("Test")`. This was asserting the tab bar contains "Test". Since Test tab is gone, drop that line:

  ```ts
  if (width === 140) {
    expect(lines.join("\n")).toContain("Providers");
    expect(lines.join("\n")).toContain("Status");
    expect(lines.join("\n")).toContain("Activity");
    expect(lines[0]).toMatch(/^┏.*┓$/);
    expect(lines.at(-1)).toMatch(/^┗.*┛$/);
  }
  ```

- [ ] **Step 1.6: Update q/Escape-each test to drop "test" tab**

In `it.each(["providers", "status", "test", "activity"] as const)("returns close for q and Escape from %s", ...)` (around line 531), change the array to `["providers", "status", "activity"] as const`.

- [ ] **Step 1.7: Add the new failing tests**

Add a new test block at the end of the `describe("ToolsDashboardComponent")` block, just before the closing `});`:

```ts
it("renders the Test column empty for non-search providers", () => {
  const lines = dashboard({
    providerNames: ["brave", "duckduckgo", "exa"],
    tierMap: new Map<string, ProviderTier>([
      ["brave", 1],
      ["duckduckgo", 3],
      ["exa", 2],
    ]),
    config: {
      providers: {
        brave: {
          enabled: true,
          apiKey: "BRAVE_API_KEY",
          budget: { mode: "managed" as const },
        },
        duckduckgo: {
          enabled: false,
          apiKey: "BRAVE_API_KEY",
          budget: { mode: "unlimited" as const },
        },
        exa: {
          enabled: true,
          apiKey: "EXA_API_KEY",
          budget: { mode: "unlimited" as const },
        },
      },
      defaultProvider: "brave",
    },
  }).component.render(100);
  const exaLine = lines.find((line) => line.includes("exa"));
  expect(exaLine).toBeDefined();
  expect(exaLine).not.toMatch(/OK|FAIL|Testing/);
});

it("marks non-search providers as 'not a search provider' when t is pressed", () => {
  const { component } = dashboard({
    providerNames: ["brave", "duckduckgo", "exa"],
    tierMap: new Map<string, ProviderTier>([
      ["brave", 1],
      ["duckduckgo", 3],
      ["exa", 2],
    ]),
    config: {
      providers: {
        brave: {
          enabled: true,
          apiKey: "BRAVE_API_KEY",
          budget: { mode: "managed" as const },
        },
        duckduckgo: {
          enabled: false,
          apiKey: "BRAVE_API_KEY",
          budget: { mode: "unlimited" as const },
        },
        exa: {
          enabled: true,
          apiKey: "EXA_API_KEY",
          budget: { mode: "unlimited" as const },
        },
      },
      defaultProvider: "brave",
    },
  });
  component.handleInput("d"); // down to duckduckgo
  component.handleInput("d"); // down to exa
  component.handleInput("t");
  const output = component.render(100).join("\n");
  expect(output).toMatch(/exa.*not a search provider/);
});

it("shows the selected search provider's test result inline after t", async () => {
  const { component, tui } = dashboard();
  component.handleInput("t");
  await vi.waitFor(() => expect(tui.requestRender).toHaveBeenCalledTimes(2));
  const output = component.render(100).join("\n");
  expect(output).toMatch(/brave.*OK.*1 result/);
});

it("shows each search provider's test result after T", async () => {
  const { component, tui } = dashboard();
  component.handleInput("T");
  await vi.waitFor(() => expect(tui.requestRender).toHaveBeenCalledTimes(2));
  const output = component.render(100).join("\n");
  expect(output).toMatch(/brave.*OK/);
  expect(output).toMatch(/duckduckgo/);
});

it("marks the selected row as Testing while the request is in flight", () => {
  let resolveSearch!: (results: SearchResult[]) => void;
  const provider: SearchProvider = {
    name: "brave",
    label: "Brave",
    search: vi.fn(
      () => new Promise<SearchResult[]>((r) => (resolveSearch = r)),
    ),
  };
  const { component } = dashboard({
    registry: searchRegistry([provider]),
  });
  component.handleInput("t");
  const output = component.render(100).join("\n");
  expect(output).toContain("Testing…");
  resolveSearch([]);
});
```

Notes on the `T` (Shift+T) keybinding test: `Key.shift("t")` resolves to the literal bytes for shifted-t. In vitest, `component.handleInput("T")` should match. If your terminal fixture needs the actual escape sequence, use `component.handleInput("[97;5u")` for a Kitty protocol sequence with shift, or fall back to capital "T" raw byte (legacy terminal). Test with raw "T" first; if it fails, use the appropriate escape.

- [ ] **Step 1.8: Run the test file and confirm new tests fail**

Run: `pnpm vitest run tests/commands/tools-dashboard.test.ts`

Expected: The five new tests fail because the Test column doesn't exist yet. The deleted/updated tests are gone, so the file count is reduced.

- [ ] **Step 1.9: Commit the failing tests and test cleanup**

```bash
git add tests/commands/tools-dashboard.test.ts
git commit -m "test: remove obsolete Test-tab tests, add Providers Test-column tests

The Test tab is going away. Delete the tests that target it
directly, update tab-list iterators in cycle/width/close-each
tests, and add five new tests that exercise the upcoming
Test column on the Providers tab:

- non-search providers have no Test cell
- pressing 't' on a non-search provider stores a deterministic
  'not a search provider' failure
- pressing 't' on a search provider renders its result inline
- pressing 'T' tests every search provider and renders each result
- the selected row shows 'Testing…' while the request is in flight

These new tests fail with the current code (Test column not yet
implemented); the cleanup keeps the suite compiling.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Drop Test tab, add Test column, add t/T handlers, update beginTest

**Files:**

- Modify: `src/commands/tools-dashboard.ts` (state, TABS, render dispatch, handleInput dispatch, renderTest removal, handleTestInput removal, resume, footer, renderProviders row loop, renderTestCell addition, handleProviderInput additions, beginTest change)

- [ ] **Step 2.1: Remove "test" from `DashboardTabId` and `TABS`**

In `src/commands/tools-dashboard.ts`:

OLD:

```ts
export type DashboardTabId = "providers" | "status" | "test" | "activity";
```

NEW:

```ts
export type DashboardTabId = "providers" | "status" | "activity";
```

OLD:

```ts
const TABS = [
  { id: "providers", label: "Providers" },
  { id: "status", label: "Status" },
  { id: "test", label: "Test" },
  { id: "activity", label: "Activity" },
] satisfies DashboardTab[];
```

NEW:

```ts
const TABS = [
  { id: "providers", label: "Providers" },
  { id: "status", label: "Status" },
  { id: "activity", label: "Activity" },
] satisfies DashboardTab[];
```

- [ ] **Step 2.2: Remove `testIndex` and change `testResults` to Map**

In the class fields (around lines 93-97):

OLD:

```ts
  private providerIndex: number;
  private testIndex: number;
  private testController?: AbortController;
  private testResults: TestResult[] = [];
  private activityUnsubscribe?: () => void;
```

NEW:

```ts
  private providerIndex: number;
  private testController?: AbortController;
  private testResults = new Map<string, TestResult>();
  private activityUnsubscribe?: () => void;
```

In the constructor (around lines 100-107):

OLD:

```ts
    this.providerIndex = initialIndex >= 0 ? initialIndex : 0;
    const searchNames = options.registry.getSearchProviderNames();
    const initialTestIndex = options.initialProvider
      ? searchNames.indexOf(options.initialProvider)
      : -1;
    this.testIndex = initialTestIndex >= 0 ? initialTestIndex : 0;
    this.activityUnsubscribe = options.subscribeActivity(() => {
```

NEW:

```ts
    this.providerIndex = initialIndex >= 0 ? initialIndex : 0;
    this.activityUnsubscribe = options.subscribeActivity(() => {
```

- [ ] **Step 2.3: Update `render(width)` to drop the test branch**

OLD (around lines 115-122):

```ts
const content =
  this.activeTab === "providers"
    ? this.renderProviders(contentWidth)
    : this.activeTab === "test"
      ? this.renderTest(contentWidth)
      : this.activeTab === "status"
        ? this.renderStatus(contentWidth)
        : this.renderActivity(contentWidth);
```

NEW:

```ts
const content =
  this.activeTab === "providers"
    ? this.renderProviders(contentWidth)
    : this.activeTab === "status"
      ? this.renderStatus(contentWidth)
      : this.renderActivity(contentWidth);
```

- [ ] **Step 2.4: Update `handleInput` to drop the test branch**

OLD (around lines 157-160):

```ts
if (this.activeTab === "test") {
  this.handleTestInput(data);
  return;
}
```

Delete those lines entirely.

- [ ] **Step 2.5: Add the Test cell to `renderProviders` row loop**

OLD (around lines 209-217):

```ts
      const isSelected = index === this.providerIndex;
      const prefix = renderRowPrefix(isSelected, this.options.theme);
      const paddedName = padVisible(truncateVisible(name, 20), 20);
      const nameCell = isSelected
        ? this.options.theme.fg("accent", this.options.theme.bold(paddedName))
        : this.options.theme.dim(paddedName);
      const rest =
        `${padVisible(String(this.options.tierMap.get(name) ?? 3), 4)} ` +
        `${padVisible(entry?.enabled === false ? "disabled" : "enabled", 8)} ` +
        `${padVisible(truncateVisible(keyState, 22), 22)} ` +
        `${padVisible(entry?.budget.mode ?? "--", 12)} ` +
        `${this.options.config.defaultProvider === name ? "default" : ""}`;
      lines.push(truncateVisible(`${prefix}${nameCell} ${rest}`, contentWidth));
    }
```

NEW:

```ts
      const isSelected = index === this.providerIndex;
      const prefix = renderRowPrefix(isSelected, this.options.theme);
      const paddedName = padVisible(truncateVisible(name, 20), 20);
      const nameCell = isSelected
        ? this.options.theme.fg("accent", this.options.theme.bold(paddedName))
        : this.options.theme.dim(paddedName);
      const testCell = this.renderTestCell(name, isSelected);
      const rest =
        `${padVisible(String(this.options.tierMap.get(name) ?? 3), 4)} ` +
        `${padVisible(entry?.enabled === false ? "disabled" : "enabled", 8)} ` +
        `${padVisible(truncateVisible(keyState, 22), 22)} ` +
        `${padVisible(entry?.budget.mode ?? "--", 12)} ` +
        `${this.options.config.defaultProvider === name ? "default" : ""}`;
      lines.push(
        truncateVisible(
          `${prefix}${nameCell} ${rest}${testCell ? ` ${testCell}` : ""}`,
          contentWidth,
        ),
      );
    }
```

- [ ] **Step 2.6: Add `renderTestCell` private method**

Place it directly after `renderProviders` (find the closing `}` of that method, insert after).

```ts
  private renderTestCell(name: string, isSelected: boolean): string {
    // Non-search providers never show a test cell.
    if (this.options.registry.selectSearchCandidates(name).length === 0) {
      return "";
    }
    if (isSelected && this.testController !== undefined) {
      return this.options.theme.dim("Testing…");
    }
    const result = this.testResults.get(name);
    if (!result) return "";
    if (result.ok) {
      const summary = `OK • ${result.latencyMs}ms`;
      return result.resultCount > 0
        ? `${summary} • ${result.resultCount} result${result.resultCount === 1 ? "" : "s"}`
        : summary;
    }
    return result.message === "OK"
      ? `FAIL • ${result.latencyMs}ms`
      : `FAIL • ${result.latencyMs}ms • ${result.message}`;
  }
```

- [ ] **Step 2.7: Delete `renderTest` and `handleTestInput` methods**

Delete the entire `renderTest(contentWidth: number): string[]` method (around lines 233-261) and the entire `handleTestInput(data: string): void` method (around lines 320-336).

- [ ] **Step 2.8: Update `beginTest` to populate the map**

OLD (around lines 338-351):

```ts
  private beginTest(run: (signal: AbortSignal) => Promise<TestResult[]>): void {
    if (this.disposed) return;
    this.testController?.abort();
    const controller = new AbortController();
    this.testController = controller;
    this.testResults = [];
    this.options.tui.requestRender();
    void run(controller.signal).then((results) => {
      if (this.disposed || this.testController !== controller) return;
      this.testResults = results;
      this.testController = undefined;
      this.options.tui.requestRender();
    });
  }
```

NEW:

```ts
  private beginTest(run: (signal: AbortSignal) => Promise<TestResult[]>): void {
    if (this.disposed) return;
    this.testController?.abort();
    const controller = new AbortController();
    this.testController = controller;
    this.options.tui.requestRender();
    void run(controller.signal).then((results) => {
      if (this.disposed || this.testController !== controller) return;
      for (const result of results) {
        this.testResults.set(result.provider, result);
      }
      this.testController = undefined;
      this.options.tui.requestRender();
    });
  }
```

- [ ] **Step 2.9: Add `t` and `T` handlers to `handleProviderInput`**

Insert these new branches at the end of `handleProviderInput` (before its closing `}`), after the existing `Enter/k/d/a` branches:

```ts
if (data === "t") {
  const name = this.options.providerNames[this.providerIndex];
  if (!name) return;
  const candidates = this.options.registry.selectSearchCandidates(name);
  if (candidates.length === 0) {
    this.testResults.set(name, {
      provider: name,
      ok: false,
      latencyMs: 0,
      resultCount: 0,
      message: "not a search provider",
    });
    this.options.tui.requestRender();
    return;
  }
  this.beginTest((signal) => [
    runProviderTest(name, this.options.registry, signal),
  ]);
  return;
}

if (matchesKey(data, Key.shift("t"))) {
  const searchNames = this.options.registry.getSearchProviderNames();
  if (searchNames.length === 0) return;
  this.beginTest((signal) =>
    runProviderTests(this.options.registry, searchNames, signal),
  );
  return;
}
```

- [ ] **Step 2.10: Update `resume()` to drop tab branching**

OLD (around lines 353-363):

```ts
  private resume(): DashboardResumeState {
    const names =
      this.activeTab === "test"
        ? this.options.registry.getSearchProviderNames()
        : this.options.providerNames;
    const index = this.activeTab === "test" ? this.testIndex : this.providerIndex;
    return {
      activeTab: this.activeTab,
      selectedProvider: names[index],
    };
  }
```

NEW:

```ts
  private resume(): DashboardResumeState {
    return {
      activeTab: this.activeTab,
      selectedProvider: this.options.providerNames[this.providerIndex],
    };
  }
```

- [ ] **Step 2.11: Update `renderFooter` for the Providers tab**

OLD (around lines 273-289):

```ts
  private renderFooter(contentWidth: number): string {
    let action: string;
    if (this.activeTab === "providers") {
      action = this.options.scope.canWrite
        ? "Enter Toggle • k Set key • d Set default • a Auto default • ←/→ Scope"
        : "←/→ Scope";
    } else if (this.activeTab === "status") {
      action = "r Reload";
    } else if (this.activeTab === "test") {
      action = "Enter/t Test • a Test all";
    } else {
      action = `w ${this.options.widgetEnabled ? "Disable" : "Enable"} widget`;
    }
```

NEW:

```ts
  private renderFooter(contentWidth: number): string {
    let action: string;
    if (this.activeTab === "providers") {
      const testBindings = "t Test • T Test all";
      action = this.options.scope.canWrite
        ? `Enter Toggle • k Set key • d Set default • a Auto default • ${testBindings} • ←/→ Scope`
        : `${testBindings} • ←/→ Scope`;
    } else if (this.activeTab === "status") {
      action = "r Reload";
    } else {
      action = `w ${this.options.widgetEnabled ? "Disable" : "Enable"} widget`;
    }
```

- [ ] **Step 2.12: Run tests and confirm GREEN**

Run: `pnpm vitest run tests/commands/tools-dashboard.test.ts`

Expected: All tests pass. Specifically:

- The 5 new tests pass (Test column renders correctly, `t`/`T` handlers work)
- The cycle/width/close-each tests pass (tab list updated)
- All other tests pass (resume, scope, activity, dispose, etc.)

- [ ] **Step 2.13: Run full check**

Run: `pnpm check`

Expected: biome lint + tsc + vitest all pass. Biome may flag unused imports — remove any now-orphaned imports.

- [ ] **Step 2.14: Commit the implementation**

```bash
git add src/commands/tools-dashboard.ts
git commit -m "feat(tools): integrate Test tab into Providers tab

Drop the dedicated Test tab. Move test-connection logic into the
Providers tab:

- 't' keybinding tests the selected search provider; non-search
  providers get a deterministic 'not a search provider' result
- 'T' (Shift+T) tests every registered search provider sequentially
- new trailing Test column renders the last result per row, or
  'Testing…' while the selected row's request is in flight

Convert testResults from TestResult[] to Map<string, TestResult>
keyed by provider name so results persist across navigations.
Simplify resume() to drop the activeTab === 'test' branch.
Update renderFooter to add 't Test • T Test all' to the Providers
footer. Drop the TABS.test entry, the renderTest/handleTestInput
methods, and the 'test' branches in render() and handleInput().

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Verify

**Files:** none modified — verification only.

- [ ] **Step 3.1: Run pnpm check**

Run: `pnpm check`

Expected: PASS. Biome + tsc + 1390+ tests green.

- [ ] **Step 3.2: Verify diff scope**

Run: `git diff --stat HEAD~2`

Expected: Only two files should appear:

- `src/commands/tools-dashboard.ts`
- `tests/commands/tools-dashboard.test.ts`

If anything else appears, review and either revert or justify.

- [ ] **Step 3.3: Confirm Tests tab references are gone**

Run: `grep -n '"test"' src/commands/tools-dashboard.ts`

Expected: No output (or only references unrelated to the Test tab). Verify that nothing in the codebase still constructs a `DashboardTabId` of `"test"`.

- [ ] **Step 3.4: Manual visual verification (optional)**

Launch a Pi session, run `/tools`, confirm:

- Only 3 tabs visible (Providers, Status, Activity)
- Providers tab has a Test column on the right
- Pressing `t` on a search provider runs the test and shows result in that row
- Pressing `t` on a non-search provider shows "not a search provider"
- Pressing `T` runs tests on all search providers
- Footer shows `t Test • T Test all`

---

## Self-Review Notes

**Spec coverage:**

- State changes (Task 2.1, 2.2) ✓
- TABS / DashboardTabId reduction (Task 2.1) ✓
- render/handleInput dispatch cleanup (Task 2.3, 2.4) ✓
- renderProviders Test cell addition (Task 2.5) ✓
- renderTestCell helper (Task 2.6) ✓
- renderTest/handleTestInput deletion (Task 2.7) ✓
- beginTest map population (Task 2.8) ✓
- t/T handlers (Task 2.9) ✓
- resume simplification (Task 2.10) ✓
- footer update (Task 2.11) ✓
- Test fixture expansion (Task 1.7) ✓
- Obsolete tests removed (Task 1.1) ✓
- Tab-list iterators updated (Task 1.2, 1.3, 1.5, 1.6) ✓
- New failing tests added (Task 1.7) ✓
- Files NOT modified: covered (no other files touched)

**Type consistency:** All `testResults` references use the Map shape. `renderTestCell` signature `(name: string, isSelected: boolean) => string` matches the single call site. `Key.shift("t")` is the documented API.

**Placeholder scan:** No "TBD", "TODO", "implement later". All code blocks contain complete, runnable code.

**Out-of-scope behaviors:** None. The spec's "in flight for the selected row" behavior for `T` (test all) is documented; per-row "Testing…" during bulk tests is left as a follow-up.

## Post-Implementation Retrospective

**Process note — regex-based cleanup missed `renderTest`**: Step 2.7 ("Delete `renderTest` and `handleTestInput` methods") used a regex with `.*?\n  \}\n` to match each function's closing brace. The regex stopped at the first `\n  }\n` it found, which can be inside an inner conditional (`}\n`) with the same indentation as the function's outer `}`. The leftover `renderTest` body referenced `this.testIndex` (deleted earlier in the same commit) and `testResults: TestResult[]` (already changed to Map), so `tsc --noEmit` caught it and a follow-up commit cleaned it up.

**Lesson for future method-deletion refactors**:
- Do deletions in a deterministic order: function-by-function, smallest first.
- Run `tsc --noEmit` as a hard gate between the deletion commit and the GREEN commit. Don't declare a refactor complete on `vitest pass` alone — the existing tests may not exercise the deleted code's callers, so type errors are the only signal.
- For multi-line function bodies, prefer a TS-aware tool (ts-morph, jscodeshift) or a hand-anchored edit per function, rather than a single regex across multiple functions.

**Other follow-ups applied during review** (not in original plan): t/T handlers moved above the `canWrite` guard (matches spec's "test bindings work on read-only scope too"), read-only test added to lock that behavior in, dead `result.message === "OK"` branch dropped from `renderTestCell` (unreachable), `isSearchProvider` lookup moved below the `!result` guard so untested rows skip the registry call entirely, weak "empty Test column" assertion tightened with word-boundary regex, "Testing…" test now async and asserts the post-resolution OK state, blank lines collapsed.
