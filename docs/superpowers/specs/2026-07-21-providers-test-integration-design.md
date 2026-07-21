# pi-tools: Integrate Test Tab into Providers Tab

**Date:** 2026-07-21
**Status:** Approved design (pending implementation)

## Context

The `/tools` dashboard currently has four tabs: Providers, Status, Test, Activity. The Test tab exists solely to run connection tests against the registered search providers. It duplicates navigation, has its own cursor (`testIndex`), its own results store, and its own footer/header boilerplate.

Only **search providers** can be tested (the test runner calls `provider.search("test", 1, signal)`). The Providers tab, in contrast, lists **all** providers. The Test tab is therefore a stripped-down parallel view of one subset of the Providers tab.

This change removes the Test tab and integrates test-connection logic into the Providers tab as a per-row action plus a Test result column. The result is fewer tabs, less duplicated state, and a single cursor model.

## Scope

**In scope:**

- `src/commands/tools-dashboard.ts` — drop Test tab, add `t` and `T` (Shift+T) handlers, append a Test column to the Providers row, convert `testResults` from array to map keyed by provider name
- `tests/commands/tools-dashboard.test.ts` — remove Test-tab tests, add new Providers-tab test-connection tests, expand fixture with a non-search provider

**Out of scope:**

- `src/commands/tools-actions.ts` — `runProviderTest` / `runProviderTests` unchanged
- `src/providers/registry.ts` — `selectSearchCandidates` / `getSearchProviderNames` unchanged
- `src/commands/tools.ts` — command loop unchanged; resume-state shape stays `{ activeTab, selectedProvider }`
- `src/tui/dashboard-theme.ts`, `src/tui/overlay-render.ts`, `src/monitor/widget.ts` — unchanged
- `README.md` — no command change to document

## Approach

Direct, minimal: drop the Test tab machinery and add the test logic inline to the Providers tab. The Test column is one extra cell appended to the existing row; the `t`/`T` handlers are two new branches in `handleProviderInput`. No new helper functions, no new files.

## Implementation

### State changes (`src/commands/tools-dashboard.ts`)

```ts
export type DashboardTabId = "providers" | "status" | "activity";

const TABS = [
  { id: "providers", label: "Providers" },
  { id: "status", label: "Status" },
  { id: "activity", label: "Activity" },
] satisfies DashboardTab[];
```

```ts
// In the class:
private testController?: AbortController;
private testResults = new Map<string, TestResult>();
// removed: private testIndex: number, private testResults: TestResult[] = []
```

Constructor: remove `this.testIndex` initialization. Keep `this.testResults` and `this.testController` initialization.

`render(width)`: remove the `this.activeTab === "test"` branch. The chain becomes:

```ts
const content =
  this.activeTab === "providers"
    ? this.renderProviders(contentWidth)
    : this.activeTab === "status"
      ? this.renderStatus(contentWidth)
      : this.renderActivity(contentWidth);
```

`handleInput(data)`: remove the `this.activeTab === "test"` branch.

### `renderProviders` — row loop

Append a Test cell to the row. The existing column widths are unchanged; the Test cell takes whatever space remains up to `contentWidth`. The whole row is already wrapped in `truncateVisible(..., contentWidth)`, so the Test cell truncates naturally on narrow overlays.

