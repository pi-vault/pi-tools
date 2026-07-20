# /tools Dashboard Refactor Phase 4: Provider Tests and Tabs-Only Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the four-tab dashboard with abortable provider tests, then remove the setup wizard and every typed subcommand.

**Architecture:** Extend `tools-actions.ts` with provider test runners that accept raw `AbortSignal`s. Let the dashboard own only an active test controller and inline result state. Once all former behavior exists in tabs, simplify `tools.ts` to tabs-only dispatch and delete the obsolete setup/subcommand modules.

**Tech Stack:** TypeScript, Pi TUI, `AbortController`, existing provider registry, Vitest, Biome.

**Prerequisite:** Phases 1–3 are implemented and `pnpm check` passes.

**Usable result:** `/tools` is the final centered Providers/Status/Test/Activity dashboard. One/all provider tests report inline and abort on close. Typed arguments show a migration hint and cannot mutate config. Legacy modules are gone.

---

## File map

- Modify `src/commands/tools-actions.ts`: single/all provider test execution.
- Modify `tests/commands/tools-actions.test.ts`: signal position, success/failure, sequencing, and abort.
- Modify `src/commands/tools-dashboard.ts`: final Test tab, async state, repaint, and disposal.
- Modify `tests/commands/tools-dashboard.test.ts`: test navigation/results/abort and four-tab width parity.
- Modify `src/commands/tools.ts`: reject all arguments and remove legacy dispatch/imports.
- Modify `tests/commands/tools.test.ts`: migration, non-UI, dashboard actions, and widget shutdown regressions.
- Delete `src/commands/tools-setup.ts` and `src/commands/tools-subcommands.ts`.
- Delete `tests/commands/tools-setup.test.ts` and `tests/commands/tools-subcommands.test.ts`.
- Verify `src/index.ts`: shutdown cleanup remains wired to the same command object.

---

### Task 1: Add abortable provider test actions

**Files:**
- Modify: `src/commands/tools-actions.ts`
- Modify: `tests/commands/tools-actions.test.ts`

- [ ] **Step 1: Write test-runner cases first**

Add imports for `runProviderTest` and `runProviderTests`. Use a minimal registry double whose `selectSearchCandidates()` returns a search provider. Add:

```ts
describe("provider tests", () => {
  it("passes the raw AbortSignal as search argument three", async () => {
    const search = vi.fn().mockResolvedValue([{ url: "https://example.com" }]);
    const registry = {
      selectSearchCandidates: vi.fn(() => [{ name: "brave", label: "Brave", search }]),
    } as never;
    const controller = new AbortController();

    const result = await runProviderTest("brave", registry, controller.signal);

    expect(search).toHaveBeenCalledWith("test", 1, controller.signal);
    expect(result).toMatchObject({
      provider: "brave",
      ok: true,
      resultCount: 1,
      message: "OK",
    });
  });

  it("returns a failed result for missing or disabled providers", async () => {
    const registry = { selectSearchCandidates: vi.fn(() => []) } as never;
    await expect(
      runProviderTest("missing", registry, new AbortController().signal),
    ).resolves.toMatchObject({
      provider: "missing",
      ok: false,
      resultCount: 0,
      message: "not found or not enabled",
    });
  });

  it("converts provider rejection into a failed result", async () => {
    const registry = {
      selectSearchCandidates: vi.fn(() => [{
        name: "brave",
        label: "Brave",
        search: vi.fn().mockRejectedValue(new Error("network down")),
      }]),
    } as never;
    await expect(
      runProviderTest("brave", registry, new AbortController().signal),
    ).resolves.toMatchObject({ ok: false, message: "network down" });
  });

  it("labels an aborted provider rejection", async () => {
    const controller = new AbortController();
    const registry = {
      selectSearchCandidates: vi.fn(() => [{
        name: "brave",
        label: "Brave",
        search: vi.fn(async () => {
          controller.abort();
          throw new Error("cancelled");
        }),
      }]),
    } as never;
    await expect(
      runProviderTest("brave", registry, controller.signal),
    ).resolves.toMatchObject({ ok: false, message: "aborted" });
  });

  it("runs all providers sequentially and stops after abort", async () => {
    const controller = new AbortController();
    const search = vi.fn(async () => {
      controller.abort();
      throw new Error("cancelled");
    });
    const registry = {
      selectSearchCandidates: vi.fn(() => [{ name: "first", label: "First", search }]),
    } as never;
    const results = await runProviderTests(
      registry,
      ["first", "second"],
      controller.signal,
    );
    expect(results).toHaveLength(1);
    expect(registry.selectSearchCandidates).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run focused tests and verify failure**

```bash
pnpm exec vitest run tests/commands/tools-actions.test.ts
```

Expected: FAIL because the test runner exports do not exist.

- [ ] **Step 3: Implement the runner contracts**

Add:

```ts
import type { ProviderRegistry } from "../providers/registry.ts";

