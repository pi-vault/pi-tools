# /tools Dashboard Refactor Phase 4: Provider Tests and Tabs-Only Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the four-tab `/tools` dashboard with abortable provider tests, then remove the setup wizard and typed subcommands.

**Architecture:** Add provider-test functions to `tools-actions.ts`, inject the existing `ProviderRegistry` into `ToolsDashboardComponent`, and keep each run's `AbortController` inside the component. After the Test tab reaches parity, make `tools.ts` reject every non-empty argument and delete the two legacy command modules.

**Tech Stack:** TypeScript, Pi 0.80.10 TUI, `AbortController`, existing `ProviderRegistry`, Vitest, Biome.

**Prerequisite:** Phases 1–3 are merged. At replan time, `pnpm check` passes with 88 test files and 1,395 tests; existing Biome diagnostics are warnings/infos only.

**Reference constraints:**

- Pi's `SearchProvider.search()` receives the raw `AbortSignal` as positional argument three.
- Pi RPC reports `mode: "rpc"`; its `ui.custom()` returns `undefined` because custom components require TUI mode. Guard with `ctx.mode === "tui"`, not `ctx.hasUI`.
- Pi disposes a custom component after `done()`. `ToolsDashboardComponent.dispose()` must therefore be idempotent.
- Follow `pi-usage`: cancel work on `q`/Escape, request a render when async state changes, and release listeners during component cleanup.
- Provider tests are real searches through `ProviderRegistry`, matching the legacy typed test, so they consume normal provider quota and budget.

---

## File map

- Modify `src/commands/tools-actions.ts`: provider test result type and one/all runners.
- Modify `tests/commands/tools-actions.test.ts`: signal, result, failure, sequence, and abort coverage.
- Modify `src/commands/tools-dashboard.ts`: Test tab, selection, inline state, cancellation, and Providers-only scope keys.
- Modify `tests/commands/tools-dashboard.test.ts`: current fixture wiring and missing Phase 4 interaction/lifecycle regressions.
- Modify `src/commands/tools.ts`: inject the registry, reject arguments, and remove legacy dispatch.
- Modify `tests/commands/tools.test.ts`: registry wiring, direct status-table tests, migration behavior, and retained dashboard/widget regressions.
- Delete `src/commands/tools-setup.ts` and `src/commands/tools-subcommands.ts`.
- Delete `tests/commands/tools-setup.test.ts` and `tests/commands/tools-subcommands.test.ts`.
- Verify `src/index.ts`: keep `session_shutdown -> toolsCommand.resetMonitor()` unchanged.

---

### Task 1: Add abortable provider test actions

**Files:**

- Modify: `src/commands/tools-actions.ts`
- Modify: `tests/commands/tools-actions.test.ts`

- [ ] **Step 1: Add failing action tests**

Add `runProviderTest` and `runProviderTests` to the existing import from `tools-actions.ts`, then append:

```ts
describe("provider tests", () => {
  it("passes the raw AbortSignal as search argument three", async () => {
    const search = vi.fn().mockResolvedValue([{ url: "https://example.com" }]);
    const registry = {
      selectSearchCandidates: vi.fn(() => [
        { name: "brave", label: "Brave", search },
      ]),
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

  it("returns a failed result for an unavailable provider", async () => {
    const registry = { selectSearchCandidates: vi.fn(() => []) } as never;

    await expect(
      runProviderTest("missing", registry, new AbortController().signal),
    ).resolves.toEqual({
      provider: "missing",
      ok: false,
      latencyMs: 0,
      resultCount: 0,
      message: "not found or not enabled",
    });
  });

  it("converts provider rejection into a failed result", async () => {
    const registry = {
      selectSearchCandidates: vi.fn(() => [
        {
          name: "brave",
          label: "Brave",
          search: vi.fn().mockRejectedValue(new Error("network down")),
        },
      ]),
    } as never;

    await expect(
      runProviderTest("brave", registry, new AbortController().signal),
    ).resolves.toMatchObject({
      provider: "brave",
      ok: false,
      resultCount: 0,
      message: "network down",
    });
  });

  it("normalizes caller cancellation to aborted", async () => {
    const controller = new AbortController();
    const registry = {
      selectSearchCandidates: vi.fn(() => [
        {
          name: "brave",
          label: "Brave",
          search: vi.fn(async () => {
            controller.abort();
            throw new DOMException("cancelled", "AbortError");
          }),
        },
      ]),
    } as never;

    await expect(
      runProviderTest("brave", registry, controller.signal),
    ).resolves.toMatchObject({
      ok: false,
      message: "aborted",
    });
  });

  it("runs providers sequentially and does not start the next after abort", async () => {
    const controller = new AbortController();
    const firstSearch = vi.fn(async () => {
      controller.abort();
      throw new DOMException("cancelled", "AbortError");
    });
    const secondSearch = vi.fn().mockResolvedValue([]);
    const registry = {
      selectSearchCandidates: vi.fn((name: string) =>
        name === "first"
          ? [{ name: "first", label: "First", search: firstSearch }]
          : [{ name: "second", label: "Second", search: secondSearch }],
      ),
    } as never;

    const results = await runProviderTests(
      registry,
      ["first", "second"],
      controller.signal,
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ provider: "first", message: "aborted" });
    expect(secondSearch).not.toHaveBeenCalled();
    expect(registry.selectSearchCandidates).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the red state**

```bash
pnpm exec vitest run tests/commands/tools-actions.test.ts
```

Expected: FAIL because `runProviderTest` and `runProviderTests` are not exported.

- [ ] **Step 3: Implement the minimal action contract**

Add the registry type import:

```ts
import type { ProviderRegistry } from "../providers/registry.ts";
```

Add the result type and runners after `CredentialClass`:

```ts
export interface TestResult {
  provider: string;
  ok: boolean;
  latencyMs: number;
  resultCount: number;
  message: string;
}

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

Do not pass `{ signal }`; the provider API requires the raw signal as argument three.

- [ ] **Step 4: Format, verify, and commit**

```bash
pnpm exec biome format --write src/commands/tools-actions.ts tests/commands/tools-actions.test.ts
pnpm exec vitest run tests/commands/tools-actions.test.ts
pnpm exec tsc --noEmit
git add src/commands/tools-actions.ts tests/commands/tools-actions.test.ts
git commit -m "feat: add abortable provider test actions"
```

Expected: all commands pass.

---

### Task 2: Add the Test tab and wire the registry

**Files:**

- Modify: `src/commands/tools-dashboard.ts`
- Modify: `tests/commands/tools-dashboard.test.ts`
- Modify: `src/commands/tools.ts`
- Modify: `tests/commands/tools.test.ts`

- [ ] **Step 1: Extend the existing dashboard fixture without a production test setter**

In `tests/commands/tools-dashboard.test.ts`, import the registry and search-provider types:

```ts
import type { ProviderRegistry } from "../../src/providers/registry.ts";
import type {
  ProviderTier,
  SearchProvider,
  SearchResult,
} from "../../src/providers/types.ts";
```

Replace the current `ProviderTier`-only import and add this helper before `dashboard()`:

```ts
function searchRegistry(
  providers: SearchProvider[] = [
    {
      name: "brave",
      label: "Brave",
      search: vi.fn().mockResolvedValue([]),
    },
  ],
): ProviderRegistry {
  const byName = new Map(
    providers.map((provider) => [provider.name, provider]),
  );
  return {
    getSearchProviderNames: vi.fn(() => [...byName.keys()]),
    selectSearchCandidates: vi.fn((name?: string) => {
      if (!name) return [...byName.values()];
      const provider = byName.get(name);
      return provider ? [provider] : [];
    }),
  } as unknown as ProviderRegistry;
}

function searchResult(url: string): SearchResult {
  return { title: "Test", url, snippet: "" };
}
```

Replace `dashboard()` with the current fixture plus registry injection:

```ts
function dashboard(
  overrides: Partial<Omit<DashboardOptions, "tui" | "theme" | "done">> = {},
  done = vi.fn(),
) {
  const tui = { requestRender: vi.fn() };
  const registry = overrides.registry ?? searchRegistry();
  const options: DashboardOptions = {
    tui: tui as never,
    theme: noTheme,
    registry,
    providerNames: ["brave", "duckduckgo"],
    tierMap: new Map<string, ProviderTier>([
      ["brave", 1],
      ["duckduckgo", 3],
    ]),
    config: providerState,
    scope: { kind: "global", path: "/tmp/tools.json", canWrite: true },
    renderStatusTable: () => "Provider  Tier\nbrave    1",
    getActivity: () => [],
    subscribeActivity: vi.fn((_listener: () => void) => vi.fn()),
    widgetEnabled: false,
    done,
    ...overrides,
  };
  return {
    done,
    tui,
    registry: options.registry,
    component: new ToolsDashboardComponent(options),
  };
}
```

- [ ] **Step 2: Add failing Test-tab and contextual-key regressions**

Replace the existing three-tab cycle test with:

```ts
it("cycles Providers, Status, Test, Activity and wraps both ways", () => {
  const { component, tui } = dashboard();

  expect(component.render(80).join("\n")).toContain("Enter Toggle");
  component.handleInput("\t");
  expect(component.render(80).join("\n")).toContain("r Reload");
  component.handleInput("\t");
  expect(component.render(80).join("\n")).toContain("Enter/t Test");
  component.handleInput("\t");
  expect(component.render(80).join("\n")).toContain("w Enable widget");
  component.handleInput("\t");
  expect(component.render(80).join("\n")).toContain("Enter Toggle");
  component.handleInput("\u001b[Z");
  expect(component.render(80).join("\n")).toContain("w Enable widget");
  expect(tui.requestRender).toHaveBeenCalledTimes(5);
});
```

Add:

```ts
it("switches scope only from Providers", () => {
  const providers = dashboard();
  providers.component.handleInput("\u001b[D");
  expect(providers.done).toHaveBeenCalledWith({
    type: "switch-scope",
    activeTab: "providers",
    selectedProvider: "brave",
  });

  for (const tab of ["status", "test", "activity"] as const) {
    for (const key of ["\u001b[D", "\u001b[C"]) {
      const instance = dashboard({ initialTab: tab });
      instance.component.handleInput(key);
      expect(instance.done).not.toHaveBeenCalled();
    }
  }
});

it("tests the selected provider and repaints before and after", async () => {
  const search = vi
    .fn()
    .mockResolvedValue([searchResult("https://example.com")]);
  const registry = searchRegistry([{ name: "brave", label: "Brave", search }]);
  const { component, tui } = dashboard({ registry, initialTab: "test" });
  const before = tui.requestRender.mock.calls.length;

  component.handleInput("\r");

  await vi.waitFor(() => {
    expect(component.render(140).join("\n")).toContain("1 result");
  });
  expect(search).toHaveBeenCalledWith("test", 1, expect.any(AbortSignal));
  expect(tui.requestRender.mock.calls.length - before).toBe(2);
});

it("tests every registered search provider with a, even in read-only scope", async () => {
  const brave = vi.fn().mockResolvedValue([]);
  const exa = vi.fn().mockResolvedValue([searchResult("https://example.com")]);
  const registry = searchRegistry([
    { name: "brave", label: "Brave", search: brave },
    { name: "exa", label: "Exa", search: exa },
  ]);
  const { component } = dashboard({
    registry,
    initialTab: "test",
    scope: { kind: "project", path: "/repo/.pi/tools.json", canWrite: false },
  });

  component.handleInput("a");

  await vi.waitFor(() => {
    expect(component.render(140).join("\n")).toContain("exa");
    expect(exa).toHaveBeenCalledOnce();
  });
  expect(brave).toHaveBeenCalledOnce();
});

it("ignores a replaced provider test after the newer run finishes", async () => {
  let resolveFirst!: (value: SearchResult[]) => void;
  let resolveSecond!: (value: SearchResult[]) => void;
  const first = new Promise<SearchResult[]>((resolve) => {
    resolveFirst = resolve;
  });
  const second = new Promise<SearchResult[]>((resolve) => {
    resolveSecond = resolve;
  });
  const search = vi
    .fn()
    .mockImplementationOnce(() => first)
    .mockImplementationOnce(() => second);
  const registry = searchRegistry([{ name: "brave", label: "Brave", search }]);
  const { component, tui } = dashboard({ registry, initialTab: "test" });

  component.handleInput("t");
  component.handleInput("t");
  resolveSecond([searchResult("one"), searchResult("two")]);
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

it("aborts and ignores a provider test completed after dispose", async () => {
  let receivedSignal: AbortSignal | undefined;
  let resolveSearch!: (value: SearchResult[]) => void;
  const search = vi.fn(
    (_query: string, _count: number, signal?: AbortSignal) => {
      receivedSignal = signal;
      return new Promise<SearchResult[]>((resolve) => {
        resolveSearch = resolve;
      });
    },
  );
  const registry = searchRegistry([{ name: "brave", label: "Brave", search }]);
  const { component, tui } = dashboard({ registry, initialTab: "test" });

  component.handleInput("t");
  await Promise.resolve();
  component.dispose();
  const rendersAfterDispose = tui.requestRender.mock.calls.length;
  resolveSearch([]);
  await Promise.resolve();
  await Promise.resolve();

  expect(receivedSignal?.aborted).toBe(true);
  expect(tui.requestRender).toHaveBeenCalledTimes(rendersAfterDispose);
  expect(component.render(140).join("\n")).not.toContain("0 results");
});

it.each([
  ["q", "q"],
  ["Escape", "\u001b"],
] as const)(
  "aborts an active provider test on %s and keeps cleanup idempotent",
  async (_label, key) => {
    let receivedSignal: AbortSignal | undefined;
    let resolveSearch!: (value: SearchResult[]) => void;
    const search = vi.fn(
      (_query: string, _count: number, signal?: AbortSignal) => {
        receivedSignal = signal;
        return new Promise<SearchResult[]>((resolve) => {
          resolveSearch = resolve;
        });
      },
    );
    const unsubscribe = vi.fn();
    const registry = searchRegistry([{ name: "brave", label: "Brave", search }]);
    const instance = dashboard({
      registry,
      initialTab: "test",
      subscribeActivity: vi.fn(() => unsubscribe),
    });

    instance.component.handleInput("t");
    await Promise.resolve();
    instance.component.handleInput(key);
    instance.component.dispose();
    const rendersAfterClose = instance.tui.requestRender.mock.calls.length;
    resolveSearch([]);
    await Promise.resolve();
    await Promise.resolve();

    expect(receivedSignal?.aborted).toBe(true);
    expect(instance.done).toHaveBeenCalledOnce();
    expect(instance.done).toHaveBeenCalledWith({ type: "close" });
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(instance.tui.requestRender).toHaveBeenCalledTimes(rendersAfterClose);
    expect(instance.component.render(140).join("\n")).not.toContain("0 results");
  },
);

it("restores and keeps the selected Test provider in a ten-row window", () => {
  const providers = Array.from({ length: 12 }, (_, index) => ({
    name: `provider-${index + 1}`,
    label: `Provider ${index + 1}`,
    search: vi.fn().mockResolvedValue([]),
  }));
  const { component } = dashboard({
    registry: searchRegistry(providers),
    initialTab: "test",
    initialProvider: "provider-12",
  });
  const output = component.render(80).join("\n");

  expect(output).toContain("> provider-12");
  expect(output).toContain("Showing 3–12 of 12");
  expect(output).not.toContain("provider-1 ");
});
```

Replace the width and close tests with:

```ts
it.each([40, 80, 140])("keeps every tab within width %i", (width) => {
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
  for (const tab of ["providers", "status", "test", "activity"] as const) {
    const lines = dashboard({
      initialTab: tab,
      getActivity: () => entries,
    }).component.render(width);
    expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
    if (width === 140) {
      const output = lines.join("\n");
      expect(output).toContain("┏");
      expect(output).toContain("┛");
      for (const label of ["Providers", "Status", "Test", "Activity"]) {
        expect(output).toContain(label);
      }
    }
  }
});

it.each([
  ["providers", "q"],
  ["providers", "\u001b"],
  ["status", "q"],
  ["status", "\u001b"],
  ["test", "q"],
  ["test", "\u001b"],
  ["activity", "q"],
  ["activity", "\u001b"],
] as const)("closes %s with %j", (initialTab, key) => {
  const instance = dashboard({ initialTab });
  instance.component.handleInput(key);
  expect(instance.done).toHaveBeenCalledWith({ type: "close" });
});
```

