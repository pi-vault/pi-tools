# /tools Dashboard Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace typed `/tools` subcommands with a safe four-tab overlay dashboard matching `/usage`.

**Architecture:** Port the `/usage` rendering shell into `src/tui/`. Keep file/config mutations and provider tests in `tools-actions.ts`; keep rendering and keyboard state in `tools-dashboard.ts`; keep command orchestration and persistent activity-widget ownership in `tools.ts`. Use action results from the component so prompts and file writes happen outside the overlay component.

**Tech Stack:** TypeScript, `@earendil-works/pi-tui`, `@earendil-works/pi-coding-agent`, Node `fs/path`, Vitest, Biome.

---

## File map

- Create `src/tui/dashboard-theme.ts`: copied theme adapter plus ANSI-safe helpers from `pi-usage`.
- Create `src/tui/overlay-render.ts`: copied frame/tab-bar helpers from `pi-usage`.
- Create `src/commands/tools-actions.ts`: safe config document mutation, scope/path policy, key validation, provider test execution.
- Create `src/commands/tools-dashboard.ts`: four-tab `Component`; no filesystem access.
- Modify `src/commands/tools.ts`: dashboard loop, migration hint, status-table reuse, widget lifecycle.
- Modify `src/index.ts`: preserve and verify session-shutdown cleanup wiring.
- Modify `tests/commands/tools.test.ts`: dispatch, status-table, and action integration coverage.
- Create `tests/commands/tools-actions.test.ts`: filesystem/security/test-runner coverage.
- Create `tests/commands/tools-dashboard.test.ts`: rendering, keyboard, repaint, and lifecycle coverage.
- Delete `src/commands/tools-setup.ts`, `src/commands/tools-subcommands.ts`, and their obsolete tests after their behavior has migrated.

Reference files:

- `/Users/lanh/Developer/pi-vault/pi-usage/src/tui/dashboard-theme.ts`
- `/Users/lanh/Developer/pi-vault/pi-usage/src/tui/overlay-render.ts`
- `/Users/lanh/Developer/pi-vault/pi-usage/src/tui/dashboard.ts`
- `/Users/lanh/Developer/pi-packages/pi/packages/coding-agent/docs/tui.md`

Use `pnpm exec ...` for checks because this repository is pnpm-managed.

---

### Task 1: Port and test the `/usage` overlay shell

**Files:**

- Create: `src/tui/dashboard-theme.ts`
- Create: `src/tui/overlay-render.ts`
- Create: `tests/tui/overlay-render.test.ts`
- Create: `tests/tui/dashboard-theme.test.ts`

- [ ] **Step 1: Copy the two reference modules into `src/tui/`**

Run:

```bash
cp /Users/lanh/Developer/pi-vault/pi-usage/src/tui/dashboard-theme.ts src/tui/dashboard-theme.ts
cp /Users/lanh/Developer/pi-vault/pi-usage/src/tui/overlay-render.ts src/tui/overlay-render.ts
```

Make these two changes while copying:

1. Extend `DashboardColor` with the status roles used by the tools dashboard:

```ts
  | "success"
  | "error"
  | "warning";
```

2. Keep all imports relative to `src/tui/`; do not import any module from `pi-usage`.

- [ ] **Step 2: Add frame and tab-bar regression tests**

Create `tests/tui/overlay-render.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  frame,
  frameContentWidth,
  pad,
  renderTabBar,
} from "../../src/tui/overlay-render.ts";
import { noTheme } from "../../src/tui/dashboard-theme.ts";

describe("overlay rendering", () => {
  it("pads and truncates visible content", () => {
    expect(pad("hi", 5)).toBe("hi   ");
    expect(visibleWidth(pad("hello world", 5))).toBe(5);
  });

  it("calculates frame content width", () => {
    expect(frameContentWidth(20)).toBe(14);
    expect(frameContentWidth(0)).toBe(1);
  });

  it("renders the heavy bordered frame", () => {
    const lines = frame(["hello"], 20, noTheme);
    expect(lines[0]).toContain("┏");
    expect(lines.at(-1)).toContain("┛");
    expect(lines.find((line) => line.includes("hello"))).toContain("┃");
  });

  it("renders active and inactive pills", () => {
    const result = renderTabBar(
      [
        { id: "providers", label: "Providers" },
        { id: "status", label: "Status" },
        { id: "test", label: "Test" },
        { id: "activity", label: "Activity" },
      ],
      "providers",
      80,
      noTheme,
    );
    expect(result).toContain("Providers");
    expect(result).toContain("Status");
    expect(result).toContain("Test");
    expect(result).toContain("Activity");
    expect(visibleWidth(result)).toBe(80);
  });
});
```

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
  it("provides a passthrough test theme", () => {
    expect(noTheme.fg("success", "ok")).toBe("ok");
    expect(noTheme.bg("selectedBg", "x")).toBe("x");
  });

  it("pads and truncates by visible width", () => {
    expect(padVisible("x", 3)).toBe("x  ");
    expect(truncateVisible("abcdef", 3)).toHaveLength(3);
  });

  it("wraps text into bounded lines", () => {
    expect(
      wrapVisible("one two three", 7).every((line) => line.length <= 7),
    ).toBe(true);
  });
});
```

- [ ] **Step 3: Run the shell tests**

Run:

```bash
pnpm exec vitest run tests/tui/overlay-render.test.ts tests/tui/dashboard-theme.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Commit the shell port**