export interface TestResult {
  provider: string;
  ok: boolean;
  latencyMs: number;
  resultCount: number;
  message: string;
}
```

Implement:

```ts
export async function runProviderTest(
  providerName: string,
  registry: ProviderRegistry,
  signal: AbortSignal,
): Promise<TestResult> {
  const provider = registry.selectSearchCandidates(providerName)[0];
  if (!provider) {
    return {
      provider: providerName,
      ok: false,
      latencyMs: 0,
      resultCount: 0,
      message: "not found or not enabled",
    };
  }
  const started = Date.now();
  try {
    const results = await provider.search("test", 1, signal);
    return {
      provider: providerName,
      ok: true,
      latencyMs: Date.now() - started,
      resultCount: results.length,
      message: "OK",
    };
  } catch (error) {
    return {
      provider: providerName,
      ok: false,
      latencyMs: Date.now() - started,
      resultCount: 0,
      message: signal.aborted
        ? "aborted"
        : error instanceof Error
          ? error.message
          : String(error),
    };
  }
}

export async function runProviderTests(
  registry: ProviderRegistry,
  names: readonly string[],
  signal: AbortSignal,
): Promise<TestResult[]> {
  const results: TestResult[] = [];
  for (const name of names) {
    if (signal.aborted) break;
    results.push(await runProviderTest(name, registry, signal));
  }
  return results;
}
```

Do not pass `{ signal }`; the provider interface requires the raw signal as argument three.

- [ ] **Step 4: Run tests and commit**

```bash
pnpm exec vitest run tests/commands/tools-actions.test.ts
git add src/commands/tools-actions.ts tests/commands/tools-actions.test.ts
git commit -m "feat: add abortable provider test actions"
```

---

### Task 2: Add the final Test tab

**Files:**
- Modify: `src/commands/tools-dashboard.ts`
- Modify: `tests/commands/tools-dashboard.test.ts`

- [ ] **Step 1: Extend the dashboard fixture and write failing tests**

Pass a `registry` double with `getSearchProviderNames()` and `selectSearchCandidates()`. Add:

```ts
it("uses the final Providers, Status, Test, Activity order", () => {
  const { component } = dashboard();
  expect(component.render(140).join("\n")).toContain("Providers");
  component.handleInput("\t");
  expect(component.render(140).join("\n")).toContain("Status");
  component.handleInput("\t");
  expect(component.render(140).join("\n")).toContain("Test");
  component.handleInput("\t");
  expect(component.render(140).join("\n")).toContain("Activity");
});

it("tests the selected provider and repaints before and after", async () => {
  const search = vi.fn().mockResolvedValue([{ url: "https://example.com" }]);
  const { component, tui } = dashboard(vi.fn(), {
    searchProvider: { name: "brave", label: "Brave", search },
  });
  component.handleInput("\t");
  component.handleInput("\t");
  const beforeTest = tui.requestRender.mock.calls.length;
  component.handleInput("\r");
  await vi.waitFor(() => {
    expect(component.render(140).join("\n")).toContain("OK");
  });
  expect(search).toHaveBeenCalledWith("test", 1, expect.any(AbortSignal));
  expect(tui.requestRender.mock.calls.length - beforeTest).toBe(2);
});

