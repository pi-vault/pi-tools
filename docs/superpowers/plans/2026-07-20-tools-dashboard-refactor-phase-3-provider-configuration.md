# /tools Dashboard Refactor Phase 3: Provider Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Providers tab that safely edits global or project provider configuration without exposing secrets or overwriting malformed files.

**Architecture:** Put path policy and read-modify-write operations in `tools-actions.ts`; render only effective config in `tools-dashboard.ts`; perform prompts, writes, reloads, and notifications in the `tools.ts` dashboard loop. Existing typed subcommands remain available until Phase 4.

**Tech Stack:** TypeScript, Node `fs/path`, Pi TUI, existing config/trust helpers, Vitest.

**Prerequisite:** Phases 1–2 are implemented and `pnpm check` passes.

**Usable result:** `/tools` can enable/disable providers, update credentials, and choose a default in Global or Project scope. Unsafe project credentials and malformed config writes are blocked. Status, Activity, widget, and legacy subcommands remain usable.

---

## File map

- Create `src/commands/tools-actions.ts`: credential classification, target path selection, safe document mutation, and provider/default actions.
- Create `tests/commands/tools-actions.test.ts`: path, malformed JSON, preservation, trust, and credential policy.
- Modify `src/config.ts`: derive project config paths from Pi's exported `CONFIG_DIR_NAME`.
- Modify `tests/config.test.ts`: keep project path regressions aligned with `CONFIG_DIR_NAME`.
- Modify `src/commands/tools-dashboard.ts`: Providers tab, bounded provider selection, scope selection, resume state, safe key-state rendering, and action results.
- Modify `tests/commands/tools-dashboard.test.ts`: provider rendering/navigation/action/security behavior.
- Modify `src/commands/tools.ts`: current-config dependency, provider action orchestration, prompt handling, and scope loop.
- Modify `src/index.ts`: pass current effective config and forced reload callbacks.
- Modify `tests/commands/tools.test.ts`: command action integration and warning paths.

---

### Task 1: Implement safe scoped configuration actions

**Files:**
- Create: `src/commands/tools-actions.ts`
- Create: `tests/commands/tools-actions.test.ts`
- Modify: `src/config.ts`
- Modify: `tests/config.test.ts`

- [ ] **Step 1: Write filesystem and security tests first**

Create `tests/commands/tools-actions.test.ts` using `vi.mock("node:fs")`, `vi.restoreAllMocks()` in `afterEach`, and these required cases:

```ts
import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyCredential,
  findWritableProjectPath,
  setDefaultProvider,
  setProviderEnabled,
  setProviderKey,
  updateScopedConfig,
} from "../../src/commands/tools-actions.ts";

vi.mock("node:fs");

afterEach(() => vi.restoreAllMocks());

describe("project credential policy", () => {
  it("classifies env names, literals, and shell commands", () => {
    expect(classifyCredential("BRAVE_API_KEY").kind).toBe("env");
    expect(classifyCredential("literal-secret").kind).toBe("literal");
    expect(classifyCredential("!op read op://vault/key").kind).toBe("shell");
    expect(classifyCredential("lower_case").kind).toBe("literal");
  });

  it.each(["literal-secret", "!op read op://vault/key", "lower_case"]) (
    "rejects project credential %s before reading or writing",
    (value) => {
      expect(() =>
        setProviderKey(
          { scope: "project", cwd: "/repo", trusted: true },
          "brave",
          value,
        ),
      ).toThrow(/environment-variable/i);
      expect(fs.readFileSync).not.toHaveBeenCalled();
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    },
  );
});

describe("project config target", () => {
  it("uses the nearest existing project file", () => {
    vi.mocked(fs.existsSync).mockImplementation(
      (candidate) =>
        candidate === path.join("/repo", CONFIG_DIR_NAME, "tools.json"),
    );
    expect(findWritableProjectPath("/repo/packages/app")).toBe(
      path.join("/repo", CONFIG_DIR_NAME, "tools.json"),
    );
  });

  it("falls back to cwd when no project file exists", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(findWritableProjectPath("/repo/packages/app")).toBe(
      path.join("/repo/packages/app", CONFIG_DIR_NAME, "tools.json"),
    );
  });
});

describe("safe read-modify-write", () => {
  it("preserves unknown root and provider fields", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      extra: { keep: true },
      providers: { brave: { enabled: false, custom: 7 } },
    }));
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);

    setProviderEnabled(
      { scope: "global", cwd: "/repo", trusted: true },
      "brave",
      true,
    );

    const written = JSON.parse(String(vi.mocked(fs.writeFileSync).mock.calls[0][1]));
    expect(written.extra.keep).toBe(true);
    expect(written.providers.brave.custom).toBe(7);
    expect(written.providers.brave.enabled).toBe(true);
  });

  it.each(["{ malformed", "null", "[]"]) (
    "does not overwrite invalid document %s",
    (raw) => {
      vi.mocked(fs.readFileSync).mockReturnValue(raw);
      expect(() =>
        updateScopedConfig(
          { scope: "global", cwd: "/repo", trusted: true },
          (document) => document,
        ),
      ).toThrow();
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    },
  );

  it("does not overwrite on non-ENOENT read errors", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    });
    expect(() =>
      updateScopedConfig(
        { scope: "global", cwd: "/repo", trusted: true },
        (document) => document,
      ),
    ).toThrow("permission denied");
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("creates an empty document only for ENOENT", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    });
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    setProviderEnabled(
      { scope: "project", cwd: "/repo", trusted: true },
      "brave",
      true,
    );
    expect(fs.writeFileSync).toHaveBeenCalledOnce();
  });

  it("rejects every untrusted project write", () => {
    expect(() =>
      setDefaultProvider(
        { scope: "project", cwd: "/repo", trusted: false },
        "auto",
        new Set(["brave"]),
      ),
    ).toThrow(/trusted/i);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });
});
```

Also add positive tests proving project `BRAVE_API_KEY` and global literal/shell values are written, `setDefaultProvider` accepts `auto` but rejects unknown providers, and the exact nearest/fallback write path is passed to `writeFileSync`.

In `tests/config.test.ts`, import `CONFIG_DIR_NAME` and replace the hardcoded `.pi` segments in `findProjectConfigPath` expectations with `CONFIG_DIR_NAME`. This keeps the shared reader and the new writer on the same Pi-defined project directory.

- [ ] **Step 2: Run the test and verify failure**

```bash
pnpm exec vitest run tests/commands/tools-actions.test.ts
```

Expected: FAIL because `tools-actions.ts` does not exist.

- [ ] **Step 3: Implement the action contracts**

Create `src/commands/tools-actions.ts` with these exports:

```ts
export type ConfigScope = "global" | "project";
export interface ScopeOptions {
  scope: ConfigScope;
  cwd: string;
  trusted: boolean;
}
export type CredentialClass = {
  kind: "env" | "literal" | "shell";
  value: string;
};
export function classifyCredential(value: string): CredentialClass;
export function findWritableProjectPath(cwd: string): string;
export function updateScopedConfig(
  options: ScopeOptions,
  updater: (document: Record<string, unknown>) => Record<string, unknown>,
): string;
export function setProviderEnabled(
  options: ScopeOptions,
  provider: string,
  enabled: boolean,
): string;
export function setProviderKey(
  options: ScopeOptions,
  provider: string,
  value: string,
): string;
export function setDefaultProvider(
  options: ScopeOptions,
  provider: string,
  known: ReadonlySet<string>,
): string;
```

Import `CONFIG_DIR_NAME` alongside `getAgentDir` in `src/config.ts`, replace `path.join(".pi", "tools.json")` with `path.join(CONFIG_DIR_NAME, "tools.json")`, and update the adjacent comment.

Use `const ENV_NAME = /^[A-Z][A-Z0-9_]+$/`. Classify `!` first, then env names, then literals. Import `CONFIG_DIR_NAME` in `tools-actions.ts` and resolve project targets with:

```ts
findProjectConfigPath(cwd) ?? path.join(cwd, CONFIG_DIR_NAME, "tools.json")
```

Reject untrusted project writes in target selection before any read. Reject non-env project keys in `setProviderKey` before calling `updateScopedConfig`.

The reader must distinguish only `ENOENT`:

```ts
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readDocument(filePath: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!isRecord(parsed)) throw new Error("Tools config root must be a JSON object");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}
```

`setDefaultProvider` accepts `"auto"` without requiring it in `known`; every other value must satisfy `known.has(provider)` before reading or writing.

Each updater must create a new `providers` object and a new selected provider object while spreading existing fields. Write only after reading and updating succeeds:

```ts
fs.mkdirSync(path.dirname(filePath), { recursive: true });
fs.writeFileSync(filePath, `${JSON.stringify(updated, null, 2)}\n`);
```

Do not catch parse, validation, mkdir, or write errors.

- [ ] **Step 4: Run action tests and commit**

```bash
pnpm exec vitest run tests/config.test.ts tests/commands/tools-actions.test.ts
git add src/config.ts src/commands/tools-actions.ts tests/config.test.ts tests/commands/tools-actions.test.ts
git commit -m "feat: add safe scoped tools config actions"
```

Expected: all action tests pass.

---

### Task 2: Add the Providers tab

**Files:**
- Modify: `src/commands/tools-dashboard.ts`
- Modify: `tests/commands/tools-dashboard.test.ts`

- [ ] **Step 1: Extend the fixture and add failing behavior tests**

Add final provider-facing option types to the fixture:

```ts
const providerState = {
  providers: {
    brave: {
      enabled: true,
      apiKey: "BRAVE_API_KEY",
      budget: { mode: "managed" as const },
    },
    duckduckgo: {
      enabled: false,
      apiKey: "literal-secret",
      budget: { mode: "unlimited" as const },
    },
  },
  defaultProvider: "brave",
};
```

Supply `providerNames: ["brave", "duckduckgo"]`, `tierMap`, `config: providerState`, and:

```ts
scope: { kind: "global", path: "/tmp/tools.json", canEditKeys: true }
```

Add tests for all of these public behaviors:

- Providers is now the initial tab and all four provider fields render.
- Output contains `env: BRAVE_API_KEY`, `set` for the literal key, and never `literal-secret`.
- Enter returns a `toggle` action for `brave` with Providers resume state.
- Down then `d` returns `set-default` for `duckduckgo` and preserves that selection.
- `a` on Providers returns `set-default` for `auto`; it does not toggle or run tests.
- `k` returns `set-key` in editable scope and returns nothing when `canEditKeys` is false.
- Left and Right return `switch-scope` with Providers resume state.
- `initialTab: "activity"` opens Activity, and an external action carries that tab plus the selected provider.
- Existing Status reload and Activity widget tests now expect `activeTab` and `selectedProvider` resume metadata.
- Tab order is Providers → Status → Activity and Shift-Tab wraps back.
- At widths 40, 80, and 140 every rendered line stays within width.

Add a 12-provider case that presses Down eleven times and asserts the output contains the selected final row and `Showing 3–12 of 12`, omits the first row, and keeps every line within the supplied visible width.

- [ ] **Step 2: Run dashboard tests and verify failure**

```bash
pnpm exec vitest run tests/commands/tools-dashboard.test.ts
```

Expected: provider tests fail because only Status/Activity exist.

- [ ] **Step 3: Extend dashboard contracts**

Replace the Phase 2 action contracts with explicit resume state:

```ts
export type DashboardTabId = "providers" | "status" | "activity";

export interface DashboardResumeState {
  activeTab: DashboardTabId;
  selectedProvider?: string;
}

type ReopenDashboardAction =
  | { type: "reload" }
  | { type: "toggle-widget" }
  | { type: "toggle"; provider: string }
  | { type: "set-key"; provider: string }
  | { type: "set-default"; provider: string }
  | { type: "switch-scope" };

export type DashboardAction =
  | (ReopenDashboardAction & DashboardResumeState)
  | { type: "close" };

export interface DashboardScope {
  kind: "global" | "project";
  path: string;
  canEditKeys: boolean;
}
```