```bash
git add src/tui tests/tui
git commit -m "feat: port usage overlay rendering shell"
```

---

### Task 2: Implement safe scoped config actions

**Files:**

- Create: `src/commands/tools-actions.ts`
- Create: `tests/commands/tools-actions.test.ts`
- Reference: `src/config.ts:findProjectConfigPath`, `src/config.ts:getConfigPath`, `src/utils/trust.ts:isProjectTrustedCached`

- [ ] **Step 1: Write filesystem and security tests first**

Create `tests/commands/tools-actions.test.ts` with these tests. Use `vi.mock("node:fs")`, restore mocks in `afterEach`, and mock `getConfigPath` only where a deterministic global path is needed.

```ts
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  classifyCredential,
  findWritableProjectPath,
  updateScopedConfig,
} from "../../src/commands/tools-actions.ts";

vi.mock("node:fs");

describe("credential policy", () => {
  it("accepts only uppercase environment names for project credentials", () => {
    expect(classifyCredential("BRAVE_API_KEY")).toEqual({
      kind: "env",
      value: "BRAVE_API_KEY",
    });
    expect(classifyCredential("sk-secret-value")).toEqual({
      kind: "literal",
      value: "sk-secret-value",
    });
    expect(classifyCredential("!op read op://vault/key")).toEqual({
      kind: "shell",
      value: "!op read op://vault/key",
    });
    expect(classifyCredential("lower_case")).toEqual({
      kind: "literal",
      value: "lower_case",
    });
  });
});

describe("project path", () => {
  it("uses the nearest existing project config", () => {
    vi.mocked(fs.existsSync).mockImplementation(
      (candidate) => candidate === path.join("/repo", ".pi", "tools.json"),
    );
    expect(findWritableProjectPath("/repo/packages/app")).toBe(
      path.join("/repo", ".pi", "tools.json"),
    );
  });

  it("falls back to cwd when no project config exists", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(findWritableProjectPath("/repo/packages/app")).toBe(
      path.join("/repo/packages/app", ".pi", "tools.json"),
    );
  });
});

describe("updateScopedConfig", () => {
  it("preserves unknown fields and untouched provider fields", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        unknown: { keep: true },
        providers: {
          brave: { enabled: false, apiKey: "BRAVE_API_KEY", custom: 7 },
        },
      }),
    );
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);

    updateScopedConfig(
      { scope: "global", cwd: "/repo", trusted: true },
      (document) => {
        const providers = document.providers as Record<
          string,
          Record<string, unknown>
        >;
        providers.brave.enabled = true;
        return document;
      },
    );

    const [, raw] = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(raw as string);
    expect(written.unknown.keep).toBe(true);
    expect(written.providers.brave.custom).toBe(7);
    expect(written.providers.brave.enabled).toBe(true);
  });

  it("does not overwrite malformed JSON", () => {
    vi.mocked(fs.readFileSync).mockReturnValue("{ malformed");
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);

    expect(() =>
      updateScopedConfig(
        { scope: "global", cwd: "/repo", trusted: true },
        (document) => document,
      ),
    ).toThrow();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("does not overwrite on non-ENOENT read errors", () => {
    const error = Object.assign(new Error("permission denied"), {
      code: "EACCES",
    });
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw error;
    });
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);

    expect(() =>
      updateScopedConfig(
        { scope: "global", cwd: "/repo", trusted: true },
        (document) => document,
      ),
    ).toThrow("permission denied");
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("rejects project writes from an untrusted project", () => {
    expect(() =>
      updateScopedConfig(
        { scope: "project", cwd: "/repo", trusted: false },
        (document) => document,
      ),
    ).toThrow(/trusted/i);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });
});
```

Add action-level tests for `setProviderKey`: project `BRAVE_API_KEY` succeeds; project literal and `!command` values throw; global literal succeeds. Add tests for toggle/default updates and `runProviderTest` passing the raw `AbortSignal` as the third argument.

- [ ] **Step 2: Run the new test file and verify failure**

Run:

```bash
pnpm exec vitest run tests/commands/tools-actions.test.ts
```

Expected: FAIL because `tools-actions.ts` does not exist.

- [ ] **Step 3: Implement the action module with exact contracts**

Create `src/commands/tools-actions.ts` with these exports and behavior:

```ts
import * as fs from "node:fs";
import * as path from "node:path";
import { getConfigPath, findProjectConfigPath } from "../config.ts";
import type { ProviderRegistry } from "../providers/registry.ts";

const ENV_NAME = /^[A-Z][A-Z0-9_]+$/;

type ConfigDocument = Record<string, unknown>;
export type ConfigScope = "global" | "project";
export type CredentialClass = {
  kind: "env" | "literal" | "shell";
  value: string;
};

export interface ScopeOptions {
  scope: ConfigScope;
  cwd: string;
  trusted: boolean;
}

export function classifyCredential(value: string): CredentialClass {
  if (value.startsWith("!")) return { kind: "shell", value };
  if (ENV_NAME.test(value)) return { kind: "env", value };
  return { kind: "literal", value };
}

export function findWritableProjectPath(cwd: string): string {
  return findProjectConfigPath(cwd) ?? path.join(cwd, ".pi", "tools.json");
}

function targetPath(options: ScopeOptions): string {
  if (options.scope === "project") {
    if (!options.trusted)
      throw new Error(
        "Project is not trusted; refusing to write project configuration",
      );
    return findWritableProjectPath(options.cwd);
  }
  return getConfigPath();
}

function readDocument(filePath: string): ConfigDocument {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as ConfigDocument;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export function updateScopedConfig(
  options: ScopeOptions,
  updater: (document: ConfigDocument) => ConfigDocument,
): string {
  const filePath = targetPath(options);
  const document = readDocument(filePath);
  const updated = updater(document);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(updated, null, 2));
  return filePath;
}

export function setProviderEnabled(
  options: ScopeOptions,
  provider: string,
  enabled: boolean,
): string {
  return updateScopedConfig(options, (document) => {
    const providers = (document.providers ?? {}) as Record<
      string,
      ConfigDocument
    >;
    providers[provider] = { ...(providers[provider] ?? {}), enabled };
    return { ...document, providers };
  });
}

export function setProviderKey(
  options: ScopeOptions,
  provider: string,
  value: string,
): string {
  const credential = classifyCredential(value);
  if (options.scope === "project" && credential.kind !== "env") {
    throw new Error("Project credentials must be environment-variable names");
  }
  return updateScopedConfig(options, (document) => {
    const providers = (document.providers ?? {}) as Record<
      string,
      ConfigDocument
    >;
    providers[provider] = { ...(providers[provider] ?? {}), apiKey: value };
    return { ...document, providers };
  });
}

export function setDefaultProvider(
  options: ScopeOptions,
  provider: string,
  known: ReadonlySet<string>,
): string {
  if (provider !== "auto" && !known.has(provider))
    throw new Error(`Unknown provider: ${provider}`);
  return updateScopedConfig(options, (document) => ({
    ...document,
    defaultProvider: provider,
  }));
}

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
  if (!provider)
    return {
      provider: providerName,
      ok: false,
      latencyMs: 0,
      resultCount: 0,
      message: "not found or not enabled",
    };
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

The implementation must not catch JSON parse errors or non-`ENOENT` errors inside `readDocument`. Keep the updater narrow so unknown fields survive.

- [ ] **Step 4: Run action tests**

Run:

```bash
pnpm exec vitest run tests/commands/tools-actions.test.ts
```

Expected: all action tests pass.

- [ ] **Step 5: Commit the action module**

```bash
git add src/commands/tools-actions.ts tests/commands/tools-actions.test.ts
git commit -m "feat: add safe scoped tools configuration actions"
```

---

### Task 3: Build the four-tab dashboard component

**Files:**

- Create: `src/commands/tools-dashboard.ts`
- Create: `tests/commands/tools-dashboard.test.ts`

- [ ] **Step 1: Define dashboard state and action types in the test**

Create a minimal registry test double and test the public behavior:

```ts
import { describe, expect, it, vi } from "vitest";
import type { ActivityEntry } from "../../src/monitor/activity-monitor.ts";
import {
  ToolsDashboardComponent,
  type DashboardAction,
} from "../../src/commands/tools-dashboard.ts";
import { noTheme } from "../../src/tui/dashboard-theme.ts";

function registryDouble() {
  return {
    getSearchProviderNames: () => ["brave", "duckduckgo"],
    getProviderNames: () => ["brave", "duckduckgo"],
    getBudgetStatus: vi.fn(() => ({ mode: "managed" as const })),
    getMetrics: vi.fn(() => undefined),
    selectSearchCandidates: vi.fn(() => []),
  } as never;
}

function dashboard(
  done = vi.fn(),
  scope = {
    kind: "global" as const,
    path: "/tmp/tools.json",
    canEditKeys: true,
  },
  activity: readonly ActivityEntry[] = [],
) {
  const componentOptions = {
    tui: { requestRender: vi.fn() } as never,
    theme: noTheme,
    registry: registryDouble(),
    tierMap: new Map([
      ["brave", 1],
      ["duckduckgo", 3],
    ]),
    providerNames: ["brave", "duckduckgo"],
    config: {
      providers: {
        brave: {
          enabled: true,
          apiKey: "BRAVE_API_KEY",
          budget: { mode: "managed" },
        },
        duckduckgo: { enabled: false, budget: { mode: "unlimited" } },
      },
      defaultProvider: "brave",
    },
    scope,
    renderStatusTable: () => "mock table",
    getActivity: () => activity,
    widgetEnabled: false,
    done,
  };
  return {
    done,
    componentOptions,
    component: new ToolsDashboardComponent(componentOptions),
  };
}