it("tests all providers with a", async () => {
  const { component, registry } = dashboard();
  component.handleInput("\t");
  component.handleInput("\t");
  component.handleInput("a");
  await vi.waitFor(() => {
    expect(registry.selectSearchCandidates).toHaveBeenCalled();
  });
});

it("ignores a stale provider test that finishes after its replacement", async () => {
  let resolveFirst!: (value: { url: string }[]) => void;
  let resolveSecond!: (value: { url: string }[]) => void;
  const first = new Promise<{ url: string }[]>((resolve) => {
    resolveFirst = resolve;
  });
  const second = new Promise<{ url: string }[]>((resolve) => {
    resolveSecond = resolve;
  });
  const search = vi
    .fn()
    .mockImplementationOnce(() => first)
    .mockImplementationOnce(() => second);
  const { component, tui } = dashboard(vi.fn(), {
    searchProvider: { name: "brave", label: "Brave", search },
  });
  component.handleInput("\t");
  component.handleInput("\t");
  component.handleInput("t");
  component.handleInput("t");

  resolveSecond([{ url: "second-1" }, { url: "second-2" }]);
  await vi.waitFor(() => {
    expect(component.render(140).join("\n")).toContain("2 results");
  });
  const rendersAfterCurrent = tui.requestRender.mock.calls.length;

  resolveFirst([]);
  await Promise.resolve();
  await Promise.resolve();
  expect(component.render(140).join("\n")).toContain("2 results");
  expect(tui.requestRender).toHaveBeenCalledTimes(rendersAfterCurrent);
});

it("aborts a running provider test on dispose", async () => {
  let receivedSignal: AbortSignal | undefined;
  const search = vi.fn((_query, _count, signal: AbortSignal) => {
    receivedSignal = signal;
    return new Promise<never>(() => undefined);
  });
  const { component } = dashboard(vi.fn(), {
    searchProvider: { name: "brave", label: "Brave", search },
  });
  component.handleInput("\t");
  component.handleInput("\t");
  component.handleInput("t");
  await Promise.resolve();
  component.dispose();
  expect(receivedSignal?.aborted).toBe(true);
});

it("keeps the selected test visible in a ten-row window", () => {
  const names = Array.from({ length: 12 }, (_, index) => `provider-${index}`);
  const { component } = dashboard(vi.fn(), { searchProviderNames: names });
  component.handleInput("\t");
  component.handleInput("\t");
  for (let index = 0; index < 11; index += 1) component.handleInput("\u001b[B");

  const output = component.render(80).join("\n");
  expect(output).toContain("provider-11");
  expect(output).not.toContain("provider-0");
  expect(output).toContain("Showing 3–12 of 12");
});
```

The fixture extension must be a normal constructor option/registry double, not a production-only test setter.

- [ ] **Step 2: Run dashboard tests and verify failure**

```bash
pnpm exec vitest run tests/commands/tools-dashboard.test.ts
```

Expected: Test tab cases fail.

- [ ] **Step 3: Extend the component with async test state**

Add `registry: ProviderRegistry` to `DashboardOptions`, extend `DashboardTabId` to include `"test"`, and use the final tab order:

```ts
export type DashboardTabId = "providers" | "status" | "test" | "activity";