Extend `DashboardOptions` with `providerNames`, `tierMap`, `config: Pick<PiToolsConfig, "providers" | "defaultProvider">`, `scope`, `initialTab?: DashboardTabId`, and `initialProvider?: string`. Use tabs `[Providers, Status, Activity]`; default `initialTab` to Providers and initialize the selected row from `initialProvider` when it still exists.

Provider rows must derive enabled/key/budget/default from `options.config`, never from registry metrics. Key display rules are exact:

```ts
undefined -> "unset"
env credential -> `env: ${value}`
literal or shell credential -> "set"
```

Use `padVisible`/`truncateVisible` for columns. Display `options.scope.path`. Up/Down clamp selection to existing provider rows and request render. Render at most ten providers with:

```ts
const visibleCount = Math.min(10, providerNames.length);
const start = Math.max(
  0,
  Math.min(
    providerIndex - Math.floor(visibleCount / 2),
    providerNames.length - visibleCount,
  ),
);
const end = start + visibleCount;
```

Render `providerNames.slice(start, end)` and add `Showing ${start + 1}–${end} of ${providerNames.length}` when rows exist. This makes the selected row visible despite Pi's clipping-only overlay height.

Create a small `resume()` method that returns the active tab and selected provider. Enter, `k`, `d`, `a`, Left, Right, reload, and widget toggle merge `resume()` into the action passed to `finish()`. On Providers, `a` returns `{ type: "set-default", provider: "auto", ...resume }`; on other tabs it does nothing in this phase.

- [ ] **Step 4: Run tests and commit**

```bash
pnpm exec vitest run tests/commands/tools-dashboard.test.ts
git add src/commands/tools-dashboard.ts tests/commands/tools-dashboard.test.ts
git commit -m "feat: add tools provider configuration tab"
```

---

### Task 3: Orchestrate provider actions and refresh effective config

**Files:**
- Modify: `src/commands/tools.ts`
- Modify: `src/index.ts`
- Modify: `tests/commands/tools.test.ts`

- [ ] **Step 1: Add command integration tests**

Define the final dependency object in tests:

```ts
const commandDeps = {
  getConfig: vi.fn(() => providerState),
  reload: vi.fn(),
};
```

Mock `ctx.ui.custom()` to return one action and then close. Add cases proving:

- toggle writes the opposite effective `enabled` value, calls `reload`, and reopens;
- set-default writes the selected provider and reloads;
- set-default `auto` writes `defaultProvider: "auto"` over a prior explicit default and reloads;
- set-key prompts, trims the result, writes and reloads;
- cancelled key input writes nothing;
- project literal key produces a warning and no write;
- malformed JSON produces a warning and no write;
- switch-scope reopens with a project `DashboardScope` using the nearest/fallback `CONFIG_DIR_NAME` path;
- actions that reopen preserve `activeTab` and `selectedProvider` in the next component options;
- an untrusted project with an existing `<CONFIG_DIR_NAME>/tools.json` can select Project scope but has `canEditKeys: false` and cannot write;
- an untrusted project without an existing project config cannot select Project scope and receives a warning;
- Status/Activity/widget behavior from Phases 1–2 still passes.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
pnpm exec vitest run tests/commands/tools.test.ts
```

Expected: new provider action tests fail.

- [ ] **Step 3: Add the final command dependency contract**

```ts
export interface ToolsCommandDeps {
  getConfig: () => Pick<PiToolsConfig, "providers" | "defaultProvider">;
  reload: () => void;
}
```

Change `createToolsCommand` to `(registry, tierMap, allProviderNames, deps)`. Update every test construction and the extension registration in `src/index.ts`:

```ts
const toolsCommand = createToolsCommand(registry, tierMap, allProviderNames, {
  getConfig: () => ({
    providers: configManager.current.providers,
    defaultProvider: configManager.current.defaultProvider,
  }),
  reload: () => configManager.refresh(true),
});
```

Legacy reload/config subcommands call `deps.reload()` until their Phase 4 removal.

- [ ] **Step 4: Implement the scoped dashboard loop**

For each command invocation, initialize:

```ts
let selectedScope: ConfigScope = "global";
let resumeState: DashboardResumeState = { activeTab: "providers" };
```

Before each `custom()` call, derive:

```ts
const scope: DashboardScope = selectedScope === "global"
  ? { kind: "global", path: getConfigPath(), canEditKeys: true }
  : {
      kind: "project",
      path: findWritableProjectPath(ctx.cwd),
      canEditKeys: ctx.isProjectTrusted(),
    };