describe("ToolsDashboardComponent", () => {
  it("renders the four tabs and provider state", () => {
    const { component } = dashboard();
    const output = component.render(100).join("\n");
    expect(output).toContain("Providers");
    expect(output).toContain("Status");
    expect(output).toContain("Test");
    expect(output).toContain("Activity");
    expect(output).toContain("brave");
    expect(output).toContain("env: BRAVE_API_KEY");
    expect(output).toContain("default");
  });

  it("uses pi-tui key matching and returns actions", () => {
    const done = vi.fn();
    const { component } = dashboard(done);
    component.handleInput("\r");
    expect(done).toHaveBeenCalledWith({ type: "toggle", provider: "brave" });

    done.mockClear();
    component.handleInput("d");
    expect(done).toHaveBeenCalledWith({
      type: "set-default",
      provider: "brave",
    });
  });

  it("switches tabs and requests repaint after navigation", () => {
    const { component } = dashboard();
    const tui = (
      component as never as {
        options: { tui: { requestRender: ReturnType<typeof vi.fn> } };
      }
    ).options.tui;
    component.handleInput("\t");
    expect(component.render(100).join("\n")).toContain("Status");
    expect(tui.requestRender).toHaveBeenCalled();
  });

  it("does not expose a key action when project key editing is disabled", () => {
    const done = vi.fn();
    const { component } = dashboard(done, {
      kind: "project",
      path: "/repo/.pi/tools.json",
      canEditKeys: false,
    });
    component.handleInput("k");
    expect(done).not.toHaveBeenCalled();
  });
});
```

Implement the test helper without adding a production-only test hook: instead, construct the component with the project scope in a separate test. The public option shape must make `canEditKeys` explicit.

- [ ] **Step 2: Run the dashboard tests to verify failure**

Run:

```bash
pnpm exec vitest run tests/commands/tools-dashboard.test.ts
```

Expected: FAIL because `tools-dashboard.ts` does not exist.

- [ ] **Step 3: Implement the dashboard public contracts**

Create `src/commands/tools-dashboard.ts` with these types and constructor contract:

```ts
import type { Component, KeybindingsManager, TUI } from "@earendil-works/pi-tui";
import type { PiToolsConfig } from "../config.ts";
import type { ProviderRegistry } from "../providers/registry.ts";
import type { ProviderTier } from "../providers/types.ts";
import type { DashboardTheme } from "../tui/dashboard-theme.ts";
import type { ActivityEntry } from "../monitor/activity-monitor.ts";

export type DashboardAction =
  | { type: "toggle"; provider: string }
  | { type: "set-key"; provider: string }
  | { type: "set-default"; provider: string }
  | { type: "reload" }
  | { type: "toggle-widget" }
  | { type: "switch-scope" }
  | { type: "close" };

export interface DashboardScope {
  kind: "global" | "project";
  path: string;
  canEditKeys: boolean;
}

export interface DashboardOptions {
  tui: TUI;
  theme: DashboardTheme;
  keybindings: KeybindingsManager;
  registry: ProviderRegistry;
  tierMap: ReadonlyMap<string, ProviderTier>;
  providerNames: readonly string[];
  config: Pick<PiToolsConfig, "providers" | "defaultProvider">;
  scope: DashboardScope;
  renderStatusTable: () => string;
  getActivity: () => readonly ActivityEntry[];
  widgetEnabled: boolean;
  done: (action: DashboardAction) => void;
}

Declare `ToolsDashboardComponent implements Component` with these private fields: `activeTab`, `providerIndex`, `testIndex`, `testAbortController`, and `testResults`. Its constructor accepts `DashboardOptions`; its public methods are `render(width: number): string[]`, `handleInput(data: string): void`, `invalidate(): void`, and `dispose(): void`. `dispose()` aborts `testAbortController` and clears it.
```

Implement the following behavior in the class:

- Four tab IDs: `providers`, `status`, `test`, `activity`.
- Tab switching with `matchesKey(data, Key.tab)` and `matchesKey(data, "shift+tab")`.
- Close with `data === "q"` or `matchesKey(data, Key.escape)`; call `dispose()` before `done({ type: "close" })`.
- Providers reads `options.config.providers[name]` for enabled/key/budget/default display. Use `classifyCredential()` only for display classification; never display literal values. Use `padVisible` and `truncateVisible` for all columns.
- Providers actions: Enter → toggle; `k` → set-key only when `scope.canEditKeys`; `d` → set-default; Left/Right → `{ type: "switch-scope" }`; all state changes call `tui.requestRender()`.
- Status calls the injected `renderStatusTable()` callback and handles `r` through `{ type: "reload" }`.
- Test uses `runProviderTest`/`runProviderTests`, owns one `AbortController`, stores results, and calls `tui.requestRender()` before and after awaits. `dispose()` aborts and clears the controller.
- Activity shows `getActivity().slice(-10)` with the existing `formatEntryLine()` and handles `w` through `{ type: "toggle-widget" }`.
- `invalidate()` does not abort tests or clear persistent widget state; `dispose()` does cleanup.

`renderStatusTable` is supplied by `tools.ts` and avoids a module cycle. The implementation also imports `TestResult` from `tools-actions.ts`.

- [ ] **Step 4: Run dashboard tests**

Run:

```bash
pnpm exec vitest run tests/commands/tools-dashboard.test.ts
```

Expected: all dashboard tests pass.

- [ ] **Step 5: Commit the dashboard component**

```bash
git add src/commands/tools-dashboard.ts tests/commands/tools-dashboard.test.ts
 git commit -m "feat: add four-tab tools dashboard component"