```ts
for (let index = start; index < end; index += 1) {
  const name = providerNames[index];
  const entry = this.options.config.providers[name];
  const key = entry?.apiKey;
  const keyState =
    key === undefined
      ? "unset"
      : classifyCredential(key) === "env"
        ? `env: ${key}`
        : "set";
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

### `renderTestCell` — new private method

Returns the trailing Test column content. `"Testing…"` while a test is in flight for the selected row. Empty for rows that have never been tested. The formatted result otherwise. For non-search providers that have been tested (via `t`), the cell shows `FAIL • not a search provider`.

```ts
private renderTestCell(name: string, isSelected: boolean): string {
  // "Testing…" takes precedence while a request is in flight for the
  // selected row. Show this regardless of whether the row is a search
  // provider — only the selected row can show it.
  if (isSelected && this.testController !== undefined) {
    return this.options.theme.dim("Testing…");
  }
  const result = this.testResults.get(name);
  if (!result) return "";
  // Non-search providers never show a successful test cell, but they can
  // still display a deterministic failure if `t` was pressed on them.
  const isSearchProvider =
    this.options.registry.selectSearchCandidates(name).length > 0;
  if (!isSearchProvider) {
    // Render the deterministic failure for non-search providers.
    return `FAIL • ${result.message}`;
  }
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

### `handleProviderInput` — new branches

Add after the existing `Enter/k/d/a` branches (which are guarded by `canWrite`). Test bindings work on read-only scope too — testing is non-mutating.

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

### `beginTest` — store into the map

The current `beginTest` assigns into a `TestResult[]`. Update to populate the map keyed by `result.provider`:

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

The `dispose()` already aborts `testController`, so cleanup is unchanged.

### `resume` — drop tab branching

```ts
private resume(): DashboardResumeState {
  return {
    activeTab: this.activeTab,
    selectedProvider: this.options.providerNames[this.providerIndex],
  };
}
```

### `renderFooter` — Providers footer

```ts
if (this.activeTab === "providers") {
  const testBindings = "t Test • T Test all";
  action = this.options.scope.canWrite
    ? `Enter Toggle • k Set key • d Set default • a Auto default • ${testBindings} • ←/→ Scope`
    : `${testBindings} • ←/→ Scope`;
}
```

The `else if (this.activeTab === "test")` branch is deleted.

### Keybindings cleanup

Remove `handleTestInput` entirely.

## Files to modify

- `src/commands/tools-dashboard.ts` — drop Test tab machinery; add `t`/`T` handlers, `renderTestCell`, footer bindings
- `tests/commands/tools-dashboard.test.ts` — replace Test-tab tests with Providers-tab tests; expand fixture with a non-search provider

## Files NOT to modify

- `src/commands/tools-actions.ts`
- `src/providers/registry.ts`
- `src/commands/tools.ts`
- `src/tui/dashboard-theme.ts`
- `src/tui/overlay-render.ts`
- `src/monitor/widget.ts`
- `README.md`

## Testing

### Tests to remove

All tests under `describe("ToolsDashboardComponent")` that target the `"test"` tab specifically:

- `it("renders the exact Test empty state when no search providers are enabled", ...)`
- `it("changes the selected Test provider with up/down", ...)`
- `it("tests the selected provider and repaints exactly before and after", ...)`
- `it("tests every registered search provider and renders exact details", ...)`
- `it("aborts a replaced test and ignores its later completion", ...)`
- `it("dispose aborts a pending test and ignores its later completion", ...)`
- `it.each(["q", ""])("%j aborts an active test, closes once, and unsubscribes once", ...)`
- `it("keeps narrow Test rows and the Showing line bounded", ...)`
- `it("renders the indicator only on the selected Test row", ...)`
- `it("preserves delimiter glyphs in Test detail and footer", ...)`

### Fixture expansion

Add a non-search provider to the fixture so the `t`-on-non-search path can be tested:

```ts
// In searchRegistry fixture, also expose getSearchProviderNames returning
// only the search subset. Add a third non-search provider to providerNames:
// e.g. providerNames: ["brave", "duckduckgo", "exa"]
// with exa missing from searchProviderNames.
```

### Tests to add

```ts
it("shows the selected search provider's test result inline after t", async () => {
  const { component, tui } = dashboard();
  component.handleInput("t");
  await vi.waitFor(() => expect(tui.requestRender).toHaveBeenCalledTimes(2));
  const output = component.render(100).join("\n");
  // brave row's Test cell shows OK with result count from the fixture
  expect(output).toMatch(/OK.*1 result/);
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
  // Use a never-resolving search() to keep the test pending.
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
  // Cleanup: resolve to avoid leaked promise in test runner.
  resolveSearch([]);
});

it("marks non-search providers as 'not a search provider' when t is pressed", () => {
  // exa is in providerNames but not in searchProviderNames.
  const { component } = dashboard({
    providerNames: ["brave", "duckduckgo", "exa"],
  });
  component.handleInput("d"); // down to duckduckgo
  component.handleInput("d"); // down to exa
  component.handleInput("t");
  const output = component.render(100).join("\n");
  expect(output).toMatch(/exa.*not a search provider/);
});

it("renders the Test column empty for non-search providers", () => {
  const { component } = dashboard({
    providerNames: ["brave", "duckduckgo", "exa"],
  });
  // Don't press t — Test cell should be empty for exa
  const lines = component.render(100);
  const exaLine = lines.find((line) => line.includes("exa"));
  expect(exaLine).toBeDefined();
  expect(exaLine).not.toMatch(/OK|FAIL|Testing/);
});
```

### Tests to keep (still pass unchanged)

- `it("opens Providers and renders scope-effective provider state", ...)`
- `it("returns provider actions with resume state", ...)`
- `it("makes untrusted Project scope read-only while preserving scope switching", ...)`
- `it("restores an available provider selection and requested tab", ...)`
- `it("returns Status reload and Activity widget actions with full resume state", ...)`
- `it("cycles Providers, Status, Test, Activity and wraps both ways", ...)` → update: drop "Test" from the cycle list
- `it("switches scope with left/right only from Providers", ...)` → update: drop the `"test"` iteration from the inner loop
- `it("ignores tab-specific keys on other tabs", ...)` → update: drop `t`/`T` from the cross-tab "ignored keys" list (they're now Provider-only)
- `it("keeps the selected provider in a bounded ten-row window", ...)`
- `it("renders only the latest ten activity entries", ...)`
- `it("renders the Activity empty state and current widget action", ...)`
- `it("repaints on activity and unsubscribes once across both disposal paths", ...)`
- `it.each([40, 80, 140])("keeps every tab within width %i", ...)` → update: drop `"test"` from the tab iteration
- `it.each(["providers", "status", "test", "activity"] as const)("returns close for q and Escape from %s", ...)` → update: drop `"test"`
- `it("renders the indicator only on the selected Providers row", ...)`
- `it("renders the ▸ indicator only on the selected row", ...)`
- `it("keeps Providers row cells aligned with the column header", ...)`
- `it("preserves delimiter glyphs in Providers footer", ...)`

## Verification

After implementation:

1. `pnpm check` — biome lint + tsc + vitest pass
2. `pnpm vitest run tests/commands/tools-dashboard.test.ts` — focused file green
3. Manual: launch Pi, run `/tools`, confirm the Test tab is gone, Providers shows a Test column, `t` and `T` work as specified

## Risk and rollback

Risk: medium-low. This is a feature-removal + column-add. The Test tab's resume-state branch in `resume()` simplifies (no tab-specific names lookup), but `tools.ts` only consumes `resume.activeTab` and `resume.selectedProvider` — both still populated correctly.

The fixture change (adding `exa` as a non-search provider) is the largest test-side risk: any test that asserts on `providerNames.length === 2` or filters lines by `line.includes("brave") || line.includes("duckduckgo")` needs updating to include `exa`.

Rollback: revert `tools-dashboard.ts` and the test file. No persistent state, no migration.