const TABS = [
  { id: "providers", label: "Providers" },
  { id: "status", label: "Status" },
  { id: "test", label: "Test" },
  { id: "activity", label: "Activity" },
] satisfies DashboardTab[];
```

Add fields:

```ts
private testIndex = 0;
private testAbortController?: AbortController;
private testResults: TestResult[] = [];
```

The Test tab provider list is `options.registry.getSearchProviderNames()`. Up/Down changes `testIndex` only while Test is active. Enter or `t` starts the selected test; `a` starts all. Each start must abort the previous controller, create a new one, clear/mark running state, and call `tui.requestRender()` before awaiting.

Use private async methods with stale-run protection:

```ts
private async testSelected(): Promise<void> {
  const names = this.options.registry.getSearchProviderNames();
  const name = names[this.testIndex];
  if (!name) return;
  const controller = this.beginTest();
  const result = await runProviderTest(name, this.options.registry, controller.signal);
  if (this.testAbortController !== controller) return;
  this.testResults = [result];
  this.testAbortController = undefined;
  this.options.tui.requestRender();
}
```

Implement `testAll()` the same way with `runProviderTests()`. `handleInput()` starts them with `void this.testSelected()`/`void this.testAll()` so it still satisfies `Component`.

Render provider selection plus inline result rows containing provider, `OK`/`FAIL`, latency, `${resultCount} results`, and message. Reuse the Phase 3 ten-row follow-selection calculation for Test providers and render the same `Showing X–Y of N` indicator. Truncate every line with `truncateVisible`. `dispose()` aborts and clears the controller before unsubscribing Activity and marking the component disposed.

- [ ] **Step 4: Run focused tests and commit**

```bash
pnpm exec vitest run tests/commands/tools-actions.test.ts tests/commands/tools-dashboard.test.ts
git add src/commands/tools-dashboard.ts tests/commands/tools-dashboard.test.ts
git commit -m "feat: add tools provider test tab"
```

---

### Task 3: Remove typed command dispatch and setup wizard

**Files:**
- Modify: `src/commands/tools.ts`
- Modify: `tests/commands/tools.test.ts`
- Delete: `src/commands/tools-setup.ts`
- Delete: `src/commands/tools-subcommands.ts`
- Delete: `tests/commands/tools-setup.test.ts`
- Delete: `tests/commands/tools-subcommands.test.ts`

- [ ] **Step 1: Replace legacy dispatch tests with migration tests**

Delete tests asserting execution of `status`, `reload`, `enable`, `disable`, `key`, `test`, `default`, `monitor`, `--status`, and `--reload`. Add one table-driven regression:

```ts
it.each([
  "status",
  "reload",
  "enable brave",
  "disable brave",
  "key brave SECRET",
  "test brave",
  "default brave",
  "monitor on",
  "--status",
  "--reload",
])("rejects typed argument %s without writes or reload", async (args) => {
  const ctx = makeCtx() as unknown as ExtensionCommandContext;
  (ctx.ui as any).custom = vi.fn();
  const deps = {
    getConfig: vi.fn(() => ({ providers: {}, defaultProvider: "auto" })),
    reload: vi.fn(),
  };
  const command = createToolsCommand(
    mem(),
    new Map<string, ProviderTier>(),
    ["brave"],
    deps,
  );

  await command.handler(args, ctx);

  expect(ctx.ui.notify).toHaveBeenCalledWith(
    expect.stringContaining("no longer supports typed subcommands"),
    "warning",
  );
  expect((ctx.ui as any).custom).not.toHaveBeenCalled();
  expect(fs.writeFileSync).not.toHaveBeenCalled();
  expect(deps.reload).not.toHaveBeenCalled();
});
```

Retain and update tests for empty-argument overlay, non-TUI warning, provider actions, scope switching, Activity widget persistence, and `resetMonitor()`. Add these mode regressions:

```ts
it("does not open an empty dashboard outside TUI mode", async () => {
  const ctx = makeCtx({
    mode: "rpc",
    hasUI: true,
  }) as unknown as ExtensionCommandContext;
  (ctx.ui as any).custom = vi.fn();
  const command = createToolsCommand(mem(), new Map(), [], {
    getConfig: () => ({ providers: {}, defaultProvider: "auto" }),
    reload: vi.fn(),
  });

  await command.handler("", ctx);

  expect((ctx.ui as any).custom).not.toHaveBeenCalled();
  expect(ctx.ui.notify).toHaveBeenCalledWith(
    expect.stringContaining("interactive TUI"),
    "warning",
  );
});