```

---

### Task 4: Replace command dispatch and own the dashboard loop/widget lifecycle

**Files:**

- Modify: `src/commands/tools.ts`
- Modify: `src/index.ts`
- Modify: `tests/commands/tools.test.ts`

- [ ] **Step 1: Add command-level tests before changing dispatch**

Update `tests/commands/tools.test.ts` with a concrete command fixture:

```ts
const commandRegistry = {
  getProviderNames: () => [],
  getSearchProviderNames: () => [],
  getBudgetStatus: () => undefined,
  getMetrics: () => undefined,
} as unknown as ProviderRegistry;
const commandTiers = new Map<string, ProviderTier>();
const commandDeps = {
  getConfig: () => ({ providers: {}, defaultProvider: "auto" }),
  reload: vi.fn(),
};

it("opens the overlay only for an empty argument string", async () => {
  const ctx = makeCtx();
  const custom = vi.spyOn(ctx.ui, "custom").mockResolvedValue(undefined);
  const command = createToolsCommand(
    commandRegistry,
    commandTiers,
    [],
    commandDeps,
  );
  await command.handler("", ctx);
  expect(custom).toHaveBeenCalledWith(
    expect.any(Function),
    expect.objectContaining({ overlay: true }),
  );
});

it("rejects typed subcommands without changing config", async () => {
  const ctx = makeCtx();
  const command = createToolsCommand(
    commandRegistry,
    commandTiers,
    [],
    commandDeps,
  );
  await command.handler("status", ctx);
  expect(ctx.ui.notify).toHaveBeenCalledWith(
    expect.stringContaining("no longer supports"),
    "warning",
  );
});