```

Pass current `deps.getConfig()`, scope, provider names, tiers, `initialTab: resumeState.activeTab`, and `initialProvider: resumeState.selectedProvider` to the component. Preserve Phase 2 Activity/widget options.

Immediately after the close guard, retain context for every reopening action:

```ts
if (!action || action.type === "close") return;
resumeState = {
  activeTab: action.activeTab,
  selectedProvider: action.selectedProvider,
};
```

Handle `switch-scope` and `toggle-widget` in the loop. On a Global → Project switch, allow the change only when `ctx.isProjectTrusted()` is true or `findProjectConfigPath(ctx.cwd)` returns an existing file; otherwise notify that Project scope requires trust or an existing project config and remain in Global scope. Switching Project → Global is always allowed. Send toggle, set-key, set-default, and reload to a private `applyDashboardAction()` that:

- wraps the whole action in `try/catch` and warns through `ctx.ui.notify`;
- calls `deps.reload()` only after successful writes or for explicit reload;
- uses `{ scope: scope.kind, cwd: ctx.cwd, trusted: ctx.isProjectTrusted() }` for every mutation;
- prompts with `ctx.ui.input()` only for `set-key`;
- treats `undefined` prompt result as cancellation;
- validates defaults against `new Set(allProviderNames)`;
- notifies success without printing any credential value.

After every non-close action, reopen the component so it receives fresh effective config.

- [ ] **Step 5: Run all checks and commit**

```bash
pnpm exec vitest run tests/config.test.ts tests/commands/tools-actions.test.ts tests/commands/tools-dashboard.test.ts tests/commands/tools.test.ts
pnpm exec biome format src/config.ts src/commands/tools-actions.ts src/commands/tools-dashboard.ts src/commands/tools.ts src/index.ts tests/config.test.ts tests/commands/tools-actions.test.ts tests/commands/tools-dashboard.test.ts tests/commands/tools.test.ts
pnpm check
git add src/commands/tools.ts src/index.ts tests/commands/tools.test.ts
git commit -m "feat: connect scoped provider actions to tools dashboard"
```

Expected: focused tests, the explicit changed-file format check, and full checks pass; typed subcommands still exist.

---

### Task 4: Phase verification

- [ ] **Step 1: Verify data-safety requirements**

```bash
pnpm exec vitest run tests/config.test.ts tests/commands/tools-actions.test.ts
grep -RIn --include='*.ts' 'path.join(".pi"' src || true
grep -RIn --include='*.ts' 'pi-usage' src || true
git diff -- package.json pnpm-lock.yaml
```

Expected: safety tests pass, the hardcoded project-path grep and runtime cross-repo import grep return no matches, and there is no dependency change.

- [ ] **Step 2: Verify the releasable checkpoint**

```bash
test -f src/commands/tools-subcommands.ts
test -f src/commands/tools-setup.ts
pnpm exec biome format src/config.ts src/commands/tools-actions.ts src/commands/tools-dashboard.ts src/commands/tools.ts src/index.ts tests/config.test.ts tests/commands/tools-actions.test.ts tests/commands/tools-dashboard.test.ts tests/commands/tools.test.ts
pnpm check
git status --short
```

Expected: the dashboard and old command paths both work, all checks pass, and the worktree is clean.