it("shows migration before the mode warning", async () => {
  const ctx = makeCtx({
    mode: "rpc",
    hasUI: true,
  }) as unknown as ExtensionCommandContext;
  (ctx.ui as any).custom = vi.fn();
  const command = createToolsCommand(mem(), new Map(), [], {
    getConfig: () => ({ providers: {}, defaultProvider: "auto" }),
    reload: vi.fn(),
  });

  await command.handler("status", ctx);

  expect(ctx.ui.notify).toHaveBeenCalledWith(
    expect.stringContaining("no longer supports typed subcommands"),
    "warning",
  );
  expect(ctx.ui.notify).not.toHaveBeenCalledWith(
    expect.stringContaining("interactive TUI"),
    "warning",
  );
});
```

- [ ] **Step 2: Run command tests and verify the migration case fails**

```bash
pnpm exec vitest run tests/commands/tools.test.ts
```

Expected: typed arguments still execute legacy paths.

- [ ] **Step 3: Simplify command entry and description**

Set:

```ts
const MIGRATION_HINT = `/tools no longer supports typed subcommands.
Use /tools (no arguments) to open the interactive dashboard.
The dashboard provides the previous status, provider, key, test, default, reload, and monitor actions through tabs.`;
```

At the top of `handler`, use the final guard order:

```ts
if (args.trim() !== "") {
  ctx.ui.notify(MIGRATION_HINT, "warning");
  return;
}
if (ctx.mode !== "tui") {
  ctx.ui.notify("/tools requires an interactive TUI", "warning");
  return;
}
```

Do not use `ctx.hasUI`: RPC reports `hasUI: true`, but its `ctx.ui.custom()` implementation cannot display a component.

After these guards, retain only the dashboard action loop from Phases 1–3. Remove `parseArgs`, every legacy switch branch, setup imports, subcommand imports, and `USAGE`. Update the command description to `Manage providers in an interactive dashboard.`

- [ ] **Step 4: Delete obsolete files**

```bash
rm src/commands/tools-setup.ts src/commands/tools-subcommands.ts
rm tests/commands/tools-setup.test.ts tests/commands/tools-subcommands.test.ts
```

Verify no surviving imports or handlers:

```bash
grep -RIn --include='*.ts' 'tools-setup\|tools-subcommands\|parseArgs\|handleEnhancedSetup\|handleToggle\|handleKey\|handleDefault\|handleTest' src tests
```

Expected: no matches.

- [ ] **Step 5: Run command and extension tests**

```bash
pnpm exec vitest run tests/commands/tools.test.ts tests/extension-load.test.ts
```

Expected: all tests pass, including shutdown wiring.

- [ ] **Step 6: Commit tabs-only migration**

```bash
git add -A
git commit -m "refactor: replace typed tools commands with dashboard"
```

---

### Task 4: Add final acceptance regressions

**Files:**
- Modify: `tests/commands/tools-actions.test.ts`
- Modify: `tests/commands/tools-dashboard.test.ts`
- Modify: `tests/commands/tools.test.ts`

- [ ] **Step 1: Confirm config safety matrix**

Ensure tests explicitly cover:

```text
Global existing valid JSON     -> narrow write, unknown fields preserved
Global missing file            -> create
Global malformed/non-object    -> no write
Global EACCES read              -> no write
Project nearest existing file  -> write nearest path
Project no existing file       -> write cwd/<CONFIG_DIR_NAME>/tools.json
Project untrusted              -> no write for toggle/key/default
Project trusted env-name key   -> write
Project literal/shell key      -> no read and no write
```

Each rejection must assert `writeFileSync` was not called. Each success must assert exact path and parsed content.

- [ ] **Step 2: Confirm dashboard interaction matrix**

Ensure tests explicitly cover:

```text
Tab / Shift-Tab wrap across Providers, Status, Test, Activity
Up / Down select provider or test row in the active tab
Left / Right return scope switch only on Providers
Enter returns toggle on Providers and starts one test on Test
k blocked when canEditKeys=false
d sets the selected provider as default on Providers
r returns reload only on Status
a sets default to auto on Providers
a starts all tests on Test
w returns toggle-widget only on Activity
reopening actions preserve activeTab and selectedProvider
q / Esc dispose and close from every tab
```

- [ ] **Step 3: Confirm rendering and secret safety**

For widths 40, 80, and 140, assert every rendered line satisfies `visibleWidth(line) <= width`. At width 140, assert `┏`, `┛`, and all four labels. At width 40, assert tab overflow remains bounded. With twelve Providers and twelve Test entries, move to the final row and assert each view shows rows 3–12, omits row 1, and renders `Showing 3–12 of 12`. Assert literal and shell credential values never appear in output.

- [ ] **Step 4: Confirm async and lifecycle behavior**

Assert the requestRender count increases by two from the count captured immediately before a test starts, provider errors become inline failures, the concrete deferred-promise stale-run test from Task 2 cannot replace current results or repaint, dispose aborts the active signal, Activity subscriptions are removed on dispose, one widget subscription exists at most, overlay close preserves the widget, and `resetMonitor()` clears widget/subscription/entries.

- [ ] **Step 5: Run focused acceptance tests and commit**

```bash
pnpm exec vitest run tests/commands/tools-actions.test.ts tests/commands/tools-dashboard.test.ts tests/commands/tools.test.ts
git add tests/commands
git commit -m "test: cover tools dashboard acceptance behavior"
```

Expected: all focused tests pass.

---

### Task 5: Final verification

- [ ] **Step 1: Run changed-file formatting, lint, typecheck, and full suite**

```bash
pnpm exec biome format src/commands/tools-actions.ts src/commands/tools-dashboard.ts src/commands/tools.ts tests/commands/tools-actions.test.ts tests/commands/tools-dashboard.test.ts tests/commands/tools.test.ts
pnpm exec biome lint src tests
pnpm exec tsc --noEmit
pnpm check
```

Expected: every command exits successfully. Formatting is intentionally scoped to Phase 4 files because the repository has unrelated baseline formatting debt; `biome format --check` is not a valid Biome 2.5.4 command.

- [ ] **Step 2: Verify import/dependency constraints**

```bash
grep -RIn --include='*.ts' 'pi-usage' src || true
grep -RIn --include='*.ts' 'ctx.hasUI\|path.join(".pi"' src/commands src/config.ts || true
git diff -- package.json pnpm-lock.yaml
```

Expected: no `pi-usage` imports, no obsolete `ctx.hasUI` overlay guard or hardcoded project config directory, and no package/lockfile changes.

- [ ] **Step 3: Verify old behavior is absent and final files exist**

```bash
test ! -e src/commands/tools-setup.ts
test ! -e src/commands/tools-subcommands.ts
test -e src/commands/tools-actions.ts
test -e src/commands/tools-dashboard.ts
grep -RIn --include='*.ts' 'tools-setup\|tools-subcommands\|parseArgs' src tests || true
```

Expected: obsolete files and imports are absent; dashboard/action files exist.

- [ ] **Step 4: Review the complete implementation range**

```bash
git diff --check
git status --short
git log --oneline --decorate -12
```

Expected: no whitespace errors, a clean worktree after commits, and only planned implementation/test changes in the phase series.

- [ ] **Step 5: Do not create an empty verification commit**

If verification requires a correction, make the smallest targeted change, rerun the failing command plus `pnpm check`, and commit that correction with a message describing the actual fix.