it("does not open a dashboard without UI", async () => {
  const ctx = { ...makeCtx(), hasUI: false };
  const custom = vi.spyOn(ctx.ui, "custom");
  const command = createToolsCommand(
    commandRegistry,
    commandTiers,
    [],
    commandDeps,
  );
  await command.handler("", ctx);
  expect(custom).not.toHaveBeenCalled();
  expect(ctx.ui.notify).toHaveBeenCalledWith(
    expect.stringContaining("interactive UI"),
    "warning",
  );
});
```

Change the factory signature to `(registry, tierMap, allProviderNames, deps)` where `deps` is the exact `ToolsCommandDeps` interface defined in Step 2.

- [ ] **Step 2: Define the command dependency interface**

Add this interface to `src/commands/tools.ts` and use it in `createToolsCommand`:

```ts
export interface ToolsCommandDeps {
  getConfig: () => Pick<PiToolsConfig, "providers" | "defaultProvider">;
  reload: () => void;
}
```

`src/index.ts` passes:

```ts
const toolsCommand = createToolsCommand(registry, tierMap, allProviderNames, {
  getConfig: () => ({
    providers: configManager.current.providers,
    defaultProvider: configManager.current.defaultProvider,
  }),
  reload: () => configManager.refresh(true),
});
```

The command handler uses its own `ctx.isProjectTrusted()` for the active invocation, so no cached trust state is needed in the command dependency object.

- [ ] **Step 3: Implement the command loop**

Rewrite `src/commands/tools.ts` while preserving the existing `formatAmount()` and `buildStatusTable()` implementation. The command handler must follow this structure:

```ts
async handler(args, ctx) {
  if (!ctx.hasUI) {
    ctx.ui.notify("/tools requires interactive UI", "warning");
    return;
  }
  if (args.trim() !== "") {
    ctx.ui.notify(MIGRATION_HINT, "warning");
    return;
  }

  let widgetEnabled = false;
  let widgetUnsubscribe: (() => void) | undefined;
  let activeTui: TUI | undefined;

  const clearWidget = () => {
    widgetUnsubscribe?.();
    widgetUnsubscribe = undefined;
    ctx.ui.setWidget("pi-tools-activity", undefined);
  };

  const setWidget = (enabled: boolean) => {
    if (!enabled) {
      widgetEnabled = false;
      clearWidget();
      return;
    }
    if (widgetUnsubscribe) return;
    widgetEnabled = true;
    const repaint = () => {
      ctx.ui.setWidget("pi-tools-activity", renderWidgetLines(activityMonitor.getEntries(), ctx.ui.theme));
      activeTui?.requestRender();
    };
    widgetUnsubscribe = activityMonitor.onUpdate(repaint);
    repaint();
  };

  // Reopen after each action so the component receives fresh effective config.
  // The loop exits only when the dashboard returns { type: "close" }.
  while (true) {
    const scope = selectedScope === "global"
      ? { kind: "global" as const, path: getConfigPath(), canEditKeys: true }
      : {
          kind: "project" as const,
          path: findWritableProjectPath(ctx.cwd),
          canEditKeys: ctx.isProjectTrusted(),
        };
    const action = await ctx.ui.custom<DashboardAction>(
      (tui, theme, keybindings, done) => {
        activeTui = tui;
        return new ToolsDashboardComponent({
          tui,
          theme: fromPiTheme(theme),
          keybindings,
          registry,
          tierMap,
          providerNames,
          config: deps.getConfig(),
          scope,
          renderStatusTable: () => buildStatusTable(registry, tierMap),
          getActivity: () => activityMonitor.getEntries(),
          widgetEnabled,
          done,
        });
      },
      { overlay: true, overlayOptions: { anchor: "center", maxHeight: "85%", width: "92%" } },
    );

    if (action.type === "close") break;
    if (action.type === "switch-scope") {
      selectedScope = selectedScope === "global" ? "project" : "global";
      continue;
    }
    if (action.type === "toggle-widget") {
      setWidget(!widgetEnabled);
      continue;
    }
    await applyDashboardAction(action, ctx, deps, providerNames, scope);
  }

  activeTui = undefined;
  // Do not clear the widget here: widget state persists after overlay close.
}
```

Add `selectedScope: ConfigScope = "global"` before the loop. Implement `applyDashboardAction(action, ctx, deps, providerNames, scope)` in `tools.ts` with these exact rules:

```ts
async function applyDashboardAction(
  action: Exclude<
    DashboardAction,
    { type: "close" | "switch-scope" | "toggle-widget" }
  >,
  ctx: ExtensionCommandContext,
  deps: ToolsCommandDeps,
  providerNames: readonly string[],
  scope: DashboardScope,
): Promise<void> {
  try {
    if (action.type === "reload") {
      deps.reload();
      return;
    }
    if (action.type === "toggle") {
      const current = deps.getConfig().providers[action.provider];
      setProviderEnabled(
        { scope: scope.kind, cwd: ctx.cwd, trusted: ctx.isProjectTrusted() },
        action.provider,
        current?.enabled !== true,
      );
      deps.reload();
      ctx.ui.notify(
        `${action.provider} ${current?.enabled === true ? "disabled" : "enabled"}`,
        "info",
      );
      return;
    }
    if (action.type === "set-default") {
      setDefaultProvider(
        { scope: scope.kind, cwd: ctx.cwd, trusted: ctx.isProjectTrusted() },
        action.provider,
        new Set(providerNames),
      );
      deps.reload();
      ctx.ui.notify(`Default provider set to ${action.provider}`, "info");
      return;
    }
    if (action.type === "set-key") {
      const value = await ctx.ui.input(
        `API key for ${action.provider}`,
        "Environment variable name or key",
      );
      if (value === undefined) return;
      setProviderKey(
        { scope: scope.kind, cwd: ctx.cwd, trusted: ctx.isProjectTrusted() },
        action.provider,
        value.trim(),
      );
      deps.reload();
      ctx.ui.notify(`API key for ${action.provider} updated`, "info");
    }
  } catch (error) {
    ctx.ui.notify(
      error instanceof Error ? error.message : String(error),
      "warning",
    );
  }
}
```

For project scope, `setProviderKey()` rejects literals and shell commands before any write. The `r` action calls `deps.reload()` and reopens the dashboard with fresh config.

- [ ] **Step 4: Make widget cleanup explicit in the command object**

Return a `resetMonitor()` method that owns the same `widgetUnsubscribe` and enabled state used by the dashboard loop:

```ts
resetMonitor(): void {
  widgetUnsubscribe?.();
  widgetUnsubscribe = undefined;
  ctx.ui.setWidget("pi-tools-activity", undefined);
  widgetEnabled = false;
  activityMonitor.clear();
}
```

Ensure no component-level monitor subscription remains after disposal. Update `src/index.ts` only to pass the current config/reload dependencies and retain:

```ts
pi.on("session_shutdown", () => {
  toolsCommand.resetMonitor();
});
```

- [ ] **Step 5: Run command tests**

Run:

```bash
pnpm exec vitest run tests/commands/tools.test.ts
```

Expected: command dispatch, migration, status table, and widget cleanup tests pass.

- [ ] **Step 6: Commit command integration**

```bash
git add src/commands/tools.ts src/index.ts tests/commands/tools.test.ts
 git commit -m "refactor: open tools dashboard and preserve widget lifecycle"