- [ ] **Step 3: Run the dashboard tests and confirm the red state**

```bash
pnpm exec vitest run tests/commands/tools-dashboard.test.ts
```

Expected: FAIL because the Test tab and required `registry` option do not exist, and scope arrows still act globally.

- [ ] **Step 4: Add the Test tab state and rendering**

In `src/commands/tools-dashboard.ts`:

1. Add the registry import and replace the existing actions import:

```ts
import type { ProviderRegistry } from "../providers/registry.ts";
import {
  classifyCredential,
  runProviderTest,
  runProviderTests,
  type TestResult,
} from "./tools-actions.ts";
```

2. Extend `DashboardTabId` and `TABS` to the final order:

```ts
export type DashboardTabId = "providers" | "status" | "test" | "activity";

const TABS = [
  { id: "providers", label: "Providers" },
  { id: "status", label: "Status" },
  { id: "test", label: "Test" },
  { id: "activity", label: "Activity" },
] satisfies DashboardTab[];
```

3. Add `registry: ProviderRegistry` to `DashboardOptions`.
4. Add these fields:

```ts
private testIndex: number;
private testAbortController?: AbortController;
private testResults: TestResult[] = [];
```

Initialize `testIndex` in the constructor immediately after `providerIndex`:

```ts
const testNames = options.registry.getSearchProviderNames();
const initialTestIndex = options.initialProvider
  ? testNames.indexOf(options.initialProvider)
  : -1;
this.testIndex = initialTestIndex >= 0 ? initialTestIndex : 0;
```

5. Extract the existing Providers window calculation for reuse:

```ts
function visibleRange(
  index: number,
  total: number,
): { start: number; end: number } {
  const count = Math.min(10, total);
  const start = Math.max(
    0,
    Math.min(index - Math.floor(count / 2), total - count),
  );
  return { start, end: start + count };
}
```

Replace the inline Providers range calculation with:

```ts
const { start, end } = visibleRange(this.providerIndex, providerNames.length);
```

6. Extend `render()` with the Test branch:

```ts
const content =
  this.activeTab === "providers"
    ? this.renderProviders(contentWidth)
    : this.activeTab === "status"
      ? this.renderStatus(contentWidth)
      : this.activeTab === "test"
        ? this.renderTest(contentWidth)
        : this.renderActivity(contentWidth);
```

Add bounded inline Test rendering:

```ts
private renderTest(contentWidth: number): string[] {
  const names = this.options.registry.getSearchProviderNames();
  const lines = [
    truncateVisible(
      this.testAbortController ? "Testing…" : "Enter/t Test • a Test all",
      contentWidth,
    ),
    "",
  ];
  if (names.length === 0) {
    return [...lines, this.options.theme.dim("No enabled search providers")];
  }

  const { start, end } = visibleRange(this.testIndex, names.length);
  for (let index = start; index < end; index += 1) {
    const name = names[index];
    const result = this.testResults.find((candidate) => candidate.provider === name);
    const detail = result
      ? `${result.ok ? "OK" : "FAIL"} • ${result.latencyMs}ms • ${result.resultCount} result${result.resultCount === 1 ? "" : "s"}${result.message === "OK" ? "" : ` • ${result.message}`}`
      : "";
    const row = truncateVisible(
      `${padVisible(index === this.testIndex ? ">" : "", 2)}${padVisible(truncateVisible(name, 20), 20)} ${detail}`,
      contentWidth,
    );
    lines.push(index === this.testIndex ? this.options.theme.inverse(row) : row);
  }
  lines.push(truncateVisible(`Showing ${start + 1}–${end} of ${names.length}`, contentWidth));
  return lines;
}
```

7. Delete the global Left/Right block from `handleInput()`. Add scope switching at the start of `handleProviderInput()`:

```ts
if (matchesKey(data, Key.left) || matchesKey(data, Key.right)) {
  this.finish({ type: "switch-scope", ...this.resume() });
  return;
}
```