```

---

### Task 5: Remove obsolete setup/subcommand modules and migrate tests

**Files:**

- Delete: `src/commands/tools-setup.ts`
- Delete: `src/commands/tools-subcommands.ts`
- Delete: `tests/commands/tools-setup.test.ts`
- Delete: `tests/commands/tools-subcommands.test.ts`
- Modify: any remaining tests importing the deleted modules

- [ ] **Step 1: Find all obsolete imports**

Run:

```bash
grep -RIn --include='*.ts' 'tools-setup\|tools-subcommands' src tests
```

Expected: only the files listed for deletion and no surviving production imports.

- [ ] **Step 2: Delete obsolete modules and tests**

Run:

```bash
rm src/commands/tools-setup.ts src/commands/tools-subcommands.ts
rm tests/commands/tools-setup.test.ts tests/commands/tools-subcommands.test.ts
```

- [ ] **Step 3: Verify old commands are absent**

Run:

```bash
grep -RIn --include='*.ts' 'parseArgs\|handleEnhancedSetup\|handleToggle\|handleKey\|handleDefault\|handleTest' src tests
```

Expected: no matches.

- [ ] **Step 4: Run the complete test suite**

Run:

```bash
pnpm exec vitest run
```

Expected: all tests pass.

- [ ] **Step 5: Commit deletion**

```bash
git add -A
 git commit -m "refactor: remove typed tools setup and subcommands"
```

---

### Task 6: Add acceptance-level regression coverage

**Files:**

- Modify: `tests/commands/tools-actions.test.ts`
- Modify: `tests/commands/tools-dashboard.test.ts`
- Modify: `tests/commands/tools.test.ts`

- [ ] **Step 1: Add config safety assertions**

Add these concrete cases to `tests/commands/tools-actions.test.ts`:

```ts
it("preserves unknown fields during a toggle", () => {
  vi.mocked(fs.readFileSync).mockReturnValue(
    JSON.stringify({
      extra: { keep: true },
      providers: { brave: { enabled: false, custom: 7 } },
    }),
  );
  vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
  setProviderEnabled(
    { scope: "global", cwd: "/repo", trusted: true },
    "brave",
    true,
  );
  const written = JSON.parse(
    String(vi.mocked(fs.writeFileSync).mock.calls[0][1]),
  );
  expect(written.extra.keep).toBe(true);
  expect(written.providers.brave.custom).toBe(7);
  expect(written.providers.brave.enabled).toBe(true);
});

it("preserves unknown provider fields during a key update", () => {
  vi.mocked(fs.readFileSync).mockReturnValue(
    JSON.stringify({ providers: { brave: { enabled: true, custom: 7 } } }),
  );
  vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
  setProviderKey(
    { scope: "global", cwd: "/repo", trusted: true },
    "brave",
    "literal-secret",
  );
  const written = JSON.parse(
    String(vi.mocked(fs.writeFileSync).mock.calls[0][1]),
  );
  expect(written.providers.brave.custom).toBe(7);
  expect(written.providers.brave.apiKey).toBe("literal-secret");
});

it.each(["literal-secret", "!op read op://vault/key"])(
  "rejects project credential %s",
  (value) => {
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    expect(() =>
      setProviderKey(
        { scope: "project", cwd: "/repo", trusted: true },
        "brave",
        value,
      ),
    ).toThrow(/environment-variable/i);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  },
);

it("writes to the nearest project file", () => {
  vi.mocked(fs.existsSync).mockImplementation(
    (candidate) => candidate === path.join("/repo", ".pi", "tools.json"),
  );
  vi.mocked(fs.readFileSync).mockReturnValue("{}");
  vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
  setProviderEnabled(
    { scope: "project", cwd: "/repo/packages/app", trusted: true },
    "brave",
    true,
  );
  expect(fs.writeFileSync.mock.calls[0][0]).toBe(
    path.join("/repo", ".pi", "tools.json"),
  );
});

it("writes to the cwd fallback project file", () => {
  vi.mocked(fs.existsSync).mockReturnValue(false);
  vi.mocked(fs.readFileSync).mockImplementation(() => {
    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  });
  vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
  setProviderEnabled(
    { scope: "project", cwd: "/repo/packages/app", trusted: true },
    "brave",
    true,
  );
  expect(fs.writeFileSync.mock.calls[0][0]).toBe(
    path.join("/repo/packages/app", ".pi", "tools.json"),
  );
});
```

Use concrete JSON fixtures and assert `fs.writeFileSync` call count/path/content; do not merely assert that an exception occurred.

- [ ] **Step 2: Add dashboard behavior assertions**

Add these concrete cases to `tests/commands/tools-dashboard.test.ts` using the existing `dashboard()` fixture and a `render(width)` helper:

```ts
it("renders disabled providers and hides literal secrets", () => {
  const { component } = dashboard();
  const output = component.render(140).join("\n");
  expect(output).toContain("duckduckgo");
  expect(output).toContain("disabled");
  expect(output).not.toContain("literal-secret");
});

it("returns set-key only for editable scope", () => {
  const editableDone = vi.fn();
  dashboard(editableDone).component.handleInput("k");
  expect(editableDone).toHaveBeenCalledWith({
    type: "set-key",
    provider: "brave",
  });

  const blockedDone = vi.fn();
  dashboard(blockedDone, {
    kind: "project",
    path: "/repo/.pi/tools.json",
    canEditKeys: false,
  }).component.handleInput("k");
  expect(blockedDone).not.toHaveBeenCalled();
});

it("returns reload from Status r", () => {
  const done = vi.fn();
  const { component } = dashboard(done);
  component.handleInput("\t");
  component.handleInput("r");
  expect(done).toHaveBeenCalledWith({ type: "reload" });
});

it("aborts a running test when disposed", async () => {
  let receivedSignal: AbortSignal | undefined;
  const registry = registryDouble() as any;
  registry.selectSearchCandidates = vi.fn(() => [
    {
      name: "brave",
      label: "Brave",
      search: vi.fn((_query, _count, signal) => {
        receivedSignal = signal;
        return new Promise<never>(() => undefined);
      }),
    },
  ]);
  const done = vi.fn();
  const { component } = dashboard(done);
  component.handleInput("\t");
  component.handleInput("\r");
  await Promise.resolve();
  component.dispose();
  expect(receivedSignal?.aborted).toBe(true);
});

it("keeps activity output bounded to ten entries", () => {
  const entries = Array.from({ length: 11 }, (_, index) => ({
    id: String(index),
    type: "api" as const,
    startTime: 0,
    status: 200,
    query: `query-${index}`,
  }));
  const { component } = dashboard(vi.fn(), undefined, entries);
  component.handleInput("\t");
  component.handleInput("\t");
  component.handleInput("\t");
  const output = component.render(140).join("\n");
  expect(output).not.toContain("query-0");
  expect(output).toContain("query-10");
});
```

Expose the existing constructor options through the test fixture as `componentOptions` rather than adding a production test hook. The test helper must provide a real `renderStatusTable` callback and the same `DashboardScope` used by production.

- [ ] **Step 3: Add width and shell parity assertions**

For widths `40`, `80`, and `140`, assert every rendered line has `visibleWidth(line) <= width`. Assert the output contains `┏`, `┛`, all four tab labels at width `140`, and overflow-safe tab rendering at width `40`.

- [ ] **Step 4: Run focused acceptance tests**

Run:

```bash
pnpm exec vitest run tests/commands/tools-actions.test.ts tests/commands/tools-dashboard.test.ts tests/commands/tools.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit acceptance coverage**

```bash
git add tests/commands
 git commit -m "test: cover tools dashboard safety and interaction acceptance"
```

---

### Task 7: Final verification and review

**Files:** none

- [ ] **Step 1: Run formatting and lint checks**

Run:

```bash
pnpm exec biome format --check src tests
pnpm exec biome lint src tests
```

Expected: both commands exit successfully.

- [ ] **Step 2: Run type checking**

Run:

```bash
pnpm exec tsc --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 3: Run the full project check**

Run:

```bash
pnpm check
```

Expected: Biome lint, TypeScript, and Vitest all pass.

- [ ] **Step 4: Verify dependency and import constraints**

Run:

```bash
grep -RIn --include='*.ts' 'pi-usage' src || true
git diff -- package.json pnpm-lock.yaml
```

Expected: no `pi-usage` imports and no dependency/lockfile changes.

- [ ] **Step 5: Review the final diff**

Run:

```bash
git diff --stat HEAD~6..HEAD
git status --short
```

Expected: only the planned TUI, command, lifecycle, test, and documentation files changed; the worktree is clean after commits.

- [ ] **Step 6: Commit only if a final documentation correction was required**

Do not create an empty verification commit. If the final review found a documentation-only correction, commit it explicitly:

```bash
git add docs/superpowers/specs/2026-07-20-tools-dashboard-refactor-design.md docs/superpowers/plans/2026-07-20-tools-dashboard-refactor.md
git commit -m "docs: clarify tools dashboard implementation details"
```

## Self-review checklist

- [x] Every spec requirement maps to Tasks 2–6: scoped writes, trust/key restrictions, provider actions, four tabs, aborts, widget lifecycle, migration, and width-safe rendering.
- [x] The corrupted duplicate plan and raw tool markup are removed.
- [x] No task relies on malformed JSON being overwritten.
- [x] Project paths use the existing nearest-config helper with a cwd fallback.
- [x] Project shell commands are rejected; only environment-variable names are accepted.
- [x] Provider state comes from effective config rather than metrics existence.
- [x] Provider search uses `search(query, maxResults, signal)`.
- [x] Keyboard handling uses `matchesKey()` and `Key` constants.
- [x] Async state changes call `tui.requestRender()`.
- [x] Widget ownership and shutdown cleanup have one owner.
- [x] No `TODO`, `TBD`, “implement later”, or unresolved task references remain.