Add Test dispatch between Providers and Status handling:

```ts
if (this.activeTab === "test") {
  this.handleTestInput(data);
  return;
}
```

Add the contextual Test keys:

```ts
private handleTestInput(data: string): void {
  const names = this.options.registry.getSearchProviderNames();
  if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
    const delta = matchesKey(data, Key.up) ? -1 : 1;
    this.testIndex = Math.max(0, Math.min(this.testIndex + delta, names.length - 1));
    this.options.tui.requestRender();
    return;
  }
  if (matchesKey(data, Key.enter) || data === "t") {
    void this.testSelected();
  } else if (data === "a") {
    void this.testAll();
  }
}
```

These Test keys remain available in read-only Project scope because they do not mutate config.

Replace `renderFooter()`'s action selection with:

```ts
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

8. Add the run helpers:

```ts
private beginTest(): AbortController {
  this.testAbortController?.abort();
  const controller = new AbortController();
  this.testAbortController = controller;
  this.testResults = [];
  this.options.tui.requestRender();
  return controller;
}

private async testSelected(): Promise<void> {
  const names = this.options.registry.getSearchProviderNames();
  const name = names[this.testIndex];
  if (!name) return;
  const controller = this.beginTest();
  const result = await runProviderTest(name, this.options.registry, controller.signal);
  if (this.disposed || this.testAbortController !== controller) return;
  this.testResults = [result];
  this.testAbortController = undefined;
  this.options.tui.requestRender();
}

private async testAll(): Promise<void> {
  const names = this.options.registry.getSearchProviderNames();
  if (names.length === 0) return;
  const controller = this.beginTest();
  const results = await runProviderTests(this.options.registry, names, controller.signal);
  if (this.disposed || this.testAbortController !== controller) return;
  this.testResults = results;
  this.testAbortController = undefined;
  this.options.tui.requestRender();
}
```

9. Make cleanup idempotent and invalidate controller identity before releasing the Activity subscription:

```ts
dispose(): void {
  if (this.disposed) return;
  this.disposed = true;
  this.testAbortController?.abort();
  this.testAbortController = undefined;
  const unsubscribe = this.activityUnsubscribe;
  this.activityUnsubscribe = undefined;
  unsubscribe?.();
}
```

Keep the existing global `q`/Escape branch: it calls `finish({ type: "close" })`, which calls `dispose()` before `done()`. Pi then calls `dispose()` again, so the idempotence guard is required.

10. Replace `resume()` so `initialProvider` remains meaningful for either provider-bearing tab:

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

- [ ] **Step 5: Wire the existing registry through `tools.ts` and test it**

In the `ToolsDashboardComponent` options inside `src/commands/tools.ts`, add:

```ts
registry,
```

In `tests/commands/tools.test.ts`, add this assertion to `loads scope-effective config for Global and Project dashboards` after the command runs:

```ts
expect(captures[0].registry).toBe(registry);
```

Name the registry before command construction so the same object is passed to `createToolsCommand()` and asserted:

```ts
const registry = mem();
const command = createToolsCommand(
  registry,
  new Map([["brave", 1]]),
  ["brave", "duckduckgo"],
  deps,
);
```

- [ ] **Step 6: Format, verify, and commit**

```bash
pnpm exec biome format --write src/commands/tools-dashboard.ts src/commands/tools.ts tests/commands/tools-dashboard.test.ts tests/commands/tools.test.ts
pnpm exec vitest run tests/commands/tools-actions.test.ts tests/commands/tools-dashboard.test.ts tests/commands/tools.test.ts
pnpm exec tsc --noEmit
git add src/commands/tools-dashboard.ts src/commands/tools.ts tests/commands/tools-dashboard.test.ts tests/commands/tools.test.ts
git commit -m "feat: add tools provider test tab"
```

Expected: all commands pass. No package or lockfile changes.

---

### Task 3: Remove typed dispatch and obsolete modules

**Files:**

- Modify: `src/commands/tools.ts`
- Modify: `tests/commands/tools.test.ts`
- Delete: `src/commands/tools-setup.ts`
- Delete: `src/commands/tools-subcommands.ts`
- Delete: `tests/commands/tools-setup.test.ts`
- Delete: `tests/commands/tools-subcommands.test.ts`

- [ ] **Step 1: Preserve status formatting coverage without a typed command**

In `tests/commands/tools.test.ts`, import `buildStatusTable` with `createToolsCommand`. Rename `describe("tools status subcommand", ...)` to `describe("buildStatusTable", ...)` and change each status test to call:

```ts
const output = buildStatusTable(registry, tierMap);
```

Remove command/context setup and notification extraction from those tests. Delete the legacy `--status` case and the entire `describe("tools reload subcommand", ...)` block.

- [ ] **Step 2: Replace legacy dispatch tests with migration tests**

Delete the config-mutation cases from `describe("tools subcommand dispatch", ...)`, its existing non-TUI warning and typed provider-test RPC cases, and the entire `describe("tools monitor subcommand", ...)` block. Keep the empty overlay, dashboard reopen, dashboard widget lifecycle, and provider dashboard action tests.

Add:

```ts
describe("tools tabs-only migration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

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
    "unknown",
  ])("rejects typed argument %s without side effects", async (args) => {
    const ctx = makeCtx() as unknown as ExtensionCommandContext;
    (ctx.ui as any).custom = vi.fn();
    const deps = commandDeps();
    const command = createToolsCommand(mem(), new Map(), ["brave"], deps);

    await command.handler(args, ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("no longer supports typed subcommands"),
      "warning",
    );
    expect((ctx.ui as any).custom).not.toHaveBeenCalled();
    expect(fs.readFileSync).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(deps.reload).not.toHaveBeenCalled();
  });

  it("does not open an empty dashboard outside TUI mode", async () => {
    const ctx = makeCtx({
      mode: "rpc",
      hasUI: true,
    }) as unknown as ExtensionCommandContext;
    (ctx.ui as any).custom = vi.fn();
    const command = createToolsCommand(mem(), new Map(), [], commandDeps());

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
    const command = createToolsCommand(mem(), new Map(), [], commandDeps());

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
});
```

- [ ] **Step 3: Run the command tests and confirm the red state**

```bash
pnpm exec vitest run tests/commands/tools.test.ts
```

Expected: FAIL because typed arguments still execute legacy branches.

- [ ] **Step 4: Make `/tools` tabs-only**

In `src/commands/tools.ts`, delete the import from `tools-subcommands.ts` and delete `USAGE`. Add:

```ts
const MIGRATION_HINT = `/tools no longer supports typed subcommands.
Use /tools (no arguments) to open the interactive dashboard.
The dashboard provides the previous status, provider, key, test, default, reload, and monitor actions through tabs.`;
```

Replace the handler with the final guard order and existing dashboard loop:

```ts
async handler(args: string, ctx: ExtensionCommandContext) {
  if (args.trim() !== "") {
    ctx.ui.notify(MIGRATION_HINT, "warning");
    return;
  }
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/tools requires an interactive TUI", "warning");
    return;
  }

  let selectedScope: ConfigScope = "global";
  let resumeState: DashboardResumeState = { activeTab: "providers" };
  while (true) {
    const scope: DashboardScope =
      selectedScope === "global"
        ? { kind: "global", path: getConfigPath(), canWrite: true }
        : {
            kind: "project",
            path: findWritableProjectPath(ctx.cwd),
            canWrite: ctx.isProjectTrusted(),
          };
    const config = deps.getConfig(selectedScope);
    const action = await ctx.ui.custom<DashboardAction>(
      (tui, theme, _keybindings, done) =>
        new ToolsDashboardComponent({
          tui,
          theme: fromPiTheme(theme),
          registry,
          providerNames: allProviderNames,
          tierMap,
          config,
          scope,
          renderStatusTable: () => buildStatusTable(registry, tierMap),
          getActivity: () => activityMonitor.getEntries(),
          subscribeActivity: (listener) => activityMonitor.onUpdate(listener),
          widgetEnabled: isWidgetEnabled(),
          initialTab: resumeState.activeTab,
          initialProvider: resumeState.selectedProvider,
          done,
        }),
      {
        overlay: true,
        overlayOptions: { anchor: "center", maxHeight: "85%", width: "92%" },
      },
    );
    if (!action || action.type === "close") return;
    resumeState = {
      activeTab: action.activeTab,
      selectedProvider: action.selectedProvider,
    };
    if (action.type === "switch-scope") {
      if (selectedScope === "project") {
        selectedScope = "global";
      } else if (ctx.isProjectTrusted() || findProjectConfigPath(ctx.cwd)) {
        selectedScope = "project";
      } else {
        ctx.ui.notify(
          "Project scope requires trust or an existing project config",
          "warning",
        );
      }
      continue;
    }
    if (action.type === "toggle-widget") {
      setWidget(ctx, !isWidgetEnabled());
      continue;
    }
    await applyDashboardAction(action, ctx, scope, config, allProviderNames, deps);
  }
}
```

Delete everything from `parseArgs(args)` through the legacy switch.

Set the command description to:

```ts
description: "Manage providers in an interactive dashboard.",
```

- [ ] **Step 5: Delete the legacy modules and tests**

```bash
rm src/commands/tools-setup.ts src/commands/tools-subcommands.ts
rm tests/commands/tools-setup.test.ts tests/commands/tools-subcommands.test.ts
```

Verify no surviving reference:

```bash
! grep -RIn --include='*.ts' 'tools-setup\|tools-subcommands' src tests
```

Expected: command exits successfully with no matches.

- [ ] **Step 6: Format, verify, and commit**

```bash
pnpm exec biome format --write src/commands/tools.ts tests/commands/tools.test.ts
pnpm exec vitest run tests/commands/tools.test.ts tests/commands/tools-dashboard.test.ts tests/extension-load.test.ts
pnpm exec tsc --noEmit
git add -A
git commit -m "refactor: replace typed tools commands with dashboard"
```

Expected: all commands pass and the four obsolete files are deleted.

---

### Task 4: Final acceptance verification

- [ ] **Step 1: Run focused Phase 4 tests**

```bash
pnpm exec vitest run tests/commands/tools-actions.test.ts tests/commands/tools-dashboard.test.ts tests/commands/tools.test.ts tests/extension-load.test.ts
```

Expected: provider actions, all four tabs, async cancellation/stale-run protection, migration, dashboard actions, and extension loading pass.

- [ ] **Step 2: Run changed-file formatting, lint, typecheck, and the full suite**

```bash
pnpm exec biome format --write src/commands/tools-actions.ts src/commands/tools-dashboard.ts src/commands/tools.ts tests/commands/tools-actions.test.ts tests/commands/tools-dashboard.test.ts tests/commands/tools.test.ts
pnpm exec biome lint src/commands/tools-actions.ts src/commands/tools-dashboard.ts src/commands/tools.ts tests/commands/tools-actions.test.ts tests/commands/tools-dashboard.test.ts tests/commands/tools.test.ts
pnpm exec tsc --noEmit
pnpm check
```

Expected: every command exits successfully. Existing repository-wide Biome warnings/infos may remain; Phase 4 must add no errors.

- [ ] **Step 3: Verify boundaries and deletions**

```bash
test ! -e src/commands/tools-setup.ts
test ! -e src/commands/tools-subcommands.ts
test ! -e tests/commands/tools-setup.test.ts
test ! -e tests/commands/tools-subcommands.test.ts
test -e src/commands/tools-actions.ts
test -e src/commands/tools-dashboard.ts
! grep -RIn --include='*.ts' 'tools-setup\|tools-subcommands' src tests
grep -n 'toolsCommand.resetMonitor' src/index.ts
! grep -RIn --include='*.ts' 'pi-usage' src
git diff -- package.json pnpm-lock.yaml
```

Expected: obsolete modules/tests are absent, shutdown cleanup remains wired, there are no runtime `pi-usage` imports, and package files have no diff.

- [ ] **Step 4: Review repository state**

```bash
git diff --check
git status --short
git log --oneline --decorate -12
```

Expected: no whitespace errors, a clean worktree after the three implementation commits, and only the planned source/test/deletion changes in this phase.

Do not create an empty verification commit. If verification exposes a defect, make the smallest targeted correction, rerun the failing command and `pnpm check`, then commit only that correction.
